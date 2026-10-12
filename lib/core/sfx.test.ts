import { describe, expect, it } from "vitest";
import { evenChars } from "./align";
import { focusColumnUnits } from "./focus";
import { pressGlyphTiming, staggerLineTiming } from "./focus-timing";
import type { TtsResult } from "./keys";
import { applyLiveTimeline, presentationSignature } from "./live-timeline";
import { cameraCatalog, motionCatalog, transitionCatalog } from "./motion-library";
import { blankShot } from "./shots";
import { countOffsetMs, focusSfxMount, scoreShot, SFX_FPS, transitionSfxMount, WHOOSH_LEAD_MS, type SfxSources } from "./sfx";
import { animationHash, buildTimeline, contentHash } from "./timeline";
import { emptyDoc, focusPresetIds, type FocusPresetId, type Line, type ProjectDoc, type Shot } from "./types";

const sources: SfxSources = {
  swipe: "/sfx/swipe.m4a",
  whoosh: "/sfx/whoosh.m4a",
  thud: "/sfx/thud.m4a",
  bloom: "/sfx/bloom.m4a",
  stamp: "/sfx/stamp.m4a",
  tick: "/sfx/tick.m4a",
  count: "/sfx/count.m4a",
};

const line = (id: string, text: string): Line => ({ id, segmentIndex: 0, text, spans: [], keywords: [], locked: false });

function fakeTts(text: string, ms: number): TtsResult {
  return { assetId: "x".repeat(64), durationMs: ms + 400, speechStartMs: 200, speechEndMs: 200 + ms, chars: evenChars(text, 200, 200 + ms), aligned: true, spokenChars: text.length };
}

function film(shots: Shot[], lines: Line[], enabled = true) {
  const doc: ProjectDoc = { ...emptyDoc(), lines, segments: [{ title: "开场", text: "" }], shots };
  doc.settings = { ...doc.settings, sfx: { enabled } };
  const timeline = buildTimeline(doc, {
    tts: new Map(lines.map((item) => [item.id, fakeTts(item.text, 2200)])),
    tracks: new Map(),
    sfx: { sources },
    media: (hash) => `/m/${hash}`,
  }, "16:9");
  return { doc, timeline };
}

function focusShot(id: string, lineId: string, presetId: FocusPresetId, text: string, extra: Partial<Shot> = {}): Shot {
  return {
    ...blankShot(id, lineId),
    mode: "motion",
    transitionIn: "cut",
    transitionLocked: true,
    focusText: { text, layoutMode: "manual", presetId },
    ...extra,
  };
}

describe("动画音效挂载", () => {
  it("每个文字预设和转场都挂了角色，运镜无声", () => {
    expect(focusPresetIds.every((id) => focusSfxMount[id])).toBe(true);
    for (const item of motionCatalog) expect(item.sfx).toBe(focusSfxMount[item.id]);
    for (const item of transitionCatalog) expect(item.sfx).toBe(transitionSfxMount[item.id]);
    for (const item of cameraCatalog) expect(item.sfx).toBeNull();
    expect(transitionSfxMount.cut).toBeNull();
    expect(transitionSfxMount.fade).toBeNull();
    expect(transitionSfxMount.dissolve).toBeNull();
  });

  it("同一类动作共用一声，数字不跟普通升起走", () => {
    for (const id of ["embedded-type", "masked-slice", "tilt-vertical", "diamond", "cross-space"] as const) expect(focusSfxMount[id]).toBe("swipe");
    for (const id of ["vertical-arc", "offset-fade", "pill", "serif-contrast", "solid-outline", "four-dots", "focus", "order"] as const) expect(focusSfxMount[id]).toBe("bloom");
    expect(focusSfxMount["number-space"]).toBe("count");
    expect(focusSfxMount["three-dots"]).toBe("count");
    expect(focusSfxMount["ink-press"]).toBe("stamp");
    expect(focusSfxMount["blur-slide"]).toBe("tick");
  });
});

