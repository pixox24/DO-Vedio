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
import { selectShotCandidate } from "../../core/shot-asset";
import { sceneSourceHash } from "../../core/scenes";
import { compileVideoPrompt } from "../../core/video-prompt-compiler";
import { videoGenerationSnapshot } from "../../core/video";
import { timelineFor } from "../artifacts";
import { videoFrame, videoPrerequisite, standardReferencesPending, videoAssetFraming } from "../video-generation";

export type ShotGenerateInput = {
  projectId: string;
  shotId: string;
  kind: "image" | "video";
  modelId: string;
  candidateCount?: number;
  outputSpecId?: OutputSpecId;
  frame?: GenerationFrame;
  assetFraming?: AssetFramingMode;
  attemptId?: string;
  requestHash?: string;
  allowNewAttempt?: boolean;
};

/**
 * 候选图上限。合并新旧候选时要截断，否则反复重生图会让候选无限增长、
 * 把镜头卡撑到很长，也让「选择候选」变成一件累人而没意义的事。
 */
const MAX_CANDIDATES = 8;

export type CandidateAsset = { frame?: { aspect: GenerationFrame["aspect"] }; id: string; assetId: string; selected?: boolean; promptHash?: string; generationPromptHash?: string; kind?: "image" | "video" };

/** 合并候选历史，并保证当前正在使用的素材不会被容量上限淘汰。 */
export function mergeCandidateHistory(current: CandidateAsset[] | undefined, fresh: CandidateAsset[], currentAssetId?: string, max = MAX_CANDIDATES) {
  const limit = Math.max(0, Math.floor(max));
  if (limit === 0) return [];

  // 新候选覆盖同 assetId 的旧记录，同时在每个输入内部去重，避免重复候选
  // 把容量占满后把真正不同的素材挤出去。Map 保持首次出现顺序，整体复杂度为 O(n)。
  const pool = new Map<string, CandidateAsset>();
  for (const candidate of current ?? []) {
    if (candidate.assetId && !pool.has(candidate.assetId)) pool.set(candidate.assetId, candidate);
  }
  for (const candidate of fresh) {
    if (candidate.assetId) pool.set(candidate.assetId, candidate);
  }

  // 旧项目可能只有 assetId、没有候选列表；第一次重新生成时也要把当前素材
  // 纳入历史，否则用户虽然没有丢文件，却没有回退入口。
  if (currentAssetId && !pool.has(currentAssetId)) {
    pool.set(currentAssetId, { id: `current-${currentAssetId}`, assetId: currentAssetId });
  }

  const freshIds = new Set<string>();
  const freshUnique: CandidateAsset[] = [];
  for (const candidate of fresh) {
    if (!candidate.assetId || freshIds.has(candidate.assetId)) continue;
    freshIds.add(candidate.assetId);
    const resolved = pool.get(candidate.assetId);
    if (resolved) freshUnique.push(resolved);
  }
  const currentCandidate = currentAssetId ? pool.get(currentAssetId) : undefined;
  const ordered = [
    ...freshUnique,
    ...(currentCandidate && !freshIds.has(currentCandidate.assetId) ? [currentCandidate] : []),
    ...(current ?? []).filter((candidate) => candidate.assetId && !freshIds.has(candidate.assetId) && candidate.assetId !== currentAssetId)
      .map((candidate) => pool.get(candidate.assetId))
      .filter((candidate): candidate is CandidateAsset => !!candidate),
  ];

  const kept = ordered.slice(0, limit);
  // 当前素材优先于新候选，保证「重新生成」不会悄悄替换用户正在使用的画面。
  if (currentCandidate && !kept.some((candidate) => candidate.assetId === currentCandidate.assetId)) {
    kept[kept.length - 1] = currentCandidate;
  }
  const selectedId = currentCandidate && kept.some((candidate) => candidate.assetId === currentCandidate.assetId)
    ? currentCandidate.assetId
    : kept[0]?.assetId;
  return kept.map((candidate) => ({ ...candidate, selected: candidate.assetId === selectedId }));
}

