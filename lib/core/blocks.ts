import { visibleLength } from "./lines";
import type { Line, VoiceSettings } from "./types";

/**
 * 段落级配音的分块 —— 纯函数。
 * 块不跨章节，优先在文案换行（自然段）处断开；超长自然段按上限拆成字数相近的几块，
 * 拆分点优先选句末强停顿。单独录制的句子自成一块，朗读类型（纯文本 / SSML）不同也要断开。
 */

export type BlockLimits = { maxLines: number; maxChars: number };

/** 默认上限约 70 秒；Gemini 长文本更容易漏读、漂移，先保守。P0 探针后再调 */
export const BLOCK_LIMITS: Record<string, BlockLimits> = {
  default: { maxLines: 8, maxChars: 300 },
  "google-gemini": { maxLines: 5, maxChars: 200 },
};

export const blockLimitsFor = (provider: string) => BLOCK_LIMITS[provider] ?? BLOCK_LIMITS.default;

/**
 * 段落模式已开放的服务商 → 句子之间的连接方式。
 * CosyVoice / Qwen 有字级时间戳，句末标点本身就会停顿；Gemini 没有时间戳，按停顿切分。
 * 探针结论：Gemini 用换行连接会把句间停顿拉长到约 1 秒、切分置信度更低，所以也直接拼接。
 */
export const PARAGRAPH_JOINERS: Partial<Record<VoiceSettings["provider"], string>> = { dashscope: "", "google-gemini": "" };

export const paragraphSupported = (voice: Pick<VoiceSettings, "provider">) => PARAGRAPH_JOINERS[voice.provider] !== undefined;

type BlockLine = Pick<Line, "id" | "segmentIndex" | "text">;

export type BlockOptions<L extends BlockLine> = BlockLimits & {
  /** 这句单独成块 */
  alone?: (line: L) => boolean;
  /** 相邻两句的 kind 不同就断开（例如 SSML 与纯文本不能放进同一个请求） */
  kind?: (line: L) => string;
};

const STRONG_END = /[。！？!?；;…]+["”’」』）)]*\s*$/;

/** 句末强停顿（句号、问号、感叹号、分号、省略号）；否则是长句在逗号处拆开的弱停顿 */
export const strongEnd = (text: string) => STRONG_END.test(text);

/** 每句所在的自然段序号（章节内按换行计）；原文找不到时返回 -1，调用方把它当作断点 */
export function paragraphIndexes(lines: BlockLine[], segments: { text: string }[]): number[] {
  const out: number[] = [];
  const state = new Map<number, { flat: string; map: number[]; cursor: number; text: string }>();
  for (const line of lines) {
    let s = state.get(line.segmentIndex);
    if (!s) {
      const text = segments[line.segmentIndex]?.text ?? "";
      let flat = "";
      const map: number[] = [];
      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i])) continue;
        flat += text[i];
        map.push(i);
      }
      s = { flat, map, cursor: 0, text };
      state.set(line.segmentIndex, s);
    }
    // 断句会去掉空白、把碎句并进上一句（可能跨换行），所以在去掉空白的文本里找
    const needle = line.text.replace(/\s/g, "");
    const at = needle ? s.flat.indexOf(needle, s.cursor) : -1;
    if (at < 0) {
      out.push(-1);
      continue;
    }
    s.cursor = at + needle.length;
    const before = s.text.slice(0, s.map[at]);
    out.push((before.match(/\n+/g) ?? []).length);
  }
  return out;
}

/** 句子分块，返回每块的句子（保持原顺序） */
export function planBlocks<L extends BlockLine>(lines: L[], segments: { text: string }[], opts: BlockOptions<L>): L[][] {
  const paragraphs = paragraphIndexes(lines, segments);
  // 先切成「不可合并的组」：章节、自然段、kind 变化、单独成块
  const groups: L[][] = [];
  lines.forEach((line, k) => {
    const prev = lines[k - 1];
    const cut =
      !prev ||
      prev.segmentIndex !== line.segmentIndex ||
      paragraphs[k] < 0 ||
      paragraphs[k] !== paragraphs[k - 1] ||
      opts.alone?.(line) ||
      opts.alone?.(prev) ||
      (opts.kind && opts.kind(prev) !== opts.kind(line));
    if (cut) groups.push([line]);
    else groups[groups.length - 1].push(line);
  });
  return groups.flatMap((g) => chunk(g, opts));
}

/**
 * 超过上限的组拆成尽量少的几块：先定块数（满足上限的最少块数），
 * 再用动态规划选拆分点——各块字数接近，拆分点优先落在句末强停顿，不留孤零零的一句。
 */
function chunk<L extends BlockLine>(group: L[], limits: BlockLimits): L[][] {
  const size = group.map((l) => Math.max(1, visibleLength(l.text)));
  const total = size.reduce((s, x) => s + x, 0);
  const L = group.length;
  const prefix = [0];
  for (const x of size) prefix.push(prefix[prefix.length - 1] + x);
  const fits = (a: number, b: number) => b - a <= limits.maxLines && (prefix[b] - prefix[a] <= limits.maxChars || b - a === 1);
  for (let n = Math.max(1, Math.ceil(total / limits.maxChars), Math.ceil(L / limits.maxLines)); n <= L; n++) {
    if (n === 1 && fits(0, L)) return [group];
    const target = total / n;
    // cost[k][b]：前 b 句分成 k 块的最小代价
    const cost = Array.from({ length: n + 1 }, () => new Array<number>(L + 1).fill(Infinity));
    const from = Array.from({ length: n + 1 }, () => new Array<number>(L + 1).fill(-1));
    cost[0][0] = 0;
    for (let k = 1; k <= n; k++)
      for (let b = k; b <= L; b++)
        for (let a = k - 1; a < b; a++) {
          if (cost[k - 1][a] === Infinity || !fits(a, b)) continue;
          const dev = (prefix[b] - prefix[a] - target) / target;
          const c = cost[k - 1][a] + dev * dev + (b < L && !strongEnd(group[b - 1].text) ? 0.5 : 0);
          if (c < cost[k][b]) {
            cost[k][b] = c;
            from[k][b] = a;
          }
        }
    if (cost[n][L] === Infinity) continue;
    const out: L[][] = [];
    for (let k = n, b = L; k > 0; k--) {
      const a = from[k][b];
      out.unshift(group.slice(a, b));
      b = a;
    }
    return out;
  }
  return group.map((l) => [l]);
}
