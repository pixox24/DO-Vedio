import { describe, expect, it } from "vitest";
import { anglesSourceFingerprint, outlineSourceFingerprint } from "./invalidation";
import { applyDraftPatch, assessAdoption, canAcceptTaskResult, canAutoRepair, createEmptyDraft, createTask, currentAdoption, currentVersion, currentVersionAdoption, defaultViralInput, getTaskPlan, handoffSettings, reviewIsCurrent, reviewRules, scriptFingerprint, settingsFingerprint, snapshotDraft, validateCommandInput } from "./state";
import type { ViralDraft, ViralReview, ViralScriptVersion } from "./types";

function readyDraft(): ViralDraft {
  const input = defaultViralInput();
  Object.assign(input, { referenceText: "原文的独特表达", topic: "怎样写清楚科普", platform: "douyin", modelId: "user-model" });
  const draft = createEmptyDraft(input, "quick", "d1", "2026-10-11T00:00:00Z");
  draft.analysis = { id: "a1", summary: "分析", observations: [], mechanisms: [{ id: "m1", type: "hook", archetype: "curiosity_gap", description: "观察原句", enabled: true }], distinctiveElements: [], referenceFingerprint: input.referenceText, createdAt: "" };
  draft.angles = [{ id: "angle1", title: "方法", coreQuestion: "怎么讲清楚", coreClaim: "先问问题", hook: "一个新开头", route: [{ id: "r1", claim: "观点", materialIds: [] }], materialIds: [], missingEvidence: [], recommendedReason: "有依据" }];
  draft.selectedAngleId = "angle1";
  draft.anglesSourceFingerprint = anglesSourceFingerprint(snapshotDraft(draft));
  draft.outline = { id: "o1", sections: [{ id: "s1", title: "开头", function: "hook", points: ["先问问题"], seconds: 120, materialIds: [] }], sourceFingerprint: outlineSourceFingerprint(snapshotDraft(draft)), createdAt: "" };
  const version: ViralScriptVersion = { id: "v1", revision: 1, title: "新标题", segments: [{ id: "s1", title: "开头", text: "全新的口播观点", materialIds: [] }], completedSegmentIds: ["s1"], complete: true, manuallyEdited: false, basedOn: snapshotDraft(draft), createdAt: "", parentVersionId: null, origin: "generated" };
  draft.versions = [version]; draft.currentVersionId = version.id;
  draft.review = reviewFor(draft);
  return draft;
}
function reviewFor(draft: ViralDraft): ViralReview {
  const version = currentVersion(draft)!;
  return { id: "review1", versionId: version.id, scriptFingerprint: scriptFingerprint(version), rules: reviewRules(draft.input), referenceFingerprint: draft.input.referenceText, issues: [], resolutions: [], checkedAt: "", autoRepairCount: 0 };
}

