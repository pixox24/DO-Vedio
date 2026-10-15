import { compileVideoReferencePrompt } from "../../core/video-prompt-compiler";
import { sourceImageSnapshot } from "../../core/video";
import { videoPlanNeedsSync } from "../../core/video-plan";
import type { GenerationFrame } from "../../core/output-spec";
import { getProject, mutateProject } from "../../server/projects";
import { beginGenerationRun, failGenerationRun, finishGenerationRun } from "../../providers/runs";
import { generateMediaAssets, mediaProviderId } from "../media-gen";
import { defineStage, PermanentError } from "../stage";
import { resolveImageModel } from "../image-models";
import { videoFrame } from "../video-generation";

export type ShotReferenceInput = { projectId: string; shotId: string; modelId: string; frame?: GenerationFrame };
export const shotReferenceStage = defineStage<ShotReferenceInput, { shotId: string; assetId: string }>({
  name: "shot-reference", concurrency: 20,
  async run(input, ctx) {
    const project = getProject(input.projectId);
    const shot = project?.doc.shots.find((item) => item.id === input.shotId);
    if (!project || !shot || project.doc.settings.visualPipeline !== "video" || !shot.videoPlan) throw new PermanentError("视频镜头不存在，请重新导演");
    if (resolveImageModel(project.doc.settings.video.referenceImageModelId || undefined) !== input.modelId) throw new PermanentError("参考图模型已变化，请重新生成");
    if (shot.locked) throw new PermanentError("镜头已锁定");
    if (videoPlanNeedsSync(shot)) throw new PermanentError("等待中文镜头要求同步到执行计划");
    const frame = videoFrame(project.doc, input.frame);
    const snapshot = sourceImageSnapshot(project.doc, shot, frame);
    const compiled = compileVideoReferencePrompt(project.doc, shot);
    const prompt = `${compiled.full}。${frame.aspect === "9:16" ? "竖屏构图" : "横屏构图"}，主体保持在中央安全区。`;
    const generation = beginGenerationRun({ projectId: input.projectId, jobId: ctx.job.id, kind: "image", providerId: mediaProviderId("image", input.modelId), modelId: input.modelId, inputHash: snapshot.promptHash, params: { stage: "shot-reference", shotId: shot.id, frame, referenceAssetIds: snapshot.referenceAssetIds } });
    try {
      const { assets } = await generateMediaAssets({ kind: "image", modelId: input.modelId, prompt, frame, references: snapshot.referenceAssetIds, seed: shot.seed, meta: { projectId: input.projectId, shotId: shot.id, stage: "shot-reference" } }, ctx.signal);
      const assetId = assets[0];
      if (!assetId) throw new PermanentError("参考图生成没有返回图片，请重试生成");
      finishGenerationRun(generation.id, { status: "succeeded", latencyMs: Date.now() - generation.startedAt, outputAssets: assets });
      mutateProject(input.projectId, (doc) => {
        const current = doc.shots.find((item) => item.id === shot.id);
        if (!ctx.current() || doc.settings.visualPipeline !== "video" || !current || current.locked || sourceImageSnapshot(doc, current, frame).hash !== snapshot.hash) return null;
        return { ...doc, shots: doc.shots.map((item) => item.id === shot.id ? { ...item, sourceImageAssetId: assetId, sourceImageDescription: undefined, sourceImagePromptHash: snapshot.promptHash, sourceImageConfirmedHash: undefined } : item) };
      });
      return { shotId: shot.id, assetId };
    } catch (error) {
      failGenerationRun(generation, error, ctx.signal.aborted);
      throw error;
    }
  },
});
