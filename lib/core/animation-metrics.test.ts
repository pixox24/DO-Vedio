import { describe, expect, it } from "vitest";
import { animationMetrics } from "./animation-metrics";
import { DEFAULT_SUBTITLE_CONFIG } from "./subtitle";
import type { Timeline } from "./timeline";
import { defaultTheme } from "./theme";

const timeline = (family: "stat" | "kinetic" = "stat"): Timeline => ({
  outputSpecId: "landscape-1080p", fps: 30, width: 1920, height: 1080, aspect: "16:9", durationMs: 2000, durationInFrames: 60,
  title: "metrics", theme: defaultTheme, voice: [], lines: [], cues: [], subtitleBlocks: [], music: [], sfx: [], subtitle: { ...DEFAULT_SUBTITLE_CONFIG, highlight: false }, aiLabel: { enabled: true, position: "top-right" }, issues: [],
  shots: [{ shotId: "s1", kind: "placeholder", startMs: 0, endMs: 2000, motion: "none", description: "", caption: "增长达到 42%", keywords: [], seed: 1, mode: "motion", card: { variant: family === "stat" ? "stat" : "headline", headline: "增长达到 42%", stat: family === "stat" ? { value: "42%", label: "增长" } : undefined }, animation: { family, intensity: 2, anchors: [], params: {} }, safeArea: { bottomRatio: 0.1, sideRatio: 0.04 } }],
});

describe("animationMetrics", () => {
  it("tracks stat provenance and repeated visible text", () => {
    const metrics = animationMetrics(timeline());
    expect(metrics.statTraceRate).toBe(1);
    expect(metrics.duplicateTextShots).toEqual(["s1"]);
    expect(metrics.familyEntropy).toBe(0);
  });

  it("does not require stat provenance for non-stat families", () => {
    const metrics = animationMetrics(timeline("kinetic"));
    expect(metrics.statTraceRate).toBe(1);
  });
});
