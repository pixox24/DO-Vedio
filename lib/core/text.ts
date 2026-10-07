/** 卡片和字幕高亮使用的短文本上限，避免信息卡出现折行。 */
export const MAX_CARD_TEXT_LENGTH = 8;

/**
 * 清洗需要在画面上突出的短文本。
 * 模型负责语义压缩，代码负责去掉空白、收尾标点并兜底截断。
 */
export function compactText(value: string | undefined, max = MAX_CARD_TEXT_LENGTH): string | undefined {
  const text = value?.replace(/\s+/g, "").replace(/[。！？!?，,；;：:、]+$/u, "").trim();
  if (!text) return undefined;
  return Array.from(text).slice(0, Math.max(1, max)).join("");
}

export function compactKeywords(values: readonly string[], max = MAX_CARD_TEXT_LENGTH): string[] {
  return [...new Set(values.map((value) => compactText(value, max)).filter((value): value is string => !!value))].slice(0, 2);
}
