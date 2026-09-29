import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import {
  GEMINI_TTS_FLASH_MODEL,
  GeminiTtsError,
  createGeminiTts,
  geminiApiKey,
  isGeminiTtsEnabled,
} from "@/lib/providers/tts/gemini";

const body = z.object({
  providerId: z.literal("google-gemini"),
  modelId: z.string().trim().min(1).max(200).default(GEMINI_TTS_FLASH_MODEL),
  voiceId: z.string().trim().min(1).max(100).default("Kore"),
});

const testText = "连接测试：你好，Gemini TTS。2026，Connection test complete.";
const testCooldownMs = 5_000;
const lastTests = new Map<string, number>();

function statusFor(error: GeminiTtsError) {
  switch (error.code) {
    case "auth": return 401;
    case "invalid-request": return 400;
    case "model-unavailable": return 503;
    case "quota":
    case "rate-limit": return 429;
    case "timeout": return 504;
    case "safety": return 422;
    case "aborted": return 499;
    case "invalid-audio":
    case "upstream": return 502;
    default: return 500;
  }
}

/**
 * 对 Google Gemini 做一次真实的短文本 TTS 请求。
 * 只返回健康信息，不创建素材、缓存或项目账本记录。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const input = await parseBody(req, body);
    if (!geminiApiKey()) {
      return Response.json({ ok: false, code: "auth", message: "未配置 GOOGLE_GEMINI_API_KEY 或 GEMINI_API_KEY" }, { status: 503 });
    }
    if (!isGeminiTtsEnabled()) {
      return Response.json({ ok: false, code: "disabled", message: "Gemini TTS 功能未开启，请设置 GOOGLE_GEMINI_TTS_ENABLED=true 后重启后台" }, { status: 409 });
    }

    const testKey = `${input.modelId}/${input.voiceId}`;
    const remainingMs = testCooldownMs - (Date.now() - (lastTests.get(testKey) ?? 0));
    if (remainingMs > 0) {
      return Response.json({ ok: false, code: "rate-limit", message: `请等待 ${Math.ceil(remainingMs / 1000)} 秒后再测试`, retryAfterMs: remainingMs }, { status: 429 });
    }
    lastTests.set(testKey, Date.now());

    const started = Date.now();
    try {
      // 每次探测新建适配器，避免开发模式中旧 singleton 持有过期配置。
      const provider = createGeminiTts({ enabled: true, timeoutMs: 15_000, maxRetries: 0 });
      const result = await provider.synthesize({
        text: testText,
        model: input.modelId,
        voice: input.voiceId,
        output: { encoding: "LINEAR16", sampleRateHertz: 24_000 },
        alignment: "estimated",
      }, req.signal);
      return Response.json({
        ok: true,
        providerId: input.providerId,
        modelId: input.modelId,
        voiceId: input.voiceId,
        latencyMs: Date.now() - started,
        audio: {
          mime: result.mime,
          sampleRateHertz: result.sampleRate,
          channels: result.channels,
          durationMs: result.durationMs,
        },
        usage: result.usage,
        retryCount: result.retryCount ?? 0,
      });
    } catch (error) {
      if (error instanceof GeminiTtsError) {
        return Response.json({
          ok: false,
          providerId: input.providerId,
          modelId: input.modelId,
          voiceId: input.voiceId,
          code: error.code,
          message: error.message,
          status: error.status,
          retryAfterMs: error.retryAfterMs,
          latencyMs: Date.now() - started,
        }, { status: statusFor(error) });
      }
      throw error;
    }
  });
}

