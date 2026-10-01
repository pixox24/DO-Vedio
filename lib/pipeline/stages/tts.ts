import { ttsKey, type TtsResult } from "../../core/keys";
import type { VoiceSettings } from "../../core/types";
import { cacheGet } from "../../server/cache";
import { putBuffer } from "../../server/media";
import { defineStage } from "../stage";
import { assertCurrent, commitCache, lineResult, recordVoiceStats, trackedSynthesis } from "../tts-common";

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
  /** 批次 id：只用于「停止本次提交」，不参与缓存键 */
  batchId?: string;
};

export const ttsStage = defineStage<TtsInput, { key: string; durationMs: number }>({
  name: "tts",
  concurrency: 3,
  async run(input, ctx) {
    const ttsText = input.ttsText ?? input.spoken;
    const key = ttsKey(ttsText, input.voice, input.textType);
    const hit = cacheGet<TtsResult>(key);
    if (hit && !input.force) return { key, durationMs: hit.durationMs };

    ctx.progress(0.1, "合成中");
    const params = { stage: "tts", textLength: input.text.length, textType: input.textType ?? "PlainText", emotionTagged: !input.textType && ttsText !== input.spoken };
    const result = await trackedSynthesis(ctx, { projectId: input.projectId, voice: input.voice, text: ttsText, textType: input.textType, billText: input.spoken, inputHash: key, params }, async (res) => {
      const timing = lineResult(input, res.words, res.durationMs, res.alignmentSource);
      assertCurrent(ctx);
      const asset = await putBuffer(res.audio, { ext: "wav", mime: "audio/wav", meta: { provider: input.voice.provider, model: input.voice.model, voice: input.voice.voiceId, sampleRate: res.sampleRate, channels: res.channels, bitsPerSample: res.bitsPerSample, durationMs: res.durationMs, alignmentSource: timing.alignmentSource, usage: res.usage, text: input.text, spoken: input.spoken } });
      const value: TtsResult = { assetId: asset.hash, ...timing };
      commitCache(ctx, [[key, value]], "revoice", input.force === true);
      return { value, outputAssets: [asset.hash], alignmentSource: timing.alignmentSource! };
    });
    if (ttsText === input.spoken) recordVoiceStats(input.voice, result.spokenChars, result.speechEndMs - result.speechStartMs);
    ctx.progress(1);
    return { key, durationMs: result.durationMs };
  },
});