describe("版本/检查绑定和采用条件", () => {
  it.each(["title", "body"] as const)("完整稿%s清空保存后补回可重新检查采用", (field) => {
    const draft = readyDraft();
    const blank = applyDraftPatch(draft, { expectedRevision: 0, manualScript: { title: field === "title" ? "" : draft.versions[0].title, segments: draft.versions[0].segments.map((segment) => ({ ...segment, text: field === "body" ? "" : segment.text })) } }, { now: "", versionId: "blank" });
    expect(currentVersion(blank)?.complete).toBe(false);
    expect(currentVersion(blank)?.completedSegmentIds).toEqual(["s1"]);
    expect(assessAdoption(blank).code).toBe("incomplete");
    const restored = applyDraftPatch(blank, { expectedRevision: 1, manualScript: { title: "补回标题", segments: draft.versions[0].segments.map((segment) => ({ ...segment, text: "补回自己的口播内容" })) } }, { now: "", versionId: "restored" });
    expect(currentVersion(restored)?.complete).toBe(true);
    expect(currentVersion(restored)?.manuallyEdited).toBe(true);
    expect(assessAdoption(restored).code).toBe("needs_review");
    restored.review = reviewFor(restored);
    expect(assessAdoption(restored).allowed).toBe(true);
    expect(canAutoRepair(currentVersion(restored)!, 0)).toBe(false);
  });
  it("真实生成半稿不能通过填正文或删除未完成段冒充完整，不能追溯更早完整稿", () => {
    const draft = readyDraft();
    const half = { ...structuredClone(draft.versions[0]), id: "half", complete: false, completedSegmentIds: ["s1"], parentVersionId: "v1", segments: [...draft.versions[0].segments, { id: "s2", title: "下一段", text: "尚未写完", materialIds: [] }] };
    draft.versions.push(half); draft.currentVersionId = half.id;
    const filled = applyDraftPatch(draft, { expectedRevision: 0, manualScript: { title: "写好了标题", segments: half.segments.map((segment) => ({ ...segment, text: "人工补上正文" })) } }, { now: "", versionId: "filled" });
    expect(currentVersion(filled)?.complete).toBe(false);
    expect(currentVersion(filled)?.completedSegmentIds).toEqual(["s1"]);
    const shortened = applyDraftPatch(filled, { expectedRevision: 1, manualScript: { title: "仅留完成部分", segments: filled.versions.at(-1)!.segments.slice(0, 1) } }, { now: "", versionId: "shortened" });
    shortened.review = reviewFor(shortened);
    expect(currentVersion(shortened)?.complete).toBe(false);
    expect(assessAdoption(shortened).code).toBe("incomplete");
  });
  it("用户继续手改后旧修改候选不能当场覆盖新人工稿", () => {
    const draft = readyDraft();
    draft.versions.push({ ...structuredClone(draft.versions[0]), id: "candidate", parentVersionId: "v1", origin: "rewrite" }); draft.candidateVersionId = "candidate";
    const edited = applyDraftPatch(draft, { expectedRevision: 0, manualScript: { title: "标题", segments: [{ ...draft.versions[0].segments[0], text: "较新的手写正文" }] } }, { now: "", versionId: "v2" });
    expect(() => applyDraftPatch(edited, { expectedRevision: 1, adoptCandidateVersionId: "candidate" }, { now: "" })).toThrow("CANDIDATE_CONFLICT");
    expect(currentVersion(edited)?.segments[0].text).toBe("较新的手写正文");
  });
  it("旧版本曾采用不代表制作仍使用它，最新项目快照才可直接打开", () => {
    const draft = readyDraft(); const settings = handoffSettings(draft);
    draft.adoptions = [
      { id: "adopt1", projectId: "p1", versionId: "v1", settings, adoptedScript: { title: "旧标题", segments: [] }, createdAt: "1" },
      { id: "adopt2", projectId: "p1", versionId: "v2", settings, adoptedScript: { title: "新标题", segments: [] }, createdAt: "2" },
    ];
    expect(currentAdoption(draft)).toBeNull(); expect(currentVersionAdoption(draft)).toBeNull();
    draft.currentVersionId = "v2";
    expect(currentAdoption(draft)?.id).toBe("adopt2");
  });
  it("只重新检查不能消除主题变化造成的旧设置", () => {
    const draft = readyDraft(); expect(assessAdoption(draft).allowed).toBe(true);
    const changed = applyDraftPatch(draft, { expectedRevision: 0, input: { ...draft.input, topic: "完全不同的主题" } }, { now: "" });
    changed.review = reviewFor(changed);
    expect(reviewIsCurrent(changed)).toBe(true);
    expect(assessAdoption(changed).code).toBe("stale");
    expect(changed.versions[0]).toEqual(draft.versions[0]);
  });
  it("改角度后重新检查仍旧设置，恢复设置保留修改前快照", () => {
    const draft = readyDraft();
    const changed = applyDraftPatch(draft, { expectedRevision: 0, angles: [{ ...draft.angles[0], coreClaim: "改了论点" }] }, { now: "" });
    changed.review = reviewFor(changed);
    expect(assessAdoption(changed).code).toBe("stale");
    const restored = applyDraftPatch(changed, { expectedRevision: 1, restoreVersionId: "v1" }, { now: "", historyId: "h1" });
    expect(restored.inputHistory[0].snapshot.selectedAngle?.coreClaim).toBe("改了论点");
    restored.review = reviewFor(restored);
    expect(assessAdoption(restored).allowed).toBe(true);
  });
  it("手改形成新版本，继承原稿上游设置且不被检查替换", () => {
    const draft = readyDraft();
    const changed = applyDraftPatch(draft, { expectedRevision: 0, input: { ...draft.input, topic: "新主题" } }, { now: "" });
    const edited = applyDraftPatch(changed, { expectedRevision: 1, manualScript: { title: "我的标题", segments: [{ ...draft.versions[0].segments[0], text: "我亲手写的文字" }] } }, { now: "", versionId: "v2" });
    const version = currentVersion(edited)!;
    expect(version.manuallyEdited).toBe(true); expect(version.basedOn.input.topic).toBe(draft.input.topic);
    expect(edited.versions[0]).toEqual(draft.versions[0]); expect(reviewIsCurrent(edited)).toBe(false);
    expect(assessAdoption(edited).code).toBe("stale");
    expect(canAutoRepair(version, 0)).toBe(false);
  });
  it("禁用规则变更只需重检，精确正文或检查规则不符则待检查", () => {
    const draft = readyDraft();
    const changed = applyDraftPatch(draft, { expectedRevision: 0, input: { ...draft.input, avoid: ["赋能"] } }, { now: "" });
    expect(assessAdoption(changed).code).toBe("needs_review");
    changed.review = reviewFor(changed);
    expect(assessAdoption(changed).allowed).toBe(true);
    changed.versions[0].segments[0].text += "另一句";
    expect(reviewIsCurrent(changed)).toBe(false);
  });
  it("未解决的必须处理/人工判断阻断；优化建议可采用", () => {
    const draft = readyDraft();
    draft.review!.issues = [{ id: "i1", severity: "judgment", category: "fact", segmentId: "s1", excerpt: "内容", reason: "材料待核实", suggestion: "补依据", materialIds: [], resolved: false }];
    expect(assessAdoption(draft).code).toBe("needs_changes");
    draft.review!.issues[0].severity = "suggestion";
    expect(assessAdoption(draft).allowed).toBe(true);
  });
  it("仅画幅和模型选择不使正文/检查失效，正文版本不增加", () => {
    const draft = readyDraft();
    const changed = applyDraftPatch(draft, { expectedRevision: 0, input: { ...draft.input, modelId: "other-model", handoff: { aspectRatio: "16:9", aspectRatioIsManual: true, settingsVersion: 50 } } }, { now: "" });
    expect(changed.versions).toEqual(draft.versions); expect(assessAdoption(changed).allowed).toBe(true);
    expect(changed.input.handoff.settingsVersion).toBe(1);
    const original = handoffSettings(draft), next = handoffSettings(changed);
    expect(settingsFingerprint(original)).not.toBe(settingsFingerprint(next));
    expect(settingsFingerprint({ ...next, version: 100 })).toBe(settingsFingerprint(next));
  });
  it("自动修订最多一次，任意人工编辑禁用自动替换", () => {
    const version = readyDraft().versions[0];
    expect(canAutoRepair(version, 0)).toBe(true); expect(canAutoRepair(version, 1)).toBe(false);
    expect(canAutoRepair({ ...version, manuallyEdited: true }, 0)).toBe(false);
  });
});

