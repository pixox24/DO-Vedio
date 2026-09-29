import type { VoiceSettings } from "../../core/types";
import { dashscopeTts } from "./dashscope";
import { geminiTts } from "./gemini";
import type { SynthRequest, TtsProvider } from "./types";

/** 所有服务端 TTS 调用共用的 provider 分发入口。 */
export function ttsProviderOf(voice: Pick<VoiceSettings, "provider">): TtsProvider {
  if (voice.provider === "dashscope") return dashscopeTts();
  if (voice.provider === "google-gemini") return geminiTts();
  throw new Error(`不支持的配音服务商：${voice.provider}`);
}

/** 项目音色 + 朗读文本 → 服务商请求。逐句、段落、探针共用，保证同样的设置发出同样的请求 */
export function ttsRequestOf(voice: VoiceSettings, text: string, textType?: "PlainText" | "SSML"): SynthRequest {
  return {
    text,
    model: voice.model,
    voice: voice.voiceId,
    rate: voice.rate,
    pitch: voice.pitch,
    volume: voice.volume,
    instruction: voice.provider === "dashscope" && textType !== "SSML" ? voice.instruction || undefined : undefined,
    textType,
    ...(voice.provider === "google-gemini" && voice.google ? {
      output: { encoding: voice.google.outputEncoding, sampleRateHertz: voice.google.sampleRateHertz },
      alignment: voice.google.alignment,
    } : {}),
  };
}
