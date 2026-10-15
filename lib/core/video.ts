import { anchorText, characterReferenceIds, lookAt, sheetSourceHash } from "./cast";
import { quickHash } from "./hash";
import { compileShotPrompt, shotCharacters } from "./prompt-compiler";
import { sceneSourceHash } from "./scenes";
import type { GenerationFrame } from "./output-spec";
import type { Timeline, TimelineShot } from "./timeline";
import type { ProjectDoc, Shot } from "./types";
import { videoReferenceDescription } from "./video-plan";

/** One source for the director/compiler/cache/status version contract. */
export const VIDEO_SNAPSHOT_VERSION = 1;
export const VIDEO_PROMPT_COMPILER_VERSION = "h3-keyframe-reference-v2";
export const VIDEO_REFERENCE_PROMPT_VERSION = "h3-silent-reference-v2";
export const VIDEO_MAX_DURATION_MS = 15_000;
export const VIDEO_MAX_HOLD_MS = 100;
export const VIDEO_WORKFLOW = "minimax_h3_zm_u08";

export type VideoShotTiming = {
  startMs: number; endMs: number; targetDurationMs: number; requestDurationSeconds: number;
  coveredLineIds: string[]; missingTtsLineIds: string[]; ready: boolean;
  reason?: "missing-shot" | "missing-tts" | "duration-out-of-range";
};

/** The final master timeline is the only authority; estimated speech is never ready. */
export function videoShotTiming(doc: ProjectDoc, shot: Shot, timeline: Timeline): VideoShotTiming {
  const interval = timeline.shots.find((item) => item.shotId === shot.id);
  const startMs = interval?.startMs ?? 0;
  const endMs = interval?.endMs ?? 0;
  const covered = timeline.lines.filter((line) => line.endMs > startMs && line.startMs < endMs);
  const missingTtsLineIds = covered.filter((line) => line.estimated || !timeline.voice.some((voice) => voice.lineId === line.id)).map((line) => line.id);
  const targetDurationMs = endMs - startMs;
  const requestDurationSeconds = Math.ceil(targetDurationMs / 1000);
  const reason = !interval ? "missing-shot" : !covered.length || missingTtsLineIds.length || !doc.lines.length ? "missing-tts"
    : targetDurationMs <= 0 || requestDurationSeconds > 15 ? "duration-out-of-range" : undefined;
  return { startMs, endMs, targetDurationMs, requestDurationSeconds, coveredLineIds: covered.map((line) => line.id), missingTtsLineIds, ready: !reason, ...(reason ? { reason } : {}) };
}

/** Stable scene → shot → interleaved character order; uploaded references survive. */
export function videoReferenceIds(doc: ProjectDoc, shot: Shot): string[] {
  const scene = doc.scenes.find((item) => item.id === shot.sceneId);
  const sceneStale = scene?.referenceSourceHash && scene.referenceSourceHash !== sceneSourceHash(scene, doc.visualStyle);
  const perCharacter = shotCharacters(doc, shot).map((card) => {
    const stale = card.sheet.sourceHash && card.sheet.sourceHash !== sheetSourceHash(card, doc.visualStyle);
    return stale ? card.referenceAssetIds : characterReferenceIds(card);
  });
  const characterIds: string[] = [];
  for (let index = 0; perCharacter.some((refs) => refs[index]); index++) {
    for (const refs of perCharacter) if (refs[index]) characterIds.push(refs[index]);
  }
  return [...new Set([...(scene && !sceneStale ? scene.referenceAssetIds.slice(0, 1) : []), ...shot.referenceAssetIds, ...characterIds])].slice(0, 8);
}

/** AI 视频只依赖本镜实际使用的角色与场景；任务成功或候选存在不代表已采用有效标准图。 */
export function missingVideoStandards(doc: ProjectDoc, shot: Shot): { kind: "character" | "scene"; id: string }[] {
  if (doc.settings.visualPipeline !== "video" || shot.kind !== "video") return [];
  const missing: { kind: "character" | "scene"; id: string }[] = [];
  for (const card of shotCharacters(doc, shot)) {
    if (card.kind === "group" || card.presentation !== "full") continue;
    const stale = card.sheet.sourceHash && card.sheet.sourceHash !== sheetSourceHash(card, doc.visualStyle);
    const refs = stale ? card.referenceAssetIds : characterReferenceIds(card);
    if (!refs.length) missing.push({ kind: "character", id: card.id });
  }
  const scene = doc.scenes.find((item) => item.id === shot.sceneId);
  if (scene && (!scene.referenceAssetIds.length || (scene.referenceSourceHash && scene.referenceSourceHash !== sceneSourceHash(scene, doc.visualStyle)))) {
    missing.push({ kind: "scene", id: scene.id });
  }
  return missing;
}

/** Main input always occupies Picture 1, including when final auxiliary refs are supplied. */
export function finalVideoReferenceIds(doc: ProjectDoc, shot: Shot, referenceAssetIds?: string[]): string[] {
  return [...new Set([...(shot.sourceImageAssetId ? [shot.sourceImageAssetId] : []), ...(referenceAssetIds ?? videoReferenceIds(doc, shot))])].filter(Boolean).slice(0, 9);
}

function staticPrompt(doc: ProjectDoc, shot: Shot) {
  // Never put action/camera/endState into a still-image prompt or its fingerprint.
  const content = videoReferenceDescription(shot);
  return compileShotPrompt(doc, { ...shot, description: content, prompt: shot.videoPlan ? content : shot.prompt, onScreenText: undefined });
}

