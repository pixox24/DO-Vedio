import type { Line, Span } from "./types";

/** 断句、句子 ID 继承、读音标注 —— 纯函数 */

const HARD = /[。！？!?；;…]+[”’」』）)]*/g;
const SOFT = /[，,、：:—]+/g;
export const MAX_LINE_CHARS = 40;

/** 一段文字拆成句子：先在句末标点断开，过长的句子再在逗号处拆；每句原文一字不改 */
export function splitSentences(text: string, max = MAX_LINE_CHARS): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    const p = para.trim();
    if (!p) continue;
    let last = 0;
    const parts: string[] = [];
    for (const m of p.matchAll(HARD)) {
      const end = m.index! + m[0].length;
      parts.push(p.slice(last, end));
      last = end;
    }
    if (last < p.length) parts.push(p.slice(last));
    for (const s of parts.map((x) => x.trim()).filter(Boolean)) out.push(...splitLong(s, max));
  }
  return mergeTiny(out);
}

function splitLong(s: string, max: number): string[] {
  if (visibleLength(s) <= max) return [s];
  // 在最接近中点的软标点处拆开，递归处理
  const cuts: number[] = [];
  for (const m of s.matchAll(SOFT)) cuts.push(m.index! + m[0].length);
  const inner = cuts.filter((c) => c > 4 && c < s.length - 4);
  if (inner.length === 0) return [s];
  const mid = s.length / 2;
  const cut = inner.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
  return [...splitLong(s.slice(0, cut).trim(), max), ...splitLong(s.slice(cut).trim(), max)];
}

/** 只有两三个字的碎句（如“对。”）并入上一句 */
function mergeTiny(list: string[]): string[] {
  const out: string[] = [];
  for (const s of list) {
    if (out.length && visibleLength(s) <= 2 && visibleLength(out[out.length - 1]) + visibleLength(s) <= MAX_LINE_CHARS) out[out.length - 1] += s;
    else out.push(s);
  }
  return out;
}

/** 不计标点和空白的字数 */
export function visibleLength(s: string) {
  return s.replace(/[\s\p{P}\p{S}]/gu, "").length;
}

/**
 * 新旧句子列表对齐：文本相同的句子继承旧 ID（配音缓存、镜头锚点都不动），
 * 其余分配新 ID。用最长公共子序列，保证顺序一致。
 */
export function alignLines<T extends { id: string; text: string }>(prev: T[], next: string[], newId: () => string): { id: string; text: string; prev?: T }[] {
  const n = prev.length;
  const m = next.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = prev[i].text === next[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { id: string; text: string; prev?: T }[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && prev[i].text === next[j]) {
      out.push({ id: prev[i].id, text: next[j], prev: prev[i] });
      i++;
      j++;
    } else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else {
      out.push({ id: newId(), text: next[j] });
      j++;
    }
  }
  return out;
}

/** 由文案段落重建句子列表：保留未改动句子的 ID 和标注 */
export function rebuildLines(prev: Line[], segments: { text: string }[], newId: () => string): Line[] {
  const flat: { segmentIndex: number; text: string }[] = [];
  segments.forEach((seg, segmentIndex) => splitSentences(seg.text).forEach((text) => flat.push({ segmentIndex, text })));
  const aligned = alignLines(prev, flat.map((f) => f.text), newId);
  return aligned.map((a, k) => {
    const base = a.prev;
    return {
      id: a.id,
      segmentIndex: flat[k].segmentIndex,
      text: a.text,
      spans: base?.spans ?? [],
      pauseAfterMs: base?.pauseAfterMs,
      keywords: base?.keywords ?? [],
      mood: base?.mood,
      voiceTag: base?.voiceTag,
      locked: base?.locked ?? false,
    };
  });
}

// ---------- 读音 ----------

export type LexEntry = { word: string; say: string };

/** 标注合法：各片段原文拼起来必须等于句子原文 */
export function spansValid(text: string, spans: Span[]) {
  return spans.length === 0 || spans.map((s) => s.text).join("") === text;
}

/** 按读音词典切分（最长匹配优先），生成片段 */
export function applyLexicon(text: string, lex: LexEntry[]): Span[] {
  const words = lex.filter((l) => l.word && l.say !== l.word).sort((a, b) => b.word.length - a.word.length);
  if (words.length === 0) return [];
  const out: Span[] = [];
  let buf = "";
  let i = 0;
  outer: while (i < text.length) {
    for (const w of words) {
      if (text.startsWith(w.word, i)) {
        if (buf) out.push({ text: buf });
        buf = "";
        out.push({ text: w.word, say: w.say });
        i += w.word.length;
        continue outer;
      }
    }
    buf += text[i++];
  }
  if (buf) out.push({ text: buf });
  return out.some((s) => s.say !== undefined) ? out : [];
}

/** 项目词典优先于旧标注，未命中的文字保留原有读法。 */
export function mergeSpans(text: string, spans: Span[], lex: LexEntry[]): Span[] {
  if (!spansValid(text, spans)) spans = [];
  const rules = applyLexicon(text, lex);
  if (spans.length === 0) return rules;
  if (rules.length === 0) return spans;
  const out: Span[] = [];
  let offset = 0;
  const previous = spans.map((s) => { const start = offset; offset += s.text.length; return { ...s, start, end: offset }; });
  offset = 0;
  for (const rule of rules) {
    const start = offset;
    offset += rule.text.length;
    if (rule.say !== undefined) { out.push(rule); continue; }
    let cursor = start;
    for (const old of previous.filter((s) => s.end > start && s.start < offset)) {
      const from = Math.max(cursor, old.start);
      const to = Math.min(offset, old.end);
      if (from > cursor) out.push({ text: text.slice(cursor, from) });
      if (to > from) out.push({ text: text.slice(from, to), say: old.start >= start && old.end <= offset ? old.say : undefined });
      cursor = to;
    }
    if (cursor < offset) out.push({ text: text.slice(cursor, offset) });
  }
  return compactSpans(out);
}

function compactSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && last.say === undefined && s.say === undefined) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

/**
 * 朗读文本和「朗读字符 → 原文字符」映射。
 * TTS 返回的字级时间戳是按朗读文本编号的，用 map 对回原文位置，字幕始终显示原文。
 */
export function spokenText(text: string, spans: Span[]): { spoken: string; map: number[] } {
  if (!spansValid(text, spans) || spans.length === 0) return { spoken: text, map: Array.from({ length: text.length }, (_, i) => i) };
  let spoken = "";
  const map: number[] = [];
  let pos = 0;
  for (const s of spans) {
    const say = s.say ?? s.text;
    for (let k = 0; k < say.length; k++) {
      // 替换读法的每个字都映射到原词内按比例对应的位置
      map.push(s.say === undefined ? pos + k : pos + Math.min(s.text.length - 1, Math.floor((k / say.length) * s.text.length)));
    }
    spoken += say;
    pos += s.text.length;
  }
  return { spoken, map };
}

// ---------- 数字读法（规则兜底） ----------

const DIGITS = "零一二三四五六七八九";

/** 年份、百分数等常见数字的规则读法；其余交给 TTS 自己的文本正则化 */
export function ruleSpans(text: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(/(\d{4})(?=年)|(\d+(?:\.\d+)?)%/g)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    if (m[1]) out.push({ text: m[1], say: [...m[1]].map((d) => DIGITS[+d]).join("") });
    else out.push({ text: m[0], say: `百分之${m[2]}` });
    last = m.index! + m[0].length;
  }
  if (out.length === 0) return [];
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
