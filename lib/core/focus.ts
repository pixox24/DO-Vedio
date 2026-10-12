import { SHOT_RULES } from "./shots";
import { countCjk, countLatin } from "./subtitle/language";
import { isSecondaryUsable } from "./subtitle/secondary";
import { focusPresetIds, type FocusPresetId, type FocusText, type Line, type MotionPalette, type Shot } from "./types";

export const focusPresetLabels: Record<FocusPresetId, string> = {
  "embedded-type": "大小字嵌入", "number-space": "数字与留白", "masked-slice": "切片与蒙版", "vertical-arc": "竖排与圆弧",
  "offset-fade": "错位与渐隐", "time-scale": "时间与刻度", "tilt-vertical": "倾斜与竖排", "solid-outline": "虚实与对照",
  order: "十字与秩序", diamond: "菱形与错位", pill: "药丸与减法", "three-dots": "数字与三点",
  steps: "阶梯与节奏", "four-dots": "四点与视角", "cross-space": "交叉与留白", chapter: "编号与转折",
  "serif-contrast": "宋黑与穿插", focus: "圆点与聚焦",
  "blur-slide": "虚焦逐词", "ink-press": "墨线压印",
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
  "blur-slide": { position: "column", symbol: "circle" }, "ink-press": { position: "press", symbol: "cross" },
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
  /** 只在这些配方里挑。空数组与未传一样，表示不限制。 */
  allowedIds?: readonly FocusPresetId[];
};

export const recommendedMotionPalette: MotionPalette = {
  opening: ["ink-press"],
  statement: ["blur-slide"],
  number: ["number-space"],
};

function uniquePresets(ids: readonly FocusPresetId[]) {
  return focusPresetIds.filter((id) => ids.includes(id));
}

export function motionPaletteActive(palette: MotionPalette | null | undefined): palette is MotionPalette {
  return !!palette && (palette.opening.length > 0 || palette.statement.length > 0 || palette.number.length > 0);
}

/** 有数字用数字格。前 15 秒的其他文字用开场，其余用观点。某一格空着时，用这盘里其余的动画。 */
export function palettePresetIds(palette: MotionPalette | null | undefined, text: string, startMs = Number.POSITIVE_INFINITY) {
  if (!motionPaletteActive(palette)) return undefined;
  const active = palette;
  const role = /\d/.test(text) ? "number" : startMs < SHOT_RULES.openingMs ? "opening" : "statement";
  const own = uniquePresets(active[role]);
  return own.length ? own : uniquePresets([...active.opening, ...active.statement, ...active.number]);
}

export const presetWidths: Record<FocusPresetId, [number, number]> = {
  "embedded-type": [3, 8], "number-space": [1, 8], "masked-slice": [3, 8], "vertical-arc": [1, 4], "offset-fade": [3, 8], "time-scale": [1, 8], "tilt-vertical": [1, 4], "solid-outline": [3, 8],
  order: [2, 8], diamond: [2, 8], pill: [2, 8], "three-dots": [1, 8], steps: [3, 8], "four-dots": [2, 8], "cross-space": [2, 8], chapter: [2, 8], "serif-contrast": [2, 8], focus: [2, 8],
  "blur-slide": [4, 8], "ink-press": [2, 6],
};

