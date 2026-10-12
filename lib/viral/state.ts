import { builtinTemplates } from "../templates/builtin";
import { resolveViralRate } from "./duration";
import { anglesSourceFingerprint, fingerprint, getInvalidation, isScriptStale, outlineSourceFingerprint, referenceFingerprint, scriptFingerprint, snapshotDraft } from "./invalidation";
import { VIRAL_LIMITS, type ViralAdoption, type ViralDraft, type ViralHandoffSettings, type ViralInput, type ViralPatch, type ViralReviewRules, type ViralScriptVersion, type ViralStage, type ViralStyleSnapshot, type ViralTask, type ViralTaskCommand, type ViralTemplateSource } from "./types";

export { fingerprint, getDraftInvalidation, getInvalidation, isScriptStale, referenceFingerprint, scriptFingerprint, snapshotDraft } from "./invalidation";
export const inputSnapshot = snapshotDraft;

export function makeStyleSnapshot(template: ViralTemplateSource, capturedAt = ""): ViralStyleSnapshot {
  return structuredClone({ templateId: template.id, templateName: template.name, capturedAt, tone: template.tone, dos: template.dos, donts: template.donts, rules: [], sample: template.sample, speechRate: template.speechRate });
}
export function defaultViralInput(template: ViralTemplateSource = builtinTemplates.find((item) => item.id === "science")!, capturedAt = ""): ViralInput {
  return { referenceText: "", referenceTitle: "", referenceSource: "", topic: "", platform: null, targetSeconds: 120, durationIsManual: false, materials: [], audience: "", coreClaim: "", contentKind: "auto", style: makeStyleSnapshot(template, capturedAt), perspective: "third", rate: "auto", mustInclude: [], avoid: [], ending: "natural", modelId: "", memes: [], humanize: true, handoff: { aspectRatio: "9:16", aspectRatioIsManual: false, settingsVersion: 0 } };
}
export function createEmptyDraft(input: ViralInput = defaultViralInput(), mode: ViralDraft["mode"] = "quick", id = "", now = ""): ViralDraft {
  return { id, revision: 0, mode, input: structuredClone(input), analysis: null, angles: [], anglesSourceFingerprint: null, selectedAngleId: null, outline: null, versions: [], currentVersionId: null, candidateVersionId: null, review: null, task: null, adoptions: [], inputHistory: [], issueResolutions: [], createdAt: now, updatedAt: now };
}
export const createViralDraft = createEmptyDraft;
export function hasMeaningfulInput(input: ViralInput): boolean {
  return Boolean(input.referenceText.trim() || input.topic.trim() || input.platform || input.materials.some((item) => item.text.trim()));
}
export function currentVersion(draft: ViralDraft): ViralScriptVersion | null { return draft.versions.find((item) => item.id === draft.currentVersionId) ?? null; }
export function isTaskActive(task: ViralTask | null | undefined): boolean { return Boolean(task && ["queued", "running", "stopping"].includes(task.status)); }
export function taskRunning(draftOrTask: ViralDraft | ViralTask | null | undefined): boolean { return isTaskActive(draftOrTask && "input" in draftOrTask ? draftOrTask.task : draftOrTask); }
export function reviewRules(input: ViralInput): ViralReviewRules {
  const { avoid, mustInclude, contentKind, perspective, materials, style, targetSeconds, rate } = input;
  return structuredClone({ avoid, mustInclude, contentKind, perspective, materials, style, targetSeconds, rate });
}
export function reviewIsCurrent(draft: ViralDraft, version: ViralScriptVersion | null = currentVersion(draft)): boolean {
  return Boolean(version && draft.review && draft.review.versionId === version.id && draft.review.scriptFingerprint === scriptFingerprint(version) && fingerprint(draft.review.rules) === fingerprint(reviewRules(draft.input)) && draft.review.referenceFingerprint === referenceFingerprint(draft.input.referenceText));
}
export type ViralAdoptionAssessment = { allowed: boolean; code: "locked" | "incomplete" | "stale" | "needs_review" | "needs_changes" | null; reasons: string[]; reviewRequired: boolean };
export function assessAdoption(draft: ViralDraft): ViralAdoptionAssessment {
  const version = currentVersion(draft);
  if (isTaskActive(draft.task)) return { allowed: false, code: "locked", reasons: ["任务正在写入，完成或停止后才能采用"], reviewRequired: false };
  if (!version || !version.complete || !version.title.trim() || !version.segments.length || version.segments.some((item) => !item.text.trim()) || version.completedSegmentIds.length !== version.segments.length) return { allowed: false, code: "incomplete", reasons: ["当前稿件尚未完成"], reviewRequired: false };
  if (isScriptStale(draft, version)) return { allowed: false, code: "stale", reasons: ["正文基于旧设置，请先更新受影响阶段或恢复此稿设置"], reviewRequired: false };
  if (!reviewIsCurrent(draft, version)) return { allowed: false, code: "needs_review", reasons: ["当前正文和规则需要检查"], reviewRequired: true };
  const issues = draft.review!.issues.filter((item) => !item.resolved && item.severity !== "suggestion");
  if (issues.length) return { allowed: false, code: "needs_changes", reasons: issues.map((item) => item.reason), reviewRequired: false };
  return { allowed: true, code: null, reasons: [], reviewRequired: false };
}
export function canAdopt(draft: ViralDraft): boolean { return assessAdoption(draft).allowed; }
export function canAutoRepair(version: ViralScriptVersion, autoRepairCount: number): boolean { return !version.manuallyEdited && autoRepairCount < 1; }
export function handoffSettings(draft: ViralDraft): ViralHandoffSettings {
  if (!draft.input.platform) throw new Error("请选择目标平台");
  return structuredClone({ version: draft.input.handoff.settingsVersion, aspectRatio: draft.input.handoff.aspectRatio, platform: draft.input.platform, targetSeconds: draft.input.targetSeconds, rate: resolveViralRate(draft.input), perspective: draft.input.perspective, style: draft.input.style });
}
/** Semantic settings identity deliberately excludes the change counter. Reverting to identical settings reuses the mapping. */
export function settingsFingerprint(settings: ViralHandoffSettings): string {
  const { version: _version, ...content } = settings;
  void _version;
  return fingerprint(content);
}
export function adoptionKey(draftId: string, versionId: string, settings: ViralHandoffSettings): string { return fingerprint({ draftId, versionId, settings: settingsFingerprint(settings) }); }
export function currentAdoption(draft: ViralDraft): ViralAdoption | null {
  if (!draft.currentVersionId || !draft.input.platform) return null;
  const key = settingsFingerprint(handoffSettings(draft));
  return latestAdoptionsByProject(draft).find((item) => item.versionId === draft.currentVersionId && settingsFingerprint(item.settings) === key) ?? null;
}
export function latestAdoptionsByProject(draft: ViralDraft): ViralAdoption[] {
  const seen = new Set<string>();
  return [...draft.adoptions].reverse().filter((item) => { if (seen.has(item.projectId)) return false; seen.add(item.projectId); return true; });
}
export function currentVersionAdoption(draft: ViralDraft): ViralAdoption | null {
  return latestAdoptionsByProject(draft).find((item) => item.versionId === draft.currentVersionId) ?? null;
}

