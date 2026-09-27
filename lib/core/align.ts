/**
 * 把 TTS 的字级时间戳对齐到原文字符 —— 纯函数。
 *
 * 服务商返回的词表是「朗读后的文字」（数字可能被它自己读成汉字，标点会粘在相邻词上），
 * 所以不能按下标直接对应。做法：
 *   1. 顺序贪心匹配：词里的文字能在朗读文本当前位置附近找到，就对上
 *   2. 找不到的词（如服务商把 12.5 读成“十二点五”）先挂起，
 *      等下一个能对上的词出现，把中间那段朗读文字按挂起词的时间均分
 *   3. 朗读字符经 map 回到原文下标；标点不占时间
 */

export type TimedWord = { text: string; startMs: number; endMs: number };
export type CharTime = { i: number; startMs: number; endMs: number };

const isContent = (ch: string) => !/[\s\p{P}\p{S}]/u.test(ch);
const norm = (ch: string) => ch.toLowerCase();

export function alignWords(spoken: string, words: TimedWord[], lookahead = 8): (TimedWord | null)[] {
  const pos: number[] = [];
  for (let i = 0; i < spoken.length; i++) if (isContent(spoken[i])) pos.push(i);
  const times: ({ startMs: number; endMs: number } | null)[] = new Array(pos.length).fill(null);

  let ptr = 0;
  let pending: TimedWord[] = [];

  const flushPending = (until: number) => {
    if (pending.length === 0) return;
    const n = until - ptr;
    const start = pending[0].startMs;
    const end = pending[pending.length - 1].endMs;
    for (let k = 0; k < n; k++) times[ptr + k] = { startMs: start + ((end - start) * k) / n, endMs: start + ((end - start) * (k + 1)) / n };
    pending = [];
  };

  for (const w of words) {
    const chars = [...w.text].filter(isContent).map(norm);
    if (chars.length === 0) continue;
    let found = -1;
    for (let d = 0; d <= lookahead && ptr + d < pos.length; d++) {
      if (chars.every((c, k) => ptr + d + k < pos.length && norm(spoken[pos[ptr + d + k]]) === c)) {
        found = ptr + d;
        break;
      }
    }
    if (found < 0) {
      pending.push(w);
      continue;
    }
    // 跳过的朗读字：有挂起词就用挂起词的时间，否则用本词开始前的一小段
    if (found > ptr) {
      if (pending.length) flushPending(found);
      else {
        const prevEnd = ptr > 0 ? (times[ptr - 1]?.endMs ?? w.startMs) : w.startMs;
        for (let k = ptr; k < found; k++) {
          const f = (k - ptr) / (found - ptr);
          const f2 = (k - ptr + 1) / (found - ptr);
          times[k] = { startMs: prevEnd + (w.startMs - prevEnd) * f, endMs: prevEnd + (w.startMs - prevEnd) * f2 };
        }
      }
    } else pending = [];
    ptr = found;
    const per = (w.endMs - w.startMs) / chars.length;
    for (let k = 0; k < chars.length; k++) times[ptr + k] = { startMs: w.startMs + per * k, endMs: w.startMs + per * (k + 1) };
    ptr += chars.length;
  }
  if (ptr < pos.length) {
    if (pending.length) flushPending(pos.length);
    else {
      const last = ptr > 0 ? times[ptr - 1]!.endMs : 0;
      for (let k = ptr; k < pos.length; k++) times[k] = { startMs: last, endMs: last };
    }
  }

  const out: (TimedWord | null)[] = new Array(spoken.length).fill(null);
  pos.forEach((p, k) => {
    const t = times[k];
    if (t) out[p] = { text: spoken[p], startMs: Math.round(t.startMs), endMs: Math.round(t.endMs) };
  });
  return out;
}

/** 朗读字符时间 → 原文字符时间（多个朗读字对应一个原文字时取并集）；标点不输出 */
export function toOriginal(text: string, spokenTimes: (TimedWord | null)[], map: number[]): CharTime[] {
  const acc = new Map<number, CharTime>();
  spokenTimes.forEach((t, k) => {
    if (!t) return;
    const i = map[k];
    if (i === undefined || !isContent(text[i] ?? "")) return;
    const cur = acc.get(i);
    if (!cur) acc.set(i, { i, startMs: t.startMs, endMs: t.endMs });
    else acc.set(i, { i, startMs: Math.min(cur.startMs, t.startMs), endMs: Math.max(cur.endMs, t.endMs) });
  });
  // 原文里有、但没有时间的字（例如被替换读法覆盖的部分）：用左右邻居插值
  const idx: number[] = [];
  for (let i = 0; i < text.length; i++) if (isContent(text[i])) idx.push(i);
  const out: CharTime[] = [];
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    const t = acc.get(i);
    if (t) {
      out.push(t);
      continue;
    }
    const prev = out[out.length - 1];
    let next: CharTime | undefined;
    for (let j = k + 1; j < idx.length && !next; j++) next = acc.get(idx[j]);
    const s = prev?.endMs ?? next?.startMs ?? 0;
    const e = next?.startMs ?? s;
    out.push({ i, startMs: s, endMs: Math.max(s, e) });
  }
  // 保证单调
  for (let k = 1; k < out.length; k++) if (out[k].startMs < out[k - 1].startMs) out[k] = { ...out[k], startMs: out[k - 1].startMs, endMs: Math.max(out[k].endMs, out[k - 1].startMs) };
  return out;
}

/** 没有时间戳时按字数均分 */
export function evenChars(text: string, startMs: number, endMs: number): CharTime[] {
  const idx: number[] = [];
  for (let i = 0; i < text.length; i++) if (isContent(text[i])) idx.push(i);
  const per = idx.length ? (endMs - startMs) / idx.length : 0;
  return idx.map((i, k) => ({ i, startMs: Math.round(startMs + per * k), endMs: Math.round(startMs + per * (k + 1)) }));
}

export function contentCount(text: string) {
  let n = 0;
  for (const ch of text) if (isContent(ch)) n++;
  return n;
}
