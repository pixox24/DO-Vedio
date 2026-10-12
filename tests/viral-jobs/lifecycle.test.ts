import { mkdtempSync, rmSync } from "fs";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb } from "../../lib/server/db";
import { claim, getJob, isCurrentExecution, succeed } from "../../lib/server/jobs";
import { updateDraft } from "../../lib/server/viral/drafts";
import { createDraft, getDraft } from "../../lib/server/viral/repository";
import { commandDraft, type ViralJobInput } from "../../lib/server/viral/tasks";
import { executeViralJob, type ViralStageRunner } from "../../lib/pipeline/viral/dispatcher";
import type { StageContext } from "../../lib/pipeline/stage";
import { currentVersion, defaultViralInput } from "../../lib/viral/state";
import type { ViralScriptVersion } from "../../lib/viral/types";

vi.mock("../../lib/llm", () => ({ listModels: () => [{ id: "test", label: "测试", model: "test" }] }));
const directory = mkdtempSync(path.join(tmpdir(), "dovedio-viral-jobs-"));
const oldDataDir = process.env.DATA_DIR;
beforeAll(() => { process.env.DATA_DIR = directory; });
afterAll(() => { closeDb(); rmSync(directory, { recursive: true, force: true }); if (oldDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = oldDataDir; });

function makeDraft() {
  return createDraft({ ...defaultViralInput(), referenceText: "参考稿说明问题，然后给出思考方法。", topic: "新的任务", platform: "douyin", modelId: "test" });
}
function contextFor(job: NonNullable<ReturnType<typeof claim>>): StageContext {
  return { job, signal: new AbortController().signal, current: () => isCurrentExecution(job.id, job.lockToken), progress: () => {}, spend: () => 0, log: () => {} };
}

const runner: ViralStageRunner = async (stage, snapshot, artifacts, options) => {
  const createdAt = new Date().toISOString();
  if (stage === "analysis") return { stage, analysis: { id: "analysis", summary: "观察", observations: [], mechanisms: [], distinctiveElements: [], referenceFingerprint: snapshot.input.referenceText, createdAt } };
  if (stage === "angles") return { stage, angles: [{ id: "angle", title: "新角度", coreQuestion: "如何理解", coreClaim: "新的主张", hook: "开头", route: [{ id: "step", claim: "由常识解释", materialIds: [] }], materialIds: [], missingEvidence: [], recommendedReason: "适合" }], selectedAngleId: "angle" };
  if (stage === "outline") {
    const { outlineSourceFingerprint } = await import("../../lib/viral/invalidation");
    return { stage, outline: { id: "outline", sections: [{ id: "section1", title: "第一段", function: "解释", points: ["常识"], seconds: 60, materialIds: [] }, { id: "section2", title: "第二段", function: "结尾", points: ["观点"], seconds: 60, materialIds: [] }], sourceFingerprint: outlineSourceFingerprint(snapshot), createdAt } };
  }
  if (stage === "generation") {
    const version: ViralScriptVersion = artifacts.version && !artifacts.version.complete ? artifacts.version : { id: randomUUID(), revision: 1, title: "新的标题", segments: snapshot.outline!.sections.map((section) => ({ id: section.id, title: section.title, text: "", materialIds: [] })), completedSegmentIds: [], complete: false, manuallyEdited: false, basedOn: { input: snapshot.input, mechanisms: snapshot.mechanisms, selectedAngle: snapshot.selectedAngle, outline: snapshot.outline }, createdAt, parentVersionId: null, origin: "generated" };
    for (const segment of version.segments) {
      if (version.completedSegmentIds.includes(segment.id)) continue;
      segment.text = "这是新创作的口播正文。";
      version.completedSegmentIds.push(segment.id);
      await options?.onVersion?.(structuredClone(version));
    }
    version.complete = true;
    await options?.onVersion?.(version);
    return { stage, version };
  }
  const { reviewRules, scriptFingerprint } = await import("../../lib/viral/state");
  return { stage, review: { id: "review", versionId: artifacts.version!.id, scriptFingerprint: scriptFingerprint(artifacts.version!), rules: reviewRules(snapshot.input), referenceFingerprint: snapshot.input.referenceText, issues: [], resolutions: [], checkedAt: createdAt, autoRepairCount: 0 } };
};

describe("复创持久任务", () => {
  it("重复开始仍为同一任务，运行中服务器锁住编辑，切换模式不新开任务", async () => {
    const draft = makeDraft();
    const accepted = commandDraft(draft.id, { expectedRevision: draft.revision, command: "quick" });
    const repeated = commandDraft(draft.id, { expectedRevision: draft.revision, command: "quick" });
    expect(repeated.task!.id).toBe(accepted.task!.id);
    expect(() => updateDraft(draft.id, { expectedRevision: accepted.revision, input: { ...accepted.input, topic: "冲突写入" } })).toThrow(/先停止/);
    const switched = updateDraft(draft.id, { expectedRevision: accepted.revision, mode: "workbench" });
    expect(switched.task!.id).toBe(accepted.task!.id);
    const job = claim("test-worker", ["viral"])!;
    expect(job.id).toBe(accepted.task!.id);
    await executeViralJob(job.input as ViralJobInput, contextFor(job), runner);
    const complete = getDraft(draft.id)!;
    expect(complete.task!.status).toBe("completed");
    expect(complete.task!.completedStages).toEqual(["analysis", "angles", "outline", "generation", "review"]);
    expect(currentVersion(complete)?.complete).toBe(true);
    succeed(job.id, "test-worker", {}, 0, job.lockToken);
  });

  it("复写自动修订保留为待采纳候选，并允许显式采纳候选的后代版本", async () => {
    const draft = makeDraft();
    commandDraft(draft.id, { expectedRevision: draft.revision, command: "quick" });
    const first = claim("rewrite-source-worker", ["viral"])!;
    await executeViralJob(first.input as ViralJobInput, contextFor(first), runner);
    succeed(first.id, "rewrite-source-worker", {}, 0, first.lockToken);

    const ready = getDraft(draft.id)!;
    const source = currentVersion(ready)!;
    commandDraft(draft.id, { expectedRevision: ready.revision, command: "rewrite", rewrite: { segmentId: source.segments[0].id, instruction: "更简洁" } });
    const job = claim("rewrite-worker", ["viral"])!;
    const rewritten: ViralScriptVersion = {
      ...structuredClone(source), id: "rewrite-candidate", revision: source.revision + 1,
      segments: source.segments.map((segment, index) => ({ ...segment, text: index === 0 ? "复写候选正文。" : segment.text })),
      parentVersionId: source.id, origin: "rewrite",
    };
    const repaired: ViralScriptVersion = {
      ...structuredClone(rewritten), id: "repair-candidate", revision: rewritten.revision + 1,
      segments: rewritten.segments.map((segment, index) => ({ ...segment, text: index === 0 ? "自动修订后的候选正文。" : segment.text })),
      parentVersionId: rewritten.id, origin: "auto_repair",
    };
    const { reviewRules, scriptFingerprint } = await import("../../lib/viral/state");
    const repairRunner: ViralStageRunner = async (stage, snapshot, artifacts, options) => {
      if (stage === "generation") return { stage, version: artifacts.version!, candidateVersion: rewritten };
      await options?.onVersion?.(repaired);
      return { stage: "review", repairedVersion: repaired, review: {
        id: "repair-review", versionId: repaired.id, scriptFingerprint: scriptFingerprint(repaired),
        rules: reviewRules(snapshot.input), referenceFingerprint: snapshot.input.referenceText, issues: [], resolutions: [],
        checkedAt: new Date().toISOString(), autoRepairCount: 1,
      } };
    };
    await executeViralJob(job.input as ViralJobInput, contextFor(job), repairRunner);
    succeed(job.id, "rewrite-worker", {}, 0, job.lockToken);

    const finished = getDraft(draft.id)!;
    expect(finished.currentVersionId).toBe(source.id);
    expect(finished.candidateVersionId).toBe(repaired.id);
    expect(finished.task!.workingVersionId).toBe(repaired.id);
    expect(currentVersion(finished)?.segments[0].text).toBe(source.segments[0].text);

    const adopted = updateDraft(draft.id, { expectedRevision: finished.revision, adoptCandidateVersionId: repaired.id });
    expect(adopted.currentVersionId).toBe(repaired.id);
    expect(adopted.candidateVersionId).toBeNull();
  });

  it("失败保留完整段落，继续只补缺段；取消后的迟到结果不能覆盖新输入", async () => {
    const draft = makeDraft();
    commandDraft(draft.id, { expectedRevision: draft.revision, command: "quick" });
    const first = claim("first-worker", ["viral"])!;
    const attempted: string[] = [];
    const failing: ViralStageRunner = async (stage, snapshot, artifacts, options) => {
      if (stage !== "generation") return runner(stage, snapshot, artifacts, options);
      const version: ViralScriptVersion = { id: "recover-version", revision: 1, title: "可恢复稿", segments: [{ id: "section1", title: "第一段", text: "已经写完，必须保留。", materialIds: [] }, { id: "section2", title: "第二段", text: "写到一半", materialIds: [] }], completedSegmentIds: ["section1"], complete: false, manuallyEdited: false, basedOn: { input: snapshot.input, mechanisms: snapshot.mechanisms, selectedAngle: snapshot.selectedAngle, outline: snapshot.outline }, createdAt: new Date().toISOString(), parentVersionId: null, origin: "generated" };
      await options?.onVersion?.(version);
      throw new Error("测试中断");
    };
    await expect(executeViralJob(first.input as ViralJobInput, contextFor(first), failing)).rejects.toThrow("测试中断");
    const failed = getDraft(draft.id)!;
    expect(failed.task!.status).toBe("failed");
    const { failJob } = await import("../../lib/server/jobs");
    failJob(first.id, "first-worker", "测试中断", false, 0, first.lockToken);
    const resumed = commandDraft(draft.id, { expectedRevision: failed.revision, command: "resume" });
    expect(resumed.task!.completedStages).toEqual(["analysis", "angles", "outline"]);
    const second = claim("second-worker", ["viral"])!;
    const continuing: ViralStageRunner = async (stage, snapshot, artifacts, options) => {
      attempted.push(stage);
      if (stage === "generation") {
        expect(artifacts.version!.segments[0].text).toBe("已经写完，必须保留。");
        expect(artifacts.version!.completedSegmentIds).toEqual(["section1"]);
      }
      return runner(stage, snapshot, artifacts, options);
    };
    await executeViralJob(second.input as ViralJobInput, contextFor(second), continuing);
    expect(attempted).toEqual(["generation", "review"]);
    expect(currentVersion(getDraft(draft.id)!)!.segments[0].text).toBe("已经写完，必须保留。");
    succeed(second.id, "second-worker", {}, 0, second.lockToken);

    let resolveResult!: () => void;
    const pending = new Promise<void>((resolve) => { resolveResult = resolve; });
    const ready = getDraft(draft.id)!;
    commandDraft(draft.id, { expectedRevision: ready.revision, command: "analyze" });
    const third = claim("third-worker", ["viral"])!;
    const delayed: ViralStageRunner = async (...args) => { await pending; return runner(...args); };
    const execution = executeViralJob(third.input as ViralJobInput, contextFor(third), delayed);
    const running = getDraft(draft.id)!;
    const stopped = commandDraft(draft.id, { expectedRevision: running.revision, expectedTaskId: third.id, command: "stop" });
    const edited = updateDraft(draft.id, { expectedRevision: stopped.revision, input: { ...stopped.input, referenceText: "用户已经换了新的参考。" } });
    resolveResult();
    await expect(execution).rejects.toThrow(/停止|接管/);
    expect(getDraft(draft.id)!.revision).toBe(edited.revision);
    expect(getDraft(draft.id)!.input.referenceText).toBe("用户已经换了新的参考。");
    expect(getJob(third.id)?.status).toBe("canceled");
  });

  it("最终完整checkpoint后停止再继续只补阶段提交和检查，启动前旧稿不会跳过生成", async () => {
    const draft = makeDraft();
    commandDraft(draft.id, { expectedRevision: draft.revision, command: "quick" });
    const first = claim("checkpoint-worker", ["viral"])!;
    let resolveReturn!: () => void;
    const waitingToReturn = new Promise<void>((resolve) => { resolveReturn = resolve; });
    let resolveCheckpoint!: () => void;
    const savedComplete = new Promise<void>((resolve) => { resolveCheckpoint = resolve; });
    const lastCheckpointWindow: ViralStageRunner = async (...args) => {
      const result = await runner(...args);
      if (args[0] === "generation") {
        resolveCheckpoint();
        await waitingToReturn;
      }
      return result;
    };
    const execution = executeViralJob(first.input as ViralJobInput, contextFor(first), lastCheckpointWindow);
    await savedComplete;
    const ready = getDraft(draft.id)!;
    const completeVersion = currentVersion(ready)!;
    expect(completeVersion.complete).toBe(true);
    expect(ready.task!.workingVersionId).toBe(completeVersion.id);
    expect(ready.task!.completedStages).not.toContain("generation");
    const stopped = commandDraft(draft.id, { expectedRevision: ready.revision, expectedTaskId: first.id, command: "stop" });
    resolveReturn();
    await expect(execution).rejects.toThrow(/停止|接管/);
    commandDraft(draft.id, { expectedRevision: stopped.revision, command: "resume" });
    const second = claim("resume-worker", ["viral"])!;
    const called: string[] = [];
    await executeViralJob(second.input as ViralJobInput, contextFor(second), async (...args) => { called.push(args[0]); return runner(...args); });
    expect(called).toEqual(["review"]);
    const resumed = getDraft(draft.id)!;
    expect(currentVersion(resumed)?.id).toBe(completeVersion.id);
    expect(resumed.task!.completedStages).toContain("generation");
    expect(resumed.task!.status).toBe("completed");
    succeed(second.id, "resume-worker", {}, 0, second.lockToken);

    commandDraft(draft.id, { expectedRevision: resumed.revision, command: "generate" });
    const third = claim("fresh-worker", ["viral"])!;
    const freshCalls: string[] = [];
    await executeViralJob(third.input as ViralJobInput, contextFor(third), async (...args) => { freshCalls.push(args[0]); return runner(...args); });
    expect(freshCalls).toEqual(["generation", "review"]);
    expect(currentVersion(getDraft(draft.id)!)?.id).not.toBe(completeVersion.id);
    succeed(third.id, "fresh-worker", {}, 0, third.lockToken);
  });

  it.each([false, true])("停止后人工编辑complete=%s的工作稿，拒绝旧续作且完整保留新版本", async (complete) => {
    const draft = makeDraft();
    commandDraft(draft.id, { expectedRevision: draft.revision, command: "quick" });
    const job = claim("manual-resume-worker", ["viral"])!;
    let resolveReturn!: () => void;
    const awaitingReturn = new Promise<void>((resolve) => { resolveReturn = resolve; });
    let resolveCheckpoint!: () => void;
    const checkpointSaved = new Promise<void>((resolve) => { resolveCheckpoint = resolve; });
    const interrupted: ViralStageRunner = async (stage, snapshot, artifacts, options) => {
      if (stage !== "generation") return runner(stage, snapshot, artifacts, options);
      const version: ViralScriptVersion = {
        id: randomUUID(), revision: 1, title: "停止前的机器稿", segments: [{ id: "section1", title: "第一段", text: "机器第一段。", materialIds: [] }, { id: "section2", title: "第二段", text: complete ? "机器第二段。" : "尚未写完", materialIds: [] }],
        completedSegmentIds: complete ? ["section1", "section2"] : ["section1"], complete, manuallyEdited: false,
        basedOn: { input: snapshot.input, mechanisms: snapshot.mechanisms, selectedAngle: snapshot.selectedAngle, outline: snapshot.outline }, createdAt: new Date().toISOString(), parentVersionId: null, origin: "generated",
      };
      await options?.onVersion?.(version);
      resolveCheckpoint();
      await awaitingReturn;
      return { stage, version };
    };
    const execution = executeViralJob(job.input as ViralJobInput, contextFor(job), interrupted);
    await checkpointSaved;
    const checkpoint = getDraft(draft.id)!;
    const workingVersionId = checkpoint.currentVersionId;
    const stopped = commandDraft(draft.id, { expectedRevision: checkpoint.revision, expectedTaskId: job.id, command: "stop" });
    const edited = updateDraft(draft.id, { expectedRevision: stopped.revision, manualScript: { title: "人工最终选择的标题", segments: stopped.versions.find((version) => version.id === workingVersionId)!.segments.map((segment) => ({ ...segment, text: `人工写的${segment.title}，不能被恢复覆盖。` })) } });
    resolveReturn();
    await expect(execution).rejects.toThrow(/停止|接管/);
    expect(() => commandDraft(draft.id, { expectedRevision: edited.revision, command: "resume" })).toThrow(/正文已在停止后修改或切换/);
    const preserved = getDraft(draft.id)!;
    expect(preserved.revision).toBe(edited.revision);
    expect(preserved.currentVersionId).toBe(edited.currentVersionId);
    expect(preserved.currentVersionId).not.toBe(workingVersionId);
    expect(currentVersion(preserved)?.title).toBe("人工最终选择的标题");
    expect(currentVersion(preserved)?.segments.every((segment) => segment.text.startsWith("人工写的"))).toBe(true);
    expect(preserved.task!.id).toBe(job.id);
    expect(preserved.task!.status).toBe("stopped");
    expect(getJob(job.id)?.status).toBe("canceled");
  });

  it("换主题使用新推荐角度而保存旧角历史；只改平台保留用户选择", async () => {
    const draft = makeDraft();
    commandDraft(draft.id, { expectedRevision: draft.revision, command: "angles" });
    const first = claim("angles-first", ["viral"])!;
    await executeViralJob(first.input as ViralJobInput, contextFor(first), runner);
    succeed(first.id, "angles-first", {}, 0, first.lockToken);
    let current = getDraft(draft.id)!;
    expect(current.selectedAngleId).toBe("angle");
    current = updateDraft(draft.id, { expectedRevision: current.revision, input: { ...current.input, topic: "完全不同的新主题" } });
    commandDraft(draft.id, { expectedRevision: current.revision, command: "angles" });
    const second = claim("angles-second", ["viral"])!;
    const topicAngles: ViralStageRunner = async (...args) => {
      const result = await runner(...args);
      if (result.stage === "angles") return { ...result, angles: result.angles.map((angle) => ({ ...angle, id: "new-angle", title: "新主题角度" })), selectedAngleId: "new-angle" };
      return result;
    };
    await executeViralJob(second.input as ViralJobInput, contextFor(second), topicAngles);
    succeed(second.id, "angles-second", {}, 0, second.lockToken);
    current = getDraft(draft.id)!;
    expect(current.selectedAngleId).toBe("new-angle");
    expect(current.angles.map((angle) => angle.id)).toContain("angle");
    current = updateDraft(draft.id, { expectedRevision: current.revision, input: { ...current.input, platform: "bilibili", targetSeconds: 300 } });
    commandDraft(draft.id, { expectedRevision: current.revision, command: "angles" });
    const third = claim("angles-third", ["viral"])!;
    const platformAngles: ViralStageRunner = async (...args) => {
      const result = await runner(...args);
      if (result.stage === "angles") return { ...result, angles: result.angles.map((angle) => ({ ...angle, id: "platform-recommendation" })), selectedAngleId: "platform-recommendation" };
      return result;
    };
    await executeViralJob(third.input as ViralJobInput, contextFor(third), platformAngles);
    expect(getDraft(draft.id)?.selectedAngleId).toBe("new-angle");
    succeed(third.id, "angles-third", {}, 0, third.lockToken);
  });

  it("同任务的停止忽略流式进度revision并幂等，旧任务ID绝不能取消新任务", async () => {
    const draft = makeDraft();
    const submitted = commandDraft(draft.id, { expectedRevision: draft.revision, command: "quick" });
    const first = claim("stop-target-worker", ["viral"])!;
    let resolveReturn!: () => void;
    const awaitingReturn = new Promise<void>((resolve) => { resolveReturn = resolve; });
    let resolveCheckpoint!: () => void;
    const checkpointSaved = new Promise<void>((resolve) => { resolveCheckpoint = resolve; });
    const streaming: ViralStageRunner = async (stage, snapshot, artifacts, options) => {
      if (stage !== "generation") return runner(stage, snapshot, artifacts, options);
      const version: ViralScriptVersion = { id: randomUUID(), revision: 1, title: "正在写", segments: snapshot.outline!.sections.map((section) => ({ id: section.id, title: section.title, text: "", materialIds: [] })), completedSegmentIds: [], complete: false, manuallyEdited: false, basedOn: { input: snapshot.input, mechanisms: snapshot.mechanisms, selectedAngle: snapshot.selectedAngle, outline: snapshot.outline }, createdAt: new Date().toISOString(), parentVersionId: null, origin: "generated" };
      for (let chunk = 0; chunk < 4; chunk++) {
        version.segments[0].text += "新的流式文字。";
        await options?.onVersion?.(structuredClone(version));
      }
      resolveCheckpoint();
      await awaitingReturn;
      return { stage, version };
    };
    const execution = executeViralJob(first.input as ViralJobInput, contextFor(first), streaming);
    await checkpointSaved;
    expect(getDraft(draft.id)!.revision).toBeGreaterThan(submitted.revision);
    const stopped = commandDraft(draft.id, { expectedRevision: submitted.revision, expectedTaskId: first.id, command: "stop" });
    expect(stopped.task!.status).toBe("stopped");
    expect(getJob(first.id)?.status).toBe("canceled");
    const repeated = commandDraft(draft.id, { expectedRevision: submitted.revision, expectedTaskId: first.id, command: "stop" });
    expect(repeated.revision).toBe(stopped.revision);
    resolveReturn();
    await expect(execution).rejects.toThrow(/停止|接管/);
    const resumed = commandDraft(draft.id, { expectedRevision: stopped.revision, command: "resume" });
    const newTaskId = resumed.task!.id;
    expect(newTaskId).not.toBe(first.id);
    expect(() => commandDraft(draft.id, { expectedRevision: resumed.revision, expectedTaskId: first.id, command: "stop" })).toThrow(/原任务已结束或已切换/);
    expect(getDraft(draft.id)!.revision).toBe(resumed.revision);
    expect(getDraft(draft.id)!.task!.status).toBe("queued");
    expect(getJob(newTaskId)?.status).toBe("queued");
    commandDraft(draft.id, { expectedRevision: resumed.revision, expectedTaskId: newTaskId, command: "stop" });
  });
});