export function validateCommandInput(input: ViralInput, command: ViralTaskCommand): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.referenceText.trim()) errors.referenceText = "请粘贴参考稿";
  if (input.referenceText.length > VIRAL_LIMITS.reference) errors.referenceText = `参考稿最多 ${VIRAL_LIMITS.reference} 字符`;
  if (input.materials.reduce((sum, item) => sum + item.text.length, 0) > VIRAL_LIMITS.materials) errors.materials = `素材合计最多 ${VIRAL_LIMITS.materials} 字符`;
  if (!input.modelId) errors.modelId = "请先选择可用文字模型";
  if (command !== "analyze" && command !== "review") {
    if (!input.topic.trim()) errors.topic = "请填写自己的主题";
    if (input.topic.length > VIRAL_LIMITS.topic) errors.topic = `主题最多 ${VIRAL_LIMITS.topic} 字符`;
    if (!input.platform) errors.platform = "请选择目标平台";
    if (!Number.isFinite(input.targetSeconds) || input.targetSeconds < VIRAL_LIMITS.minSeconds || input.targetSeconds > VIRAL_LIMITS.maxSeconds) errors.targetSeconds = "目标时长须为 30 秒至 30 分钟";
  }
  return errors;
}
export function getTaskPlan(draft: ViralDraft, command: ViralTaskCommand): ViralStage[] {
  if (command === "analyze") return ["analysis"];
  if (command === "review") return ["review"];
  if (command === "rewrite" || command === "calibrate") return ["generation", "review"];
  const snapshot = snapshotDraft(draft);
  const analysisValid = Boolean(draft.analysis && draft.analysis.referenceFingerprint === referenceFingerprint(draft.input.referenceText));
  const anglesValid = analysisValid && draft.angles.length > 0 && draft.anglesSourceFingerprint === anglesSourceFingerprint(snapshot);
  const outlineValid = anglesValid && Boolean(snapshot.selectedAngle && draft.outline && draft.outline.sourceFingerprint === outlineSourceFingerprint(snapshot));
  const plan: ViralStage[] = [];
  if (!analysisValid) plan.push("analysis");
  if (command === "angles" || !anglesValid) plan.push("angles");
  if (command === "angles") return plan;
  if (command === "outline" || !outlineValid) plan.push("outline");
  if (command === "outline") return plan;
  return [...plan, "generation", "review"];
}
export function createTask(draft: ViralDraft, command: ViralTaskCommand, id: string, now: string, rewrite: ViralTask["snapshot"]["rewrite"] = null): ViralTask {
  const version = currentVersion(draft);
  return { id, generation: (draft.task?.generation ?? 0) + 1, status: "queued", command, plan: getTaskPlan(draft, command), stage: null, completedStages: [], snapshot: { ...snapshotDraft(draft), command, modelId: draft.input.modelId, versionId: version?.id ?? null, scriptFingerprint: version ? scriptFingerprint(version) : null, rewrite }, workingVersionId: null, cancelRequested: false, error: null, createdAt: now, updatedAt: now };
}
export function canAcceptTaskResult(draft: ViralDraft, taskId: string, generation: number): boolean {
  const task = draft.task;
  if (!task || task.id !== taskId || task.generation !== generation || !isTaskActive(task) || task.cancelRequested || task.status === "stopping") return false;
  // Stage-owned angle/outline updates may advance the snapshot; input changes cannot.
  const empty = { mechanisms: [], selectedAngle: null, outline: null };
  return getInvalidation({ input: task.snapshot.input, ...empty }, { input: draft.input, ...empty }).earliestStage === null;
}
export function canEditDraft(draft: ViralDraft): boolean { return !isTaskActive(draft.task); }

