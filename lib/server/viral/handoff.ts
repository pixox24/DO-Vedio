import { randomUUID } from "crypto";
import { emptyDoc, type Project, type ProjectDoc } from "../../core/types";
import { applyPresetToDoc, presetGroupIds } from "../../core/preset";
import { assessAdoption, currentVersion, fingerprint, handoffSettings, settingsFingerprint } from "../../viral/state";
import type { ViralAdoption, ViralAdoptRequest, ViralDraft, ViralHandoffSettings, ViralScriptVersion, ViralSyncImpact, ViralSyncRequest } from "../../viral/types";
import { get, json, run, tx } from "../db";
import { cancelProjectJobs } from "../jobs";
import { getDefaultPreset } from "../presets";
import { createProject, getProject, saveProjectWithinTx } from "../projects";
import { createVersionWithinTx } from "../versions";
import { ViralError } from "./errors";
import { assertDraftRevision, findAdoptionMapping, putDraftWithinTx, requireDraft, sourceByProject, writeAdoptionMappingWithinTx } from "./repository";

export type ViralHandoffResult = { draft: ViralDraft; projectId: string; url: string; reused: boolean };

/** Production has no source segment IDs; compare only the actual title and spoken text. */
export function productionScriptFingerprint(script: { title: string; segments: { title: string; text: string }[] }): string {
  return fingerprint({ title: script.title, segments: script.segments.map(({ title, text }) => ({ title, text })) });
}

function validate(draft: ViralDraft, request: ViralAdoptRequest) {
  if (draft.currentVersionId !== request.versionId || draft.input.handoff.settingsVersion !== request.settingsVersion)
    throw new ViralError("conflict", "稿件或制作设置已有变化，请刷新后采用", 409, { currentRevision: draft.revision });
  const assessment = assessAdoption(draft);
  if (!assessment.allowed) throw new ViralError(assessment.code === "incomplete" ? "needs_changes" : assessment.code!, assessment.reasons.join("；"), 409);
  if (!draft.input.platform) throw new ViralError("validation", "请选择目标平台");
  return { version: currentVersion(draft)!, settings: handoffSettings(draft) };
}

function withFrame(doc: ProjectDoc, settings: ViralHandoffSettings): ProjectDoc {
  return { ...doc, settings: { ...doc.settings, aspects: [settings.aspectRatio], previewAspect: settings.aspectRatio, outputSpecIds: [settings.aspectRatio === "9:16" ? "portrait-1080p" : "landscape-1080p"] } };
}

function withScript(doc: ProjectDoc, draft: ViralDraft, version: ViralScriptVersion, settings: ViralHandoffSettings): ProjectDoc {
  const outline = version.basedOn.outline;
  return withFrame({
    ...doc,
    brief: { ...doc.brief, title: version.title, summary: version.basedOn.selectedAngle?.coreClaim ?? draft.input.coreClaim,
      minutes: settings.targetSeconds / 60, templateId: settings.style.templateId, audience: draft.input.audience,
      perspective: settings.perspective, rate: settings.rate, mustInclude: draft.input.mustInclude.join("\n"), avoid: draft.input.avoid.join("\n"),
      slang: "off", memes: [], groundedEnabled: draft.input.humanize },
    modelId: draft.input.modelId,
    sections: outline?.sections.map((section) => ({ title: section.title, points: section.points.join("\n"), minutes: section.seconds / 60 }))
      ?? version.segments.map((segment) => ({ title: segment.title, points: "", minutes: settings.targetSeconds / 60 / version.segments.length })),
    segments: version.segments.map(({ title, text }) => ({ title, text })),
    metadata: null, lines: [], shots: [], characters: [], castAnalysis: null, scenes: [], music: [],
    settings: { ...doc.settings, voice: doc.settings.voice.instructionSource === "generated"
      ? { ...doc.settings.voice, instruction: "", instructionSource: "user" } : doc.settings.voice },
  }, settings);
}

function newProject(draft: ViralDraft, version: ViralScriptVersion, settings: ViralHandoffSettings) {
  let doc = emptyDoc();
  const preset = getDefaultPreset();
  if (preset) doc = applyPresetToDoc(doc, preset.payload, { groups: [...presetGroupIds], includeBudget: true }).doc;
  return createProject(withScript(doc, draft, version, settings));
}

function record(draft: ViralDraft, version: ViralScriptVersion, settings: ViralHandoffSettings, project: Project): ViralHandoffResult {
  const adoption: ViralAdoption = { id: randomUUID(), projectId: project.id, versionId: version.id, settings,
    adoptedScript: { title: version.title, segments: structuredClone(version.segments) }, createdAt: new Date().toISOString() };
  const key = settingsFingerprint(settings);
  if (findAdoptionMapping(draft.id, version.id, key)) {
    // A deliberate sync can return to a historical version. Keep the former snapshot in the draft ledger.
    run("UPDATE viral_adoptions SET id = ?, project_id = ?, body = ?, created_at = ? WHERE draft_id = ? AND version_id = ? AND settings_key = ?",
      adoption.id, project.id, json(adoption), Date.parse(adoption.createdAt), draft.id, version.id, key);
  } else writeAdoptionMappingWithinTx(draft.id, key, adoption);
  const next = putDraftWithinTx({ ...draft, adoptions: [...draft.adoptions, adoption] });
  return { draft: next, projectId: project.id, url: `/projects/${project.id}/video`, reused: false };
}

