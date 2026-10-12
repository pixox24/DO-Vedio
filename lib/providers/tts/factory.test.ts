import { describe, expect, it } from "vitest";
import { emptyDoc } from "@/lib/core/types";
import { ttsRequestOf } from "./factory";

describe("配音请求的全片说明", () => {
  it("只发给 Qwen-Audio，SSML 句不带说明", () => {
    const voice = { ...emptyDoc().settings.voice, instruction: "沉稳、老练，语重心长。" };
    expect(ttsRequestOf({ ...voice, model: "cosyvoice-v3-flash" }, "正文").instruction).toBeUndefined();
    expect(ttsRequestOf({ ...voice, provider: "google-gemini", model: "gemini-3.8-flash-tts" }, "正文").instruction).toBeUndefined();
    expect(ttsRequestOf({ ...voice, model: "qwen-audio-3.0-tts-flash" }, "正文").instruction).toBe("沉稳、老练，语重心长。");
    expect(ttsRequestOf({ ...voice, model: "qwen-audio-3.1-tts-flash" }, "正文", "SSML").instruction).toBeUndefined();
  });
});