/** Stable layout choice shared by preview and render. */
export function selectFocusPreset(context: FocusMatchContext): FocusPresetId {
  const width = context.visualWidth ?? focusVisualWidth(context.text);
  const recent = new Set(context.recentPresetIds ?? []);
  const universe = context.allowedIds?.length ? uniquePresets(context.allowedIds) : focusPresetIds;
  const eligible = universe.filter((id) => width >= presetWidths[id][0] && width <= presetWidths[id][1]);
  const pool = eligible.length ? eligible : universe.length ? universe : ["focus" as const];
  const fresh = pool.filter((id) => !recent.has(id));
  const candidates = (fresh.length ? fresh : pool).map((id) => {
    const index = focusPresetIds.indexOf(id);
    const [min, max] = presetWidths[id];
    let score = width >= min && width <= max ? 4 : -Math.min(Math.abs(width - min), Math.abs(width - max));
    if (context.hasNumber && ["number-space", "time-scale", "three-dots"].includes(id)) score += 2;
    if (context.hasSupport && ["embedded-type", "order", "chapter", "serif-contrast"].includes(id)) score += 0.5;
    if (id === "blur-slide" && context.hasSupport) score += 1.2;
    if ((id === "blur-slide" || id === "ink-press") && context.hasNumber) score -= 2;
    if (id === "blur-slide" && !context.hasNumber && width >= 4) score += 0.8;
    if (id === "ink-press" && !context.hasNumber && width <= 5) score += 0.8;
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

export function resolveFocusText(shot: Pick<Shot, "focusText" | "onScreenText" | "card">, keywords: readonly string[], caption: string, context: Omit<FocusMatchContext, "text" | "allowedIds"> & { palette?: MotionPalette | null; startMs?: number } = {}): FocusText | undefined {
  const focus = focusTextFromLegacy(shot, keywords, caption);
  if (!focus?.text) return undefined;
  const manual = focus.layoutMode === "manual" && focus.presetId;
  const presetId = manual
    ? focus.presetId
    : selectFocusPreset({
      ...context,
      text: focus.text,
      hasNumber: /\d/.test(focus.text),
      hasSupport: !!focus.support,
      mode: focus.layoutMode,
      allowedIds: palettePresetIds(context.palette, focus.text, context.startMs),
    });
  const emphasis = focus.emphasis && focus.text.includes(focus.emphasis) ? focus.emphasis : undefined;
  return { ...focus, presetId, emphasis, support: cleanFocusText(focus.support) };
}

type ColumnPreset = "blur-slide" | "ink-press";

function isColumnPreset(presetId: string | undefined): presetId is ColumnPreset {
  return presetId === "blur-slide" || presetId === "ink-press";
}

/** Chinese phrases split into a few beats. A short phrase or a pure number stays one beat. */
export function focusStaggerUnits(text: string, emphasis?: string): string[] {
  const chars = Array.from(text);
  if (chars.length <= 3 || !/\p{Script=Han}/u.test(text)) return [text];
  if (emphasis && emphasis !== text && text.includes(emphasis)) {
    const at = text.indexOf(emphasis);
    const parts = [text.slice(0, at), emphasis, text.slice(at + emphasis.length)].filter((part) => part.length > 0);
    if (parts.length >= 2) return parts.slice(0, 4);
  }
  const count = Math.min(4, Math.floor(chars.length / 2));
  const base = Math.floor(chars.length / count);
  let extra = chars.length % count;
  const units: string[] = [];
  let index = 0;
  for (let unit = 0; unit < count; unit++) {
    const size = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    units.push(chars.slice(index, index + size).join(""));
    index += size;
  }
  return units;
}

/** Latin small lines stagger by word. Chinese small lines use the same beats as the title. */
export function focusColumnUnits(text: string, emphasis?: string): string[] {
  if (countLatin(text) >= 3 && countCjk(text) === 0) {
    const words = text.split(/\s+/).filter(Boolean);
    return words.length ? words : [text];
  }
  return focusStaggerUnits(text, emphasis);
}

/** Target size of the small line. The renderer uses this same ratio. */
export function focusColumnFontSize(preset: ColumnPreset, frameWidth: number): number {
  return frameWidth * (preset === "ink-press" ? 0.016 : 0.02);
}

export const FOCUS_COLUMN_WIDTH = 0.76;

/** One line, no wrap and no ellipsis. Ink press also refuses a long tracked line. */
export function focusSmallLineFits(text: string, preset: ColumnPreset, frameWidth: number): boolean {
  if (!Number.isFinite(frameWidth) || frameWidth <= 0) return false;
  const chars = Array.from(text);
  if (preset === "ink-press" && chars.length > 32) return false;
  const fontSize = focusColumnFontSize(preset, frameWidth);
  const tracking = preset === "ink-press" ? 0.14 : 0;
  const body = chars.reduce((sum, char) => {
    const em = /\p{Script=Han}/u.test(char) ? 1 : /\d/.test(char) ? 0.62 : 0.56;
    return sum + fontSize * (em + tracking);
  }, 0);
  const gaps = preset === "blur-slide" ? Math.max(0, text.split(/\s+/).filter(Boolean).length - 1) * fontSize * 0.32 : 0;
  return body + gaps <= frameWidth * FOCUS_COLUMN_WIDTH;
}

/**
 * English small line for the two column presets.
 * It is the anchored sentence's subtitle translation, not a separate phrase translation.
 * Returns nothing when bilingual is off, the translation is unusable, not Latin, or too long.
 */
export function resolveFocusCaption(input: {
  presetId?: string;
  bilingual: boolean;
  line?: Pick<Line, "text" | "secondaryText" | "secondaryHash"> | null;
  frameWidth: number;
}): string | undefined {
  if (!isColumnPreset(input.presetId) || !input.bilingual || !input.line || !isSecondaryUsable(input.line)) return undefined;
  const text = input.line.secondaryText?.trim() ?? "";
  if (countCjk(text) > 0 || countLatin(text) < 3) return undefined;
  if (!focusSmallLineFits(text, input.presetId, input.frameWidth)) return undefined;
  return text;
}

/** The one small-line slot: English when present, otherwise the Chinese support line. */
export function focusSmallCopy(caption: string | undefined, support: string | undefined): string | undefined {
  return caption || support || undefined;
}
