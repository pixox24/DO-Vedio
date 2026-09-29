import type { VoiceSettings } from "../../core/types";
import { dashscopeTts } from "./dashscope";
import { geminiTts } from "./gemini";
import type { TtsProvider } from "./types";

/** 所有服务端 TTS 调用共用的 provider 分发入口。 */
export function ttsProviderOf(voice: Pick<VoiceSettings, "provider">): TtsProvider {
  if (voice.provider === "dashscope") return dashscopeTts();
  if (voice.provider === "google-gemini") return geminiTts();
  throw new Error(`不支持的配音服务商：${voice.provider}`);
}
