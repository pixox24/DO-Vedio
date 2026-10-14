import { describe, expect, it } from "vitest";
import { evenChars } from "./align";
import { sheetSourceHash } from "./cast";
import type { TtsResult } from "./keys";
import { applyPresetToDoc, extractPresetPayload } from "./preset";
import { setupConfirmationMatches, setupFingerprint } from "./production";
import { selectShotCandidate } from "./shot-asset";
import { blankShot, normalizeVideoShots } from "./shots";
import { buildTimeline, layoutLines, type Artifacts } from "./timeline";
import { characterCardSchema, emptyDoc, projectDocSchema, type Line, type Shot } from "./types";
import { sourceImageConfirmed, sourceImageSnapshot, sourceImageStale, videoAssetStale, videoGenerationSnapshot, videoPlayback, videoReferenceIds, videoShotTiming } from "./video";

const line = (id: string, text = "一段足够长的连续旁白内容"): Line => ({ id, text, segmentIndex: 0, spans: [], keywords: [], locked: false });
const tts = (text: string, durationMs: number): TtsResult => ({
  assetId: `audio-${text}`, durationMs: durationMs + 400, speechStartMs: 200, speechEndMs: durationMs + 200,
  chars: evenChars(text, 200, durationMs + 200), aligned: true, spokenChars: text.length,
});
const frame = { aspect: "16:9" as const, width: 1920, height: 1080, fps: 30 };
function fixture(durations = [3000, 3000, 3000]) {
  const doc = emptyDoc();
  doc.settings.visualPipeline = "video";
  doc.lines = durations.map((_, index) => line(`line${index}`));
  doc.shots = doc.lines.map((item, index): Shot => ({
    ...blankShot(`shot${index}`, item.id), kind: "video", mode: "generate", groupId: "group",
    motion: "zoom-in", transitionIn: "fade", sourceImageAssetId: `image${index}`,
    videoPlan: { startState: "A subject stands by a window", action: "The subject raises a hand", camera: "A gentle dolly forward", endState: "The hand rests on the window" },
  }));
  const art: Artifacts = { tts: new Map(doc.lines.map((item, index) => [item.id, tts(item.text, durations[index])])), tracks: new Map(), media: (id) => `/m/${id}` };
  return { doc, art };
}

