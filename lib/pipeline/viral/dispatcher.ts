import { PermanentError, defineStage, type StageContext } from "../stage";
import { runViralStage } from "./stages";
import { angleContextCompatible, anglesSourceFingerprint, generationSourceFingerprint, snapshotDraft } from "../../viral/invalidation";
import { canAcceptTaskResult, currentVersion, reviewIsCurrent } from "../../viral/state";
import type { ViralDraft, ViralScriptVersion, ViralStage, ViralStageArtifacts, ViralStageResult } from "../../viral/types";
import { tx } from "../../server/db";
import { isCurrentExecution } from "../../server/jobs";
import { putDraftWithinTx, recordArtifactWithinTx, requireDraft } from "../../server/viral/repository";
import type { ViralJobInput } from "../../server/viral/tasks";

export type ViralStageRunner = typeof runViralStage;

function versionUpsert(draft: ViralDraft, version: ViralScriptVersion, select: boolean) {
  const previous = draft.versions.find((item) => item.id === version.id);
  if (previous?.complete && JSON.stringify(previous) !== JSON.stringify(version)) throw new PermanentError("完整稿件不能被旧执行覆盖");
  const existing = draft.versions.findIndex((item) => item.id === version.id);
  if (existing < 0) draft.versions.push(structuredClone(version));
  else draft.versions[existing] = structuredClone(version);
  if (select) draft.currentVersionId = version.id;
}

function assertExecution(input: ViralJobInput, context: StageContext, draft: ViralDraft) {
  if (!context.current() || context.signal.aborted || !isCurrentExecution(context.job.id, context.job.lockToken) || !canAcceptTaskResult(draft, input.taskId, input.generation)) {
    throw new DOMException("任务已停止或由新版本接管", "AbortError");
  }
}

function artifactsOf(draft: ViralDraft): ViralStageArtifacts {
  const working = draft.versions.find((item) => item.id === draft.task?.workingVersionId);
  const source = draft.versions.find((item) => item.id === draft.task?.snapshot.versionId);
  const rewriting = draft.task?.command === "rewrite" && draft.task.stage === "generation";
  return { analysis: draft.analysis, angles: draft.angles, anglesSourceFingerprint: draft.anglesSourceFingerprint, selectedAngleId: draft.selectedAngleId, outline: draft.outline, version: rewriting ? source ?? working ?? currentVersion(draft) : working ?? source ?? currentVersion(draft), review: draft.review };
}

/** The stream's last checkpoint can commit before cancellation/crash interrupts its stage result. */
function checkpointedGeneration(draft: ViralDraft): ViralStageResult | null {
  const task = draft.task;
  const version = draft.versions.find((item) => item.id === task?.workingVersionId);
  if (!task || !version?.complete || version.id === task.snapshot.versionId || generationSourceFingerprint(version.basedOn) !== generationSourceFingerprint(task.snapshot)) return null;
  const expectedOrigin = task.command === "rewrite" ? "rewrite" : task.command === "calibrate" ? "calibrated" : "generated";
  if (version.origin !== expectedOrigin) return null;
  if (task.command === "rewrite") {
    const source = draft.versions.find((item) => item.id === task.snapshot.versionId);
    return source ? { stage: "generation", version: source, candidateVersion: version } : null;
  }
  return { stage: "generation", version };
}

function checkpoint(input: ViralJobInput, context: StageContext, update: (draft: ViralDraft) => void): ViralDraft {
  return tx(() => {
    const draft = requireDraft(input.draftId);
    assertExecution(input, context, draft);
    update(draft);
    draft.task!.updatedAt = new Date().toISOString();
    return putDraftWithinTx(draft);
  });
}

