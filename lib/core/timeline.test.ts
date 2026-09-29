import { describe, expect, it } from "vitest";
import { evenChars } from "./align";
import type { TtsResult } from "./keys";
import { duckEnvelope, envelopeAt, mergeIntervals } from "./mix";
import { normalizeShots, repairShots, SHOT_RULES, stampShots, blankShot } from "./shots";
import { breakLine, cuesForLine, toSrt } from "./subtitles";
import { buildTimeline, layoutLines, TIMING } from "./timeline";
import { emptyDoc, type Line, type ProjectDoc, duckingSchema } from "./types";

const line = (id: string, text: string, seg = 0, extra: Partial<Line> = {}): Line => ({ id, segmentIndex: seg, text, spans: [], keywords: [], locked: false, ...extra });

describe("字幕", () => {
  it("按画幅限制字数、在标点处断、去掉行尾标点", () => {
    const text = "我们今天要讲的，是一个关于时间和记忆的故事，它发生在很久以前。";
    for (const max of [16, 12]) {
      const r = breakLine(text, max);
      for (const [a, b] of r) {
        const t = text.slice(a, b);
        expect(t.replace(/[，。]/g, "").length).toBeLessThanOrEqual(max);
        expect(/[，。]$/.test(t)).toBe(false);
      }
    }
    expect(breakLine(text, 16).map(([a, b]) => text.slice(a, b))).toEqual(["我们今天要讲的", "是一个关于时间和记忆的故事", "它发生在很久以前"]);
  });

  it("不把一个词拆到两行", () => {
    const text = "人工智能正在深刻地改变我们每一个普通人的日常生活方式";
    const r = breakLine(text, 12).map(([a, b]) => text.slice(a, b));
    expect(r.join("")).toBe(text);
    // “生活”“方式”“普通人”之类的词不应被拆开
    for (let k = 0; k + 1 < r.length; k++) expect(`${r[k].slice(-1)}${r[k + 1][0]}`).not.toBe("生活");
  });

  it("时间来自字级时间戳、首尾相接、导出 SRT", () => {
    const text = "第一行的内容在这里，第二行的内容在那里。";
    const chars = evenChars(text, 1000, 5000);
    const cues = cuesForLine("a", text, chars, "16:9", ["内容"]);
    expect(cues.length).toBe(2);
    expect(cues[0].startMs).toBe(1000);
    expect(cues[0].endMs).toBe(cues[1].startMs);
    expect(cues[1].endMs).toBe(5000);
    expect(cues[0].highlights).toEqual([[4, 6]]);
    expect(toSrt(cues)).toContain("00:00:01,000 --> ");
  });
});

describe("自动压低", () => {
  const d = duckingSchema.parse({});
  it("合并短间隔", () => {
    expect(mergeIntervals([{ startMs: 0, endMs: 1000 }, { startMs: 1500, endMs: 2000 }, { startMs: 5000, endMs: 6000 }], 1200)).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 5000, endMs: 6000 },
    ]);
  });
  it("人声时压低，长停顿时抬高", () => {
    const env = duckEnvelope([{ startMs: 1000, endMs: 3000 }, { startMs: 8000, endMs: 9000 }], 0, 12000, d);
    expect(envelopeAt(env, 0)).toBe(d.gapDb);
    expect(envelopeAt(env, 2000)).toBe(d.underVoiceDb);
    expect(envelopeAt(env, 5000)).toBe(d.gapDb);
    expect(envelopeAt(env, 8500)).toBe(d.underVoiceDb);
    // 压下在人声开始前完成
    expect(envelopeAt(env, 1000)).toBe(d.underVoiceDb);
    expect(envelopeAt(env, 1000 - d.attackMs)).toBe(d.gapDb);
    for (let k = 1; k < env.length; k++) expect(env[k][0]).toBeGreaterThanOrEqual(env[k - 1][0]);
  });
});

function fakeTts(text: string, ms: number): TtsResult {
  return { assetId: "x".repeat(64), durationMs: ms + 400, speechStartMs: 200, speechEndMs: 200 + ms, chars: evenChars(text, 200, 200 + ms), aligned: true, spokenChars: text.length };
}

function docWith(lines: Line[]): ProjectDoc {
  return { ...emptyDoc(), lines, segments: [{ title: "开场", text: "" }, { title: "第二章", text: "" }] };
}

