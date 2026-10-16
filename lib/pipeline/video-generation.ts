import { randomUUID } from "crypto";
import { outputSpecForRequest, outputSpecsFor, type GenerationFrame } from "../core/output-spec";
import { playbackAssetId, selectShotCandidate } from "../core/shot-asset";
import type { Aspect, ProjectDoc, Shot } from "../core/types";
import { missingVideoStandards, sourceImageConfirmed, sourceImageSnapshot, sourceImageStale, videoGenerationSnapshot, videoShotTiming, videoPlayback } from "../core/video";
import type { Timeline } from "../core/timeline";
import { findMediaRecoveryRun, findOriginalMediaAttempt } from "../providers/runs";
import { listProviderProfiles } from "../providers/registry";
import { all, parseJson } from "../server/db";
import { enqueue, latestJobByKey, projectJobs } from "../server/jobs";
import { getAsset } from "../server/media";
import { timelineFor } from "./artifacts";
import { resolveImageModel } from "./image-models";
import { PermanentError } from "./stage";
import { videoPlanNeedsSync } from "../core/video-plan";

export function videoFrame(doc: ProjectDoc, frame?: GenerationFrame): GenerationFrame {
  return frame ?? outputSpecsFor(doc.settings)[0];
}
export function videoAssetFraming(doc: ProjectDoc): "shared" | "per-output" {
  return doc.settings.assetFraming === "per-output" ? "per-output" : "shared";
}
export function videoModelAvailable(modelId: string) {
  return listProviderProfiles().some((p) => p.kind === "video" && p.configured && p.enabled && p.adapterStatus === "ready" && (modelId === `${p.providerId}::${p.modelId}` || modelId === p.modelId));
}
export function referenceJobKey(doc: ProjectDoc, shot: Shot, frame: GenerationFrame) {
  return `shot-reference:${shot.id}:${sourceImageSnapshot(doc, shot, frame).promptHash}`;
}
export function videoPrerequisite(doc: ProjectDoc, shot: Shot, timeline: Timeline): string | undefined {
  if (doc.settings.visualPipeline !== "video") return "请先切换到 AI 视频驱动";
  if (shot.kind !== "video" || !shot.videoPlan) return shot.locked ? "锁定镜头还不是视频分镜，请解锁并重新导演" : "请先重新导演生成视频分镜";
  if (videoPlanNeedsSync(shot)) return "等待中文镜头要求同步到执行计划";
  if (missingVideoStandards(doc, shot).length) return "请先在角色和场景中补齐并采用有效标准图";
  const timing = videoShotTiming(doc, shot, timeline);
  if (!timing.ready) return timing.reason === "duration-out-of-range" ? "镜头超过 15 秒或时长无效，请重新导演" : "等待真实配音完成";
  if (!shot.sourceImageAssetId || sourceImageStale(doc, shot, videoFrame(doc))) return "等待镜头参考图";
  if (!doc.settings.video.autoContinue && !sourceImageConfirmed(doc, shot, videoFrame(doc))) return "等待确认参考图";
}

/** Readiness checks the selected output for every requested aspect, including probe data. */
export function videoRenderProblems(doc: ProjectDoc, timeline: Timeline, frame: GenerationFrame, shots: readonly Shot[] = doc.shots): string[] {
  if (doc.settings.visualPipeline !== "video") return [];
  if (!doc.shots.length) return ["等待视频分镜"];
  // 单镜检查仍需完整分镜上下文：参考图指纹中的情绪取决于相邻镜头的覆盖范围。
  return shots.flatMap((shot) => {
    if (shot.kind !== "video" || !shot.videoPlan) return [`镜头 ${shot.id} 需要重新导演为视频`];
    if (videoPlanNeedsSync(shot)) return [`镜头 ${shot.id} 等待中文镜头要求同步`];
    const variant = shot.assetVariants[frame.aspect];
    const origin = variant?.source === "shared" && variant.sourceAspect ? videoFrame(doc, outputSpecForRequest(doc.settings, undefined, variant.sourceAspect)) : frame;
    const snapshot = videoGenerationSnapshot(doc, shot, timeline, origin);
    const assetId = playbackAssetId(shot, frame.aspect);
    const hash = variant ? variant.promptHash : shot.assetPromptHash;
    if (!assetId || hash !== snapshot.hash) return [`镜头 ${shot.id} 的 ${frame.aspect} 视频缺失或已过期`];
    const asset = getAsset(assetId);
    if (!snapshot.timing.ready || !asset || asset.kind !== "video" || !videoPlayback(snapshot.timing.targetDurationMs, { durationMs: asset.durationMs ?? 0 }).videoDurationReady) return [`镜头 ${shot.id} 视频时长不足或尚未探测`];
    return [];
  });
}

export function usableVideoCandidate(doc: ProjectDoc, shot: Shot, timeline: Timeline, frame: GenerationFrame) {
  const snapshot = videoGenerationSnapshot(doc, shot, timeline, frame);
  return shot.candidates.find((candidate) => {
    if (candidate.kind !== "video" || candidate.promptHash !== snapshot.hash || candidate.generationPromptHash !== snapshot.hash || (videoAssetFraming(doc) === "per-output" && candidate.frame?.aspect !== frame.aspect)) return false;
    const asset = getAsset(candidate.assetId);
    return asset?.kind === "video" && videoPlayback(snapshot.timing.targetDurationMs, { durationMs: asset.durationMs ?? 0 }).videoDurationReady;
  });
}

