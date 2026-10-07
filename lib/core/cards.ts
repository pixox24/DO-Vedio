import type { Card, ShotSize } from "./types";
import { compactText, MAX_CARD_TEXT_LENGTH } from "./text";

/**
 * 信息卡与景别规则 —— 纯函数。
 * 卡片数据由大模型从旁白中抽取；这里负责校验（数字不许编造、不许复述整句字幕），
 * 以及没有卡片数据时的保守兜底。
 */

const clip = (s: string | undefined, n = MAX_CARD_TEXT_LENGTH) => compactText(s, Math.min(n, MAX_CARD_TEXT_LENGTH));
const norm = (s: string) => s.replace(/[\s,，]/g, "");
/** 去掉标点后的纯文字，用于判断是否在复述字幕 */
const bare = (s: string) => s.replace(/[\s\p{P}]/gu, "");

/** 卡片文字不能是整句字幕（长句原样上屏等于把字幕再念一遍） */
function repeatsCaption(text: string, caption: string) {
  const t = bare(text);
  return t.length > 10 && t === bare(caption);
}

/** 旧版文字/问答/号召卡不再作为独立模板生成，读取时降级为提示卡，避免旧项目失效。 */
function legacyFallback(text: string | undefined): Card | undefined {
  const content = clip(text);
  return content ? { variant: "alert", alert: { type: "info", content } } : undefined;
}

/** 校验并清洗大模型给出的卡片；数据不成立时降级为短提示，仍不成立返回 undefined */
export function sanitizeCard(card: Card | undefined, caption: string): Card | undefined {
  if (!card) return undefined;
  const headline = clip(card.headline, 16);
  const asFallback = (h: string | undefined): Card | undefined => (h && !repeatsCaption(h, caption) ? legacyFallback(h) : undefined);
  switch (card.variant) {
    case "stat": {
      const value = clip(card.stat?.value, 12);
      // 数字必须出自旁白，防止编造
      if (!value || !norm(caption).includes(norm(value))) return asFallback(headline ?? clip(card.stat?.label));
      return { variant: "stat", headline, stat: { value, unit: clip(card.stat?.unit), label: clip(card.stat?.label) ?? "" } };
    }
    case "list": {
      const items = [...new Set((card.items ?? []).map((x) => clip(x)).filter((x): x is string => !!x))].slice(0, 4);
      return items.length >= 2 ? { variant: "list", headline, items } : asFallback(headline);
    }
    case "split": {
      const a = clip(card.sides?.[0]);
      const b = clip(card.sides?.[1]);
      return a && b && a !== b ? { variant: "split", headline, sides: [a, b] } : asFallback(headline);
    }
    case "quote": {
      const raw = card.headline?.trim();
      const q = clip(raw);
      return q && raw && !repeatsCaption(raw, caption) ? { variant: "quote", headline: q } : undefined;
    }
    case "qa": {
      return legacyFallback(headline ?? card.qa?.question ?? card.qa?.answer);
    }
    case "cta": {
      return legacyFallback(headline ?? card.cta?.action ?? card.cta?.subtitle);
    }
    case "alert": {
      const content = clip(card.alert?.content);
      if (content && !repeatsCaption(content, caption)) return { variant: "alert", headline, alert: { type: card.alert?.type ?? "info", content } };
      return asFallback(headline ?? content);
    }
    case "definition": {
      const term = clip(card.definition?.term);
      const meaning = clip(card.definition?.meaning);
      if (term && meaning && !repeatsCaption(meaning, caption)) return { variant: "definition", headline, definition: { term, meaning } };
      return asFallback(headline ?? term);
    }
    case "timeline": {
      const events = (card.timeline ?? []).flatMap((item) => {
        const time = clip(item.time);
        const event = clip(item.event);
        return time && event ? [{ time, event }] : [];
      }).slice(0, 4);
      return events.length >= 2 ? { variant: "timeline", headline, timeline: events } : asFallback(headline);
    }
    case "profile": {
      const name = clip(card.profile?.name);
      if (!name) return asFallback(headline);
      return { variant: "profile", headline, profile: { name, role: clip(card.profile?.role), bio: clip(card.profile?.bio) } };
    }
    case "headline":
      return legacyFallback(headline);
    default:
      return legacyFallback(headline);
  }
}

/**
 * 没有卡片数据时（旧分镜、拆出来的镜头）按旁白保守地推断。
 * 只认明确的信号：带单位的数字 → 数据卡；「相比 / 对比」+ 两个关键词 → 对比卡；两个关键词 → 列表。
 * 没有明确的卡片信号时返回无文字的信息层，避免重新生成已移除的文字卡。
 */
export function fallbackCard(caption: string, keywords: string[]): Card {
  const stat = caption.match(/\d+(?:\.\d+)?\s*(?:[%％]|[万亿]|倍)|\d{3,}(?:\.\d+)?/)?.[0];
  if (stat) {
    const m = stat.match(/^([\d.]+)\s*(.*)$/)!;
    return { variant: "stat", stat: { value: clip(m[1]) ?? m[1].slice(0, MAX_CARD_TEXT_LENGTH), unit: clip(m[2]), label: clip(keywords.find((k) => !k.includes(m[1]))) ?? "" } };
  }
  if (keywords.length >= 2 && /(相比|对比|比起|而不是|vs|VS)/.test(caption)) return { variant: "split", sides: [clip(keywords[0]) ?? keywords[0], clip(keywords[1]) ?? keywords[1]] };
  if (keywords.length >= 2) return { variant: "list", items: keywords.slice(0, 3).map((keyword) => clip(keyword) ?? keyword.slice(0, MAX_CARD_TEXT_LENGTH)) };
  return { variant: "list", items: [] };
}

/** 拆镜头时换景别：同一主体，远近交替，避免连续两张一样的画面 */
const nextSize: Record<ShotSize, ShotSize> = { "extreme-wide": "medium", wide: "close", medium: "close", close: "medium", "extreme-close": "medium" };

/** 第 k 个拆出来的镜头（k 从 1 开始）用什么景别：奇数换景别，偶数回到原景别 */
export function splitShotSize(base: ShotSize | undefined, k: number): ShotSize {
  const b = base ?? "medium";
  return k % 2 === 1 ? nextSize[b] : b;
}
