import { describe, expect, it } from "vitest";
import { evenChars } from "./align";
import type { TtsResult } from "./keys";
import { blankShot } from "./shots";
import { cuesForLine, normalizeCues, toSrt, type Cue } from "./subtitles";
import { buildTimeline, layoutLines, subtitleLineOffsets, typedCharsAt } from "./timeline";
import { emptyDoc, type Line, type ProjectDoc } from "./types";

/**
 * P2-7：SRT cue 必须服从全局时间轴（最短时长只作为建议，不得跨句/重叠）。
 * P2-8：Karaoke 逐字高亮优先真实字级时间，缺失时回退整句均匀进度。
 */

const line = (id: string, text: string, seg = 0, extra: Partial<Line> = {}): Line => ({ id, segmentIndex: seg, text, spans: [], keywords: [], locked: false, ...extra });

function fakeTts(text: string, ms: number): TtsResult {
  return { assetId: "x".repeat(64), durationMs: ms + 400, speechStartMs: 200, speechEndMs: 200 + ms, chars: evenChars(text, 200, 200 + ms), aligned: true, spokenChars: text.length };
}

function docWith(lines: Line[]): ProjectDoc {
  return { ...emptyDoc(), lines, segments: [{ title: "开场", text: "" }, { title: "第二章", text: "" }] };
}

const art = (tts: Record<string, TtsResult> = {}) => ({ tts: new Map(Object.entries(tts)), tracks: new Map(), media: (h: string) => `/m/${h}` });

const assertCueInvariants = (cues: Cue[], endLimitMs = Number.POSITIVE_INFINITY) => {
  for (const cue of cues) {
    expect(Number.isFinite(cue.startMs)).toBe(true);
    expect(Number.isFinite(cue.endMs)).toBe(true);
    expect(cue.startMs).toBeGreaterThanOrEqual(0);
    expect(cue.startMs).toBeLessThan(cue.endMs);
    expect(cue.endMs).toBeLessThanOrEqual(endLimitMs);
  }
  for (let k = 1; k < cues.length; k++) {
    expect(cues[k].startMs).toBeGreaterThanOrEqual(cues[k - 1].endMs);
  }
};

const parseSrtTime = (value: string): number => {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value);
  if (!match) throw new Error(`bad srt time: ${value}`);
  const [, h, m, s, ms] = match;
  return Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms);
};

describe("normalizeCues / cuesForLine 全局时间约束", () => {
  it("200ms 的短句不越过下一句的真实开始（450ms）", () => {
    const a = "好。";
    const b = "下一句从这里开始。";
    const cueA = cuesForLine("a", a, evenChars(a, 0, 200), "16:9");
    const cueB = cuesForLine("b", b, evenChars(b, 450, 1450), "16:9");
    expect(cueA).toHaveLength(1);
    // 句内最短时长（800ms）会把 a 撑到 800ms；全局约束必须压回下一句开始 450ms
    expect(cueA[0].endMs).toBe(800);
    const cues = normalizeCues([...cueA, ...cueB], 2000);
    expect(cues[0].endMs).toBeLessThanOrEqual(450);
    expect(cues[0].startMs).toBe(0);
    assertCueInvariants(cues, 2000);
  });

  it("同句多 cue、段落停顿、估算配音混合后仍不重叠且有限", () => {
    const bText = "这一句话比较长，需要断成两行显示，再多一些字凑够三行。";
    const lines = [line("a", "好。"), line("b", bText), line("c", "第三句没有配音，按估算排。")];
    const { lines: laid } = layoutLines(lines, art({ a: fakeTts("好。", 200), b: fakeTts(bText, 3000) }));
    const raw = laid.flatMap((l) => {
      const text = lines.find((x) => x.id === l.id)!.text;
      return cuesForLine(l.id, text, l.chars, "16:9", ["断成"]);
    });
    expect(raw.filter((c) => c.lineId === "b").length).toBeGreaterThanOrEqual(2);
    const cues = normalizeCues([...raw].reverse(), 60_000);
    assertCueInvariants(cues, 60_000);
    // 估算句也要落在自己的时间区间里
    const estimated = cues.filter((c) => c.lineId === "c");
    expect(estimated.length).toBeGreaterThan(0);
    const laidC = laid.find((l) => l.id === "c")!;
    expect(estimated[0].startMs).toBe(laidC.startMs);
    expect(estimated.at(-1)!.endMs).toBeLessThanOrEqual(laidC.endMs);
  });

  it("最后一条 cue 不超过媒体时长上限", () => {
    const lines = [line("a", "第一句很短。"), line("b", "第二句稍微长一点，用来确认收尾。")];
    const doc = docWith(lines);
    const t = buildTimeline(doc, art({ a: fakeTts("第一句很短。", 250), b: fakeTts("第二句稍微长一点，用来确认收尾。", 1500) }), "16:9");
    expect(t.cues.length).toBeGreaterThan(0);
    expect(t.cues.at(-1)!.endMs).toBeLessThanOrEqual(t.durationMs);
    assertCueInvariants(t.cues, t.durationMs);
  });

  it("负值、NaN、Infinity、零时长输入不产生非法输出", () => {
    const dirty: Cue[] = [
      { startMs: Number.NaN, endMs: 100, text: "a", lineId: "x", highlights: [] },
      { startMs: -50, endMs: -10, text: "b", lineId: "x", highlights: [] },
      { startMs: 100, endMs: 100, text: "c", lineId: "x", highlights: [] },
      { startMs: 300, endMs: Number.POSITIVE_INFINITY, text: "d", lineId: "x", highlights: [] },
      { startMs: 500, endMs: Number.NaN, text: "e", lineId: "x", highlights: [] },
    ];
    const cues = normalizeCues(dirty, 1000);
    expect(cues).toHaveLength(5);
    assertCueInvariants(cues, 1000);
    expect(normalizeCues(dirty, Number.NaN).every((c) => Number.isFinite(c.startMs) && Number.isFinite(c.endMs))).toBe(true);
  });
});

