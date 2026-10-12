import { describe, expect, it } from "vitest";
import { evenChars } from "./align";
import type { TtsResult } from "./keys";
import { applyLiveTimeline, presentationSignature } from "./live-timeline";
import { blankShot } from "./shots";
import { selectShotCandidate } from "./shot-asset";
import { buildTimeline } from "./timeline";
import { coverWithTrack } from "./music";
import { emptyDoc, type Line, type ProjectDoc } from "./types";

const line = (id: string, text: string, extra: Partial<Line> = {}): Line => ({ id, segmentIndex: 0, text, spans: [], keywords: ["话"], locked: false, ...extra });

function fakeTts(text: string, ms: number): TtsResult {
  return { assetId: "a".repeat(64), durationMs: ms + 400, speechStartMs: 200, speechEndMs: 200 + ms, chars: evenChars(text, 200, 200 + ms), aligned: true, spokenChars: text.length };
}

function sample(): { doc: ProjectDoc; timeline: ReturnType<typeof buildTimeline> } {
  const doc: ProjectDoc = {
    ...emptyDoc(),
    lines: [line("a", "第一句话。"), line("b", "第二句话。")],
    music: coverWithTrack([{ id: "a" }, { id: "b" }], "theme.mp3"),
  };
  const timeline = buildTimeline(doc, {
    tts: new Map([["a", fakeTts("第一句话。", 1000)], ["b", fakeTts("第二句话。", 1000)]]),
    tracks: new Map([["theme.mp3", { id: "theme.mp3", title: "主题", assetId: "trackhash", durationMs: 8000, moods: [], loopable: true }]]),
    media: (hash) => `/m/${hash}`,
  }, "16:9");
  return { doc, timeline };
}