describe("时间轴", () => {
  const lines = [line("a", "第一句话。"), line("b", "第二句话，稍微长一点。"), line("c", "新的章节开始了。", 1)];
  const art = (tts: Record<string, TtsResult>) => ({ tts: new Map(Object.entries(tts)), tracks: new Map(), media: (h: string) => `/m/${h}` });

  it("配音是主时钟：句子首尾相接加停顿", () => {
    const { lines: laid } = layoutLines(lines, art({ a: fakeTts("第一句话。", 1000), b: fakeTts("第二句话，稍微长一点。", 2000) }));
    expect(laid[0]).toMatchObject({ startMs: TIMING.leadInMs, endMs: TIMING.leadInMs + 1000, estimated: false });
    expect(laid[1].startMs).toBe(laid[0].endMs + TIMING.pauseInSegmentMs);
    expect(laid[2].startMs).toBe(laid[1].endMs + TIMING.pauseBetweenSegmentsMs);
    expect(laid[2].estimated).toBe(true);
  });

  it("改一句只影响它和后面的时间", () => {
    const before = layoutLines(lines, art({ a: fakeTts("", 1000), b: fakeTts("", 2000), c: fakeTts("", 1500) })).lines;
    const after = layoutLines(lines, art({ a: fakeTts("", 1000), b: fakeTts("", 3000), c: fakeTts("", 1500) })).lines;
    expect(after[0]).toEqual(before[0]);
    expect(after[2].startMs - before[2].startMs).toBe(1000);
    expect(after[2].endMs - after[2].startMs).toBe(before[2].endMs - before[2].startMs);
  });

  it("镜头锚定在句子上，跟着配音时长走；横竖屏同一套分镜", () => {
    const doc = docWith(lines);
    doc.shots = [blankShot("s1", "a"), { ...blankShot("s2", "c"), kind: "title" }];
    const h = buildTimeline(doc, art({ a: fakeTts("", 1000), b: fakeTts("", 2000), c: fakeTts("", 1500) }), "16:9");
    const v = buildTimeline(doc, art({ a: fakeTts("", 1000), b: fakeTts("", 2000), c: fakeTts("", 1500) }), "9:16");
    expect(h.shots.map((s) => s.startMs)).toEqual(v.shots.map((s) => s.startMs));
    expect(h.shots[0].startMs).toBe(0);
    expect(h.shots[1].startMs).toBe(h.lines[2].startMs);
    expect(h.shots[1].chapter).toEqual({ index: 2, title: "第二章" });
    expect(h.shots[1].endMs).toBe(h.durationMs);
    expect(v.width).toBe(1080);
  });

  it("视频镜头把素材地址交给视频层，而不是图片占位层", () => {
    const doc = docWith([line("v", "视频旁白")]);
    doc.shots = [{ ...blankShot("video", "v"), kind: "video", assetId: "v".repeat(64) }];
    const timeline = buildTimeline(doc, { ...art({}), media: (hash: string) => `/api/media/${hash}` }, "16:9");
    expect(timeline.shots[0]).toMatchObject({ videoSrc: `/api/media/${"v".repeat(64)}` });
    expect(timeline.shots[0].imageSrc).toBeUndefined();
  });
});

describe("分镜规则", () => {
  let n = 0;
  const id = () => `n${++n}`;
  const mk = (count: number, ms: number) => {
    const ls = Array.from({ length: count }, (_, k) => line(`l${k}`, "这是一句测试用的话，中间有逗号。"));
    const tts = new Map(ls.map((l) => [l.id, fakeTts(l.text, ms)]));
    const laid = layoutLines(ls, { tts });
    return { ls, times: new Map(laid.lines.map((l) => [l.id, l])), total: laid.endMs };
  };
  const durations = (shots: ReturnType<typeof normalizeShots>, times: Map<string, { startMs: number; chars: { i: number; startMs: number }[] }>, total: number) => {
    const starts = shots.map((s) => {
      const t = times.get(s.at.lineId)!;
      return s.at.char === 0 ? t.startMs : t.chars.find((c) => c.i >= s.at.char)!.startMs;
    });
    starts[0] = 0;
    return starts.map((s, k) => (starts[k + 1] ?? total) - s);
  };

  it("过短的镜头合并、过长的拆开", () => {
    const { ls, times, total } = mk(12, 2400);
    // 每句一个镜头（2.4 秒 + 停顿，合规）→ 保持；只给一个镜头 → 被拆成多段
    const one = normalizeShots([blankShot("only", "l0")], ls, times, total, id);
    const d = durations(one, times, total);
    expect(one.length).toBeGreaterThan(4);
    for (const x of d.slice(0, -1)) expect(x).toBeGreaterThanOrEqual(SHOT_RULES.minMs);
    for (const x of d) expect(x).toBeLessThanOrEqual(SHOT_RULES.maxMs + 1);
  });

  it("开场更快、相邻运镜不同、锁定不动", () => {
    const { ls, times, total } = mk(8, 4500);
    const locked = { ...blankShot("L", "l5"), locked: true, motion: "none" as const };
    const shots = normalizeShots([blankShot("a", "l0"), blankShot("tiny", "l0", 3), locked], ls, times, total, id);
    expect(shots.find((s) => s.id === "L")).toEqual(locked);
    expect(shots.some((s) => s.id === "tiny")).toBe(false);
    const d = durations(shots, times, total);
    expect(d[0]).toBeLessThanOrEqual(SHOT_RULES.openingMaxMs + 1);
    for (let k = 1; k < shots.length; k++) if (!shots[k].locked && !shots[k - 1].locked) expect(shots[k].motion).not.toBe(shots[k - 1].motion);
  });

  it("拆出来的镜头换景别、不继承信息卡", () => {
    const { ls, times, total } = mk(12, 2400);
    const base = { ...blankShot("g", "l0"), mode: "generate" as const, shotSize: "wide" as const, description: "清晨的港口" };
    const shots = normalizeShots([base], ls, times, total, id);
    expect(shots.length).toBeGreaterThan(2);
    for (let k = 1; k < shots.length; k++) expect(shots[k].shotSize).not.toBe(shots[k - 1].shotSize);
    expect(shots.every((s) => s.description === "清晨的港口")).toBe(true);
    const card = { ...blankShot("c", "l0"), mode: "motion" as const, card: { variant: "list" as const, items: ["一", "二"] } };
    const split = normalizeShots([card], ls, times, total, id);
    expect(split[0].card).toBeDefined();
    expect(split.slice(1).every((s) => s.card === undefined && s.mode === "motion" && s.shotSize === undefined)).toBe(true);
  });

  it("句子被删后镜头移到下一句，文本变化的镜头标记过期", () => {
    const ls = [line("a", "一。"), line("b", "二。"), line("c", "三。")];
    const shots = stampShots([blankShot("s1", "a"), blankShot("s2", "b"), { ...blankShot("s3", "c"), locked: true }], ls);
    const next = [line("a", "一。"), line("c", "三改了。")];
    const r = repairShots(shots, ls, next);
    expect(r.shots.map((s) => s.at.lineId)).toEqual(["a", "c"]);
    expect(r.stale.has("s1")).toBe(false);
    // s2 移到 c 后与 s3 冲突，保留一个；锁定的不算过期
    expect(r.stale.has("s3")).toBe(false);
  });
});