describe("toSrt", () => {
  it("稳定排序、编号 1..n、时间格式合法且无重叠", () => {
    const cues: Cue[] = [
      { startMs: 3000, endMs: 4000, text: "三", lineId: "c", highlights: [] },
      { startMs: 0, endMs: 500, text: "一", lineId: "a", highlights: [] },
      { startMs: 1000, endMs: 1200, text: "二", lineId: "b", highlights: [] },
      { startMs: 1000, endMs: 1100, text: "二b", lineId: "b", highlights: [] },
    ];
    const srt = toSrt(cues);
    const blocks = srt.trim().split(/\n\n+/);
    expect(blocks).toHaveLength(4);
    const parsed: { startMs: number; endMs: number; text: string }[] = [];
    blocks.forEach((block, index) => {
      const rows = block.split("\n");
      expect(rows[0]).toBe(String(index + 1));
      const match = /^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/.exec(rows[1]);
      expect(match).not.toBeNull();
      parsed.push({ startMs: parseSrtTime(match![1]), endMs: parseSrtTime(match![2]), text: rows[2] });
    });
    // 相同 startMs 保持传入顺序（稳定排序）
    expect(parsed.map((p) => p.text)).toEqual(["一", "二", "二b", "三"]);
    for (const p of parsed) {
      expect(Number.isFinite(p.startMs)).toBe(true);
      expect(p.startMs).toBeLessThan(p.endMs);
    }
    for (let k = 1; k < parsed.length; k++) expect(parsed[k].startMs).toBeGreaterThanOrEqual(parsed[k - 1].endMs);
  });
});

describe("buildTimeline 的 cue 全局约束", () => {
  it("短句紧接长句：cue 不越过下一句开始，subtitleBlocks 不串行", () => {
    const lines = [line("a", "好。", 0, { pauseAfterMs: 0 }), line("b", "这一句很长，足够撑满一段完整配音，也不会被前一句的最短时长推走。")];
    const doc = docWith(lines);
    doc.shots = [blankShot("s1", "a")];
    const t = buildTimeline(doc, art({ a: fakeTts("好。", 200), b: fakeTts(lines[1].text, 3500) }), "16:9");
    assertCueInvariants(t.cues, t.durationMs);
    const first = t.cues.filter((c) => c.lineId === "a");
    const second = t.cues.filter((c) => c.lineId === "b");
    expect(first.at(-1)!.endMs).toBeLessThanOrEqual(second[0].startMs);
    expect(t.subtitleBlocks[0]).toMatchObject({ startMs: t.lines[0].startMs, endMs: t.lines[0].endMs });
    expect(t.subtitleBlocks[1]).toMatchObject({ startMs: t.lines[1].startMs, endMs: t.lines[1].endMs });
    expect(t.lines[1].startMs).toBeGreaterThanOrEqual(t.lines[0].endMs);
  });
});

