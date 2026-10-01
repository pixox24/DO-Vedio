import { describe, expect, it } from "vitest";
import { evenChars } from "../align";
import type { TtsResult } from "../keys";
import { buildTimeline } from "../timeline";
import { emptyDoc, projectDocSchema, settingsSchema, type Line } from "../types";
import { calculateSubtitleLayout, wrapText } from "./formatter";
import { fontFamilyStack, resolveSecondarySubtitleFontId, resolveSubtitleFontId, studioFontById, STUDIO_FONTS, subtitleFontIds } from "./fonts";
import { bilingualTarget, inferScriptLanguage, looksLikeSecondary } from "./language";
import { applySubtitlePreset, DEFAULT_SUBTITLE_CONFIG, subtitlePresetUpdates } from "./presets";
import { drawSubtitles, prepareSubtitleLayout } from "./renderer";
import { applySecondaryTranslation, isSecondaryUsable, pendingTranslateUnits, primaryHash, secondaryCoverage } from "./secondary";
import type { SubtitleBlock } from "./types";

const line = (id: string, text: string, extra: Partial<Line> = {}): Line => ({ id, segmentIndex: 0, text, spans: [], keywords: [], locked: false, ...extra });

function fakeTts(text: string, ms: number): TtsResult {
  return { assetId: "x".repeat(64), durationMs: ms + 400, speechStartMs: 200, speechEndMs: 200 + ms, chars: evenChars(text, 200, 200 + ms), aligned: true, spokenChars: text.length };
}

/** 模拟 canvas：字符宽度随 ctx.font 里的字号变化，字号自适应逻辑才能被验证 */
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

describe("字幕配置", () => {
  it("旧项目的精简字幕配置会补齐新默认值", () => {
    const parsed = settingsSchema.parse({ subtitle: { enabled: false, burnIn: false, highlight: false } });
    expect(parsed.subtitle).toMatchObject({
      enabled: false,
      burnIn: false,
      highlight: false,
      preset: "viral-yellow",
      fontSize: 26,
      fontId: "system-cjk",
      positionY: 82,
      animation: "pop",
      bilingual: false,
      maxLines: 3,
      maxWidthRatio: 0.84,
    });
  });

  it("line 支持双语副行字段且旧文档继续可读", () => {
    const doc = projectDocSchema.parse({
      ...emptyDoc(),
      lines: [{ id: "a", segmentIndex: 0, text: "你好世界", secondaryText: "Hello world", secondaryHash: "abc" }],
    });
    expect(doc.lines[0].secondaryText).toBe("Hello world");
    expect(doc.lines[0].secondaryHash).toBe("abc");
    expect(doc.settings.subtitle.showBackground).toBe(true);
  });

  it("预设只覆盖样式字段，不碰开关和字体", () => {
    const base = { ...DEFAULT_SUBTITLE_CONFIG, enabled: false, fontId: "wuhan-yingxiong" };
    const next = applySubtitlePreset(base, "cinematic-bilingual");
    expect(next.enabled).toBe(false);
    expect(next.fontId).toBe("wuhan-yingxiong");
    expect(next.bilingual).toBe(true);
    expect(next.animation).toBe("fade");
    expect(next.showBackground).toBe(false);
    expect(subtitlePresetUpdates("neon-cyan")).toMatchObject({ primaryColor: "#22d3ee", animation: "karaoke" });
    expect(subtitlePresetUpdates("classic-contrast").animation).toBe("none");
  });
});

