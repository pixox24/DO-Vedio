/**
 * 字幕语言工具 —— 从 AI-Video 字幕模块移植。
 * 用于判断一句口播是什么语言、双语副行是否可信、以及翻译方向。
 */

export type ScriptLanguage = "zh" | "en";
export type SecondaryScript = "latin" | "cjk";

export function normalizeScriptLanguage(value: unknown): ScriptLanguage {
  return value === "en" ? "en" : "zh";
}

/** 双语字幕的目标语言：中文配英文，英文配中文 */
export function bilingualTarget(language?: ScriptLanguage | null): ScriptLanguage {
  return normalizeScriptLanguage(language) === "zh" ? "en" : "zh";
}

/** 某种口播语言对应的副行文字系统 */
export function secondaryScript(language?: ScriptLanguage | null): SecondaryScript {
  return normalizeScriptLanguage(language) === "zh" ? "latin" : "cjk";
}

export function countCjk(text: string | undefined): number {
  return ((text || "").match(/[\u4e00-\u9fff]/g) || []).length;
}

export function countLatin(text: string | undefined): number {
  return ((text || "").match(/[A-Za-z]/g) || []).length;
}

/** 文字看起来是不是目标副行语言（英文副行不允许夹中文，反之亦然） */
export function looksLikeSecondary(text: string | undefined, language?: ScriptLanguage | null): boolean {
  const value = (text || "").trim();
  if (!value) return false;
  const expected = language ? secondaryScript(language) : null;
  const latin = countLatin(value);
  const cjk = countCjk(value);
  if (expected === "latin") return latin >= 3 && cjk === 0;
  if (expected === "cjk") return cjk >= 2;
  return latin >= 3 || cjk >= 2;
}

/**
 * 按文本本身确定源语言：至少 2 个汉字或 3 个拉丁字母才算确定。
 * 只有数字、符号、空白等低置信度文本返回 null，调用方不得猜方向。
 */
export function detectSourceLanguage(text: string | undefined): ScriptLanguage | null {
  const value = (text || "").trim();
  if (!value) return null;
  if (countCjk(value) >= 2) return "zh";
  if (countLatin(value) >= 3) return "en";
  return null;
}

export function inferScriptLanguage(text: string | undefined): ScriptLanguage {
  const value = (text || "").trim();
  if (!value) return "zh";
  const cjk = countCjk(value);
  const latin = countLatin(value);
  if (cjk >= 2 && cjk >= Math.max(1, Math.floor(latin / 4))) return "zh";
  if (latin >= 3) return "en";
  return "zh";
}

export function countWords(text: string | undefined): number {
  return (text || "").trim().split(/\s+/).filter(Boolean).length;
}
