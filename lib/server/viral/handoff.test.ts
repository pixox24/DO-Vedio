import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultViralInput, reviewRules, scriptFingerprint, snapshotDraft } from "../../viral/state";
import type { ViralDraft, ViralScriptVersion } from "../../viral/types";
import { emptyDoc } from "../../core/types";
import { closeDb, get, run, tx } from "../db";
import { createDraft, mutateDraftTransaction, putDraftWithinTx, requireDraft } from "./repository";
import { adoptViralDraft, syncViralDraft, viralSyncImpact } from "./handoff";
import { getProject, saveProject } from "../projects";
import { createPreset, setDefaultPreset } from "../presets";
import { listVersions } from "../versions";

let directory: string;
const priorDataDir = process.env.DATA_DIR;
beforeEach(() => { closeDb(); directory = mkdtempSync(path.join(tmpdir(), "viral-handoff-")); process.env.DATA_DIR = directory; });
afterEach(() => { closeDb(); process.env.DATA_DIR = priorDataDir; if (priorDataDir === undefined) delete process.env.DATA_DIR; rmSync(directory, { recursive: true, force: true }); });

function fixture(): ViralDraft {
  const input = defaultViralInput();
  Object.assign(input, { referenceText: "参考原文不能进入视频项目", topic: "自己的主题", platform: "douyin", modelId: "test" });
  const draft = createDraft(input);
  return mutateDraftTransaction(draft.id, draft.revision, (current) => {
    const version: ViralScriptVersion = { id: "v1", revision: 1, title: "自己的标题", segments: [{ id: "s1", title: "开头", text: "属于自己的口播正文。", materialIds: [] }], completedSegmentIds: ["s1"], complete: true, manuallyEdited: false, basedOn: snapshotDraft(current), createdAt: new Date().toISOString(), parentVersionId: null, origin: "generated" };
    current.versions = [version]; current.currentVersionId = version.id;
    current.review = { id: "r1", versionId: version.id, scriptFingerprint: scriptFingerprint(version), rules: reviewRules(input), referenceFingerprint: input.referenceText, issues: [], resolutions: [], checkedAt: new Date().toISOString(), autoRepairCount: 0 };
  });
}
const request = (draft: ViralDraft) => ({ expectedRevision: draft.revision, versionId: draft.currentVersionId!, settingsVersion: draft.input.handoff.settingsVersion });
function revised(draft: ViralDraft): ViralDraft {
  return mutateDraftTransaction(draft.id, draft.revision, (current) => {
    const version = { ...current.versions[0], id: "v2", revision: 2, title: "新版标题", segments: [{ id: "s1", title: "开头", text: "改进后的口播正文。", materialIds: [] }], parentVersionId: "v1" };
    current.versions.push(version); current.currentVersionId = version.id;
    current.review = { ...current.review!, versionId: version.id, scriptFingerprint: scriptFingerprint(version) };
  });
}