/** Resume can adopt an already downloaded current result without another provider request. */
export function adoptReadyVideoCandidates(projectId: string, doc: ProjectDoc, aspects: readonly Aspect[]): ProjectDoc {
  if (doc.settings.visualPipeline !== "video") return doc;
  const framing = videoAssetFraming(doc);
  const frames = framing === "shared" ? [videoFrame(doc)] : aspects.map((aspect) => outputSpecForRequest(doc.settings, undefined, aspect));
  let changed = false;
  const shots = doc.shots.map((shot) => {
    if (shot.locked) return shot;
    let current = shot;
    for (const frame of frames) {
      const timeline = timelineFor(doc, projectId, frame.aspect);
      if (videoPrerequisite(doc, current, timeline) || !videoRenderProblems(doc, timeline, frame, [current]).length) continue;
      const candidate = usableVideoCandidate(doc, current, timeline, frame);
      if (!candidate) continue;
      const next = selectShotCandidate(current, candidate.id, { aspect: frame.aspect, framing, aspects: outputSpecsFor(doc.settings).map((spec) => spec.aspect) });
      if (next) { current = next; changed = true; }
    }
    return current;
  });
  return changed ? { ...doc, shots } : doc;
}

type AttemptInput = { attemptId?: string; requestHash?: string; candidateCount?: number };
export function videoAttempt(projectId: string, shotId: string, requestHash: string, operation: "generate" | "resume" | "regenerate" = "generate", resumeAttemptId?: string) {
  const original = findOriginalMediaAttempt({ projectId, shotId, requestHash });
  const previous = all<{ input: string }>("SELECT input FROM jobs WHERE project_id = ? AND stage = 'shot-generate' AND json_extract(input, '$.shotId') = ? AND json_extract(input, '$.requestHash') = ? ORDER BY created_at DESC", projectId, shotId, requestHash).map((row) => parseJson<AttemptInput>(row.input, {}));
  if (operation === "regenerate") return { attemptId: randomUUID(), allowNewAttempt: true };
  const attemptId = operation === "resume" ? resumeAttemptId : original?.params.attemptId ?? previous[0]?.attemptId;
  if (operation === "resume" && (!attemptId || (!findMediaRecoveryRun({ projectId, attemptId, requestHash, candidateIndex: 0 }) && !previous.some((item) => item.attemptId === attemptId)))) throw new PermanentError("恢复尝试与当前镜头输入不匹配，请检查参考图和视频参数");
  return { attemptId: attemptId ?? randomUUID(), allowNewAttempt: false, candidateCount: previous.find((item) => item.attemptId === attemptId)?.candidateCount };
}

export function enqueueVideoShot(input: { projectId: string; doc: ProjectDoc; shot: Shot; frame: GenerationFrame; candidateCount?: number; batchId?: string; operation?: "generate" | "resume" | "regenerate"; resumeAttemptId?: string; goalId?: string }) {
  const { projectId, doc, shot, frame } = input;
  if (shot.locked) throw new PermanentError("镜头已锁定，请先解锁");
  const timeline = timelineFor(doc, projectId, frame.aspect);
  const error = videoPrerequisite(doc, shot, timeline);
  if (error) throw new PermanentError(error);
  if (!videoModelAvailable(doc.settings.video.modelId)) throw new PermanentError("视频模型不可用，请在模型中心检查配置");
  const snapshot = videoGenerationSnapshot(doc, shot, timeline, frame);
  const key = snapshot.key;
  const active = latestJobByKey(key, projectId);
  if (active && ["queued", "running"].includes(active.status)) return { job: active, reused: true, attemptId: (active.input as AttemptInput).attemptId };
  const attempt = videoAttempt(projectId, shot.id, snapshot.hash, input.operation, input.resumeAttemptId);
  const job = enqueue({ projectId, stage: "shot-generate", key, target: `镜头 ${shot.id}`, maxAttempts: 1, priority: 6, input: {
    projectId, shotId: shot.id, kind: "video", modelId: doc.settings.video.modelId, frame,
    assetFraming: videoAssetFraming(doc), candidateCount: attempt.candidateCount ?? input.candidateCount ?? 1, batchId: input.batchId ?? randomUUID(), goalId: input.goalId,
    requestHash: snapshot.hash, attemptId: attempt.attemptId, allowNewAttempt: attempt.allowNewAttempt,
  } });
  return { job, attemptId: attempt.attemptId };
}

export function enqueueShotReference(projectId: string, doc: ProjectDoc, shot: Shot, frame: GenerationFrame, requestedModelId?: string) {
  if (doc.settings.visualPipeline !== "video" || shot.kind !== "video" || !shot.videoPlan) throw new PermanentError("请先重新导演生成视频分镜");
  if (shot.locked) throw new PermanentError("镜头已锁定，请先解锁");
  if (missingVideoStandards(doc, shot).length) throw new PermanentError("请先在角色和场景中补齐并采用有效标准图");
  const modelId = resolveImageModel(requestedModelId || doc.settings.video.referenceImageModelId || undefined);
  if (videoPlanNeedsSync(shot)) throw new PermanentError("等待中文镜头要求同步到执行计划");
  if (!modelId) throw new PermanentError("没有可用的参考图模型，请在模型中心配置并启用");
  const active = projectJobs(projectId).find((job) => job.stage === "shot-reference" && ["queued", "running"].includes(job.status) && (job.input as { shotId?: string } | null)?.shotId === shot.id);
  if (active) return active;
  return enqueue({ projectId, stage: "shot-reference", key: referenceJobKey(doc, shot, frame), target: `镜头参考 ${shot.id}`, input: { projectId, shotId: shot.id, modelId, frame }, priority: 6, maxAttempts: 1 });
}
