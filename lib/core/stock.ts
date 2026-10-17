import type { GenerationFrame } from "./output-spec";
import { outputSpecsFor } from "./output-spec";
import type { Timeline } from "./timeline";
import type { ProjectDoc, Shot } from "./types";
import { isAiVideo, videoGenerationSnapshot, videoShotTiming } from "./video";
import { quickHash } from "./hash";

/**
 * 素材管线的纯函数层：检索词、快照、过期判定、画幅方向。
 *
 * 这里**不下载、不写文档、不碰缓存**——那些在 `shot-stock` stage 与
 * `lib/providers/stock/` 里。这样快照哈希与门禁都能在测试里逐位断言。
 *
 * 最关键的一条不变量：`shot.stockQuery` 不进 `videoGenerationSnapshot` 的哈希，
 * `stockSnapshot` 也不含 `videoPlan`。两条管线各有各的过期判据，互不牵连。
 */

/** 与 `VIDEO_SNAPSHOT_VERSION` 同理：改哈希输入结构时必须加一，让旧素材自然过期。 */
export const STOCK_SNAPSHOT_VERSION = 1;

/**
 * 规则派生的兜底检索词。分镜 LLM 已给 `stockQuery` 时不用它。
 *
 * 必须**可复现**：它进快照哈希，同一份文档必须永远算出同一个词，否则每次
 * 打开项目都会把素材判为过期。所以这里只做确定性的词法处理，不问模型。
 *
 * 它只是过渡：`staleRanges` 在素材管线下会把「缺 `stockQuery`」视为过期，
 * 下一次重做分镜就会补齐。真正决定检索质量的是分镜那次调用。
 */
const stockStopwords = new Set([
  "a", "an", "the", "this", "that", "these", "those", "his", "her", "their", "its", "our", "your",
  "i", "me", "my", "we", "us", "you", "he", "she", "him", "they", "them", "it",
  "in", "on", "at", "of", "by", "with", "and", "or", "to", "from", "into", "onto", "as", "is", "are",
  "was", "were", "be", "being", "been", "up", "down", "over", "under", "near", "toward", "towards",
  "while", "then", "still", "very", "slowly", "gently", "softly", "medium", "wide", "close",
  "composition", "frame", "shot", "camera", "scene",
]);
/** 兜底检索词：`videoPlan` 缺失或抽不出英文词时用。固定值，保证可复现。 */
const STOCK_QUERY_FALLBACK = "abstract background";

export function stockQuery(shot: Shot): string {
  const source = `${shot.videoPlan?.startState ?? ""} ${shot.videoPlan?.action ?? ""}`;
  const words = source.toLowerCase().replace(/[^a-z\s]+/g, " ").split(/\s+/)
    .filter((word) => word.length > 2 && !stockStopwords.has(word));
  return words.slice(0, 3).join(" ") || STOCK_QUERY_FALLBACK;
}

/** 该镜头实际拿去检索的词：分镜给的优先，缺了才退到规则派生。 */
export function effectiveStockQuery(shot: Shot): string {
  return shot.stockQuery?.trim() || stockQuery(shot);
}

/** 素材的输出画幅。与 `videoFrame` 同理：默认取第一个输出规格。 */
export function stockFrame(doc: ProjectDoc, frame?: GenerationFrame): GenerationFrame {
  return frame ?? outputSpecsFor(doc.settings)[0];
}

/**
 * 检索方向由画幅决定。竖屏素材给横屏用会被 cover 裁掉两侧，不做这件事。
 * 只传方向、不做「先按一个方向搜再裁」，所以 1:1 这种两向可用的画幅不需要特殊处理。
 */
export function stockOrientation(frame: GenerationFrame): "landscape" | "portrait" {
  return frame.height > frame.width ? "portrait" : "landscape";
}

/**
 * 已试素材游标：该镜头当前候选的全部 assetId。
 *
 * **只进任务 input，绝不进快照哈希。** 候选池被 `MAX_CANDIDATES = 8` 截断，
 * 一旦有候选被淘汰，从文档推导的排除集就会变；若它参与哈希，门禁会把当前
 * 正在用的素材误判成过期。
 */
export function stockExclusions(shot: Shot): string[] {
  return [...new Set([...(shot.assetId ? [shot.assetId] : []), ...shot.candidates.map((candidate) => candidate.assetId)])];
}