function commitStage(input: ViralJobInput, context: StageContext, result: ViralStageResult): ViralDraft {
  return checkpoint(input, context, (draft) => {
    const task = draft.task!;
    if (result.stage === "analysis") draft.analysis = result.analysis;
    if (result.stage === "angles") {
      const previousSelection = draft.selectedAngleId;
      const previousAngle = draft.angles.find((item) => item.id === previousSelection);
      const compatible = angleContextCompatible(draft.anglesSourceFingerprint, snapshotDraft(draft));
      const incomingIds = new Set(result.angles.map((item) => item.id));
      draft.angles = [...draft.angles.filter((item) => !incomingIds.has(item.id)), ...result.angles];
      // Preserve the user's angle for platform/time adaptation, never carry an old topic into a new task.
      draft.selectedAngleId = previousAngle && compatible ? previousSelection : result.selectedAngleId;
      draft.anglesSourceFingerprint = anglesSourceFingerprint(snapshotDraft(draft));
    }
    if (result.stage === "outline") draft.outline = result.outline;
    if (result.stage === "generation") {
      if (result.candidateVersion) {
        versionUpsert(draft, result.candidateVersion, false);
        draft.candidateVersionId = result.candidateVersion.id;
        task.workingVersionId = result.candidateVersion.id;
      } else {
        versionUpsert(draft, result.version, true);
        task.workingVersionId = result.version.id;
        draft.candidateVersionId = null;
        draft.review = null;
        draft.issueResolutions = [];
      }
    }
    if (result.stage === "review") {
      if (result.repairedVersion) {
        const checked = draft.versions.find((item) => item.id === result.repairedVersion?.parentVersionId);
        if (checked?.manuallyEdited) throw new PermanentError("人工编辑稿不能被自动修订替换");
        const remainsCandidate = task.command === "rewrite";
        versionUpsert(draft, result.repairedVersion, !remainsCandidate);
        task.workingVersionId = result.repairedVersion.id;
        draft.candidateVersionId = remainsCandidate ? result.repairedVersion.id : null;
      }
      if (result.candidateVersion) {
        versionUpsert(draft, result.candidateVersion, false);
        draft.candidateVersionId = result.candidateVersion.id;
      }
      // A rewrite candidate may be checked before adoption. The current manual text keeps its existing report.
      if (result.review.versionId === draft.currentVersionId) {
        draft.review = result.review;
        if (!reviewIsCurrent(draft)) throw new PermanentError("检查版本与正文或规则不一致");
      }
    }
    task.snapshot.mechanisms = structuredClone(draft.analysis?.mechanisms ?? []);
    task.snapshot.selectedAngle = structuredClone(draft.angles.find((item) => item.id === draft.selectedAngleId) ?? null);
    task.snapshot.outline = structuredClone(draft.outline);
    if (!task.completedStages.includes(result.stage)) task.completedStages.push(result.stage);
    recordArtifactWithinTx(task.id, result.stage, result);
  });
}

/** Injectable runner makes cancellation and recovery tests independent of provider access. */
export async function executeViralJob(input: ViralJobInput, context: StageContext, runner: ViralStageRunner = runViralStage) {
  try {
    checkpoint(input, context, (draft) => { draft.task!.status = "running"; });
    let latest = requireDraft(input.draftId);
    const plan = [...latest.task!.plan];
    for (const stage of plan) {
      latest = requireDraft(input.draftId);
      assertExecution(input, context, latest);
      if (latest.task!.completedStages.includes(stage)) continue;
      latest = checkpoint(input, context, (draft) => { draft.task!.stage = stage; });
      context.progress(0, stageLabel(stage));
      const snapshot = structuredClone(latest.task!.snapshot);
      const savedGeneration = stage === "generation" ? checkpointedGeneration(latest) : null;
      if (savedGeneration) {
        latest = commitStage(input, context, savedGeneration);
        continue;
      }
      // Comparison-side review owns resolutions only for this exact input task; it does not enter writing context.
      const result = await runner(stage, snapshot, artifactsOf(latest), {
        signal: context.signal,
        resolutions: structuredClone(latest.issueResolutions),
        onVersion: (version) => {
          checkpoint(input, context, (draft) => {
            const source = draft.versions.find((item) => item.id === draft.task!.snapshot.versionId);
            const candidate = draft.task!.command === "rewrite" || (stage === "review" && Boolean(source?.manuallyEdited));
            versionUpsert(draft, version, !candidate);
            if (candidate) draft.candidateVersionId = version.id;
            draft.task!.workingVersionId = version.id;
            if (!candidate) draft.review = null;
          });
        },
      });
      assertExecution(input, context, requireDraft(input.draftId));
      if (result.stage !== stage) throw new PermanentError("内容阶段返回了不匹配的产物");
      latest = commitStage(input, context, result);
    }
    latest = checkpoint(input, context, (draft) => {
      const review = draft.review;
      const hasUnresolved = review?.versionId === draft.currentVersionId && review.issues.some((issue) => !issue.resolved && issue.severity !== "suggestion");
      draft.task!.status = hasUnresolved ? "needs_changes" : "completed";
      draft.task!.stage = null;
      draft.task!.error = null;
    });
    return { draftId: latest.id, taskId: input.taskId, versionId: latest.currentVersionId };
  } catch (error) {
    // The canceled execution cannot touch a resumed task or a newer manually edited script.
    const draft = requireDraft(input.draftId);
    if (canAcceptTaskResult(draft, input.taskId, input.generation) && context.current() && isCurrentExecution(context.job.id, context.job.lockToken)) {
      checkpoint(input, context, (next) => {
        next.task!.status = "failed";
        next.task!.error = { code: "generation_failed", message: error instanceof Error ? error.message : "生成未完成", stage: next.task!.stage };
      });
    }
    throw error;
  }
}

function stageLabel(stage: ViralStage): string {
  return { analysis: "拆解中", angles: "构思角度", outline: "生成大纲", generation: "写稿中", review: "检查中" }[stage];
}

export const viralStage = defineStage<ViralJobInput, { draftId: string; taskId: string; versionId: string | null }>({ name: "viral", concurrency: 2, run: executeViralJob });
