import { describe, expect, it, vi } from "vitest";
import {
  GEMINI_TTS_FLASH_MODEL,
  buildGeminiRequest,
  classifyGeminiError,
  createGeminiTts,
  geminiApiKey,
  geminiFetch,
  geminiProxyUrl,
  normalizeAudio,
  parseGeminiResponse,
  retryAfterMsFromBody,
} from "./gemini";
import { pcmToWav } from "./types";

describe("Google Gemini TTS 适配器", () => {
  it("即使保存了表达指令，也只把正文发送给 Gemini", () => {
    const body = buildGeminiRequest({ text: "正文不能被改写", stylePrompt: "沉稳、清晰", model: GEMINI_TTS_FLASH_MODEL, voice: "Kore" });
    expect(body.contents[0].parts[0].text).toBe("正文不能被改写");
    expect(JSON.stringify(body)).not.toContain("沉稳、清晰");
    expect(body.generationConfig.speechConfig).not.toHaveProperty("stylePrompt");
    expect(body.generationConfig).not.toHaveProperty("audioConfig");
  });

  it("已有 WAV 原样通过，裸 PCM 只包装一次", () => {
    const pcm = Buffer.alloc(480, 3);
    const wav = pcmToWav(pcm, 24_000);
    expect(normalizeAudio(wav, "audio/wav")).toMatchObject({ audio: wav, sampleRate: 24_000, channels: 1, bitsPerSample: 16, durationMs: 10 });
    const normalized = normalizeAudio(pcm, "audio/L16", { sampleRateHertz: 24_000 });
    expect(normalized.audio.toString("ascii", 0, 4)).toBe("RIFF");
    expect(normalized.audio.length).toBe(524);
  });

  it("声明为 WAV 但缺少文件头时拒绝响应", () => {
    expect(() => normalizeAudio(Buffer.alloc(8), "audio/wav")).toThrow(/RIFF\/WAVE/);
  });

  it("解析 inlineData 音频和 usage", () => {
    const pcm = Buffer.alloc(96, 8).toString("base64");
    const parsed = parseGeminiResponse({
      metadata: { data: "not-audio-field" },
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16", data: pcm } }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 34 },
    }, 2);
    expect(parsed.audio).toEqual(Buffer.alloc(96, 8));
    expect(parsed.mime).toBe("audio/L16");
    expect(parsed.usage).toMatchObject({ unit: "output-tokens", quantity: 34, inputTokens: 12, outputTokens: 34 });
  });

  it("对 429 按 Retry-After 重试，并返回统一 WAV 结果", async () => {
    const pcm = Buffer.alloc(480, 4).toString("base64");
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", message: "try later" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16", data: pcm } }] } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = createGeminiTts({ apiKey: "test-key", enabled: true, baseUrl: "https://example.test", fetchImpl, maxRetries: 1, retryDelayMs: 0 });
    const result = await provider.synthesize({ text: "测试", model: GEMINI_TTS_FLASH_MODEL, voice: "Kore", stylePrompt: "沉稳" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.mime).toBe("audio/wav");
    expect(result.alignmentSource).toBe("estimated");
    expect(result.words).toEqual([]);
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(request.contents[0].parts[0].text).toBe("测试");
    expect(JSON.stringify(request)).not.toContain("沉稳");
    expect(request.generationConfig.speechConfig).not.toHaveProperty("stylePrompt");
  });

  it("解析 Gemini 429 正文里的 retry in 秒数", () => {
    expect(retryAfterMsFromBody({ error: { message: "Please retry in 21.850018284s." } })).toBe(21850);
    expect(classifyGeminiError(429, { error: { message: "quota exceeded; Please retry in 21.85s." } }).retryAfterMs).toBe(21850);
    expect(classifyGeminiError(429, { error: { message: "Please retry in 21s." } }, undefined, 30_000).retryAfterMs).toBe(30_000);
  });

  it("分类鉴权、安全和模型错误", () => {
    expect(classifyGeminiError(401, { error: { message: "bad api key" } }).code).toBe("auth");
    expect(classifyGeminiError(400, { error: { message: "blocked by safety filter" } }).code).toBe("safety");
    expect(classifyGeminiError(403, { error: { message: "blocked by safety policy" } }).code).toBe("safety");
    expect(classifyGeminiError(404, { error: { message: "model not found" } }).code).toBe("model-unavailable");
  });

  it("支持通用 GEMINI_API_KEY 兼容别名", () => {
    expect(geminiApiKey("  alias-key  ")).toBe("alias-key");
  });

  it("Google Key 为空时回退到通用别名", () => {
    vi.stubEnv("GOOGLE_GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "  alias-from-env  ");
    expect(geminiApiKey()).toBe("alias-from-env");
    vi.unstubAllEnvs();
  });

  it("保留 fetch failed 的底层网络原因", () => {
    const error = classifyGeminiError(undefined, undefined, Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }));
    expect(error.code).toBe("upstream");
    expect(error.message).toContain("找不到 Gemini 服务地址");
    expect(error.message).toContain("ENOTFOUND");
  });

  it("地区不支持时提示配置 Gemini 代理，且不重试", () => {
    const error = classifyGeminiError(400, { error: { code: 400, message: "User location is not supported for the API use.", status: "FAILED_PRECONDITION" } });
    expect(error.message).toContain("GOOGLE_GEMINI_PROXY_URL");
    expect(error.retryable).toBe(false);
  });

  it("未配置代理时用内置 fetch；代理连不上时报代理地址", async () => {
    expect(geminiProxyUrl("  ")).toBeUndefined();
    expect(geminiFetch(undefined)).toBe(fetch);
    const proxied = geminiFetch("http://127.0.0.1:1");
    await expect(proxied("https://generativelanguage.googleapis.com/v1beta/models")).rejects.toThrow("无法连接 Gemini 代理 http://127.0.0.1:1");
  });
});