/** Manual blanking does not erase a completed generation baseline; an unfinished generation starts a new boundary. */
function hasCompletedEditingBaseline(draft: ViralDraft, previous: ViralScriptVersion): boolean {
  let baseline = previous;
  for (let remaining = draft.versions.length; remaining > 0; remaining--) {
    if (baseline.complete) return baseline.segments.length > 0 && baseline.segments.every((segment) => baseline.completedSegmentIds.includes(segment.id));
    if (baseline.origin !== "manual" || !baseline.parentVersionId) return false;
    const parent = draft.versions.find((version) => version.id === baseline.parentVersionId);
    if (!parent) return false;
    baseline = parent;
  }
  return false;
}

/** A candidate may have automatic-repair descendants, but its lineage must still root at the current script. */
function descendsFrom(draft: ViralDraft, version: ViralScriptVersion, ancestorId: string): boolean {
  if (version.id === ancestorId) return false;
  const visited = new Set<string>();
  let cursor: ViralScriptVersion | undefined = version;
  while (cursor && cursor.id !== ancestorId) {
    if (visited.has(cursor.id) || !cursor.parentVersionId) return false;
    visited.add(cursor.id);
    const parentId: string = cursor.parentVersionId;
    cursor = draft.versions.find((item) => item.id === parentId);
  }
  return cursor?.id === ancestorId;
}

