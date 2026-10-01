import { randomUUID } from "crypto";
import { shotGenerationKey } from "../../core/keys";
import { compileShotPrompt, shotReferenceIds } from "../../core/prompt-compiler";
import type { ProjectDoc, Shot } from "../../core/types";
import { assetDataUri, generateBatch, generateMediaAssets, mediaProviderId } from "../media-gen";
import { beginGenerationRun, failGenerationRun, finishGenerationRun, noteGenerationRun } from "../../providers/runs";
import { defineStage, PermanentError } from "../stage";
import { getProject, mutateProject } from "../../server/projects";
import type { AssetFramingMode, OutputSpecId } from "../../core/types";
import { outputSpecForRequest, outputSpecsFor, type GenerationFrame } from "../../core/output-spec";
import { quickHash } from "../../core/hash";

export type ShotGenerateInput = {
  projectId: string;
  shotId: string;
  kind: "image" | "video";
  modelId: string;
  candidateCount?: number;
  outputSpecId?: OutputSpecId;
  frame?: GenerationFrame;
  assetFraming?: AssetFramingMode;
};

/**
 * 候选图上限。合并新旧候选时要截断，否则反复重生图会让候选无限增长、
 * 把镜头卡撑到很长，也让「选择候选」变成一件累人而没意义的事。
 */
const MAX_CANDIDATES = 8;

export type CandidateAsset = { id: string; assetId: string; selected?: boolean };

/** 合并候选历史，并保证当前正在使用的素材不会被容量上限淘汰。 */
export function mergeCandidateHistory(current: CandidateAsset[], fresh: CandidateAsset[], currentAssetId?: string, max = MAX_CANDIDATES) {
  const merged = [...fresh, ...current.filter((candidate) => !fresh.some((item) => item.assetId === candidate.assetId))];
  const currentIndex = currentAssetId ? merged.findIndex((candidate) => candidate.assetId === currentAssetId) : -1;
  const kept = merged.slice(0, max);
  if (currentIndex >= max && currentIndex >= 0 && currentAssetId) {
    const evict = kept.findLastIndex((candidate) => candidate.assetId !== currentAssetId);
    if (evict >= 0) kept.splice(evict, 1, merged[currentIndex]);
  }
  const selectedId = currentAssetId && kept.some((candidate) => candidate.assetId === currentAssetId)
    ? currentAssetId
    : kept.find((candidate) => fresh.some((item) => item.assetId === candidate.assetId))?.assetId;
  return kept.map((candidate) => ({ ...candidate, selected: candidate.assetId === selectedId }));
}

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
    const spec = input.frame ?? outputSpecForRequest(project.doc.settings, input.outputSpecId);
    const frame: GenerationFrame = { aspect: spec.aspect, width: spec.width, height: spec.height, fps: spec.fps };
    const assetFraming = input.assetFraming ?? project.doc.settings.assetFraming;
    const refs = referenceIds(project.doc, shot);
    const baseKey = shotGenerationKey(project.doc, shot, input.kind, input.modelId, frame);
    const candidateCount = Math.max(1, Math.min(4, Math.floor(input.candidateCount ?? 1)));
    const candidateGroupId = randomUUID();
    const compiled = compileShotPrompt(project.doc, shot);
    const frameHint = frame.aspect === "9:16" ? "竖屏构图，主体保持在中央安全区，顶部和底部预留字幕与平台界面空间" : "横屏构图，主体和关键动作保持在中央安全区，左右保留环境叙事空间";
    const generationPrompt = `${compiled.full}。${frameHint}`;
    const generationPromptHash = quickHash(generationPrompt);
    const candidateIds = Array.from({ length: candidateCount }, () => randomUUID());
    const slots: (string | undefined)[] = Array.from({ length: candidateCount });
    const writeAsset = (index: number, assetId: string) => {
      if (!ctx.current()) return;
      slots[index] = assetId;
      mutateProject(input.projectId, (doc) => {
        if (!ctx.current()) return null;
        const current = doc.shots.find((item) => item.id === shot.id);
        if (!current) return null;
        const ready = slots.filter((asset): asset is string => !!asset);
        const firstReady = slots.findIndex(Boolean);
        const fresh = ready.length
          ? slots.flatMap((asset, candidateIndex) => asset ? [{ id: candidateIds[candidateIndex], assetId: asset, selected: false }] : [])
          : [];
        // 合并而不是替换：保留历史候选，用户点了新候选之后还能切回旧图。
        // 旧图若仍是当前 assetId，就保持选中——重生图不该把用户已经满意的画面顶掉。
        const candidates = fresh.length
          ? mergeCandidateHistory(current.candidates, fresh, current.assetId, MAX_CANDIDATES)
          : current.candidates;
        const selectedId = candidates.find((candidate) => candidate.selected)?.assetId ?? (firstReady >= 0 ? slots[firstReady] : undefined);
        const variants = selectedId ? Object.fromEntries(outputSpecsFor(doc.settings).map((spec) => [spec.aspect, {
          assetId: selectedId,
          promptHash: generationPromptHash,
          aspect: spec.aspect,
          width: spec.width,
          height: spec.height,
          source: spec.aspect === frame.aspect ? "generated" : "shared",
          sourceAspect: spec.aspect === frame.aspect ? undefined : frame.aspect,
          generatedAt: new Date().toISOString(),
        }])) : current.assetVariants;
        return {
          ...doc,
          shots: doc.shots.map((item) => item.id === shot.id ? {
            ...item,
            kind: input.kind,
            assetId: selectedId ?? item.assetId,
            candidateGroupId,
            candidates,
            assetPromptHash: compiled.hash,
            assetVariants: selectedId ? (assetFraming === "shared" ? variants : {
              ...item.assetVariants,
              [frame.aspect]: { assetId: selectedId, promptHash: generationPromptHash, aspect: frame.aspect, width: frame.width, height: frame.height, source: "generated", generatedAt: new Date().toISOString() },
            }) : item.assetVariants,
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
        current: ctx.current,
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
              prompt: generationPrompt,
              frame,
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
              { kind: input.kind, modelId: input.modelId, prompt: generationPrompt, frame, references: refs, seed: shot.seed === undefined ? undefined : shot.seed + index, firstFrame, lastFrame, controlImage, meta: { projectId: input.projectId, shotId: shot.id, candidateGroupId, candidateIndex: index, frame } },
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
