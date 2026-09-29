import { alignWords, contentCount, evenChars, toOriginal } from "../../core/align";
import { ttsKey, voiceKeyOf, type TtsResult } from "../../core/keys";
import type { VoiceSettings } from "../../core/types";
import { ttsProviderOf } from "../../providers/tts/factory";
import { cacheGet, cachePut } from "../../server/cache";
import { run } from "../../server/db";
import { putBuffer } from "../../server/media";
import { billedCharsOf, ttsBilling } from "../pricing";
import { defineStage } from "../stage";
import { beginGenerationRun, failGenerationRun, finishGenerationRun, noteGenerationRun } from "../../providers/runs";

/** 配音：一句一个任务。结果写缓存（按朗读文本 + 音色），不直接改文档 */

export type TtsInput = {
  projectId: string;
  lineId: string;
  text: string;
  spoken: string;
  ttsText?: string;
  textType?: "PlainText" | "SSML";
  map: number[];
  voice: VoiceSettings;
  /** 重录时保留旧缓存，直到新音频成功后再覆盖。 */
  force?: boolean;
};

export function providerOf(v: VoiceSettings) {
  return ttsProviderOf(v);
}

export const ttsStage = defineStage<TtsInput, { key: string; durationMs: number }>({
  name: "tts",
  concurrency: 3,
  async run(input, ctx) {
    const ttsText = input.ttsText ?? input.spoken;
    const key = ttsKey(ttsText, input.voice, input.textType);
    const hit = cacheGet<TtsResult>(key);
    if (hit && !input.force) return { key, durationMs: hit.durationMs };

    const provider = providerOf(input.voice);
    ctx.progress(0.1, "合成中");
    const generation = beginGenerationRun({ projectId: input.projectId, jobId: ctx.job.id, providerId: provider.id, modelId: input.voice.model, kind: "tts", inputHash: key, params: { stage: "tts", voice: input.voice.voiceId, voiceFingerprint: voiceKeyOf(input.voice), textLength: input.text.length, rate: input.voice.rate, pitch: input.voice.pitch, volume: input.voice.volume, textType: input.textType ?? "PlainText", emotionTagged: !input.textType && ttsText !== input.spoken } });
    try {
      const res = await provider.synthesize(
        {
          text: ttsText,
          model: input.voice.model,
          voice: input.voice.voiceId,
          rate: input.voice.rate,
          pitch: input.voice.pitch,
          volume: input.voice.volume,
          instruction: input.voice.provider === "dashscope" && input.textType !== "SSML" ? input.voice.instruction || undefined : undefined,
          textType: input.textType,
          ...(input.voice.provider === "google-gemini" && input.voice.google ? {
            output: { encoding: input.voice.google.outputEncoding, sampleRateHertz: input.voice.google.sampleRateHertz },
            alignment: input.voice.google.alignment,
          } : {}),
        },
        ctx.signal,
      );
      const billing = ttsBilling(provider.id, input.voice.model, res.usage, res.billedChars || billedCharsOf(input.spoken));
      const ledgerId = ctx.spend({ provider: provider.id, model: input.voice.model, unit: billing.unit, quantity: billing.quantity, costYuan: billing.costYuan });

      const aligned = res.words.length > 0;
      const alignmentSource = res.alignmentSource ?? (aligned ? "provider" : "estimated");
      let chars = aligned ? toOriginal(input.text, alignWords(input.spoken, res.words), input.map) : [];
      const speechStartMs = aligned ? Math.max(0, res.words[0].startMs) : 0;
      const speechEndMs = aligned ? Math.min(res.durationMs, res.words[res.words.length - 1].endMs) : res.durationMs;
      if (!aligned || chars.length === 0) chars = evenChars(input.text, speechStartMs, speechEndMs);

      const asset = await putBuffer(res.audio, { ext: "wav", mime: "audio/wav", meta: { provider: provider.id, model: input.voice.model, voice: input.voice.voiceId, sampleRate: res.sampleRate, channels: res.channels, bitsPerSample: res.bitsPerSample, durationMs: res.durationMs, alignmentSource, usage: res.usage, text: input.text, spoken: input.spoken } });
      const result: TtsResult = {
        assetId: asset.hash,
        durationMs: res.durationMs,
        speechStartMs,
        speechEndMs: Math.max(speechEndMs, speechStartMs + 1),
        chars,
        aligned,
        alignmentSource,
        spokenChars: contentCount(input.text),
      };
      cachePut(key, "tts", result);
      noteGenerationRun(generation.id, { usage: res.usage, durationMs: res.durationMs, retryCount: res.retryCount ?? 0, alignmentSource, costSource: billing.costSource, ledgerUnit: billing.unit, ledgerQuantity: billing.quantity });
      finishGenerationRun(generation.id, { status: "succeeded", latencyMs: Date.now() - generation.startedAt, costYuan: billing.costYuan, outputAssets: [asset.hash], ledgerId });

      // 语速实测：累计「有效语音时长 / 字数」，写稿阶段用它估算时长
      const speech = result.speechEndMs - result.speechStartMs;
      if (ttsText === input.spoken && result.spokenChars >= 4 && speech > 500) {
        run(
          `INSERT INTO voice_stats (voice_key, chars, speech_ms, samples) VALUES (?, ?, ?, 1)
           ON CONFLICT(voice_key) DO UPDATE SET chars = chars + excluded.chars, speech_ms = speech_ms + excluded.speech_ms, samples = samples + 1`,
          voiceKeyOf(input.voice),
          result.spokenChars,
          speech,
        );
      }
      ctx.progress(1);
      return { key, durationMs: result.durationMs };
    } catch (e) {
      failGenerationRun(generation, e, ctx.signal.aborted);
      throw e;
    }
  },
});