describe("复创制作交接的真实 SQLite 事务", () => {
  it("两个独立进程同时采用也只创建一个项目", async () => {
    const draft = fixture();
    const moduleUrl = pathToFileURL(path.resolve("lib/server/viral/handoff.ts")).href;
    const program = "const loaded = await import(process.argv[1]); const api = loaded.default ?? loaded; const result = api.adoptViralDraft(process.argv[2], JSON.parse(process.argv[3])); process.stdout.write(result.projectId);";
    const execute = promisify(execFile);
    const results = await Promise.all([0, 1].map(() => execute(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program, moduleUrl, draft.id, JSON.stringify(request(draft))], { env: { ...process.env, DATA_DIR: directory } })));
    expect(results[0].stdout).toBe(results[1].stdout);
    expect(get<{ count: number }>("SELECT COUNT(*) AS count FROM projects")?.count).toBe(1);
    expect(get<{ count: number }>("SELECT COUNT(*) AS count FROM viral_adoptions")?.count).toBe(1);
  });
  it("同请求连续重试复用一个项目，正文直接进入断句且不带参考", () => {
    const draft = fixture(); const first = adoptViralDraft(draft.id, request(draft));
    const second = adoptViralDraft(draft.id, request(draft));
    expect(second.projectId).toBe(first.projectId); expect(second.reused).toBe(true);
    expect(get<{ count: number }>("SELECT COUNT(*) AS count FROM projects")?.count).toBe(1);
    const project = getProject(first.projectId)!;
    expect(project.doc.segments).toEqual([{ title: "开头", text: "属于自己的口播正文。" }]);
    expect(project.doc.lines).toEqual([]); expect(project.doc.shots).toEqual([]);
    expect(JSON.stringify(project.doc)).not.toContain(draft.input.referenceText);
    expect(get("SELECT 1 FROM jobs LIMIT 1")).toBeUndefined();
  });
  it("默认预设保留音色和字幕，本期竖屏覆盖预设横屏", () => {
    const doc = emptyDoc(); doc.settings.voice.voiceId = "custom-voice";
    const preset = createPreset({ name: "默认", payload: { settings: doc.settings, visualStyle: null } }); setDefaultPreset(preset.id);
    const draft = fixture(); const result = adoptViralDraft(draft.id, request(draft)); const project = getProject(result.projectId)!;
    expect(project.doc.settings.voice.voiceId).toBe("custom-voice"); expect(project.doc.settings.aspects).toEqual(["9:16"]);
    expect(project.doc.settings.outputSpecIds).toEqual(["portrait-1080p"]);
  });
  it("单改画幅复用原项目，不覆盖制作侧人工正文", () => {
    let draft = fixture(); const first = adoptViralDraft(draft.id, request(draft));
    const project = getProject(first.projectId)!; project.doc.segments[0].text = "制作侧修改"; saveProject(project.id, project.doc, project.revision);
    draft = mutateDraftTransaction(draft.id, first.draft.revision, (current) => { current.input.handoff.aspectRatio = "16:9"; current.input.handoff.settingsVersion++; });
    const result = adoptViralDraft(draft.id, request(draft));
    expect(result.projectId).toBe(project.id); expect(getProject(project.id)!.doc.segments[0].text).toBe("制作侧修改");
    expect(getProject(project.id)!.doc.settings.aspects).toEqual(["16:9"]);
    draft = mutateDraftTransaction(draft.id, result.draft.revision, (current) => { current.input.handoff.aspectRatio = "9:16"; current.input.handoff.settingsVersion++; });
    const reverted = adoptViralDraft(draft.id, request(draft));
    expect(reverted.projectId).toBe(project.id); expect(getProject(project.id)!.doc.settings.aspects).toEqual(["9:16"]);
    expect(getProject(project.id)!.doc.segments[0].text).toBe("制作侧修改");
  });
  it("半稿、旧设置和未检查不能采用", () => {
    const draft = fixture();
    const half = mutateDraftTransaction(draft.id, draft.revision, (current) => { const version = { ...current.versions[0], id: "partial", complete: false, completedSegmentIds: [] }; current.versions.push(version); current.currentVersionId = version.id; });
    expect(() => adoptViralDraft(draft.id, request(half))).toThrow("尚未完成");
    const old = mutateDraftTransaction(draft.id, half.revision, (current) => { current.currentVersionId = "v1"; current.input.topic = "新主题"; });
    expect(() => adoptViralDraft(draft.id, request(old))).toThrow("旧设置");
    const unchecked = mutateDraftTransaction(draft.id, old.revision, (current) => { current.input.topic = "自己的主题"; current.review = null; });
    expect(() => adoptViralDraft(draft.id, request(unchecked))).toThrow("需要检查");
  });
  it("已有项目的新稿必须显式同步；生产侧修改和确认间冲突可发现", () => {
    const draft = fixture(); const first = adoptViralDraft(draft.id, request(draft)); const next = revised(first.draft);
    expect(() => adoptViralDraft(draft.id, request(next))).toThrow("查看同步影响");
    const impact = viralSyncImpact(draft.id, first.projectId); expect(impact.productionEdited).toBe(false);
    const project = getProject(first.projectId)!; project.doc.segments[0].text = "手动改过"; saveProject(project.id, project.doc, project.revision);
    expect(viralSyncImpact(draft.id, first.projectId).productionEdited).toBe(true);
    expect(() => syncViralDraft(draft.id, { ...request(next), projectId: project.id, strategy: "replace", expectedProjectScript: impact.projectScript })).toThrow("确认期间发生变化");
    expect(getProject(project.id)!.doc.segments[0].text).toBe("手动改过");
  });
  it("同步保留旧文案和旧成片，重复同步复用，断句待更新", () => {
    const draft = fixture(); const first = adoptViralDraft(draft.id, request(draft)); const next = revised(first.draft);
    run("INSERT INTO renders (id, project_id, aspect, quality, timeline_hash, video_hash, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "render", first.projectId, "9:16", "final", "old", "old-video", 3000, Date.now());
    run("INSERT INTO project_goals (project_id, goal, updated_at) VALUES (?, ?, ?)", first.projectId, JSON.stringify({ until: "render", aspects: ["9:16"], quality: "final" }), Date.now());
    const impact = viralSyncImpact(draft.id, first.projectId); expect(impact.hasRenders).toBe(true);
    const syncRequest = { ...request(next), projectId: first.projectId, strategy: "replace" as const, expectedProjectScript: impact.projectScript };
    const result = syncViralDraft(draft.id, syncRequest); expect(syncViralDraft(draft.id, syncRequest).projectId).toBe(result.projectId);
    expect(getProject(first.projectId)!.doc.segments[0].text).toBe("改进后的口播正文。");
    expect(listVersions(first.projectId)[0].label).toBe("同步复创新版前"); expect(get("SELECT 1 FROM renders WHERE id = 'render'")).toBeDefined();
    expect(get("SELECT 1 FROM project_goals WHERE project_id = ?", first.projectId)).toBeUndefined();
  });
  it("另建制作完整保留原项目", () => {
    const draft = fixture(); const first = adoptViralDraft(draft.id, request(draft)); const next = revised(first.draft);
    const before = getProject(first.projectId)!;
    const result = syncViralDraft(draft.id, { ...request(next), projectId: first.projectId, strategy: "new_project", expectedProjectScript: viralSyncImpact(draft.id, first.projectId).projectScript });
    expect(result.projectId).not.toBe(first.projectId); expect(getProject(first.projectId)).toEqual(before);
  });
  it("恢复历史稿须显式同步，不会把历史映射当作制作当前正文", () => {
    const draft = fixture(); const first = adoptViralDraft(draft.id, request(draft)); const next = revised(first.draft);
    const updated = syncViralDraft(draft.id, { ...request(next), projectId: first.projectId, strategy: "replace", expectedProjectScript: viralSyncImpact(draft.id, first.projectId).projectScript });
    const restored = mutateDraftTransaction(draft.id, updated.draft.revision, (current) => { current.currentVersionId = "v1"; current.review = { ...current.review!, versionId: "v1", scriptFingerprint: scriptFingerprint(current.versions[0]) }; });
    expect(() => adoptViralDraft(draft.id, request(restored))).toThrow("已采用另一版正文");
    expect(getProject(first.projectId)!.doc.brief.title).toBe("新版标题");
    const syncRequest = { ...request(restored), projectId: first.projectId, strategy: "replace" as const, expectedProjectScript: viralSyncImpact(draft.id, first.projectId).projectScript };
    const result = syncViralDraft(draft.id, syncRequest);
    expect(getProject(first.projectId)!.doc.brief.title).toBe("自己的标题");
    expect(syncViralDraft(draft.id, syncRequest).projectId).toBe(result.projectId);
    expect(result.draft.adoptions).toHaveLength(3);
    expect(listVersions(first.projectId)).toHaveLength(2);
  });
  it("映射写入失败回滚项目写入", () => {
    const draft = fixture();
    run("CREATE TRIGGER fail_adoption BEFORE INSERT ON viral_adoptions BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
    expect(() => adoptViralDraft(draft.id, request(draft))).toThrow("forced failure");
    expect(get<{ count: number }>("SELECT COUNT(*) AS count FROM projects")?.count).toBe(0);
    expect(requireDraft(draft.id).adoptions).toEqual([]);
  });
  it("事务异常保持稿件和完整版本", () => {
    const draft = fixture();
    expect(() => tx(() => { putDraftWithinTx({ ...draft, input: { ...draft.input, topic: "错误写入" } }); throw new Error("abort"); })).toThrow("abort");
    expect(requireDraft(draft.id)).toEqual(draft);
  });
});
