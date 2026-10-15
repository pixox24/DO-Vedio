import { dashscopeModelState, dashscopeTts } from "@/lib/providers/tts/dashscope";
import { edgeTts } from "@/lib/providers/tts/edge";
import { geminiApiKey, geminiTts, isGeminiTtsEnabled } from "@/lib/providers/tts/gemini";
import { catalogVoice, listCustomVoices } from "@/lib/server/custom-voices";

export async function GET() {
  const p = dashscopeTts();
  const g = geminiTts();
  const e = edgeTts();
  const custom = listCustomVoices();
  const geminiConfigured = !!geminiApiKey() && isGeminiTtsEnabled();
  return Response.json({
    // Edge 免费且无需 Key，只要目录里有模型就算可用
    configured: p.models.some((model) => dashscopeModelState(model.id).configured) || geminiConfigured || e.models.length > 0,
    providers: [
      { id: p.id, label: "阿里云百炼语音", models: p.models.map((m) => {
        const state = dashscopeModelState(m.id);
        return {
          ...m,
          configured: state.configured,
          configurationHint: state.hint,
          voices: [
            ...p.voices(m.id),
            ...custom.filter((voice) => voice.provider === p.id && voice.model === m.id).map(catalogVoice),
          ],
        };
      }) },
      { id: g.id, label: "Google Gemini TTS", models: g.models.map((m) => ({
        ...m,
        configured: geminiConfigured,
        configurationHint: !geminiApiKey() ? "需配置 GOOGLE_GEMINI_API_KEY 或 GEMINI_API_KEY" : !isGeminiTtsEnabled() ? "需开启 GOOGLE_GEMINI_TTS_ENABLED" : undefined,
        voices: g.voices(m.id),
      })) },
      // Edge 免费且无需 Key，恒为可用；每句一次请求，不经过音色册
      { id: e.id, label: "微软 Edge 朗读", models: e.models.map((m) => ({ ...m, configured: true, voices: e.voices(m.id) })) },
    ],
  });
}