/**
 * 检索时用的最短时长下限（秒）。
 *
 * 取「用户在设置里填的下限」与「镜头时长」的较大者：素材短于镜头会让
 * `videoPlayback` 的 `videoDurationReady` 为假，渲染直接卡住。向上取整到秒
 * 是因为 Pexels 的 `min_duration` 只认整数秒。
 *
 * 注意来源声明的 `duration` 是整数秒、实测可能短一点，所以 stage 拿到素材后
 * **还要按 ffprobe 实测时长复检**（`targetDurationMs - VIDEO_MAX_HOLD_MS`）。
 */
export function stockMinDurationSec(doc: ProjectDoc, targetDurationMs: number): number {
  return Math.max(doc.settings.stock.minDurationSec, Math.max(1, Math.ceil(targetDurationMs / 1000)));
}

/**
 * 时长下限之外再留多少秒的余量作为上限。
 *
 * 端到端实测（`scripts/stock-e2e.ts`）里两秒的镜头曾检索回一条 120 秒、
 * 232MB 的地铁素材并直接撞上下载体积上限。只设「不短于」是不够的：
 * Pexels 的长素材占比很高，而它正是体积与下载额度的唯一变量。
 */
export const STOCK_DURATION_SLACK_SEC = 15;

/**
 * 检索时用的时长上限（秒）。**派生值，不是设置项**——它只有一个正确答案：
 * 比下限多一点点余量，够 `pickFile` 与时长复检挑到东西，又不至于拖回一部长片。
 */
export function stockMaxDurationSec(doc: ProjectDoc, targetDurationMs: number): number {
  return stockMinDurationSec(doc, targetDurationMs) + STOCK_DURATION_SLACK_SEC;
}

/**
 * 素材快照：与 `videoGenerationSnapshot` 同形（`{ hash, key, timing }`），只换哈希输入。
 *
 * 哈希输入**只含文档里稳定可复现的部分**：检索词、方向、时长下限、目标时长、
 * 覆盖句的文本与配音。`excludeAssetIds`（重搜游标）不在这里——重搜前后哈希
 * 必须不变，写回的 `promptHash` 才是同一个稳定值。
 */
export function stockSnapshot(doc: ProjectDoc, shot: Shot, timeline: Timeline, frame: GenerationFrame) {
  const timing = videoShotTiming(doc, shot, timeline);
  const lineIds = new Set(timing.coveredLineIds);
  const query = effectiveStockQuery(shot);
  const minDurationSec = stockMinDurationSec(doc, timing.targetDurationMs);
  // 上限进哈希：它是检索条件的一部分，改了就必须重新检索，
  // 否则缓存会把「有上限之前」搜回来的长片继续当成这一镜的素材。
  const maxDurationSec = stockMaxDurationSec(doc, timing.targetDurationMs);
  const hash = quickHash({
    version: STOCK_SNAPSHOT_VERSION, pipeline: "stock",
    aspect: frame.aspect, orientation: stockOrientation(frame),
    query, minDurationSec, maxDurationSec,
    targetDurationMs: timing.targetDurationMs, requestDurationSeconds: timing.requestDurationSeconds,
    seed: shot.seed,
    lines: doc.lines.filter((line) => lineIds.has(line.id)).map((line) => ({ id: line.id, text: line.text, spans: line.spans })),
    voices: timeline.voice.filter((voice) => lineIds.has(voice.lineId)).map((voice) => ({
      lineId: voice.lineId, assetId: voice.assetId ?? voice.src, trimStartMs: voice.trimStartMs,
      startMs: voice.startMs - timing.startMs, durationMs: voice.durationMs,
    })),
    missingTtsLineIds: timing.missingTtsLineIds,
  });
  return { hash, key: `stock:${hash}`, timing, query, minDurationSec, maxDurationSec };
}

/**
 * 按画面管线分发快照。门禁、候选判定与编排都通过它取快照，
 * 而不是各写一份 `isAiVideo(...) ? ... : ...`。
 */
export function snapshotFor(doc: ProjectDoc, shot: Shot, timeline: Timeline, frame: GenerationFrame) {
  return isAiVideo(doc.settings.visualPipeline)
    ? videoGenerationSnapshot(doc, shot, timeline, frame)
    : stockSnapshot(doc, shot, timeline, frame);
}

/** 当前素材是否与现在的检索输入一致。与 `videoAssetStale` 同理。 */
export function stockAssetStale(doc: ProjectDoc, shot: Shot, timeline: Timeline, frame: GenerationFrame): boolean {
  return !!shot.assetId && shot.assetPromptHash !== stockSnapshot(doc, shot, timeline, frame).hash;
}