describe("typedCharsAt（Karaoke 真实字级时间）", () => {
  const block = (over: Partial<Parameters<typeof typedCharsAt>[0]> = {}) => ({ lineId: "a", startMs: 0, endMs: 1000, text: "好快停顿", keywords: [], ...over });
  // 第 3 个字拖长（200-900），其余很快
  const charTimes = [
    { i: 0, startMs: 0, endMs: 100 },
    { i: 1, startMs: 100, endMs: 200 },
    { i: 2, startMs: 200, endMs: 900 },
    { i: 3, startMs: 900, endMs: 1000 },
  ];

  it("按真实时间走，而不是按整句总进度线性", () => {
    const b = block({ charTimes });
    expect(typedCharsAt(b, 50)).toBe(0);
    expect(typedCharsAt(b, 100)).toBe(1);
    expect(typedCharsAt(b, 150)).toBe(1);
    // 线性进度在 250ms 只会显示 1 个字；真实时间已经读到第 2 个
    expect(typedCharsAt(b, 250)).toBe(2);
    // 长停顿期间保持 2 个字；线性进度在 850ms 已经到 3
    expect(typedCharsAt(b, 850)).toBe(2);
    expect(typedCharsAt(b, 899)).toBe(2);
    expect(typedCharsAt(b, 900)).toBe(3);
    expect(typedCharsAt(b, 1000)).toBe(4);
    expect(typedCharsAt(b, 5000)).toBe(4);
  });

  it("无 charTimes / 空 charTimes 时回退均匀进度", () => {
    const b = block();
    expect(typedCharsAt(b, 0)).toBe(0);
    expect(typedCharsAt(b, 250)).toBe(1);
    expect(typedCharsAt(b, 500)).toBe(2);
    expect(typedCharsAt(b, 1000)).toBe(4);
    expect(typedCharsAt(b, 5000)).toBe(4);
    expect(typedCharsAt(b, -100)).toBe(0);
    expect(typedCharsAt(block({ charTimes: [] }), 500)).toBe(2);
  });

  it("NaN、越界索引和空文本都安全", () => {
    expect(typedCharsAt(block(), Number.NaN)).toBe(0);
    expect(typedCharsAt(block({ charTimes }), Number.NaN)).toBe(0);
    expect(typedCharsAt(block({ charTimes: [{ i: 99, startMs: 0, endMs: 10 }] }), 500)).toBe(4);
    expect(typedCharsAt(block({ charTimes: [{ i: 0, startMs: 0, endMs: Number.NaN }] }), 500)).toBe(0);
    expect(typedCharsAt(block({ text: "" }), 500)).toBe(0);
  });

  it("稀疏 charTimes（标点无时间）高亮跟随真实索引", () => {
    // 原文“你好，世界。”：逗号 i=2、句号 i=5 不占时间
    const sparse = block({
      text: "你好，世界。",
      charTimes: [
        { i: 0, startMs: 0, endMs: 100 },
        { i: 1, startMs: 100, endMs: 200 },
        { i: 3, startMs: 200, endMs: 300 },
        { i: 4, startMs: 300, endMs: 400 },
      ],
    });
    expect(typedCharsAt(sparse, 150)).toBe(1);
    expect(typedCharsAt(sparse, 250)).toBe(2);
    expect(typedCharsAt(sparse, 350)).toBe(4);
    expect(typedCharsAt(sparse, 450)).toBe(5);
    expect(typedCharsAt(sparse, 999)).toBe(5);
  });
});

describe("subtitleLineOffsets（折行后的原文偏移）", () => {
  it("英文断行去掉空格后偏移仍按原文定位", () => {
    const text = "hello brave new world";
    expect(subtitleLineOffsets(text, ["hello brave", "new world"])).toEqual([0, 12]);
  });

  it("中文无空格折行与行首空白处理都不漂移", () => {
    const text = "这是一句很长的中文字幕文本";
    const lines = ["这是一句很长的", "中文字幕文本"];
    expect(subtitleLineOffsets(text, lines)).toEqual([0, 7]);
  });
});

describe("buildTimeline 的 charTimes 映射", () => {
  it("真实 TTS 提供 charTimes 且索引与文本一致，估算配音不提供", () => {
    const lines = [line("a", "你好世界"), line("b", "估算句子")];
    const doc = docWith(lines);
    doc.shots = [blankShot("s1", "a")];
    const t = buildTimeline(doc, art({ a: fakeTts("你好世界", 1000) }), "16:9");
    const a = t.subtitleBlocks.find((b) => b.lineId === "a")!;
    expect(a.charTimes).toBeDefined();
    expect(a.charTimes!.map((c) => c.i)).toEqual([0, 1, 2, 3]);
    expect(a.charTimes!.length).toBe(a.text.length);
    expect(a.charTimes![0].startMs).toBeGreaterThanOrEqual(a.startMs);
    expect(a.charTimes!.at(-1)!.endMs).toBeLessThanOrEqual(a.endMs);
    const b = t.subtitleBlocks.find((x) => x.lineId === "b")!;
    expect(b.charTimes).toBeUndefined();
  });

  it("含标点的真实 TTS 用稀疏索引提供 charTimes（标点不占时间）", () => {
    const text = "你好，世界。";
    const doc = docWith([line("a", text)]);
    doc.shots = [blankShot("s1", "a")];
    const t = buildTimeline(doc, art({ a: fakeTts(text, 1000) }), "16:9");
    const a = t.subtitleBlocks[0];
    expect(a.charTimes).toBeDefined();
    // 逗号 i=2、句号 i=5 没有字级时间，索引为稀疏子集
    expect(a.charTimes!.map((c) => c.i)).toEqual([0, 1, 3, 4]);
    expect(a.charTimes!.length).toBeLessThan(a.text.length);
  });
});