describe("任务互斥与计划/晚响应", () => {
  it("模式切换不改变既定任务，输入和正文锁定", () => {
    const draft = readyDraft(); draft.task = createTask(draft, "quick", "t1", "");
    const switched = applyDraftPatch(draft, { expectedRevision: 0, mode: "workbench" }, { now: "" });
    expect(switched.task).toEqual(draft.task);
    expect(() => applyDraftPatch(switched, { expectedRevision: 1, input: { ...draft.input, topic: "写入" } }, { now: "" })).toThrow("TASK_ACTIVE");
    expect(() => applyDraftPatch(switched, { expectedRevision: 1, manualScript: { title: "改标题", segments: draft.versions[0].segments } }, { now: "", versionId: "v2" })).toThrow("TASK_ACTIVE");
    expect(assessAdoption(switched).code).toBe("locked");
  });
  it("停止、过时代次和新输入后不接收迟到结果", () => {
    const draft = readyDraft(); draft.task = createTask(draft, "generate", "t1", "");
    expect(canAcceptTaskResult(draft, "t1", 1)).toBe(true);
    expect(canAcceptTaskResult(draft, "t1", 0)).toBe(false);
    expect(canAcceptTaskResult(draft, "old", 1)).toBe(false);
    draft.task.cancelRequested = true; expect(canAcceptTaskResult(draft, "t1", 1)).toBe(false);
    draft.task.cancelRequested = false; draft.input.topic = "新的输入";
    expect(canAcceptTaskResult(draft, "t1", 1)).toBe(false);
  });
  it("从最早失效阶段构建显式任务计划，风格不重新拆解/角度", () => {
    const draft = readyDraft(); expect(getTaskPlan(draft, "quick")).toEqual(["generation", "review"]);
    draft.input.style.tone = "温暖";
    expect(getTaskPlan(draft, "generate")).toEqual(["generation", "review"]);
    draft.input.topic = "新主题";
    expect(getTaskPlan(draft, "quick")).toEqual(["angles", "outline", "generation", "review"]);
    draft.input.referenceText = "新原文";
    expect(getTaskPlan(draft, "quick")).toEqual(["analysis", "angles", "outline", "generation", "review"]);
  });
  it("仅参考可拆解，生成需要主题平台有效时长，30秒与30分钟边界允许", () => {
    const input = defaultViralInput(); Object.assign(input, { referenceText: "原稿", modelId: "model" });
    expect(validateCommandInput(input, "analyze")).toEqual({});
    expect(validateCommandInput(input, "quick")).toMatchObject({ topic: "请填写自己的主题", platform: "请选择目标平台" });
    Object.assign(input, { topic: "主题", platform: "douyin", targetSeconds: 30 });
    expect(validateCommandInput(input, "quick")).toEqual({});
    input.targetSeconds = 1_800; expect(validateCommandInput(input, "quick")).toEqual({});
    input.targetSeconds = 1_801; expect(validateCommandInput(input, "quick")).toHaveProperty("targetSeconds");
  });
});
