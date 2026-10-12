import { randomUUID } from "crypto";
import { listModels } from "../../llm";
import { fingerprint, getInvalidation, isScriptStale, scriptFingerprint, snapshotDraft } from "../../viral/invalidation";
import { createTask, currentVersion, isTaskActive, validateCommandInput } from "../../viral/state";
import type { ViralCommandRequest, ViralDraft, ViralTask, ViralTaskCommand } from "../../viral/types";
import { json, run, tx } from "../db";
import { cancelJob, getJob } from "../jobs";
import { ViralError } from "./errors";
import { assertDraftRevision, nextDraftGenerationWithinTx, putDraftWithinTx, requireDraft } from "./repository";

export type ViralJobInput = { draftId: string; taskId: string; generation: number };

function validateStart(draft: ViralDraft, command: ViralTaskCommand, rewrite?: ViralCommandRequest["rewrite"], allowPartialCalibration = false) {
  const fields = validateCommandInput(draft.input, command);
  if (Object.keys(fields).length) throw new ViralError("validation", Object.values(fields)[0], 400, { fields });
  if (!listModels().some((model) => model.id === draft.input.modelId)) throw new ViralError("model_unavailable", "所选文字模型当前不可用，请在模型配置中检查", 400, { fields: { modelId: "所选模型不可用" } });
  if (command === "review" || command === "rewrite" || command === "calibrate") {
    const version = currentVersion(draft);
    if (!version) throw new ViralError("validation", "请先生成稿件", 400);
    if ((command === "rewrite" || command === "calibrate") && !version.complete && !(allowPartialCalibration && command === "calibrate" && version.origin === "calibrated")) throw new ViralError("validation", "请先继续完成稿件，再做局部修改或时长校准", 400);
    if ((command === "rewrite" || command === "calibrate") && isScriptStale(draft, version)) throw new ViralError("stale", "正文基于旧设置，请先重新成稿或恢复此稿设置", 409);
    if (command === "rewrite" && (!rewrite || !version.segments.some((segment) => segment.id === rewrite.segmentId))) throw new ViralError("validation", "请选择当前稿件中的段落", 400);
  }
}

function enqueueTaskWithinTx(draft: ViralDraft, task: ViralTask) {
  const now = Date.now();
  const input: ViralJobInput = { draftId: draft.id, taskId: task.id, generation: task.generation };
  // Same jobs table and worker lease protocol; queue insertion and draft write commit atomically.
  run(`INSERT INTO jobs (id, project_id, stage, key, target, status, priority, max_attempts, input, created_at, updated_at)
    VALUES (?, NULL, 'viral', ?, '爆款复创', 'queued', 5, 1, ?, ?, ?)`, task.id, `viral:${draft.id}`, json(input), now, now);
}

function assertResumeScript(draft: ViralDraft, previous: ViralTask) {
  // A rewrite checkpoints a candidate while leaving its source selected. Other writing tasks select their work.
  const expectedVersionId = previous.command === "rewrite" ? previous.snapshot.versionId : previous.workingVersionId ?? previous.snapshot.versionId;
  const version = currentVersion(draft);
  const changedSelection = draft.currentVersionId !== expectedVersionId;
  const changedSource = expectedVersionId === previous.snapshot.versionId && version !== null && scriptFingerprint(version) !== previous.snapshot.scriptFingerprint;
  if (changedSelection || changedSource) throw new ViralError("conflict", "正文已在停止后修改或切换，旧任务不能继续覆盖；请检查当前稿件或重新生成", 409, { currentRevision: draft.revision });
}

export function commandDraft(id: string, request: ViralCommandRequest): ViralDraft {
  return tx(() => {
    const draft = requireDraft(id);
    if (request.command !== "stop" && request.command !== "resume" && isTaskActive(draft.task)) {
      // A double submit may retry the already accepted command; it never queues another model task.
      if (draft.task?.command === request.command && fingerprint(draft.task.snapshot.rewrite) === fingerprint(request.rewrite ?? null)) return draft;
      throw new ViralError("locked", "任务进行中，请等待完成或先停止", 409, { currentRevision: draft.revision });
    }
    if (request.command === "stop") {
      const task = draft.task;
      // Streaming checkpoints advance the draft revision. Cancellation targets the task identity, not progress.
      if (!request.expectedTaskId) throw new ViralError("validation", "请指定要停止的任务", 400);
      if (!task || task.id !== request.expectedTaskId) throw new ViralError("conflict", "原任务已结束或已切换，请读取当前任务后再操作", 409, { currentRevision: draft.revision });
      if (!isTaskActive(task)) return draft;
      cancelJob(task.id);
      task.status = "stopped";
      task.cancelRequested = true;
      task.updatedAt = new Date().toISOString();
      return putDraftWithinTx(draft);
    }
    assertDraftRevision(draft, request.expectedRevision);
    if (request.command === "resume") {
      const previous = draft.task;
      if (!previous || !["failed", "stopped"].includes(previous.status)) throw new ViralError("conflict", "只有失败或已停止的任务可以继续", 409);
      assertResumeScript(draft, previous);
      validateStart(draft, previous.command, previous.snapshot.rewrite ?? undefined, true);
      const invalidation = getInvalidation(previous.snapshot, snapshotDraft(draft));
      const task = createTask(draft, previous.command, randomUUID(), new Date().toISOString(), previous.snapshot.rewrite);
      if (!invalidation.earliestStage) {
        task.plan = [...previous.plan];
        task.completedStages = [...previous.completedStages];
        task.workingVersionId = previous.workingVersionId;
        // Changing only the model or production settings must not discard completed paragraphs.
        task.snapshot = structuredClone(previous.snapshot);
        task.snapshot.modelId = draft.input.modelId;
      } else if (invalidation.earliestStage === "review" && currentVersion(draft)?.complete) task.plan = ["review"];
      task.generation = nextDraftGenerationWithinTx(draft.id);
      draft.task = task;
      enqueueTaskWithinTx(draft, task);
      return putDraftWithinTx(draft);
    }
    validateStart(draft, request.command, request.rewrite);
    const task = createTask(draft, request.command, randomUUID(), new Date().toISOString(), request.rewrite ?? null);
    task.generation = nextDraftGenerationWithinTx(draft.id);
    draft.task = task;
    enqueueTaskWithinTx(draft, task);
    return putDraftWithinTx(draft);
  });
}

/** Reconcile terminal queue state after a worker crash or an external queue cancellation. No model call. */
export function refreshDraftTask(id: string): ViralDraft {
  const draft = requireDraft(id);
  if (!draft.task || !isTaskActive(draft.task)) return draft;
  const job = getJob(draft.task.id);
  if (!job || (job.status !== "failed" && job.status !== "canceled")) return draft;
  return tx(() => {
    const latest = requireDraft(id);
    const task = latest.task;
    if (!task || task.id !== draft.task?.id || !isTaskActive(task)) return latest;
    task.status = job.status === "canceled" ? "stopped" : "failed";
    task.cancelRequested = job.status === "canceled";
    task.error = job.status === "failed" ? { code: "generation_failed", message: job.error ?? "任务未完成，请从此步继续", stage: task.stage } : null;
    task.updatedAt = new Date().toISOString();
    return putDraftWithinTx(latest);
  });
}

export function taskSnapshotMatchesScript(task: ViralTask, draft: ViralDraft): boolean {
  const version = draft.versions.find((item) => item.id === task.snapshot.versionId);
  return Boolean(version && task.snapshot.scriptFingerprint === scriptFingerprint(version));
}
