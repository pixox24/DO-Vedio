/**
 * 字幕排版与防溢出引擎 —— 从 AI-Video 字幕模块移植。
 * 负责智能折行、标点平衡和字号自适应，Canvas 测量一次、多端复用。
 *
 * 完整性不变量：
 * - `maxLines` 只是排版偏好，永远不会裁掉文本；超出偏好时通过
 *   `FormattedSubtitleBlock.exceededMaxLines` 显式上报。
 * - 每一行都按 Unicode grapheme 边界切开，emoji / 旗帜 / 组合音标不会被拆散。
 * - 折行后逐行测量，超过安全宽度的行通过 `overflow` 显式上报，不做静默裁切。
 */

import { SYSTEM_FONT_STACK, subtitleCanvasFont, type SubtitleTypeface } from "./fonts";

const DEFAULT_TYPEFACE: SubtitleTypeface = {
  primaryFamily: SYSTEM_FONT_STACK,
  primaryWeight: "bold",
  secondaryFamily: SYSTEM_FONT_STACK,
  secondaryWeight: "500",
};

export interface FormattedSubtitleBlock {
  lines: string[];
  secondaryLines: string[];
  fontSize: number;
  secondaryFontSize: number;
  lineHeight: number;
  secondaryLineHeight: number;
  totalHeight: number;
  maxLineWidth: number;
  boxWidth: number;
  boxHeight: number;
  /** 完整主行/副行数超过用户偏好 maxLines；文本仍完整保留 */
  exceededMaxLines: boolean;
  /** 存在测量宽度超过安全宽度的行（正常流程应为 false，仅单个 grapheme 超宽时可能为 true） */
  overflow: boolean;
}

const MIN_PRIMARY_FONT_SIZE = 14;
const MIN_SECONDARY_FONT_SIZE = 10;
const PRIMARY_SHRINK_STEPS = 4;
const SECONDARY_SHRINK_STEPS = 4;
const PRIMARY_SIZE_RATIO = 0.88;
const SECONDARY_SIZE_RATIO = 0.62;
const SECONDARY_SHRINK_RATIO = 0.85;
const SECONDARY_MIN_FLOOR_RATIO = 0.45;
const OVERFLOW_EPSILON = 0.01;

/** 适合结束一行的标点（断行发生在标点之后，更符合朗读节奏） */
const BREAK_AFTER = new Set([
  " ",
  "\t",
  "，",
  "。",
  "！",
  "？",
  "；",
  "：",
  "、",
  "…",
  "—",
  "”",
  "’",
  "）",
  "】",
  "》",
  "」",
  ",",
  ".",
  "!",
  "?",
  ";",
  ":",
]);

/** 超宽西文 token（URL / 邮箱 / 数字串）内部优先断开的标点 */
const WORD_BREAKS = new Set(["-", ".", "_", "/", ":", "?", "&", "=", "#", "@", ",", ";", "!", "%"]);

const ASCII_PRINTABLE_RE = /^[\x21-\x7E]$/;
const WHITESPACE_RE = /^\s+$/u;
const TRAILING_WHITESPACE_RE = /\s+$/u;
const ASCII_ALNUM_RE = /[A-Za-z0-9]/;
const REGIONAL_INDICATOR_RE = /^[\u{1F1E6}-\u{1F1FF}]$/u;
/** 中文/全角标点：附着在前一个汉字上，避免标点落在行首或单独成行（避头尾）；emoji 属于符号类，不在此列 */
const CJK_PUNCT_RE = /^\p{P}$/u;

let graphemeSegmenter: Intl.Segmenter | null | undefined;

/** 无 Intl.Segmenter 时的降级分段：至少把组合音标、ZWJ、肤色和成对区域指示符粘住 */
function fallbackGraphemes(text: string): string[] {
  const units: string[] = [];
  for (const point of Array.from(text)) {
    const last = units[units.length - 1];
    const isMark = /^\p{M}$/u.test(point);
    const isJoiner = point === "\u200D" || point === "\uFE0F" || point === "\u200B";
    const isSkinTone = /^[\u{1F3FB}-\u{1F3FF}]$/u.test(point);
    const lastIsRegional = last ? REGIONAL_INDICATOR_RE.test(last.slice(-2)) : false;
    const isRegional = REGIONAL_INDICATOR_RE.test(point);
    const pairsWithRegional = isRegional && lastIsRegional && Array.from(last).filter((unit) => REGIONAL_INDICATOR_RE.test(unit)).length % 2 === 1;
    if (last && (isMark || isJoiner || isSkinTone || pairsWithRegional)) {
      units[units.length - 1] = last + point;
    } else {
      units.push(point);
    }
  }
  return units;
}