describe("段落配音的时间轴", () => {
  const block = (index: number, gapAfterMs: number) => ({ key: "blk", index, count: 3, gapAfterMs, confidence: 1, splitSource: "provider" as const, blockAssetId: "whole" });
  // 每个切片：前半段停顿 + 1s 语音 + 后半段停顿
  const tts = (index: number, lead: number, tail: number, gap: number): TtsResult => ({ assetId: `a${index}`, durationMs: lead + 1000 + tail, speechStartMs: lead, speechEndMs: lead + 1000, chars: [], aligned: true, spokenChars: 5, block: block(index, gap) });

  it("块内用原音频的自然停顿，块尾用标注停顿；切片首尾相接", () => {
    const lines = [line("a", "第一句话。", 0, { pauseAfterMs: 50 }), line("b", "第二句话。"), line("c", "第三句话。", 0, { pauseAfterMs: 900 }), line("d", "块外一句。")];
    const art = { tts: new Map<string, TtsResult | undefined>([["a", tts(0, 0, 300, 600)], ["b", tts(1, 300, 200, 400)], ["c", tts(2, 200, 0, 0)]]) };
    const { lines: laid } = layoutLines(lines, art);
    // a→b：自然停顿 600（忽略 a 上标注的 50）；b→c：400；c 是块尾，按标注 900
    expect(laid[1].startMs - laid[0].endMs).toBe(600);
    expect(laid[2].startMs - laid[1].endMs).toBe(400);
    expect(laid[3].startMs - laid[2].endMs).toBe(900);

    const doc: ProjectDoc = { ...emptyDoc(), lines };
    const t = buildTimeline(doc, { ...art, tracks: new Map(), media: (h) => h }, "16:9");
    const [va, vb, vc] = t.voice;
    // a 播到切点（带 300 尾音），b 从切点开始（带 300 换气），两段首尾相接
    expect(va.startMs + va.durationMs).toBe(vb.startMs);
    expect(vb.trimStartMs).toBe(0);
    expect(vb.startMs + vb.durationMs).toBe(vc.startMs);
    // 块首从有效语音开始，块尾到有效语音结束
    expect(va.trimStartMs).toBe(0);
    expect(va.startMs).toBe(t.lines[0].startMs);
    expect(vc.startMs + vc.durationMs).toBe(t.lines[2].endMs);
  });

  it("不相邻或不同块的句子按普通规则排", () => {
    const lines = [line("a", "第一句话。"), line("b", "第二句话。")];
    const other = { ...tts(1, 300, 0, 0), block: { ...block(1, 0), key: "other" } };
    const { lines: laid } = layoutLines(lines, { tts: new Map([["a", tts(0, 0, 300, 600)], ["b", other]]) });
    expect(laid[1].startMs - laid[0].endMs).toBe(TIMING.pauseInSegmentMs);
  });
});
