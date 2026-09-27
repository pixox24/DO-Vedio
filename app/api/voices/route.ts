import { dashscopeTts, isQwenAudioModel, qwenAudioHttpUrl } from "@/lib/providers/tts/dashscope";

export async function GET() {
  const p = dashscopeTts();
  const apiKeyConfigured = !!process.env.DASHSCOPE_API_KEY?.trim();
  return Response.json({
    configured: apiKeyConfigured,
    providers: [{ id: p.id, label: "阿里云百炼语音", models: p.models.map((m) => ({
      ...m,
      configured: apiKeyConfigured && (!isQwenAudioModel(m.id) || !!qwenAudioHttpUrl()),
      configurationHint: !apiKeyConfigured ? "需配置 DASHSCOPE_API_KEY" : isQwenAudioModel(m.id) && !qwenAudioHttpUrl() ? "需配置 Qwen TTS HTTP 地址" : undefined,
      voices: p.voices(m.id),
    })) }],
  });
}