/** 按 Unicode grapheme 边界分段；优先 Intl.Segmenter，退化到 Array.from + 组合规则 */
function segmentGraphemes(text: string): string[] {
  if (graphemeSegmenter === undefined) {
    try {
      graphemeSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
    } catch {
      graphemeSegmenter = null;
    }
  }
  if (!graphemeSegmenter) return fallbackGraphemes(text);
  const units: string[] = [];
  for (const part of graphemeSegmenter.segment(text)) units.push(part.segment);
  return units;
}

/**
 * Splits Chinese & English text into lines based on canvas width constraints.
 * Prefers breaking at punctuation marks or spaces for natural speech cadence.
 *
 * `maxLines` is only an aesthetic preference: when the text cannot fit it, every
 * line is still returned (never sliced). Callers read `exceededMaxLines` from
 * `calculateSubtitleLayout` to surface the state.
 */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 3): string[] {
  return wrapTextInternal(ctx, text, maxWidth, normalizeMaxLines(maxLines)).lines;
}

interface WrapResult {
  lines: string[];
  /** 某个不可自然断开的 token 被按 grapheme 硬拆，字号阶梯可据此再尝试缩小 */
  hardSplit: boolean;
}

interface ParagraphWrap {
  lines: string[];
  hardSplit: boolean;
}

function normalizeMaxLines(maxLines: number): number {
  return Number.isFinite(maxLines) && maxLines >= 1 ? Math.floor(maxLines) : 1;
}

/**
 * 多段完整折行：先计算最小行数的基础折行，仅在基础折行仍满足偏好行数时
 * 才启用标点偏好折行，保证 maxLines 作为偏好生效而不会被当作截断指令。
 */
function wrapTextInternal(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): WrapResult {
  if (!text) return { lines: [], hardSplit: false };

  const paragraphs = text.split(/\r?\n/).filter((paragraph) => paragraph.trim() !== "");
  if (paragraphs.length === 0) return { lines: [], hardSplit: false };

  const basic = paragraphs.map((paragraph) => wrapParagraph(ctx, paragraph, maxWidth, false));
  const basicCount = basic.reduce((sum, item) => sum + item.lines.length, 0);

  if (basicCount <= maxLines) {
    const styled = paragraphs.map((paragraph) => wrapParagraph(ctx, paragraph, maxWidth, true));
    const styledCount = styled.reduce((sum, item) => sum + item.lines.length, 0);
    if (styledCount <= maxLines) {
      return {
        lines: styled.flatMap((item) => item.lines),
        hardSplit: styled.some((item) => item.hardSplit),
      };
    }
  }

  return {
    lines: basic.flatMap((item) => item.lines),
    hardSplit: basic.some((item) => item.hardSplit),
  };
}

/** 段落拆成 word / grapheme / space 原子：西文单词优先整体保留，CJK 与 emoji 逐 grapheme 可断 */
type WrapAtom = { text: string; kind: "word" | "grapheme" | "space" };

function atomize(text: string): WrapAtom[] {
  const atoms: WrapAtom[] = [];
  let word = "";

  const flushWord = () => {
    if (word) {
      atoms.push({ text: word, kind: "word" });
      word = "";
    }
  };

  for (const unit of segmentGraphemes(text)) {
    if (WHITESPACE_RE.test(unit)) {
      flushWord();
      const last = atoms[atoms.length - 1];
      if (last && last.kind === "space") last.text += unit;
      else atoms.push({ text: unit, kind: "space" });
    } else if (ASCII_PRINTABLE_RE.test(unit)) {
      word += unit;
    } else {
      flushWord();
      const last = atoms[atoms.length - 1];
      // 中文标点绑定前一个汉字：折行时标点跟着字走，不会出现在行首或单独成行
      if (last && last.kind === "grapheme" && CJK_PUNCT_RE.test(unit)) last.text += unit;
      else atoms.push({ text: unit, kind: "grapheme" });
    }
  }

  flushWord();
  return atoms;
}

