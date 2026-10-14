import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Freeze, OffthreadVideo } from "remotion";
import type { TimelineShot } from "@/lib/core/timeline";
import { FocusTextShot, isFocusTextShot } from "../animation/focus-text";
import { VideoShot, videoPlaybackFrames } from "./video";

vi.mock("remotion", async (original) => ({
  ...await original<typeof import("remotion")>(),
  useCurrentFrame: () => 30,
  useVideoConfig: () => ({ fps: 30, width: 640, height: 360 }),
}));

const shot = {
  shotId: "video", kind: "video", mode: "generate", startMs: 0, endMs: 3050,
  motion: "zoom-in", caption: "", keywords: [], description: "", seed: 1,
  card: { variant: "headline" }, videoSrc: "fixture.mp4",
  videoTrimStartMs: 0, videoPlayableDurationMs: 3000, videoHoldLastFrameMs: 50,
  videoSourceDurationMs: 3000, videoSourceFps: 24, videoDurationReady: true,
  focusText: { text: "重点", presetId: "focus", layoutMode: "auto" },
} satisfies TimelineShot;

describe("AI video playback", () => {
  it("holds the actual final 24 fps source frame on a 30 fps timeline", () => {
    const frames = videoPlaybackFrames(shot, 30);
    expect(frames.hold).toBe(true);
    expect(frames.holdFrom).toBe(90);
    expect(frames.freezeFrame).toBeCloseTo(88.75);
    expect(frames.freezeFrame / 30).toBeCloseTo(71 / 24);
  });

  it("quantizes trims in composition fps, including the freeze seek offset", () => {
    const frames = videoPlaybackFrames({ ...shot, videoTrimStartMs: 500 }, 30);
    expect(frames.trimBefore).toBe(15);
    expect(frames.freezeFrame).toBeCloseTo(73.75);
  });

  it("never extends missing, rejected or over-100ms durations", () => {
    for (const override of [{ videoHoldLastFrameMs: 101 }, { videoDurationReady: false }, { videoHoldLastFrameMs: 0 }]) {
      expect(videoPlaybackFrames({ ...shot, ...override }, 30).hold).toBe(false);
    }
    expect(videoPlaybackFrames({ ...shot, videoSourceFps: undefined }, 30).freezeFrame).toBe(89);
  });

  it("uses only muted natural-speed video, without looping or image Motion", () => {
    const view = VideoShot({ shot, durationInFrames: 92 });
    const media = view.props.children[0];
    expect(media.type).toBe(Freeze);
    expect(media.props.children.type).toBe(OffthreadVideo);
    expect(media.props.children.props.muted).toBe(true);
    expect(media.props.children.props.loop).toBeUndefined();
    expect(media.props.children.props.playbackRate).toBeUndefined();
    expect(media.props.children.props.style.transform).toBeUndefined();
  });

  it("keeps the video routing and overlays existing focus typography transparently", () => {
    expect(isFocusTextShot({ ...shot, mode: "motion" })).toBe(false);
    const overlay = renderToStaticMarkup(createElement(FocusTextShot, { shot, durationInFrames: 92, overlay: true }));
    const card = renderToStaticMarkup(createElement(FocusTextShot, { shot, durationInFrames: 92 }));
    expect(overlay).toContain("background:transparent");
    expect(overlay).toContain("重");
    expect(overlay).not.toContain("background:#101312");
    expect(card).toContain("background:#101312");
  });
});
