import type { Aspect } from "./types";

/**
 * 字幕断行 —— 纯函数。
 * 规则：按画幅限制每行字数；优先在标点处断；去掉行尾标点；用 Intl.Segmenter 分词，不把一个词拆到两行；
 * 每条时间取自字级时间戳。
 */

export const maxCharsFor = (aspect: Aspect) => (aspect === "9:16" ? 12 : 16);

export type Cue = { startMs: number; endMs: number; text: string; lineId: string; highlights: [number, number][] };

type Tok = { text: string; from: number; to: number; punct: boolean; hardBreak: boolean };

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("zh", { granularity: "word" }) : null;
const isPunct = (s: string) => /^[\s\p{P}\p{S}]+$/u.test(s);
const width = (s: string) => {
  // 英文字母和数字按半个字宽计
  let w = 0;
  for (const ch of s) w += /[\x21-\x7e]/.test(ch) ? 0.55 : /\s/.test(ch) ? 0.3 : 1;
  return w;
};

function tokenize(text: string): Tok[] {
  const parts = segmenter ? [...segmenter.segment(text)].map((s) => ({ text: s.segment, index: s.index })) : [...text].map((ch, index) => ({ text: ch, index }));
  return parts.map((p) => ({ text: p.text, from: p.index, to: p.index + p.text.length, punct: isPunct(p.text), hardBreak: /[，,。！？!?；;：:、…—]/.test(p.text) }));
}

/** 把一句话切成若干行（返回原文区间） */
export function breakLine(text: string, max: number): [number, number][] {
  const toks = tokenize(text);
  const out: [number, number][] = [];
  let cur: Tok[] = [];
  const curWidth = () => width(cur.filter((t) => !t.punct).map((t) => t.text).join(""));
  const push = () => {
    // 去掉首尾标点
    while (cur.length && cur[cur.length - 1].punct) cur.pop();
    while (cur.length && cur[0].punct) cur.shift();
    if (cur.length) out.push([cur[0].from, cur[cur.length - 1].to]);
    cur = [];
  };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (!t.punct && cur.length && curWidth() + width(t.text) > max) {
      // 超长：回退到行内最后一个软标点处断开（如果那样不会让前半行太短）
      const lastBreak = cur.map((x) => x.hardBreak).lastIndexOf(true);
      if (lastBreak > 0 && width(cur.slice(0, lastBreak).filter((x) => !x.punct).map((x) => x.text).join("")) >= max * 0.4) {
        const rest = cur.slice(lastBreak + 1);
        cur = cur.slice(0, lastBreak + 1);
        push();
        cur = rest;
      } else push();
    }
    cur.push(t);
    // 句中标点处，如果已经够长就断行
    if (t.hardBreak && curWidth() >= max * 0.6) push();
  }
  push();
  return out;
}

/**
 * 生成一句话的字幕条。chars 是原文字符时间（相对全片），缺字时插值。
 * 同一句内的相邻字幕首尾相接，不留空隙；每条至少显示 minMs。
 */
export function cuesForLine(
  lineId: string,
  text: string,
  chars: { i: number; startMs: number; endMs: number }[],
  aspect: Aspect,
  keywords: string[] = [],
  minMs = 800,
): Cue[] {
  if (chars.length === 0) return [];
  const ranges = breakLine(text, maxCharsFor(aspect));
  const timeAt = (from: number, to: number) => {
    const inside = chars.filter((c) => c.i >= from && c.i < to);
    if (inside.length) return { s: inside[0].startMs, e: inside[inside.length - 1].endMs };
    const before = chars.filter((c) => c.i < from).pop();
    const t = before?.endMs ?? chars[0].startMs;
    return { s: t, e: t };
  };
  const cues: Cue[] = ranges.map(([from, to]) => {
    const { s, e } = timeAt(from, to);
    const t = text.slice(from, to);
    return { startMs: s, endMs: e, text: t, lineId, highlights: highlightsIn(t, keywords) };
  });
  for (let k = 0; k < cues.length; k++) {
    if (k + 1 < cues.length) cues[k].endMs = cues[k + 1].startMs;
    if (cues[k].endMs - cues[k].startMs < minMs) cues[k].endMs = cues[k].startMs + minMs;
    if (k + 1 < cues.length && cues[k].endMs > cues[k + 1].startMs) cues[k + 1].startMs = cues[k].endMs;
  }
  return cues;
}

function highlightsIn(t: string, keywords: string[]): [number, number][] {
  const out: [number, number][] = [];
  for (const k of keywords) {
    const i = t.indexOf(k);
    if (i >= 0) out.push([i, i + k.length]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export function srtTime(ms: number) {
  const t = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(t / 3600000))}:${pad(Math.floor(t / 60000) % 60)}:${pad(Math.floor(t / 1000) % 60)},${pad(t % 1000, 3)}`;
}

export function toSrt(cues: Cue[]) {
  return cues.map((c, k) => `${k + 1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${c.text}\n`).join("\n");
}