describe("字幕语言与翻译对账", () => {
  it("识别口播语言与副行语言", () => {
    expect(inferScriptLanguage("你好世界")).toBe("zh");
    expect(inferScriptLanguage("hello world")).toBe("en");
    expect(inferScriptLanguage("")).toBe("zh");
    expect(bilingualTarget("zh")).toBe("en");
    expect(bilingualTarget("en")).toBe("zh");
    expect(looksLikeSecondary("Hello there", "zh")).toBe(true);
    expect(looksLikeSecondary("Hello 你好", "zh")).toBe(false);
    expect(looksLikeSecondary("你好世界", "en")).toBe(true);
  });

  it("哈希忽略标点空白，文本改动即视为过期", () => {
    expect(primaryHash("你好，世界！")).toBe(primaryHash("你好世界"));
    expect(primaryHash("你好世界")).not.toBe(primaryHash("你好世界啊"));

    const translated = line("a", "你好世界", { secondaryText: "Hello world", secondaryHash: primaryHash("你好世界") });
    expect(isSecondaryUsable(translated)).toBe(true);
    expect(isSecondaryUsable({ ...translated, text: "你好世界啊" })).toBe(false);
    expect(isSecondaryUsable({ ...translated, secondaryText: "你好 世界" })).toBe(false);
    expect(isSecondaryUsable(line("b", "第二句"))).toBe(false);
  });

  it("待翻译队列、覆盖率与回填", () => {
    const lines = [line("a", "你好世界", { secondaryText: "Hello world", secondaryHash: primaryHash("你好世界") }), line("b", "第二句")];
    expect(pendingTranslateUnits(lines).map((unit) => unit.id)).toEqual(["b"]);
    expect(secondaryCoverage(lines)).toEqual({ total: 2, fresh: 1, stale: 1 });

    const applied = applySecondaryTranslation(lines, new Map([["b", "Second line"]]));
    expect(applied[1].secondaryText).toBe("Second line");
    expect(applied[1].secondaryHash).toBe(primaryHash("第二句"));
    expect(isSecondaryUsable(applied[1])).toBe(true);
    expect(secondaryCoverage(applied)).toEqual({ total: 2, fresh: 2, stale: 0 });
  });
});

describe("字幕字体", () => {
  it("解析字体 id 并在未内置时回退系统字体", () => {
    expect(resolveSubtitleFontId(DEFAULT_SUBTITLE_CONFIG)).toBe("system-cjk");
    expect(resolveSubtitleFontId({ fontId: "wuhan-yingxiong" })).toBe("wuhan-yingxiong");
    expect(resolveSubtitleFontId({ fontId: "nanxi-youmo-song" })).toBe("system-cjk");
    expect(resolveSubtitleFontId({ fontFamily: 'StudioZhuoteZiyou, sans-serif' })).toBe("zhuote-ziyou");
    expect(resolveSecondarySubtitleFontId({ secondaryFontId: "latin-serif" })).toBe("latin-serif");
    expect(resolveSecondarySubtitleFontId({ secondaryFontId: "not-a-font" })).toBe("system-latin");
    expect(subtitleFontIds({ ...DEFAULT_SUBTITLE_CONFIG, bilingual: true })).toEqual(["system-cjk", "system-latin"]);
    expect(fontFamilyStack(studioFontById("wuhan-yingxiong"))).toContain("StudioWuhanYingxiong");
    expect(STUDIO_FONTS.filter((font) => font.url && font.bundled)).toHaveLength(4);
  });
});

