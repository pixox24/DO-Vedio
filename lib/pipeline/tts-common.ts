import { alignWords, contentCount, evenChars, toOriginal } from "../core/align";
import { voiceKeyOf, type TtsResult } from "../core/keys";
import type { VoiceSettings } from "../core/types";
import { ttsProviderOf, ttsRequestOf } from "../providers/tts/factory";
import type { SynthResult, SynthWord } from "../providers/tts/types";
import { beginGenerationRun, failGenerationRun, finishGenerationRun, noteGenerationRun } from "../providers/runs";
import { cachePut } from "../server/cache";
import { run, tx } from "../server/db";
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

/** 一次性写入配音缓存；任务已被取消或接管时整批不写 */
export function commitCache(ctx: StageContext, entries: [string, TtsResult][]) {
  const committed = tx(() => {
    if (!ctx.current()) return false;
    for (const [key, value] of entries) cachePut(key, "tts", value);
    return true;
  });
  if (!committed) throw canceled(ctx);
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