describe("video domain contract", () => {
  it("old documents default to image and leave the text model alone", () => {
    const old = emptyDoc();
    const { visualPipeline: _pipeline, video: _video, ...settings } = old.settings;
    void _pipeline; void _video;
    const doc = projectDocSchema.parse({ ...old, settings: { ...settings, modelId: "text-model" } });
    expect(doc.settings.visualPipeline).toBe("image");
    expect(doc.settings.modelId).toBe("text-model");
    expect(doc.settings.video).toEqual({ modelId: "autodl::minimax_h3_zm_u08", referenceImageModelId: "", resolution: "768p", autoContinue: false });
  });

  it("uses real TTS pauses and lead/tail, hard cuts, and no image choreography", () => {
    const { doc, art } = fixture([3000, 4000, 2000]);
    doc.lines[0].pauseAfterMs = 650;
    doc.shots[0].focusText = { text: "重点", layoutMode: "auto", presetId: "focus" };
    const timeline = buildTimeline(doc, art, "16:9");
    expect(timeline.durationMs).toBe(500 + 3000 + 650 + 4000 + 250 + 2000 + 1500);
    expect(timeline.shots[0]).toMatchObject({ kind: "video", mode: "generate", motion: "none", transitionIn: "cut", overlapInFrames: 0, overlapOutFrames: 0, focusText: { text: "重点" } });
    expect(videoShotTiming(doc, doc.shots[0], timeline)).toMatchObject({ targetDurationMs: 4150, requestDurationSeconds: 5, ready: true });
    expect(videoShotTiming(doc, doc.shots[2], timeline).targetDurationMs).toBe(3500);
    art.tts.delete(doc.lines[1].id);
    expect(videoShotTiming(doc, doc.shots[1], buildTimeline(doc, art, "16:9"))).toMatchObject({ ready: false, reason: "missing-tts" });
  });

  it("retains natural gaps from real paragraph TTS", () => {
    const { doc, art } = fixture([2000, 2000]);
    for (const [index, item] of doc.lines.entries()) art.tts.get(item.id)!.block = {
      key: "block", index, count: 2, gapAfterMs: 875, confidence: 1, splitSource: "provider", blockAssetId: "block-audio",
    };
    expect(videoShotTiming(doc, doc.shots[0], buildTimeline(doc, art, "16:9")).targetDurationMs).toBe(500 + 2000 + 875);
  });

  it("accepts exactly 15s and splits longer intervals without changing narration duration", () => {
    const exact = fixture([13000]);
    expect(videoShotTiming(exact.doc, exact.doc.shots[0], buildTimeline(exact.doc, exact.art, "16:9"))).toMatchObject({ targetDurationMs: 15000, requestDurationSeconds: 15, ready: true });
    const { doc, art } = fixture([24000]);
    const original = buildTimeline(doc, art, "16:9");
    const times = new Map(layoutLines(doc.lines, art).lines.map((item) => [item.id, item]));
    let id = 0;
    const split = normalizeVideoShots(doc.shots, doc.lines, times, original.durationMs, () => `split${++id}`);
    doc.shots = split;
    const timeline = buildTimeline(doc, art, "16:9");
    expect(split.length).toBeGreaterThan(1);
    expect(split.every((shot) => shot.groupId === "group")).toBe(true);
    expect(timeline.durationMs).toBe(original.durationMs);
    expect(timeline.shots.every((shot) => shot.endMs - shot.startMs <= 15000)).toBe(true);
    expect(split[1].sourceImageAssetId).toBeUndefined();
    const locked = { ...split[0], locked: true };
    expect(normalizeVideoShots([locked], doc.lines, times, original.durationMs, () => "unused")).toEqual([locked]);
    doc.shots = [locked];
    expect(videoShotTiming(doc, locked, buildTimeline(doc, art, "16:9"))).toMatchObject({ ready: false, reason: "duration-out-of-range" });
  });

  it("separates source confirmation from dynamic/video fingerprints and preserves local independence", () => {
    const { doc, art } = fixture();
    const before = buildTimeline(doc, art, "16:9");
    const source = sourceImageSnapshot(doc, doc.shots[1], frame);
    doc.shots[1].sourceImageConfirmedHash = source.hash;
    const snapshots = doc.shots.map((shot) => videoGenerationSnapshot(doc, shot, before, frame));
    doc.shots[1].videoPlan!.action = "The subject slowly turns away";
    const after = buildTimeline(doc, art, "16:9");
    expect(sourceImageConfirmed(doc, doc.shots[1], frame)).toBe(true);
    expect(videoGenerationSnapshot(doc, doc.shots[1], after, frame).hash).not.toBe(snapshots[1].hash);
    expect(videoGenerationSnapshot(doc, doc.shots[0], after, frame).hash).toBe(snapshots[0].hash);
    expect(videoGenerationSnapshot(doc, doc.shots[2], after, frame).hash).toBe(snapshots[2].hash);
    doc.shots[1].sourceImageAssetId = "chosen-image";
    expect(sourceImageConfirmed(doc, doc.shots[1], frame)).toBe(false);
    doc.shots[1].sourceImagePromptHash = "unknown";
    expect(sourceImageStale(doc, doc.shots[1], frame)).toBe(false);
    doc.shots[1].videoPlan!.startState = "The subject sits in a chair";
    expect(sourceImageSnapshot(doc, doc.shots[1], frame).promptHash).not.toBe(source.promptHash);
  });

  it("uses stable TTS asset identity across browser/render URLs, and actual duration changes expire video", () => {
    const { doc, art } = fixture();
    const shot = doc.shots[1];
    const current = videoGenerationSnapshot(doc, shot, buildTimeline(doc, art, "16:9"), frame);
    expect(videoGenerationSnapshot(doc, shot, buildTimeline(doc, { ...art, media: (id) => `http://localhost/${id}` }, "16:9"), frame, { prompt: "compiled text" }).hash).toBe(current.hash);
    shot.groupId = "new-group";
    shot.focusText = { text: "叠加文字", layoutMode: "manual", presetId: "focus" };
    doc.settings.subtitle.fontSize += 4;
    expect(videoGenerationSnapshot(doc, shot, buildTimeline(doc, art, "16:9"), frame).hash).toBe(current.hash);
    art.tts.set(doc.lines[1].id, tts(doc.lines[1].text, 3100));
    expect(videoGenerationSnapshot(doc, shot, buildTimeline(doc, art, "16:9"), frame).hash).not.toBe(current.hash);
  });

  it("keeps uploaded refs while excluding stale auto portraits", () => {
    const { doc } = fixture();
    const card = characterCardSchema.parse({ id: "person", referenceAssetIds: ["uploaded"], sheet: { portraitAssetId: "auto", turnaroundAssetIds: ["turnaround"] } });
    card.sheet.sourceHash = sheetSourceHash(card, doc.visualStyle);
    doc.characters = [card];
    doc.shots[0].characterIds = [card.id];
    expect(videoReferenceIds(doc, doc.shots[0])).toEqual(["uploaded", "auto", "turnaround"]);
    card.hair = "long hair";
    expect(videoReferenceIds(doc, doc.shots[0])).toEqual(["uploaded"]);
  });

  it("trims excess and holds at most 100ms; larger shortfall stays unready", () => {
    expect(videoPlayback(5000, { durationMs: 6000, fps: 24 })).toMatchObject({ videoPlayableDurationMs: 5000, videoHoldLastFrameMs: 0, videoSourceFps: 24, videoDurationReady: true });
    expect(videoPlayback(5000, { durationMs: 4900 })).toMatchObject({ videoPlayableDurationMs: 4900, videoHoldLastFrameMs: 100, videoDurationReady: true });
    expect(videoPlayback(5000, { durationMs: 4899 })).toMatchObject({ videoHoldLastFrameMs: 0, videoDurationReady: false });
    expect(videoPlayback(5000)).toMatchObject({ videoDurationReady: false });
    const { doc, art } = fixture([3000]);
    doc.shots[0].assetId = "video";
    art.videos = new Map([["video", { durationMs: 4950, fps: 24 }]]);
    expect(buildTimeline(doc, art, "16:9").shots[0]).toMatchObject({ videoSourceDurationMs: 4950, videoPlayableDurationMs: 4950, videoHoldLastFrameMs: 50, videoDurationReady: true });
  });

  it("old video candidates recover their own provenance and unknown cannot impersonate current output", () => {
    const { doc, art } = fixture();
    const shot = doc.shots[0];
    const timeline = buildTimeline(doc, art, "16:9");
    const hash = videoGenerationSnapshot(doc, shot, timeline, frame).hash;
    shot.candidates = [
      { id: "new", assetId: "new-video", selected: false, kind: "video", promptHash: hash, generationPromptHash: hash },
      { id: "old", assetId: "old-video", selected: false, kind: "video", promptHash: "old", generationPromptHash: "old" },
      { id: "unknown", assetId: "unknown-video", selected: false, kind: "video" },
    ];
    const fresh = selectShotCandidate(shot, "new", { aspect: "16:9", framing: "shared" })!;
    expect(videoAssetStale(doc, fresh, timeline, frame)).toBe(false);
    const old = selectShotCandidate(fresh, "old", { aspect: "16:9", framing: "shared" })!;
    expect(old.assetVariants["16:9"]?.promptHash).toBe("old");
    expect(videoAssetStale(doc, old, timeline, frame)).toBe(true);
    const unknown = selectShotCandidate(fresh, "unknown", { aspect: "16:9", framing: "shared" })!;
    expect(unknown.assetVariants["16:9"]?.promptHash).toBe("unknown");
    expect(videoAssetStale(doc, unknown, timeline, frame)).toBe(true);
  });

  it("video cost settings invalidate setup confirmation and apply only in the explicit preset group", () => {
    const { doc } = fixture();
    const confirmed = setupFingerprint(doc.settings);
    for (const changed of [
      { ...doc.settings, visualPipeline: "image" as const },
      { ...doc.settings, video: { ...doc.settings.video, autoContinue: true } },
      { ...doc.settings, video: { ...doc.settings.video, resolution: "480p" as const } },
      { ...doc.settings, video: { ...doc.settings.video, referenceImageModelId: "other" } },
    ]) expect(setupConfirmationMatches(confirmed, changed)).toBe(false);
    const payload = extractPresetPayload(doc);
    const target = emptyDoc();
    expect(applyPresetToDoc(target, payload, { groups: ["output"] }).doc.settings.visualPipeline).toBe("image");
    expect(applyPresetToDoc(target, payload, { groups: ["video"] }).doc.settings.visualPipeline).toBe("video");
  });
});
