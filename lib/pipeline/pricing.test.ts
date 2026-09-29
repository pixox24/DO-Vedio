import { describe, expect, it } from "vitest";
import { ttsBilling } from "./pricing";

describe("TTS usage ledger units", () => {
  it("keeps token units instead of treating an unknown price as free characters", () => {
    expect(ttsBilling("google-gemini", "gemini-3.8-flash-tts", { unit: "output-tokens", quantity: 42, outputTokens: 42, costSource: "provider" }, 100)).toEqual({ unit: "output-token", quantity: 42, costYuan: 0, costSource: "provider" });
    expect(ttsBilling("google-gemini", "gemini-3.8-flash-tts", { unit: "unknown", quantity: 100, costSource: "unknown" }, 100)).toEqual({ unit: "unknown", quantity: 100, costYuan: 0, costSource: "unknown" });
  });
});
