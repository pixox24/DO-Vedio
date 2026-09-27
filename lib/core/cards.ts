import type { Card, ShotSize } from "./types";

/**
 * 信息卡与景别规则 —— 纯函数。
 * 卡片数据由大模型从旁白中抽取；这里负责校验（数字不许编造、不许复述整句字幕），
 * 以及没有卡片数据时的保守兜底。
 */

const clip = (s: string | undefined, n: number) => {
  const t = s?.trim().replace(/[。！？!?，,；;：:]+$/, "");
  return t ? t.slice(0, n) : undefined;
};
const norm = (s: string) => s.replace(/[\s,，]/g, "");
/** 去掉标点后的纯文字，用于判断是否在复述字幕 */
const bare = (s: string) => s.replace(/[\s\p{P}]/gu, "");

/** 卡片文字不能是整句字幕（长句原样上屏等于把字幕再念一遍） */
function repeatsCaption(text: string, caption: string) {
  const t = bare(text);
  return t.length > 10 && t === bare(caption);
}

/** 校验并清洗大模型给出的卡片；数据不成立时降级为标题卡，仍不成立返回 undefined */
export function sanitizeCard(card: Card | undefined, caption: string): Card | undefined {
  if (!card) return undefined;
  const headline = clip(card.headline, 16);
  const asHeadline = (h: string | undefined): Card | undefined => (h && !repeatsCaption(h, caption) ? { variant: "headline", headline: h } : undefined);
  switch (card.variant) {
    case "stat": {
      const value = clip(card.stat?.value, 12);
      // 数字必须出自旁白，防止编造
      if (!value || !norm(caption).includes(norm(value))) return asHeadline(headline ?? clip(card.stat?.label, 16));
      return { variant: "stat", headline, stat: { value, unit: clip(card.stat?.unit, 6), label: clip(card.stat?.label, 20) ?? "" } };
    }
    case "list": {
      const items = [...new Set((card.items ?? []).map((x) => clip(x, 14)).filter((x): x is string => !!x))].slice(0, 4);
      return items.length >= 2 ? { variant: "list", headline, items } : asHeadline(headline);
    }
    case "split": {
      const a = clip(card.sides?.[0], 12);
      const b = clip(card.sides?.[1], 12);
      return a && b && a !== b ? { variant: "split", headline, sides: [a, b] } : asHeadline(headline);
    }
    case "quote": {
      const q = clip(card.headline, 24);
      return q && !repeatsCaption(q, caption) ? { variant: "quote", headline: q } : undefined;
    }
    default:
      return asHeadline(headline);
  }
}

/**
 * 没有卡片数据时（旧分镜、拆出来的镜头）按旁白保守地推断。
 * 只认明确的信号：带单位的数字 → 数据卡；「相比 / 对比」+ 两个关键词 → 对比卡；两个关键词 → 列表；其余 → 标题卡。
 * 标题只用关键词或第一个短分句，不复述整句。
 */
export function fallbackCard(caption: string, keywords: string[]): Card {
  const stat = caption.match(/\d+(?:\.\d+)?\s*(?:[%％]|[万亿]|倍)|\d{3,}(?:\.\d+)?/)?.[0];
  if (stat) {
    const m = stat.match(/^([\d.]+)\s*(.*)$/)!;
    return { variant: "stat", stat: { value: m[1], unit: m[2] || undefined, label: keywords.find((k) => !k.includes(m[1])) ?? "" } };
  }
  if (keywords.length >= 2 && /(相比|对比|比起|而不是|vs|VS)/.test(caption)) return { variant: "split", sides: [keywords[0], keywords[1]] };
  if (keywords.length >= 2) return { variant: "list", items: keywords.slice(0, 3) };
  const first = caption.split(/[，,。！？!?；;：:、]/).find((x) => x.trim())?.trim() ?? "";
  return { variant: "headline", headline: keywords[0] || first.slice(0, 12) || undefined };
}

/** 拆镜头时换景别：同一主体，远近交替，避免连续两张一样的画面 */
const nextSize: Record<ShotSize, ShotSize> = { "extreme-wide": "medium", wide: "close", medium: "close", close: "medium", "extreme-close": "medium" };

/** 第 k 个拆出来的镜头（k 从 1 开始）用什么景别：奇数换景别，偶数回到原景别 */
export function splitShotSize(base: ShotSize | undefined, k: number): ShotSize {
  const b = base ?? "medium";
  return k % 2 === 1 ? nextSize[b] : b;
}