/** Pure reducer: IDs/timestamps are supplied by the caller and no model or storage action is started here. */
export function applyDraftPatch(draft: ViralDraft, patch: ViralPatch, options: { now: string; versionId?: string; historyId?: string }): ViralDraft {
  if (patch.expectedRevision !== draft.revision) throw new Error("REVISION_CONFLICT");
  const keys = Object.keys(patch).filter((key) => key !== "expectedRevision" && key !== "mode");
  if (isTaskActive(draft.task) && keys.length) throw new Error("TASK_ACTIVE");
  const next = structuredClone(draft);
  if (patch.restoreVersionId) {
    const version = draft.versions.find((item) => item.id === patch.restoreVersionId);
    if (!version) throw new Error("VERSION_NOT_FOUND");
    next.inputHistory.push({ id: options.historyId ?? `history-${draft.revision}`, snapshot: snapshotDraft(draft), savedAt: options.now });
    const handoff = next.input.handoff;
    const modelId = next.input.modelId;
    next.input = { ...structuredClone(version.basedOn.input), handoff, modelId };
    // Restore the generation mechanism snapshot as well, without reviving old source quotations.
    if (next.analysis) next.analysis.mechanisms = structuredClone(version.basedOn.mechanisms);
    if (version.basedOn.selectedAngle) {
      next.angles = next.angles.filter((item) => item.id !== version.basedOn.selectedAngle!.id);
      next.angles.push(structuredClone(version.basedOn.selectedAngle));
    }
    next.selectedAngleId = version.basedOn.selectedAngle?.id ?? null;
    next.outline = structuredClone(version.basedOn.outline);
    next.currentVersionId = version.id;
    next.issueResolutions = [];
  }
  if (patch.input) {
    const handoffChanged = patch.input.handoff.aspectRatio !== next.input.handoff.aspectRatio;
    next.input = structuredClone(patch.input);
    // Counter belongs to the server reducer; callers cannot forge a stale settings version.
    next.input.handoff.settingsVersion = draft.input.handoff.settingsVersion + Number(handoffChanged);
  }
  if (patch.mode) next.mode = patch.mode;
  if (patch.angles) next.angles = structuredClone(patch.angles);
  if (patch.enabledMechanismIds) {
    if (!next.analysis || patch.enabledMechanismIds.some((id) => !next.analysis!.mechanisms.some((item) => item.id === id))) throw new Error("MECHANISM_NOT_FOUND");
    next.analysis.mechanisms = next.analysis.mechanisms.map((item) => ({ ...item, enabled: patch.enabledMechanismIds!.includes(item.id) }));
  }
  if (patch.selectedAngleId !== undefined) next.selectedAngleId = patch.selectedAngleId;
  if (patch.outline !== undefined) next.outline = structuredClone(patch.outline);
  const chosenVersion = patch.adoptCandidateVersionId ?? patch.currentVersionId;
  if (chosenVersion) {
    const chosen = next.versions.find((item) => item.id === chosenVersion);
    if (!chosen) throw new Error("VERSION_NOT_FOUND");
    if (patch.adoptCandidateVersionId && (next.candidateVersionId !== chosen.id || !chosen.complete || !descendsFrom(next, chosen, next.currentVersionId ?? ""))) throw new Error("CANDIDATE_CONFLICT");
    next.currentVersionId = chosenVersion;
    if (patch.adoptCandidateVersionId) next.candidateVersionId = null;
    next.issueResolutions = [];
  }
  if (patch.manualScript) {
    if (!options.versionId) throw new Error("VERSION_ID_REQUIRED");
    if (next.versions.some((item) => item.id === options.versionId)) throw new Error("VERSION_ID_CONFLICT");
    const previous = currentVersion(next);
    if (!previous) throw new Error("VERSION_NOT_FOUND");
    const complete = hasCompletedEditingBaseline(next, previous) && Boolean(patch.manualScript.title.trim()) && patch.manualScript.segments.length > 0 && patch.manualScript.segments.every((item) => Boolean(item.text.trim()));
    const version: ViralScriptVersion = { ...structuredClone(previous), ...structuredClone(patch.manualScript), id: options.versionId, revision: Math.max(0, ...next.versions.map((item) => item.revision)) + 1, complete, completedSegmentIds: complete ? patch.manualScript.segments.map((item) => item.id) : previous.completedSegmentIds.filter((id) => patch.manualScript!.segments.some((item) => item.id === id)), manuallyEdited: true, parentVersionId: previous.id, origin: "manual", createdAt: options.now };
    // Editing words does not claim that stale upstream choices have been regenerated.
    next.versions.push(version);
    next.currentVersionId = version.id;
    next.issueResolutions = [];
  }
  if (patch.issueResolutions) next.issueResolutions = structuredClone(patch.issueResolutions);
  if (next.selectedAngleId && !next.angles.some((item) => item.id === next.selectedAngleId)) throw new Error("ANGLE_NOT_FOUND");
  return { ...next, revision: draft.revision + 1, updatedAt: options.now };
}