function mappingIsCurrent(draft: ViralDraft, adoption: ViralAdoption): boolean {
  return [...draft.adoptions].reverse().find((entry) => entry.projectId === adoption.projectId)?.versionId === adoption.versionId;
}

function reuse(draft: ViralDraft, adoption: ViralAdoption, settings: ViralHandoffSettings): ViralHandoffResult {
  const project = getProject(adoption.projectId);
  if (!project) throw new ViralError("handoff_conflict", "关联制作已被删除，请先在回收站恢复", 409);
  // A previously used setting can be chosen again. An unchanged retry leaves production intact.
  const desired = withFrame(project.doc, settings);
  if (fingerprint(project.doc.settings.aspects) !== fingerprint(desired.settings.aspects)
    || fingerprint(project.doc.settings.outputSpecIds) !== fingerprint(desired.settings.outputSpecIds)
    || project.doc.settings.previewAspect !== settings.aspectRatio) {
    run("DELETE FROM project_goals WHERE project_id = ?", project.id);
    cancelProjectJobs(project.id, ["render"]);
    saveProjectWithinTx(project.id, desired, project.revision);
  }
  return { draft, projectId: adoption.projectId, url: `/projects/${adoption.projectId}/video`, reused: true };
}

export function adoptViralDraft(id: string, request: ViralAdoptRequest): ViralHandoffResult {
  return tx(() => {
    const draft = requireDraft(id);
    const { version, settings } = validate(draft, request);
    const existing = findAdoptionMapping(id, version.id, settingsFingerprint(settings));
    // A successful retry carries the earlier draft revision. Identity is checked before the revision fence.
    if (existing) {
      if (!mappingIsCurrent(draft, existing.adoption)) throw new ViralError("handoff_conflict", "关联制作已采用另一版正文，请先查看同步影响，再选择同步此稿或新建制作", 409);
      return reuse(draft, existing.adoption, settings);
    }
    assertDraftRevision(draft, request.expectedRevision);
    const previous = draft.adoptions.at(-1);
    if (!previous) return record(draft, version, settings, newProject(draft, version, settings));
    if (previous.versionId !== version.id) throw new ViralError("handoff_conflict", "已有视频制作，请先查看同步影响，再选择同步新版或新建制作", 409);
    const project = getProject(previous.projectId);
    if (!project) throw new ViralError("handoff_conflict", "关联制作已被删除，请先在回收站恢复", 409);
    // A frame change updates only output settings and never rewrites production text.
    run("DELETE FROM project_goals WHERE project_id = ?", project.id);
    cancelProjectJobs(project.id, ["render"]);
    const next = saveProjectWithinTx(project.id, withFrame(project.doc, settings), project.revision);
    return record(draft, version, settings, next);
  });
}

function linkedProject(draft: ViralDraft, projectId: string) {
  const adoption = [...draft.adoptions].reverse().find((entry) => entry.projectId === projectId);
  const project = getProject(projectId);
  if (!adoption || !project || sourceByProject(projectId)?.draftId !== draft.id) throw new ViralError("handoff_conflict", "制作与当前草稿不匹配", 409);
  return { adoption, project };
}

export function viralSyncImpact(id: string, projectId: string): ViralSyncImpact {
  const { adoption, project } = linkedProject(requireDraft(id), projectId);
  const projectScript = productionScriptFingerprint({ title: project.doc.brief.title, segments: project.doc.segments });
  return { projectId, projectScript, productionEdited: projectScript !== productionScriptFingerprint(adoption.adoptedScript),
    hasSentences: project.doc.lines.length > 0,
    hasVoices: Boolean(get("SELECT 1 FROM tts_takes WHERE project_id = ? LIMIT 1", projectId)) || Boolean(get("SELECT 1 FROM jobs WHERE project_id = ? AND stage IN ('tts', 'tts-block') AND status = 'succeeded' LIMIT 1", projectId)),
    hasShots: project.doc.shots.length > 0, hasRenders: Boolean(get("SELECT 1 FROM renders WHERE project_id = ? LIMIT 1", projectId)) };
}

export function syncViralDraft(id: string, request: ViralSyncRequest): ViralHandoffResult {
  return tx(() => {
    const draft = requireDraft(id);
    const { version, settings } = validate(draft, request);
    const existing = findAdoptionMapping(id, version.id, settingsFingerprint(settings));
    if (existing && mappingIsCurrent(draft, existing.adoption)) {
      if (request.strategy === "replace" && existing.adoption.projectId !== request.projectId)
        throw new ViralError("handoff_conflict", "此版本已采用到另一制作，请打开已关联制作", 409);
      return reuse(draft, existing.adoption, settings);
    }
    assertDraftRevision(draft, request.expectedRevision);
    const { project } = linkedProject(draft, request.projectId);
    if (request.strategy === "new_project") return record(draft, version, settings, newProject(draft, version, settings));
    const actual = productionScriptFingerprint({ title: project.doc.brief.title, segments: project.doc.segments });
    if (actual !== request.expectedProjectScript) throw new ViralError("handoff_conflict", "制作正文在确认期间发生变化，请重新查看同步影响", 409);
    createVersionWithinTx(project.id, project.revision, "同步复创新版前", project.doc);
    run("DELETE FROM project_goals WHERE project_id = ?", project.id);
    cancelProjectJobs(project.id);
    const next = saveProjectWithinTx(project.id, withScript(project.doc, draft, version, settings), project.revision);
    return record(draft, version, settings, next);
  });
}
