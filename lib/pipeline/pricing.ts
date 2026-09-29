import pricing from "../../config/pricing.json";

/** 费用估算。单价写在 config/pricing.json，需要人工核实 */

import type { TtsUsage } from "../providers/tts/types";

export type TtsPrice = {
  perTenThousandChars?: number;
  unit?: "characters" | "input-tokens" | "output-tokens" | "seconds" | "unknown";
  verified?: boolean;
};
type LlmPrice = { perMillionInputChars: number; perMillionOutputChars: number };

export function ttsPrice(provider: string, model: string): TtsPrice {
  return (pricing.tts as Record<string, TtsPrice>)[`${provider}/${model}`] ?? { perTenThousandChars: 2, unit: "characters", verified: false };
}

/** CosyVoice 按字符计费（一个汉字按 2 个字符计，以服务商返回的 usage 为准） */
export function estimateTtsCost(provider: string, model: string, billedChars: number) {
  const price = ttsPrice(provider, model);
  return price.unit && price.unit !== "characters" ? 0 : (billedChars / 10000) * (price.perTenThousandChars ?? 0);
}

/** 账本单位跟随服务商 usage；未知单位保留为 unknown，不把 0 当成免费。 */
export function ttsBilling(provider: string, model: string, usage: TtsUsage | undefined, fallbackChars: number) {
  if (usage) {
    const unit = usage.unit === "characters" ? "char" : usage.unit === "input-tokens" ? "input-token" : usage.unit === "output-tokens" ? "output-token" : usage.unit === "seconds" ? "second" : "unknown";
    return { unit, quantity: usage.quantity, costYuan: usage.unit === "characters" ? estimateTtsCost(provider, model, usage.quantity) : 0, costSource: usage.costSource };
  }
  return { unit: "char", quantity: fallbackChars, costYuan: estimateTtsCost(provider, model, fallbackChars), costSource: "pricing-table" as const };
}

/** 字符数估算的 TTS 计费字符：汉字 2，其余 1 */
export function billedCharsOf(text: string) {
  let n = 0;
  for (const ch of text) n += /[㐀-鿿豈-﫿]/.test(ch) ? 2 : 1;
  return n;
}

export function llmPrice(modelId: string): LlmPrice {
  const table = pricing.llm as Record<string, LlmPrice>;
  return table[modelId] ?? table._default;
}

export function estimateLlmCost(modelId: string, inputChars: number, outputChars: number) {
  const p = llmPrice(modelId);
  return (inputChars / 1e6) * p.perMillionInputChars + (outputChars / 1e6) * p.perMillionOutputChars;
}