describe("字幕排版", () => {
  it("短句不折行，长句按宽度折行且不超过最大行数", () => {
    const ctx = mockContext();
    expect(wrapText(ctx, "短句", 100)).toEqual(["短句"]);
    const long = "这是一句非常非常长的口播字幕文本，需要在宽度限制内自动折行，不能超出画面边界。";
    const lines = wrapText(ctx, long, 200, 3);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const text of lines) expect(ctx.measureText(text).width).toBeLessThanOrEqual(200);
  });

  it("超宽时自动缩小字号，双语块包含副行", () => {
    const ctx = mockContext();
    const long = "这是一句非常非常长的口播字幕文本，需要在宽度限制内自动折行，不能超出画面边界。";
    const layout = calculateSubtitleLayout(ctx, long, undefined, 1000, 40, false, 0.84, 3);
    expect(layout.lines.length).toBeLessThanOrEqual(3);
    expect(layout.fontSize).toBeLessThanOrEqual(40);
    expect(layout.boxWidth).toBeGreaterThan(layout.maxLineWidth);

    // 单个超长单词无法折行：字号必须缩到能放进安全宽度
    const word = calculateSubtitleLayout(ctx, "Supercalifragilisticexpialidocious", undefined, 1000, 40, false, 0.84, 3);
    expect(word.fontSize).toBeLessThan(40);
    expect(word.maxLineWidth).toBeLessThanOrEqual(1000 * 0.84);

    const bilingual = calculateSubtitleLayout(ctx, "主行口播文本", "Secondary translation line", 1000, 40, true, 0.84, 3);
    expect(bilingual.secondaryLines.length).toBeGreaterThan(0);
    expect(bilingual.secondaryFontSize).toBeLessThan(bilingual.fontSize);
    expect(bilingual.totalHeight).toBeGreaterThan(0);
  });
});

describe("字幕绘制", () => {
  it("prepare 生成排版，draw 画出主行与副行", () => {
    let fillTextCalls = 0;
    const ctx = {
      ...mockContext(),
      textAlign: "",
      textBaseline: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      lineJoin: "",
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      beginPath: () => {},
      roundRect: () => {},
      fill: () => {},
      strokeText: () => {},
      fillText: () => {
        fillTextCalls++;
      },
    } as unknown as CanvasRenderingContext2D;
    const block: SubtitleBlock = { lineId: "a", startMs: 0, endMs: 1000, text: "你好世界", secondaryText: "Hello world", keywords: [] };
    const config = { ...DEFAULT_SUBTITLE_CONFIG, bilingual: true };
    const prepared = prepareSubtitleLayout(ctx, 1000, block, config);
    expect(prepared?.layout.lines).toHaveLength(1);
    expect(prepared?.layout.secondaryLines.length).toBeGreaterThan(0);
    drawSubtitles(ctx, 1000, 1000, block, config, 0.5, undefined, prepared);
    expect(fillTextCalls).toBeGreaterThanOrEqual(2);
  });
});

describe("时间轴字幕块", () => {
  it("双语开启且翻译有效时写入副行；关闭时只保留主行", () => {
    const lines = [line("a", "你好世界", { secondaryText: "Hello world", secondaryHash: primaryHash("你好世界") })];
    const doc = { ...emptyDoc(), lines };
    doc.settings.subtitle = { ...doc.settings.subtitle, bilingual: true };
    const art = { tts: new Map([["a", fakeTts("你好世界", 1000)]]), tracks: new Map<string, never>(), media: (hash: string) => `/m/${hash}` };
    const t = buildTimeline(doc, art, "16:9");
    expect(t.subtitleBlocks).toHaveLength(1);
    expect(t.subtitleBlocks[0]).toMatchObject({ lineId: "a", text: "你好世界", secondaryText: "Hello world" });
    expect(t.subtitle.bilingual).toBe(true);

    const mono = { ...doc, settings: { ...doc.settings, subtitle: { ...doc.settings.subtitle, bilingual: false } } };
    const t2 = buildTimeline(mono, art, "16:9");
    expect(t2.subtitleBlocks[0].secondaryText).toBeUndefined();
  });

  it("字幕关闭时不生成字幕块，但 cues 与 SRT 链路保持独立", () => {
    const lines = [line("a", "你好世界。")];
    const doc = { ...emptyDoc(), lines };
    doc.settings.subtitle = { ...doc.settings.subtitle, enabled: false };
    const art = { tts: new Map([["a", fakeTts("你好世界。", 1000)]]), tracks: new Map<string, never>(), media: (hash: string) => `/m/${hash}` };
    const t = buildTimeline(doc, art, "16:9");
    expect(t.subtitleBlocks).toHaveLength(0);
    expect(t.cues).toHaveLength(0);
  });
});
