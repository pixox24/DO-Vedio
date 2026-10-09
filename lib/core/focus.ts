import { focusPresetIds, type FocusPresetId, type FocusText, type Shot } from "./types";

export const focusPresetLabels: Record<FocusPresetId, string> = {
  "embedded-type": "大小字嵌入", "number-space": "数字与留白", "masked-slice": "切片与蒙版", "vertical-arc": "竖排与圆弧",
  "offset-fade": "错位与渐隐", "time-scale": "时间与刻度", "tilt-vertical": "倾斜与竖排", "solid-outline": "虚实与对照",
  order: "十字与秩序", diamond: "菱形与错位", pill: "药丸与减法", "three-dots": "数字与三点",
  steps: "阶梯与节奏", "four-dots": "四点与视角", "cross-space": "交叉与留白", chapter: "编号与转折",
  "serif-contrast": "宋黑与穿插", focus: "圆点与聚焦",
};

/** Visual repetition is tracked independently of the wording. */
export const focusPresetGroups: Record<FocusPresetId, { position: string; symbol: string }> = {
  "embedded-type": { position: "left", symbol: "circle" }, "number-space": { position: "left", symbol: "circle" },
  "masked-slice": { position: "left", symbol: "square" }, "vertical-arc": { position: "center", symbol: "circle" },
  "offset-fade": { position: "offset", symbol: "plus" }, "time-scale": { position: "left", symbol: "dots" },
  "tilt-vertical": { position: "center", symbol: "plus" }, "solid-outline": { position: "left", symbol: "square" },
  order: { position: "left", symbol: "plus" }, diamond: { position: "offset", symbol: "diamond" },
  pill: { position: "left", symbol: "pill" }, "three-dots": { position: "left", symbol: "dots" },
  steps: { position: "offset", symbol: "square" }, "four-dots": { position: "right", symbol: "dots" },
  "cross-space": { position: "offset", symbol: "plus" }, chapter: { position: "right", symbol: "square" },
  "serif-contrast": { position: "left", symbol: "diamond" }, focus: { position: "center", symbol: "circle" },
};

/** Visual width used by the deterministic layout matcher, not a font measurement. */
export function focusVisualWidth(value: string): number {
  return Array.from(value).reduce((sum, char) => {
    if (/\p{Script=Han}/u.test(char)) return sum + 1;
    if (/\d/.test(char)) return sum + 0.72;
    if (/[%％+×xX]/.test(char)) return sum + 0.62;
    return sum + 0.55;
  }, 0);
}

const punctuation = /[。！？!?，,；;：:、]+$/u;

/** Cleans a complete phrase; an overlong phrase must be summarized, never sliced. */
export function normalizeFocusText(value: string | undefined, max = 8): string | undefined {
  const cleaned = value?.replace(/\s+/g, "").replace(punctuation, "").trim();
  return cleaned && focusVisualWidth(cleaned) <= max ? cleaned : undefined;
}

export function cleanFocusText(value: string | undefined): string | undefined {
  return value?.replace(/\s+/g, "").replace(punctuation, "").trim() || undefined;
}

/** Numbers are compared as source tokens: 85% cannot silently become 85 or 95%. */
export function focusNumbersMatchSource(value: string, caption: string): boolean {
  const tokens = value.replace(/[，,\s]/g, "").match(/\d+(?:\.\d+)?(?:[%％倍年月日]|万|亿)?/g) ?? [];
  const sourceTokens = new Set(caption.replace(/[，,\s]/g, "").match(/\d+(?:\.\d+)?(?:[%％倍年月日]|万|亿)?/g) ?? []);
  return tokens.every((token) => sourceTokens.has(token.replace("％", "%")) || sourceTokens.has(token.replace("%", "％")));
}

function firstMeaningful(...values: (string | undefined)[]): string | undefined {
  return values.map((value) => normalizeFocusText(value)).find((value): value is string => !!value);
}