describe("一个镜头一声", () => {
  it("没有入场重叠时，甩镜不盖过文字", () => {
    const cue = scoreShot({ startMs: 0, endMs: 3000, overlapInFrames: 0, transitionIn: "whip", mode: "motion", focusText: { text: "过度思考", presetId: "ink-press" } });
    expect(cue?.role).toBe("stamp");
  });

  it("转场叠进来时只留转场", () => {
    const cue = scoreShot({ startMs: 2000, endMs: 5000, overlapInFrames: 12, transitionIn: "whip", mode: "motion", focusText: { text: "过度思考", presetId: "ink-press" } });
    expect(cue).toMatchObject({ role: "whoosh", offsetMs: -WHOOSH_LEAD_MS });
  });

  it("标题镜头不再额外加嗖", () => {
    const { timeline } = film([
      focusShot("title", "a", "ink-press", "过度思考", { kind: "title" }),
    ], [line("a", "过度思考会阻碍执行。")]);
    expect(timeline.sfx.map((cue) => cue.role)).toEqual(["stamp"]);
    const frames = Math.max(1, Math.round(((timeline.shots[0]!.endMs - timeline.shots[0]!.startMs) / 1000) * SFX_FPS));
    const lead = pressGlyphTiming(frames, Array.from("过度思考").length).lead;
    expect(timeline.sfx[0]).toMatchObject({ src: "/sfx/stamp.m4a", atMs: Math.round((lead / SFX_FPS) * 1000) });
  });

  it("第二镜的甩镜提前 80 毫秒，不叠压印", () => {
    const { timeline } = film([
      { ...blankShot("pic", "a"), kind: "image", motion: "zoom-in" },
      focusShot("text", "b", "ink-press", "过度思考", { transitionIn: "whip" }),
    ], [line("a", "先看画面。"), line("b", "再看这四个字。")]);
    const shot = timeline.shots[1]!;
    expect(shot.overlapInFrames).toBeGreaterThan(0);
    expect(timeline.sfx).toEqual([expect.objectContaining({ role: "whoosh", atMs: shot.startMs - WHOOSH_LEAD_MS, src: "/sfx/whoosh.m4a" })]);
  });

  it("虚焦起拍跟逐词的第一拍，逐字起拍跟第一个字", () => {
    const slide = film([focusShot("slide", "a", "blur-slide", "方向比速度")], [line("a", "方向比速度重要。")]).timeline;
    const frames = Math.max(1, Math.round(((slide.shots[0]!.endMs - slide.shots[0]!.startMs) / 1000) * SFX_FPS));
    const lead = staggerLineTiming(frames, focusColumnUnits("方向比速度").length, "main").lead;
    expect(slide.sfx[0]).toMatchObject({ role: "tick", atMs: Math.round((lead / SFX_FPS) * 1000) });

    const steps = film([focusShot("steps", "a", "steps", "一步一步")], [line("a", "一步一步来。")]).timeline;
    expect(steps.sfx[0]).toMatchObject({ role: "tick", atMs: 0 });
  });

  it("数字音效停在涨完的那一帧", () => {
    expect(countOffsetMs(3000)).toBe(533);
    expect(countOffsetMs(1500)).toBe(380);
    const { timeline } = film([focusShot("n", "a", "number-space", "85%")], [line("a", "完成了百分之八十五。")]);
    const shot = timeline.shots[0]!;
    expect(timeline.sfx[0]).toMatchObject({ role: "count", atMs: countOffsetMs(shot.endMs - shot.startMs), src: "/sfx/count.m4a" });
  });

  it("图片运镜和切镜没有声音", () => {
    const { timeline } = film([{ ...blankShot("pic", "a"), kind: "image", motion: "pan-left", transitionIn: "cut" }], [line("a", "只是一张图。")]);
    expect(timeline.sfx).toEqual([]);
  });

  it("关掉之后列表为空，地址还留着", () => {
    const { timeline } = film([focusShot("text", "a", "ink-press", "过度思考")], [line("a", "过度思考会阻碍执行。")], false);
    expect(timeline.sfx).toEqual([]);
    expect(timeline.sfxSources.stamp).toBe("/sfx/stamp.m4a");
  });

  it("缺文件时不塞空地址", () => {
    const doc = film([focusShot("text", "a", "ink-press", "过度思考")], [line("a", "过度思考会阻碍执行。")]).doc;
    const timeline = buildTimeline(doc, { tts: new Map([["a", fakeTts("过度思考会阻碍执行。", 2200)]]), tracks: new Map(), sfx: { sources: {} }, media: (hash) => `/m/${hash}` }, "16:9");
    expect(timeline.sfx).toEqual([]);
  });

  it("只改音效不动内容哈希，动画哈希要变", () => {
    const shots = [focusShot("text", "a", "focus", "记住这点")];
    const lines = [line("a", "记住这一点。")];
    const on = film(shots, lines, true).timeline;
    const off = film(shots, lines, false).timeline;
    expect(on.sfx.length).toBe(1);
    expect(contentHash(on)).toBe(contentHash(off));
    expect(animationHash(on)).not.toBe(animationHash(off));
  });
});

describe("预览当场开关音效", () => {
  it("开关不进成片追帧，但预览按当前开关重算", () => {
    const lines = [line("a", "记住这一点。")];
    const shots = [focusShot("text", "a", "focus", "记住这点")];
    const quiet = film(shots, lines, false);
    const loudDoc: ProjectDoc = { ...quiet.doc, settings: { ...quiet.doc.settings, sfx: { enabled: true } } };
    expect(presentationSignature(quiet.doc)).toBe(presentationSignature(loudDoc));
    const heard = applyLiveTimeline(quiet.timeline, loudDoc, []);
    expect(heard.sfx.map((cue) => cue.role)).toEqual(["bloom"]);
    const muted = applyLiveTimeline(heard, quiet.doc, []);
    expect(muted.sfx).toEqual([]);
  });
});
