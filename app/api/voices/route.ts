import { dashscopeTts, isQwenAudioModel, qwenAudioHttpUrl } from "@/lib/providers/tts/dashscope";
import { geminiApiKey, geminiTts, isGeminiTtsEnabled } from "@/lib/providers/tts/gemini";

export async function GET() {
  const p = dashscopeTts();
  const g = geminiTts();
  const apiKeyConfigured = !!process.env.DASHSCOPE_API_KEY?.trim();
  const geminiConfigured = !!geminiApiKey() && isGeminiTtsEnabled();
  return Response.json({
    configured: apiKeyConfigured || geminiConfigured,
    providers: [
      { id: p.id, label: "阿里云百炼语音", models: p.models.map((m) => ({
        ...m,
        configured: apiKeyConfigured && (!isQwenAudioModel(m.id) || !!qwenAudioHttpUrl()),
        configurationHint: !apiKeyConfigured ? "需配置 DASHSCOPE_API_KEY" : isQwenAudioModel(m.id) && !qwenAudioHttpUrl() ? "需配置 Qwen TTS HTTP 地址" : undefined,
        voices: p.voices(m.id),
      })) },
      { id: g.id, label: "Google Gemini TTS", models: g.models.map((m) => ({
        ...m,
        configured: geminiConfigured,
        configurationHint: !geminiApiKey() ? "需配置 GOOGLE_GEMINI_API_KEY 或 GEMINI_API_KEY" : !isGeminiTtsEnabled() ? "需开启 GOOGLE_GEMINI_TTS_ENABLED" : undefined,
        voices: g.voices(m.id),
      })) },
    ],
  });
}
