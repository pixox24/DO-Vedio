import { alignWords, contentCount, evenChars, toOriginal } from "../core/align";
import { voiceKeyOf, type TtsResult } from "../core/keys";
import type { VoiceSettings } from "../core/types";
import { ttsProviderOf, ttsRequestOf } from "../providers/tts/factory";
import type { SynthResult, SynthWord } from "../providers/tts/types";
import { beginGenerationRun, failGenerationRun, finishGenerationRun, noteGenerationRun } from "../providers/runs";
import { cachePut } from "../server/cache";
import { get, parseJson, run, tx } from "../server/db";
import { billedCharsOf, ttsBilling } from "./pricing";
import type { StageContext } from "./stage";

/** 逐句配音（tts）与段落配音（tts-block）共用的合成、记账、写缓存 */

export const canceled = (ctx: StageContext) => ctx.signal.reason ?? new DOMException("配音任务已取消", "AbortError");

export function assertCurrent(ctx: StageContext) {
  if (!ctx.current()) throw canceled(ctx);
}

type Synthesis = {
  projectId: string;
  voice: VoiceSettings;
  text: string;
  textType?: "PlainText" | "SSML";
  /** 服务商没返回计费字数时，按这段文字估算 */
  billText: string;
  inputHash: string;
  params: Record<string, unknown>;
};

/**
 * 一次上游合成：生成记录 + 记账。store 负责写素材和缓存，返回产物；
 * 合成或 store 中任何一步出错，生成记录都记为失败（已扣的费用照记，与上游一致）。
 */
export async function trackedSynthesis<T>(ctx: StageContext, o: Synthesis, store: (res: SynthResult) => Promise<{ value: T; outputAssets: string[]; alignmentSource: string }>): Promise<T> {
  const provider = ttsProviderOf(o.voice);
  const v = o.voice;
  const generation = beginGenerationRun({ projectId: o.projectId, jobId: ctx.job.id, providerId: provider.id, modelId: v.model, kind: "tts", inputHash: o.inputHash, params: { voice: v.voiceId, voiceFingerprint: voiceKeyOf(v), rate: v.rate, pitch: v.pitch, volume: v.volume, ...o.params } });
  try {
    const res = await provider.synthesize(ttsRequestOf(v, o.text, o.textType), ctx.signal);
    assertCurrent(ctx);
    const billing = ttsBilling(provider.id, v.model, res.usage, res.billedChars || billedCharsOf(o.billText));
    const ledgerId = ctx.spend({ provider: provider.id, model: v.model, unit: billing.unit, quantity: billing.quantity, costYuan: billing.costYuan });
    const out = await store(res);
    noteGenerationRun(generation.id, { usage: res.usage, durationMs: res.durationMs, retryCount: res.retryCount ?? 0, alignmentSource: out.alignmentSource, costSource: billing.costSource, ledgerUnit: billing.unit, ledgerQuantity: billing.quantity });
    finishGenerationRun(generation.id, { status: "succeeded", latencyMs: Date.now() - generation.startedAt, costYuan: billing.costYuan, outputAssets: out.outputAssets, ledgerId });
    return out.value;
  } catch (e) {
    failGenerationRun(generation, e, ctx.signal.aborted);
    throw e;
  }
}

/** 单句音频的时间信息：有字级时间戳就对齐到原文，没有就在有效语音区间内按字数均分 */
export function lineResult(line: { text: string; spoken: string; map: number[] }, words: SynthWord[], durationMs: number, alignmentSource?: TtsResult["alignmentSource"]): Omit<TtsResult, "assetId"> {
  const aligned = words.length > 0;
  let chars = aligned ? toOriginal(line.text, alignWords(line.spoken, words), line.map) : [];
  const speechStartMs = aligned ? Math.max(0, words[0].startMs) : 0;
  const speechEndMs = aligned ? Math.min(durationMs, words[words.length - 1].endMs) : durationMs;
  if (!aligned || chars.length === 0) chars = evenChars(line.text, speechStartMs, speechEndMs);
  return { durationMs, speechStartMs, speechEndMs: Math.max(speechEndMs, speechStartMs + 1), chars, aligned, alignmentSource: alignmentSource ?? (aligned ? "provider" : "estimated"), spokenChars: contentCount(line.text) };
}

/**
 * 一次性写入配音缓存；任务已被取消或接管时整批不写。
 *
 * 覆盖前把旧结果归档到 `tts_takes`，让「重录」可以撤销 —— 否则用户点了重录就只能接受新版本，
 * 而重录是要花钱的。归档只在调用方显式传入 `force` 时发生；正常自动编排即使
 * 因为重新排队而写入缓存，也不会污染撤销记录。
 */
export function commitCache(ctx: StageContext, entries: [string, TtsResult][], reason: string = "revoice", force = false) {
  const committed = tx(() => {
    if (!ctx.current()) return false;
    const projectId = ctx.job.projectId;
    for (const [key, value] of entries) {
      const previous = get<{ result: string }>("SELECT result FROM cache WHERE key = ?", key);
      // 只有明确的强制重录才会覆盖当前结果并提供撤销；自动编排/补齐命中
      // 同一个 key 时不应把正常运行历史塞进撤销栈。
      if (force && previous && projectId) {
        // 每个 key 只保留一个可撤销版本，避免连续点击「撤销」一路回到更早的音频。
        run("DELETE FROM tts_takes WHERE project_id = ? AND cache_key = ?", projectId, key);
        run(
          "INSERT INTO tts_takes (project_id, cache_key, result, archived_at, reason) VALUES (?, ?, ?, ?, ?)",
          projectId,
          key,
          previous.result,
          Date.now(),
          reason,
        );
      }
      cachePut(key, "tts", value);
    }
    return true;
  });
  if (!committed) throw canceled(ctx);
}

/**
 * 撤销上一次重录：把该 key 最近一条归档写回缓存，并删掉这条记录（只允许回一步）。
 * 返回真正被回退的 key 数量。
 */
export function undoLastTake(projectId: string, keys: string[]) {
  return tx(() => {
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.length === 0) return 0;
    const takes = uniqueKeys.map((key) => ({
      key,
      take: get<{ id: number; result: string }>(
        "SELECT id, result FROM tts_takes WHERE project_id = ? AND cache_key = ? ORDER BY archived_at DESC, id DESC LIMIT 1",
        projectId,
        key,
      ),
    }));
    // 一次批量重录要么整体可撤销，要么明确告知没有记录，不能只恢复一半。
    if (takes.some(({ take }) => !take)) return 0;
    for (const { key, take } of takes) {
      if (!take) return 0;
      const value = parseJson<TtsResult>(take.result, undefined as unknown as TtsResult);
      if (!value) return 0;
      cachePut(key, "tts", value);
      run("DELETE FROM tts_takes WHERE id = ?", take.id);
    }
    return takes.length;
  });
}

/** 语速实测：累计「有效语音时长 / 字数」，写稿阶段用它估算时长 */
export function recordVoiceStats(voice: VoiceSettings, chars: number, speechMs: number) {
  if (chars < 4 || speechMs <= 500) return;
  run(
    `INSERT INTO voice_stats (voice_key, chars, speech_ms, samples) VALUES (?, ?, ?, 1)
     ON CONFLICT(voice_key) DO UPDATE SET chars = chars + excluded.chars, speech_ms = speech_ms + excluded.speech_ms, samples = samples + 1`,
    voiceKeyOf(voice),
    chars,
    speechMs,
  );
}