/** Maps pre-focus projects into the single重点文字 contract. */
export function focusTextFromLegacy(shot: Pick<Shot, "focusText" | "onScreenText" | "card">, keywords: readonly string[] = [], caption = ""): FocusText | undefined {
  if (shot.focusText?.text) {
    const text = cleanFocusText(shot.focusText.text);
    return text ? { ...shot.focusText, text, support: cleanFocusText(shot.focusText.support), layoutMode: shot.focusText.layoutMode ?? "auto" } : undefined;
  }
  const card = shot.card;
  let text: string | undefined;
  let support: string | undefined;
  if (card?.variant === "stat") {
    text = firstMeaningful(card.stat && `${card.stat.value}${card.stat.unit ?? ""}`, card.stat?.value, card.headline, card.stat?.label);
    support = firstMeaningful(card.stat?.label, card.stat?.unit);
  } else if (card?.variant === "definition") {
    text = firstMeaningful(card.definition?.term, card.headline);
    support = firstMeaningful(card.definition?.meaning);
  } else if (card?.variant === "profile") {
    text = firstMeaningful(card.profile?.name, card.headline);
    support = firstMeaningful(card.profile?.role, card.profile?.bio);
  } else if (card?.variant === "timeline") {
    text = firstMeaningful(card.headline, card.timeline?.[0]?.event, card.timeline?.[0]?.time);
    support = firstMeaningful(card.timeline?.[0]?.time);
  } else if (card?.variant === "list") {
    text = firstMeaningful(card.headline, card.items?.[0]);
    support = firstMeaningful(card.items?.[1]);
  } else if (card?.variant === "split") {
    text = firstMeaningful(card.headline, card.sides?.[0], card.sides?.[1]);
    support = firstMeaningful(card.sides?.[1]);
  } else {
    text = firstMeaningful(card?.headline, card?.alert?.content, card?.qa?.answer, card?.cta?.action, shot.onScreenText);
  }
  text ??= firstMeaningful(...keywords, ...caption.split(/[，,。！？!?；;：:、]/));
  if (!text) return undefined;
  return { text, support, layoutMode: "auto" };
}

export type FocusMatchContext = {
  text: string;
  visualWidth?: number;
  hasNumber?: boolean;
  hasSupport?: boolean;
  recentPresetIds?: readonly FocusPresetId[];
  seed?: number;
  mode?: FocusText["layoutMode"];
};

export const presetWidths: Record<FocusPresetId, [number, number]> = {
  "embedded-type": [3, 8], "number-space": [1, 8], "masked-slice": [3, 8], "vertical-arc": [1, 4], "offset-fade": [3, 8], "time-scale": [1, 8], "tilt-vertical": [1, 4], "solid-outline": [3, 8],
  order: [2, 8], diamond: [2, 8], pill: [2, 8], "three-dots": [1, 8], steps: [3, 8], "four-dots": [2, 8], "cross-space": [2, 8], chapter: [2, 8], "serif-contrast": [2, 8], focus: [2, 8],
};

/** Stable layout choice shared by preview and render. */
export function selectFocusPreset(context: FocusMatchContext): FocusPresetId {
  const width = context.visualWidth ?? focusVisualWidth(context.text);
  const recent = new Set(context.recentPresetIds ?? []);
  const eligible = focusPresetIds.filter((id) => width >= presetWidths[id][0] && width <= presetWidths[id][1]);
  const pool = eligible.length ? eligible : ["focus" as const];
  const fresh = pool.filter((id) => !recent.has(id));
  const candidates = (fresh.length ? fresh : pool).map((id) => {
    const index = focusPresetIds.indexOf(id);
    const [min, max] = presetWidths[id];
    let score = width >= min && width <= max ? 4 : -Math.min(Math.abs(width - min), Math.abs(width - max));
    if (context.hasNumber && ["number-space", "time-scale", "three-dots"].includes(id)) score += 2;
    if (context.hasSupport && ["embedded-type", "order", "chapter", "serif-contrast"].includes(id)) score += 0.5;
    const group = focusPresetGroups[id];
    for (const used of recent) {
      if (focusPresetGroups[used].position === group.position) score -= .6;
      if (focusPresetGroups[used].symbol === group.symbol) score -= .5;
    }
    let hash = ((context.seed ?? 0) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
    const random = ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff;
    score += context.mode === "shuffle" ? random * 2.5 : random * 0.8;
    return { id, score };
  }).sort((a, b) => b.score - a.score);
  return candidates[0]?.id ?? "focus";
}

export function resolveFocusText(shot: Pick<Shot, "focusText" | "onScreenText" | "card">, keywords: readonly string[], caption: string, context: Omit<FocusMatchContext, "text"> & { recentPresetIds?: readonly FocusPresetId[] } = {}): FocusText | undefined {
  const focus = focusTextFromLegacy(shot, keywords, caption);
  if (!focus?.text) return undefined;
  const presetId = focus.layoutMode === "manual" && focus.presetId
    ? focus.presetId
    : selectFocusPreset({ ...context, text: focus.text, hasNumber: /\d/.test(focus.text), hasSupport: !!focus.support, mode: focus.layoutMode });
  const emphasis = focus.emphasis && focus.text.includes(focus.emphasis) ? focus.emphasis : undefined;
  return { ...focus, presetId, emphasis, support: cleanFocusText(focus.support) };
}