describe("预览当场覆盖字幕和配乐", () => {
  it("改颜色和位置只动字幕层和安全区，旁白地址不动", () => {
    const { doc, timeline } = sample();
    const next = applyLiveTimeline(timeline, {
      ...doc,
      settings: { ...doc.settings, subtitle: { ...doc.settings.subtitle, primaryColor: "#00ffcc", positionY: 30, fontSize: 48 } },
    }, []);
    expect(next.subtitle.primaryColor).toBe("#00ffcc");
    expect(next.subtitle.positionY).toBe(30);
    expect(next.shots[0]?.safeArea?.topRatio).toBeGreaterThan(0);
    expect(next.voice.map((item) => item.src)).toEqual(timeline.voice.map((item) => item.src));
    expect(next.lines).toEqual(timeline.lines);
  });

  it("关掉关键词就不再把关键词写进字幕块", () => {
    const { doc, timeline } = sample();
    const next = applyLiveTimeline(timeline, {
      ...doc,
      settings: { ...doc.settings, subtitle: { ...doc.settings.subtitle, highlight: false } },
    }, []);
    expect(next.subtitleBlocks.every((block) => block.keywords.length === 0)).toBe(true);
    expect(next.subtitleBlocks[0]?.charTimes?.length).toBeGreaterThan(0);
  });

  it("换曲和调音量当场改配乐，并和成片用同一段铺轨", () => {
    const { doc, timeline } = sample();
    const same = applyLiveTimeline(timeline, doc, [{ id: "theme.mp3", src: "/m/trackhash", durationMs: 8000 }]);
    expect(same.music).toEqual(timeline.music);
    const louder = applyLiveTimeline(timeline, {
      ...doc,
      settings: { ...doc.settings, music: { ...doc.settings.music, gainDb: -12 } },
    }, [{ id: "theme.mp3", src: "/m/trackhash", durationMs: 8000 }]);
    expect(louder.music[0]?.baseGain).toBeLessThan(timeline.music[0]!.baseGain);
    const swapped = applyLiveTimeline(timeline, {
      ...doc,
      music: coverWithTrack(doc.lines, "other.mp3"),
    }, [{ id: "other.mp3", src: "/m/other", durationMs: 4000 }]);
    expect(swapped.music[0]).toMatchObject({ trackId: "other.mp3", src: "/m/other", loop: true });
    expect(swapped.voice).toEqual(timeline.voice);
  });

  it("关闭配乐后预览里没有背景音乐", () => {
    const { doc, timeline } = sample();
    const next = applyLiveTimeline(timeline, {
      ...doc,
      settings: { ...doc.settings, music: { ...doc.settings.music, enabled: false } },
    }, []);
    expect(next.music).toEqual([]);
  });

  it("签名只跟着字幕和配乐变", () => {
    const { doc } = sample();
    const colored = { ...doc, settings: { ...doc.settings, subtitle: { ...doc.settings.subtitle, primaryColor: "#111111" } } };
    expect(presentationSignature(colored)).not.toBe(presentationSignature(doc));
    expect(presentationSignature({ ...doc, brief: { ...doc.brief, title: "另一个标题" } })).toBe(presentationSignature(doc));
  });

  it("换候选只改这一镜的画面，旁白和起止不动", () => {
    const doc: ProjectDoc = {
      ...emptyDoc(),
      lines: [line("a", "第一句话。"), line("b", "第二句话。")],
      shots: [
        {
          ...blankShot("s1", "a"),
          kind: "image",
          assetId: "old-a",
          candidates: [{ id: "keep", assetId: "old-a", selected: true }, { id: "pick", assetId: "new-a", selected: false }],
          assetVariants: { "16:9": { assetId: "old-a", promptHash: "h", aspect: "16:9", width: 1920, height: 1080, source: "generated" } },
        },
        { ...blankShot("s2", "b"), kind: "image", assetId: "keep-b" },
      ],
    };
    const timeline = buildTimeline(doc, {
      tts: new Map([["a", fakeTts("第一句话。", 1000)], ["b", fakeTts("第二句话。", 1000)]]),
      tracks: new Map(),
      media: (hash) => `/api/media/${hash}`,
    }, "16:9");
    const picked = selectShotCandidate(doc.shots[0]!, "pick", { aspect: "16:9", framing: "smart-dual", aspects: ["16:9"] });
    const nextDoc = { ...doc, shots: [picked!, doc.shots[1]!] };
    const next = applyLiveTimeline(timeline, nextDoc, []);
    expect(next.shots[0]?.imageSrc).toBe("/api/media/new-a");
    expect(next.shots[0]?.videoSrc).toBeUndefined();
    expect(next.shots[0]?.startMs).toBe(timeline.shots[0]?.startMs);
    expect(next.shots[0]?.endMs).toBe(timeline.shots[0]?.endMs);
    expect(next.shots[1]?.imageSrc).toBe(timeline.shots[1]?.imageSrc);
    expect(next.shots[1]?.startMs).toBe(timeline.shots[1]?.startMs);
    expect(next.voice).toEqual(timeline.voice);
    expect(presentationSignature(nextDoc)).toBe(presentationSignature(doc));
  });

  it("视频候选换的是视频地址", () => {
    const doc: ProjectDoc = {
      ...emptyDoc(),
      lines: [line("a", "第一句话。")],
      shots: [{
        ...blankShot("s1", "a"),
        kind: "video",
        assetId: "old-v",
        candidates: [{ id: "keep", assetId: "old-v", selected: true }, { id: "pick", assetId: "new-v", selected: false }],
        assetVariants: { "16:9": { assetId: "old-v", promptHash: "h", aspect: "16:9", width: 1920, height: 1080, source: "generated" } },
      }],
    };
    const timeline = buildTimeline(doc, { tts: new Map([["a", fakeTts("第一句话。", 1000)]]), tracks: new Map(), media: (hash) => `/api/media/${hash}` }, "16:9");
    const picked = selectShotCandidate(doc.shots[0]!, "pick", { aspect: "16:9", framing: "smart-dual" });
    const next = applyLiveTimeline(timeline, { ...doc, shots: [picked!] }, []);
    expect(next.shots[0]?.videoSrc).toBe("/api/media/new-v");
    expect(next.shots[0]?.imageSrc).toBeUndefined();
    expect(next.shots[0]?.startMs).toBe(timeline.shots[0]?.startMs);
  });
});