export function sourceImageSnapshot(doc: ProjectDoc, shot: Shot, frame: GenerationFrame, referenceAssetIds?: string[]) {
  const refs = [...new Set(referenceAssetIds ?? videoReferenceIds(doc, shot))].filter((id) => id !== shot.sourceImageAssetId).slice(0, 8);
  const compiled = staticPrompt(doc, shot);
  const promptHash = quickHash({
    version: VIDEO_SNAPSHOT_VERSION, compilerVersion: VIDEO_REFERENCE_PROMPT_VERSION, pipeline: "video-reference", prompt: compiled.hash,
    modelId: doc.settings.video.referenceImageModelId, aspect: frame.aspect, seed: shot.seed, referenceAssetIds: refs,
    description: shot.videoPlanDescriptionHash ? shot.description : undefined,
  });
  const hash = quickHash({ promptHash, sourceImageAssetId: shot.sourceImageAssetId, description: shot.sourceImageDescription });
  return { hash, promptHash, referenceAssetIds: refs };
}

export function sourceImageConfirmed(doc: ProjectDoc, shot: Shot, frame: GenerationFrame, referenceAssetIds?: string[]): boolean {
  return !!shot.sourceImageAssetId && shot.sourceImageConfirmedHash === sourceImageSnapshot(doc, shot, frame, referenceAssetIds).hash;
}

/** Unknown means user-chosen input: automatic generation must never overwrite it. */
export function sourceImageStale(doc: ProjectDoc, shot: Shot, frame: GenerationFrame): boolean {
  return !!shot.sourceImageAssetId && !!shot.sourceImagePromptHash && shot.sourceImagePromptHash !== "unknown"
    && shot.sourceImagePromptHash !== sourceImageSnapshot(doc, shot, frame).promptHash;
}

export type VideoSnapshotOptions = {
  referenceAssetIds?: string[]; compilerVersion?: string | number; prompt?: string; modelId?: string;
};

export function videoGenerationSnapshot(doc: ProjectDoc, shot: Shot, timeline: Timeline, frame: GenerationFrame, options: VideoSnapshotOptions = {}) {
  const timing = videoShotTiming(doc, shot, timeline);
  const referenceAssetIds = finalVideoReferenceIds(doc, shot, options.referenceAssetIds);
  const source = sourceImageSnapshot(doc, shot, frame, referenceAssetIds);
  const lineIds = new Set(timing.coveredLineIds);
  const characters = shotCharacters(doc, shot).map((card) => ({ id: card.id, anchor: anchorText(card, lookAt(card, shot.at.lineId, doc.lines)) }));
  const modelId = options.modelId ?? doc.settings.video.modelId;
  const compilerVersion = options.compilerVersion ?? VIDEO_PROMPT_COMPILER_VERSION;
  // Compiled text is deterministic from this snapshot. An optional display prompt must
  // not make status/preview hashes differ from the worker's hash.
  const hash = quickHash({
    version: VIDEO_SNAPSHOT_VERSION, compilerVersion, pipeline: "video", workflow: VIDEO_WORKFLOW, modelId,
    aspect: frame.aspect, resolution: doc.settings.video.resolution, seed: shot.seed,
    sourceHash: source.hash, referenceAssetIds, characters, videoPlan: shot.videoPlan,
    description: shot.videoPlanDescriptionHash ? shot.description : undefined,
    targetDurationMs: timing.targetDurationMs, requestDurationSeconds: timing.requestDurationSeconds,
    lines: doc.lines.filter((line) => lineIds.has(line.id)).map((line) => ({ id: line.id, text: line.text, spans: line.spans })),
    voices: timeline.voice.filter((voice) => lineIds.has(voice.lineId)).map((voice) => ({
      lineId: voice.lineId, assetId: voice.assetId ?? voice.src, trimStartMs: voice.trimStartMs,
      startMs: voice.startMs - timing.startMs, durationMs: voice.durationMs,
    })),
    missingTtsLineIds: timing.missingTtsLineIds,
  });
  return { hash, key: `shot:${hash}`, timing, referenceAssetIds, modelId, compilerVersion, workflow: VIDEO_WORKFLOW, sourceImageHash: source.hash };
}

export function videoAssetStale(doc: ProjectDoc, shot: Shot, timeline: Timeline, frame: GenerationFrame, options?: VideoSnapshotOptions): boolean {
  return !!shot.assetId && shot.assetPromptHash !== videoGenerationSnapshot(doc, shot, timeline, frame, options).hash;
}

export type VideoArtifact = { durationMs: number; width?: number; height?: number; fps?: number };

/** Milliseconds stay independent of source fps; the player handles frame quantization. */
export function videoPlayback(targetDurationMs: number, source?: VideoArtifact): Pick<TimelineShot,
  "videoTrimStartMs" | "videoPlayableDurationMs" | "videoHoldLastFrameMs" | "videoSourceDurationMs" | "videoSourceFps" | "videoDurationReady"> {
  const durationMs = source && Number.isFinite(source.durationMs) && source.durationMs > 0 ? source.durationMs : undefined;
  const deficit = durationMs === undefined ? Infinity : Math.max(0, targetDurationMs - durationMs);
  return {
    videoTrimStartMs: 0, videoPlayableDurationMs: durationMs === undefined ? 0 : Math.min(targetDurationMs, durationMs),
    videoHoldLastFrameMs: deficit <= VIDEO_MAX_HOLD_MS ? deficit : 0,
    videoSourceDurationMs: durationMs, videoSourceFps: source?.fps,
    videoDurationReady: targetDurationMs > 0 && durationMs !== undefined && deficit <= VIDEO_MAX_HOLD_MS,
  };
}
