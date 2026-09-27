import { describe, expect, it } from "vitest";
import { buildDashscopeHttpRequest, createDashscopeTts, parseDashscopeHttpEvents, parseDashscopeHttpResponse } from "./dashscope";

describe("DashScope TTS HTTP 适配", () => {
  it("构造 Qwen-Audio 请求并保留控制参数", () => {
    const request = buildDashscopeHttpRequest(
      {
        model: "qwen-audio-3.0-tts-plus",
        voice: "longanhuan_v3.6",
        text: "<speak>你好<break time=\"300ms\"/></speak>",
        textType: "SSML",
        instruction: "请用沉稳的纪录片旁白表达。",
        rate: 0.9,
        pitch: 1.1,
        volume: 60,
        wordTimestampEnabled: true,
      },
      "https://workspace.example/tts",
    );
    expect(request.url).toBe("https://workspace.example/tts");
    expect(request.body).toEqual({
      model: "qwen-audio-3.0-tts-plus",
      input: {
        text: "<speak>你好<break time=\"300ms\"/></speak>",
        voice: "longanhuan_v3.6",
        format: "wav",
        sample_rate: 24000,
        word_timestamp_enabled: true,
        rate: 0.9,
        volume: 60,
        pitch: 1.1,
        text_type: "SSML",
      },
    });
  });

  it("SSML 模式不叠加自然语言 Instruct", () => {
    const request = buildDashscopeHttpRequest({
      model: "qwen-audio-3.0-tts-plus",
      voice: "longanhuan_v3.6",
      text: "<speak>你好。</speak>",
      textType: "SSML",
      instruction: "语速较快，带有明显的上扬语调。",
      rate: 1,
      pitch: 1,
      volume: 50,
    }, "https://workspace.example/tts");
    expect(request.body.input).not.toHaveProperty("instruction");
  });

  it("解析 SSE 音频、计费字符和重复字级时间戳", () => {
    const pcm = Buffer.alloc(480, 7).toString("base64");
    const event = {
      output: {
        audio: { data: pcm },
        sentence: {
          index: 0,
          words: [
            { text: "你", begin_time: 0, end_time: 100 },
            { text: "好", begin_time: 100, end_time: 200 },
          ],
        },
      },
      usage: { characters: 4 },
    };
    const repeatedTimestamp = { output: { sentence: event.output.sentence } };
    const raw = `data: ${JSON.stringify(event)}\n\ndata: ${JSON.stringify(repeatedTimestamp)}\n\ndata: [DONE]\n\n`;
    const parsed = parseDashscopeHttpResponse(parseDashscopeHttpEvents(raw));
    expect(parsed.audio).toEqual(Buffer.alloc(480, 7));
    expect(parsed.billedChars).toBe(4);
    expect(parsed.words).toEqual([
      { text: "你", startMs: 0, endMs: 100 },
      { text: "好", startMs: 100, endMs: 200 },
    ]);
  });

  it("选择 Qwen-Audio 时没有 HTTP 地址会给出永久配置错误", async () => {
    const provider = createDashscopeTts("test-key", "ws://unused", undefined);
    await expect(provider.synthesize({ model: "qwen-audio-3.0-tts-flash", voice: "longanhuan_v3.6", text: "测试", rate: 1, pitch: 1, volume: 50 })).rejects.toThrow("DASHSCOPE_TTS_HTTP_URL");
  });
});
