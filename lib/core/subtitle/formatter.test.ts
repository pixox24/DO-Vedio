import { describe, expect, it } from "vitest";
import { calculateSubtitleLayout, wrapText } from "./formatter";

/**
 * 排版完整性回归测试（P2-5 / P2-6）。
 * mock canvas 的宽度随 ctx.font 里的字号变化：每 code point 宽 fontSize * 0.9。
 */
function mockContext(): CanvasRenderingContext2D {
  const ctx = {
    font: "",
    measureText(text: string) {
      const size = Number(ctx.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 16);
      return { width: [...text].length * size * 0.9 };
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

const setFont = (ctx: CanvasRenderingContext2D, size: number) => {
  ctx.font = `bold ${size}px sans-serif`;
};

function graphemesOf(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), (item) => item.segment);
}

const stripWhitespace = (text: string) => text.replace(/\s+/gu, "");

function expectLinesFit(ctx: CanvasRenderingContext2D, lines: string[], fontSize: number, maxWidth: number) {
  setFont(ctx, fontSize);
  for (const line of lines) {
    expect(ctx.measureText(line).width, `line ${JSON.stringify(line)} must fit in ${maxWidth}px`).toBeLessThanOrEqual(maxWidth);
  }
}

/** 每行必须是输入 grapheme 序列的连续子序列：emoji/旗帜/组合音标不得拆成半个 */
function expectGraphemeContinuity(input: string, lines: string[]) {
  const inputGraphemes = graphemesOf(input);
  let cursor = 0;
  for (const line of lines) {
    for (const grapheme of graphemesOf(line)) {
      if (/^\s+$/u.test(grapheme)) continue;
      const at = inputGraphemes.indexOf(grapheme, cursor);
      expect(at, `grapheme ${JSON.stringify(grapheme)} in line ${JSON.stringify(line)} must continue the input`).toBeGreaterThanOrEqual(0);
      cursor = at + 1;
    }
  }
}

const LONG_CN = "这是一句非常长的中文口播字幕文本，需要在宽度限制内自动折行，并且无论如何都不能丢掉任何一个汉字。".repeat(4);

describe("wrapText 完整性（P2-5）", () => {
  it("maxLines=2/3/4 的超长中文完整保留，返回全部行", () => {
    for (const maxLines of [2, 3, 4]) {
      const ctx = mockContext();
      setFont(ctx, 40);
      const lines = wrapText(ctx, LONG_CN, 400, maxLines);
      expect(lines.length).toBeGreaterThan(maxLines);
      expect(stripWhitespace(lines.join(""))).toBe(stripWhitespace(LONG_CN));
      expectLinesFit(ctx, lines, 40, 400);
      expectGraphemeContinuity(LONG_CN, lines);
    }
  });

  it("maxLines 只作偏好，不截断文本", () => {
    const ctx = mockContext();
    setFont(ctx, 40);
    const lines = wrapText(ctx, LONG_CN, 400, 1);
    expect(lines.length).toBeGreaterThan(1);
    expect(stripWhitespace(lines.join(""))).toBe(stripWhitespace(LONG_CN));
  });

  it("中英混排折行不丢字且不越界", () => {
    const ctx = mockContext();
    setFont(ctx, 30);
    const mixed = "开场用中文说明，然后切换到 English words and phrases that keep going 最后回到中文收尾。";
    const lines = wrapText(ctx, mixed, 270, 2);
    expect(lines.length).toBeGreaterThan(1);
    expect(stripWhitespace(lines.join(""))).toBe(stripWhitespace(mixed));
    expectLinesFit(ctx, lines, 30, 270);
    expectGraphemeContinuity(mixed, lines);
  });

  it("显式换行按段完整折行", () => {
    const ctx = mockContext();
    setFont(ctx, 24);
    const manual = "第一段手动换行的文字。\nSecond manual paragraph stays complete.\n第三段结尾。";
    const lines = wrapText(ctx, manual, 300, 2);
    expect(stripWhitespace(lines.join(""))).toBe(stripWhitespace(manual));
    expectLinesFit(ctx, lines, 24, 300);
    expectGraphemeContinuity(manual, lines);
  });

  it("有预算时优先在标点处断行", () => {
    const ctx = mockContext();
    setFont(ctx, 40);
    const text = "你好，世界这是后续内容";
    const lines = wrapText(ctx, text, 180, 3);
    expect(lines[0]).toBe("你好，");
    expect(stripWhitespace(lines.join(""))).toBe(stripWhitespace(text));
  });

  it("中文标点跟随前字，不落行首也不单独成行", () => {
    const ctx = mockContext();
    setFont(ctx, 40);
    const text = "这是一句非常长的竖屏字幕文本，用来确认安全排版宽度与自动折行在竖屏下同样不会溢出画面。";
    const lines = wrapText(ctx, text, 300, 2);
    expect(stripWhitespace(lines.join(""))).toBe(stripWhitespace(text));
    const forbiddenHead = /^[，。！？；：、…—）】》」]/;
    for (const line of lines) {
      expect(forbiddenHead.test(line), `line must not start with punctuation: ${line}`).toBe(false);
      expect(line.replace(/\s/g, "").length, `line must not be a lone punctuation: ${line}`).toBeGreaterThan(1);
    }
  });

  it("普通英文单词只在词边界换行", () => {
    const ctx = mockContext();
    setFont(ctx, 20);
    const text = "alpha beta gamma delta epsilon zeta eta theta";
    const lines = wrapText(ctx, text, 126, 3);
    const words = new Set(text.split(" "));
    for (const line of lines) {
      for (const token of line.split(" ")) {
        expect(words.has(token), `token ${JSON.stringify(token)} must be a whole input word`).toBe(true);
      }
    }
    expect(lines.join(" ")).toBe(text);
  });
});

describe("超长西文 token 二次断词（P2-6）", () => {
  it("120+ 连续 ASCII 按 grapheme 安全拆分且不丢尾部", () => {
    const ctx = mockContext();
    setFont(ctx, 24);
    const ascii = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".repeat(2) + "tail";
    expect(ascii.length).toBeGreaterThanOrEqual(120);
    const lines = wrapText(ctx, ascii, 216, 2);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join("")).toBe(ascii);
    expectLinesFit(ctx, lines, 24, 216);
    expectGraphemeContinuity(ascii, lines);
  });

  it("超长 URL 优先在标点处断且不切掉尾部", () => {
    const ctx = mockContext();
    setFont(ctx, 24);
    const url = "https://example.com/a/very/long/path?query=abcdefghijklmnopqrstuvwxyz0123456789&token=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
    const lines = wrapText(ctx, url, 200, 3);
    expect(lines.join("")).toBe(url);
    expect(lines.length).toBeGreaterThan(3);
    expectLinesFit(ctx, lines, 24, 200);
    expect(lines.slice(0, -1).some((line) => /[-._/:?&=#@]$/.test(line))).toBe(true);
  });

  it("长数字串完整保留", () => {
    const ctx = mockContext();
    setFont(ctx, 24);
    const digits = "1234567890".repeat(13);
    const lines = wrapText(ctx, digits, 180, 2);
    expect(lines.join("")).toBe(digits);
    expect(lines.length).toBeGreaterThan(2);
    expectLinesFit(ctx, lines, 24, 180);
  });
});

describe("grapheme 边界安全", () => {
  it("emoji、旗帜、组合音标不会出现半个字符", () => {
    const ctx = mockContext();
    setFont(ctx, 30);
    const text = "😀😀 hello 🇨🇳 cafe\u0301 🎉🎉";
    const lines = wrapText(ctx, text, 100, 3);
    expect(stripWhitespace(lines.join(""))).toBe(stripWhitespace(text));
    expectGraphemeContinuity(text, lines);
    expectLinesFit(ctx, lines, 30, 100);
  });
});

describe("calculateSubtitleLayout 完整性状态（P2-5 / P2-6）", () => {
  it("maxLines=2/3/4 的超长中文完整可见并标记 exceededMaxLines", () => {
    const safeWidth = 1920 * 0.84;
    for (const maxLines of [2, 3, 4]) {
      const ctx = mockContext();
      const layout = calculateSubtitleLayout(ctx, LONG_CN, undefined, 1920, 40, false, 0.84, maxLines);
      expect(stripWhitespace(layout.lines.join(""))).toBe(stripWhitespace(LONG_CN));
      expect(layout.lines.length).toBeGreaterThan(maxLines);
      expect(layout.exceededMaxLines).toBe(true);
      expect(layout.overflow).toBe(false);
      expectLinesFit(ctx, layout.lines, layout.fontSize, safeWidth);
      expect(layout.boxWidth).toBeGreaterThan(layout.maxLineWidth);
      expect(layout.boxHeight).toBeGreaterThan(layout.totalHeight);
    }
  });

  it("正常短句不标记溢出或超行，双字段始终有布尔值", () => {
    const ctx = mockContext();
    const layout = calculateSubtitleLayout(ctx, "正常短句", "Short line", 1920, 40, true, 0.84, 3);
    expect(typeof layout.exceededMaxLines).toBe("boolean");
    expect(typeof layout.overflow).toBe("boolean");
    expect(layout.exceededMaxLines).toBe(false);
    expect(layout.overflow).toBe(false);
    expect(layout.secondaryLines.length).toBeGreaterThan(0);
  });

  it("双语长副行完整保留且主副行都受安全宽度约束", () => {
    const safeWidth = 1080 * 0.84;
    const primary = "中文主行和 English words 混排的内容。\n第二段手动换行。";
    const secondary = "A complete English translation line that is intentionally long enough to wrap across several subtitle lines without losing any word at all. This extra sentence guarantees that the secondary block needs more than three full lines.";
    const ctx = mockContext();
    const layout = calculateSubtitleLayout(ctx, primary, secondary, 1080, 34, true, 0.84, 3);
    expect(stripWhitespace(layout.lines.join(""))).toBe(stripWhitespace(primary));
    expect(stripWhitespace(layout.secondaryLines.join(""))).toBe(stripWhitespace(secondary));
    expect(layout.secondaryLines.length).toBeGreaterThan(3);
    expect(layout.exceededMaxLines).toBe(true);
    expect(layout.overflow).toBe(false);
    expectLinesFit(ctx, layout.lines, layout.fontSize, safeWidth);
    expectLinesFit(ctx, layout.secondaryLines, layout.secondaryFontSize, safeWidth);
  });

  it("120+ 连续 ASCII 在横屏与竖屏都不越界不丢字", () => {
    const ascii = "x".repeat(130);
    for (const canvasWidth of [1920, 1080]) {
      const ctx = mockContext();
      const layout = calculateSubtitleLayout(ctx, ascii, undefined, canvasWidth, 40, false, 0.84, 3);
      expect(layout.lines.join("")).toBe(ascii);
      expect(layout.overflow).toBe(false);
      expectLinesFit(ctx, layout.lines, layout.fontSize, canvasWidth * 0.84);
    }
  });

  it("长 URL 与长数字串的布局不丢尾部", () => {
    const ctx = mockContext();
    const url = "https://example.com/a/very/long/path?query=abcdefghijklmnopqrstuvwxyz0123456789&token=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
    const urlLayout = calculateSubtitleLayout(ctx, url, undefined, 1080, 36, false, 0.84, 3);
    expect(urlLayout.lines.join("")).toBe(url);
    expect(urlLayout.overflow).toBe(false);
    expectLinesFit(ctx, urlLayout.lines, urlLayout.fontSize, 1080 * 0.84);

    const digits = "1234567890".repeat(13);
    const digitLayout = calculateSubtitleLayout(ctx, digits, undefined, 1080, 36, false, 0.84, 3);
    expect(digitLayout.lines.join("")).toBe(digits);
    expect(digitLayout.overflow).toBe(false);
    expectLinesFit(ctx, digitLayout.lines, digitLayout.fontSize, 1080 * 0.84);
  });

  it("极小画布无法容纳单字时显式标记 overflow 且文本完整", () => {
    const ctx = mockContext();
    const layout = calculateSubtitleLayout(ctx, "😀😀", undefined, 8, 40, false, 0.84, 3);
    expect(layout.lines.join("")).toBe("😀😀");
    expect(layout.overflow).toBe(true);
  });
});