/** 单张场景标准图 + 镜头自己的 + 出场角色的定妆，最多 8 张。 */
export function referenceIds(doc: ProjectDoc, shot: Shot) {
  const scene = doc.scenes.find((s) => s.id === shot.sceneId);
  const stale = scene?.referenceSourceHash && scene.referenceSourceHash !== sceneSourceHash(scene, doc.visualStyle);
  const refs = scene && !stale ? scene.referenceAssetIds.slice(0, 1) : [];
  return [...new Set([...refs, ...shotReferenceIds(doc, shot)])].slice(0, 8);
}

export const shotGenerateStage = defineStage<ShotGenerateInput, { shotId: string; assets: string[]; candidateGroupId: string }>({
  name: "shot-generate",
  concurrency: 20,
  async run(input, ctx) {
    if (input.kind === "video") return runVideoShot(input, ctx);
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
        const fresh = ready.length
          ? slots.flatMap((asset, candidateIndex) => asset ? [{ id: candidateIds[candidateIndex], assetId: asset, selected: false, promptHash: compiled.hash, generationPromptHash, kind: input.kind }] : [])
          : [];
        // 合并而不是替换：保留历史候选，用户点了新候选之后还能切回旧图。
        // 旧图若仍是当前 assetId，就保持选中——重生图不该把用户已经满意的画面顶掉。
        const history = (current.candidates ?? []).map((candidate) => candidate.assetId === current.assetId && !candidate.promptHash
          ? { ...candidate, promptHash: current.assetPromptHash, kind: current.kind === "video" ? "video" as const : "image" as const } : candidate);
        const candidates = mergeCandidateHistory(history, fresh, current.assetId, MAX_CANDIDATES).map((candidate) => ({
          ...candidate, selected: !!candidate.selected,
          ...(candidate.assetId === current.assetId && !candidate.promptHash ? { promptHash: current.assetPromptHash } : {}),
        }));
        const selected = candidates.find((candidate) => candidate.selected);
        let next: Shot = { ...current, candidates, candidateGroupId };
        // 只有新图真正成为当前素材时才更新指纹；生成新候选不能把仍选中的旧图标成最新。
        if (selected && fresh.some((candidate) => candidate.id === selected.id)) {
          next = selectShotCandidate(next, selected.id, { aspect: frame.aspect, framing: assetFraming, aspects: outputSpecsFor(doc.settings).map((spec) => spec.aspect) }) ?? next;
          const generated = next.assetVariants[frame.aspect];
          if (generated) next.assetVariants = { ...next.assetVariants, [frame.aspect]: { ...generated, width: frame.width, height: frame.height, generatedAt: new Date().toISOString() } };
        }
        return {
          ...doc,
          shots: doc.shots.map((item) => item.id === shot.id ? next : item),
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


async function runVideoShot(input: ShotGenerateInput, ctx: import("../stage").StageContext) {
  const project = getProject(input.projectId);
  const shot = project?.doc.shots.find((item) => item.id === input.shotId);
  if (!project || !shot) throw new PermanentError("镜头不存在");
  if (shot.locked) throw new PermanentError("镜头已锁定，请先解锁");
  const frame = videoFrame(project.doc, input.frame);
  const timeline = timelineFor(project.doc, input.projectId, frame.aspect);
  const prerequisite = videoPrerequisite(project.doc, shot, timeline);
  if (prerequisite) throw new PermanentError(prerequisite);
  if (standardReferencesPending(input.projectId, shot)) throw new PermanentError("等待关联标准图完成后再生成视频");
  const snapshot = videoGenerationSnapshot(project.doc, shot, timeline, frame);
  if (!input.attemptId || input.requestHash !== snapshot.hash || input.modelId !== snapshot.modelId) throw new PermanentError("视频输入已变化，请重新确认并生成");
  const compiled = compileVideoPrompt({ doc: project.doc, shot, referenceAssetIds: snapshot.referenceAssetIds, requestDurationSeconds: snapshot.timing.requestDurationSeconds, targetDurationMs: snapshot.timing.targetDurationMs });
  const candidateGroupId = input.attemptId;
  const count = Math.max(1, Math.min(4, Math.floor(input.candidateCount ?? 1)));
  const assets: string[] = [];
  for (let index = 0; index < count; index++) {
    if (!ctx.current()) break;
    const { assets: generated } = await generateMediaAssets({
      kind: "video", modelId: input.modelId, prompt: compiled.prompt, frame, references: snapshot.referenceAssetIds,
      seed: shot.seed === undefined ? undefined : shot.seed + index,
      targetDurationMs: snapshot.timing.targetDurationMs, requestDurationSeconds: snapshot.timing.requestDurationSeconds,
      resolution: project.doc.settings.video.resolution,
      recovery: { projectId: input.projectId, jobId: ctx.job.id, attemptId: input.attemptId, requestHash: snapshot.hash, candidateIndex: index, allowNewAttempt: input.allowNewAttempt },
      onRecovery: (state) => { if (ctx.current()) ctx.progress((index + (state.phase === "ready" ? 1 : 0.1)) / count, state.phase); },
      meta: { projectId: input.projectId, shotId: shot.id, candidateGroupId, candidateIndex: index, frame },
    }, ctx.signal);
    const assetId = generated[0];
    if (!assetId) throw new PermanentError("视频生成没有返回素材，请恢复原尝试");
    assets.push(assetId);
    mutateProject(input.projectId, (doc) => {
      const current = doc.shots.find((item) => item.id === shot.id);
      if (!ctx.current() || doc.settings.visualPipeline !== "video" || !current || current.locked || videoGenerationSnapshot(doc, current, timelineFor(doc, input.projectId, frame.aspect), frame).hash !== snapshot.hash) return null;
      const fresh = assets.map((asset, candidateIndex) => ({ id: `${input.attemptId}:${candidateIndex}`, assetId: asset, selected: false, kind: "video" as const, frame: { aspect: frame.aspect }, promptHash: snapshot.hash, generationPromptHash: snapshot.hash }));
      // A preexisting image output must not prevent adoption of the first video.
      const currentAssetId = current.kind === "video" ? current.assetVariants[frame.aspect]?.assetId ?? (frame.aspect === videoFrame(doc).aspect ? current.assetId : undefined) : undefined;
      const history = current.candidates.map((candidate) => candidate.assetId === current.assetId && !candidate.promptHash ? { ...candidate, kind: current.kind === "video" ? "video" as const : "image" as const, promptHash: current.assetPromptHash } : candidate);
      const candidates = mergeCandidateHistory(history, fresh, currentAssetId).map((candidate) => ({ ...candidate, selected: !!candidate.selected }));
      const currentOutputHash = current.assetVariants[frame.aspect]?.promptHash ?? (frame.aspect === videoFrame(doc).aspect ? current.assetPromptHash : undefined);
      // 更新过期输出时直接采用新视频；相同输入下的有效选择继续保留，旧结果仍可从历史找回。
      const selected = !currentAssetId || currentOutputHash !== snapshot.hash
        ? candidates.find((candidate) => candidate.id === fresh[0]?.id)
        : candidates.find((candidate) => candidate.selected);
      let next: Shot = { ...current, candidates, candidateGroupId };
      if (selected && fresh.some((candidate) => candidate.id === selected.id)) {
        next = selectShotCandidate(next, selected.id, { aspect: frame.aspect, framing: videoAssetFraming(doc), aspects: outputSpecsFor(doc.settings).map((spec) => spec.aspect) }) ?? next;
        const variant = next.assetVariants[frame.aspect];
        if (variant) next.assetVariants = { ...next.assetVariants, [frame.aspect]: { ...variant, width: frame.width, height: frame.height, generatedAt: new Date().toISOString() } };
      }
      return { ...doc, shots: doc.shots.map((item) => item.id === shot.id ? next : item) };
    });
  }
  ctx.progress(1, "视频生成完成");
  return { shotId: shot.id, assets, candidateGroupId };
}
