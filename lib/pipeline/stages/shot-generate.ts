import { randomUUID } from "crypto";
import { shotGenerationKey } from "../../core/keys";
import { compileShotPrompt, shotReferenceIds } from "../../core/prompt-compiler";
import type { ProjectDoc, Shot } from "../../core/types";
import { assetDataUri, generateBatch, generateMediaAssets, mediaProviderId } from "../media-gen";
import { beginGenerationRun, failGenerationRun, finishGenerationRun, noteGenerationRun } from "../../providers/runs";
import { defineStage, PermanentError } from "../stage";
import { getProject, mutateProject } from "../../server/projects";

export type ShotGenerateInput = {
  projectId: string;
  shotId: string;
  kind: "image" | "video";
  modelId: string;
  candidateCount?: number;
};

/** 参考图：镜头自己的 + 出场角色的定妆（上传 > 立绘 > 三视图）+ 场景参考，最多 8 张 */
function referenceIds(doc: ProjectDoc, shot: Shot) {
  const scene = shot.sceneId ? (doc.scenes.find((s) => s.id === shot.sceneId)?.referenceAssetIds ?? []) : [];
  return [...new Set([...shotReferenceIds(doc, shot), ...scene])].slice(0, 8);
}

export const shotGenerateStage = defineStage<ShotGenerateInput, { shotId: string; assets: string[]; candidateGroupId: string }>({
  name: "shot-generate",
  concurrency: 20,
  async run(input, ctx) {
    const project = getProject(input.projectId);
    const shot = project?.doc.shots.find((s) => s.id === input.shotId);
    if (!project || !shot) throw new PermanentError("镜头不存在");
    if (shot.locked) throw new PermanentError("镜头已锁定，请先解锁后再生成");
    const refs = referenceIds(project.doc, shot);
    const baseKey = shotGenerationKey(project.doc, shot, input.kind, input.modelId);
    const candidateCount = Math.max(1, Math.min(4, Math.floor(input.candidateCount ?? 1)));
    const candidateGroupId = randomUUID();
    const compiled = compileShotPrompt(project.doc, shot);
    const candidateIds = Array.from({ length: candidateCount }, () => randomUUID());
    const slots: (string | undefined)[] = Array.from({ length: candidateCount });
    const writeAsset = (index: number, assetId: string) => {
      slots[index] = assetId;
      mutateProject(input.projectId, (doc) => {
        const current = doc.shots.find((item) => item.id === shot.id);
        if (!current) return null;
        const ready = slots.filter((asset): asset is string => !!asset);
        const firstReady = slots.findIndex(Boolean);
        const candidates = ready.length
          ? slots.flatMap((asset, candidateIndex) => asset ? [{ id: candidateIds[candidateIndex], assetId: asset, selected: candidateIndex === firstReady }] : [])
          : current.candidates;
        return {
          ...doc,
          shots: doc.shots.map((item) => item.id === shot.id ? {
            ...item,
            kind: input.kind,
            assetId: ready[0] ?? item.assetId,
            candidateGroupId,
            candidates,
            assetPromptHash: compiled.hash,
          } : item),
        };
      });
    };
    // 候选图并行生成、逐张缓存：失败的不影响成功的，重试只补缺的
    const firstFrame = await assetDataUri(shot.firstFrameAssetId);
    const lastFrame = await assetDataUri(shot.lastFrameAssetId);
    const controlImage = await assetDataUri(shot.controlAssetId);
    const assets = await generateBatch(
      Array.from({ length: candidateCount }, (_, index) => index),
      {
        itemKey: (index) => `${baseKey}:${ctx.job.id}:${index}`,
        signal: ctx.signal,
        onProgress: (done, total) => ctx.progress(done / total, `候选 ${done}/${total}`),
        onAsset: writeAsset,
        run: async (index) => {
          const run = beginGenerationRun({
            projectId: input.projectId,
            jobId: ctx.job.id,
            providerId: mediaProviderId(input.kind, input.modelId),
            modelId: input.modelId,
            kind: input.kind,
            inputHash: `${baseKey}:${index}`,
            params: {
              stage: "shot-generate",
              shotId: shot.id,
              prompt: compiled.full,
              visualStyleId: project.doc.visualStyle?.id,
              candidateIndex: index,
              seed: shot.seed === undefined ? undefined : shot.seed + index,
              referenceAssetIds: refs,
              characterIds: shot.characterIds,
              sceneId: shot.sceneId,
              firstFrameAssetId: shot.firstFrameAssetId,
              lastFrameAssetId: shot.lastFrameAssetId,
              controlAssetId: shot.controlAssetId,
            },
          });
          try {
            // 目前两个适配器都不支持独立的负面词，发送带「画面中不要出现」的完整提示词
            const { assets: out, referenceFallback } = await generateMediaAssets(
              { kind: input.kind, modelId: input.modelId, prompt: compiled.full, references: refs, seed: shot.seed === undefined ? undefined : shot.seed + index, firstFrame, lastFrame, controlImage, meta: { projectId: input.projectId, shotId: shot.id, candidateGroupId, candidateIndex: index } },
              ctx.signal,
            );
            if (referenceFallback) noteGenerationRun(run.id, { referenceFallback });
            finishGenerationRun(run.id, { status: "succeeded", latencyMs: Date.now() - run.startedAt, outputAssets: out });
            return out[0];
          } catch (e) {
            failGenerationRun(run, e, ctx.signal.aborted);
            throw e;
          }
        },
      },
    );
    ctx.progress(1, "生成完成");
    return { shotId: shot.id, assets, candidateGroupId };
  },
});
