import pricing from "../../config/pricing.json";

/** 费用估算。单价写在 config/pricing.json，需要人工核实 */

type TtsPrice = { perTenThousandChars: number };
type LlmPrice = { perMillionInputChars: number; perMillionOutputChars: number };

export function ttsPrice(provider: string, model: string): TtsPrice {
  return (pricing.tts as Record<string, TtsPrice>)[`${provider}/${model}`] ?? { perTenThousandChars: 2 };
}

/** CosyVoice 按字符计费（一个汉字按 2 个字符计，以服务商返回的 usage 为准） */
export function estimateTtsCost(provider: string, model: string, billedChars: number) {
  return (billedChars / 10000) * ttsPrice(provider, model).perTenThousandChars;
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