/** 最近一个“可以在其后断行”的标点位置（UTF-16 索引）；不构成前进时返回 0 */
function lastPreferredBreakIndex(text: string): number {
  let index = 0;
  let breakIndex = 0;
  for (const unit of segmentGraphemes(text)) {
    index += unit.length;
    if (BREAK_AFTER.has(unit)) breakIndex = index;
  }
  return breakIndex < text.length ? breakIndex : 0;
}

/** 把超宽西文 token 按 URL/邮箱/数字串标点切成可断开的片段（标点保留在前段末尾） */
function splitAtWordBreaks(word: string): string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const unit of segmentGraphemes(word)) {
    piece += unit;
    if (WORD_BREAKS.has(unit)) {
      pieces.push(piece);
      piece = "";
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** 两行且末行过短时做 grapheme 安全的重心平衡；含字母数字时不动，避免拆开单词 */
function balanceTwoLines(ctx: CanvasRenderingContext2D, lines: string[], maxWidth: number): string[] {
  if (lines.length !== 2) return lines;
  const [first, second] = lines;
  if (!first || !second) return lines;
  const firstUnits = segmentGraphemes(first);
  const secondUnits = segmentGraphemes(second);
  if (secondUnits.length > 3 || firstUnits.length < 8) return lines;
  if (ASCII_ALNUM_RE.test(first + second)) return lines;

  const combined = firstUnits.concat(secondUnits);
  const mid = Math.floor(combined.length / 2);
  const balanced = [combined.slice(0, mid).join(""), combined.slice(mid).join("")];
  if (!balanced[0] || !balanced[1]) return lines;
  if (ctx.measureText(balanced[0]).width > maxWidth || ctx.measureText(balanced[1]).width > maxWidth) return lines;
  return balanced;
}

/** 单段完整折行：要么按宽度返回全部行，要么在偏好行数内优先标点断行 */
function wrapParagraph(ctx: CanvasRenderingContext2D, paragraph: string, maxWidth: number, preferPunctuationBreaks: boolean): ParagraphWrap {
  const lines: string[] = [];
  let current = "";
  let hardSplit = false;

  const fits = (value: string) => ctx.measureText(value).width <= maxWidth;

  const flush = () => {
    const trimmed = current.replace(TRAILING_WHITESPACE_RE, "");
    if (trimmed) lines.push(trimmed);
    current = "";
  };

  const placeGrapheme = (unit: string) => {
    for (;;) {
      if (!current) {
        if (!fits(unit)) hardSplit = true;
        current = unit;
        return;
      }
      if (fits(current + unit)) {
        current += unit;
        return;
      }
      const breakIndex = preferPunctuationBreaks ? lastPreferredBreakIndex(current) : 0;
      if (breakIndex > 0) {
        const head = current.slice(0, breakIndex).replace(TRAILING_WHITESPACE_RE, "");
        if (head) lines.push(head);
        current = current.slice(breakIndex);
        continue;
      }
      flush();
    }
  };

  const hardSplitText = (value: string) => {
    hardSplit = true;
    for (const unit of segmentGraphemes(value)) placeGrapheme(unit);
  };

  const placeWord = (word: string) => {
    for (;;) {
      if (current && !fits(current + word)) {
        flush();
        continue;
      }
      if (fits(current + word)) {
        current += word;
        return;
      }
      // 当前行为空且单词本身放不下：优先在标点处二次断词，其次 grapheme 硬拆
      const pieces = splitAtWordBreaks(word);
      if (pieces.length > 1) {
        for (const piece of pieces) {
          if (fits(current + piece)) {
            current += piece;
          } else if (current) {
            flush();
            if (fits(piece)) current = piece;
            else hardSplitText(piece);
          } else {
            hardSplitText(piece);
          }
        }
        return;
      }
      hardSplitText(word);
      return;
    }
  };

  for (const atom of atomize(paragraph)) {
    if (atom.kind === "space") {
      if (!current) continue;
      if (fits(current + atom.text)) current += atom.text;
      else flush();
      continue;
    }
    if (atom.kind === "word") {
      placeWord(atom.text);
      continue;
    }
    placeGrapheme(atom.text);
  }
  flush();

  return { lines: balanceTwoLines(ctx, lines, maxWidth), hardSplit };
}

/** Calculates complete multi-line layout with auto-scaling font size to ensure 100% zero overflow */
export function calculateSubtitleLayout(
  ctx: CanvasRenderingContext2D,
  text: string,
  secondaryText: string | undefined,
  canvasWidth: number,
  baseFontSize: number,
  isBilingual: boolean,
  maxWidthRatio = 0.84,
  maxLines = 3,
  typeface: SubtitleTypeface = DEFAULT_TYPEFACE,
): FormattedSubtitleBlock {
  const maxWidth = canvasWidth * maxWidthRatio;
  const preferredMaxLines = normalizeMaxLines(maxLines);

  let currentFontSize = baseFontSize;
  let lines: string[] = [];

  // 字号阶梯：仅当某段 token 无法在安全宽度内断开时才缩小，缩到最小字号后
  // 转为增加行数保全文本（wrapTextInternal 永不返回丢失文字的短行）。
  for (let attempt = 0; attempt < PRIMARY_SHRINK_STEPS; attempt++) {
    ctx.font = subtitleCanvasFont(typeface.primaryFamily, currentFontSize, typeface.primaryWeight);
    const wrapped = wrapTextInternal(ctx, text, maxWidth, preferredMaxLines);
    lines = wrapped.lines;
    if (!wrapped.hardSplit || currentFontSize <= MIN_PRIMARY_FONT_SIZE) break;
    const nextSize = Math.max(MIN_PRIMARY_FONT_SIZE, Math.round(currentFontSize * PRIMARY_SIZE_RATIO));
    if (nextSize >= currentFontSize) break;
    currentFontSize = nextSize;
  }

  const lineHeight = Math.round(currentFontSize * 1.32);
  let secondaryFontSize = Math.max(MIN_SECONDARY_FONT_SIZE, Math.round(currentFontSize * SECONDARY_SIZE_RATIO));
  let secondaryLines: string[] = [];

  // 双语副行遵守同样的完整性规则：完整折行，不再受旧的 secondaryLineOptions 截断。
  if (isBilingual && secondaryText && secondaryText.trim()) {
    const secondaryFloor = Math.max(MIN_SECONDARY_FONT_SIZE, Math.round(currentFontSize * SECONDARY_MIN_FLOOR_RATIO));
    for (let attempt = 0; attempt < SECONDARY_SHRINK_STEPS; attempt++) {
      ctx.font = subtitleCanvasFont(typeface.secondaryFamily, secondaryFontSize, typeface.secondaryWeight);
      const wrapped = wrapTextInternal(ctx, secondaryText, maxWidth, preferredMaxLines);
      secondaryLines = wrapped.lines;
      if (!wrapped.hardSplit || secondaryFontSize <= secondaryFloor) break;
      const nextSize = Math.max(secondaryFloor, Math.round(secondaryFontSize * SECONDARY_SHRINK_RATIO));
      if (nextSize >= secondaryFontSize) break;
      secondaryFontSize = nextSize;
    }
  }
  const secondaryLineHeight = Math.round(secondaryFontSize * 1.28);

  // Calculate bounding box，同时显式复核每一行是否仍在安全宽度内。
  let maxLineWidth = 0;
  let overflow = false;
  const measureLine = (line: string) => {
    const width = ctx.measureText(line).width;
    if (width > maxLineWidth) maxLineWidth = width;
    if (width > maxWidth + OVERFLOW_EPSILON) overflow = true;
  };

  ctx.font = subtitleCanvasFont(typeface.primaryFamily, currentFontSize, typeface.primaryWeight);
  for (const line of lines) measureLine(line);

  if (secondaryLines.length > 0) {
    ctx.font = subtitleCanvasFont(typeface.secondaryFamily, secondaryFontSize, typeface.secondaryWeight);
    for (const line of secondaryLines) measureLine(line);
  }

  const exceededMaxLines = lines.length > preferredMaxLines || secondaryLines.length > preferredMaxLines;

  const primaryHeight = lines.length * lineHeight;
  const secondaryHeight = secondaryLines.length > 0 ? secondaryLines.length * secondaryLineHeight + currentFontSize * 0.25 : 0;
  const totalHeight = primaryHeight + secondaryHeight;

  const paddingX = Math.round(currentFontSize * 0.85);
  const paddingY = Math.round(currentFontSize * 0.55);

  const boxWidth = maxLineWidth + paddingX * 2;
  const boxHeight = totalHeight + paddingY * 2;

  return {
    lines,
    secondaryLines,
    fontSize: currentFontSize,
    secondaryFontSize,
    lineHeight,
    secondaryLineHeight,
    totalHeight,
    maxLineWidth,
    boxWidth,
    boxHeight,
    exceededMaxLines,
    overflow,
  };
}
