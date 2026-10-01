import { describe, expect, it } from "vitest";
import { defaultMotionProfile, motionProfile } from "./motion";
import { choreograph } from "./choreography";
import type { Line, Shot } from "./types";

const lines: Line[] = [
  { id: "a", segmentIndex: 0, text: "紧张的数据", keywords: [], mood: "紧张", spans: [], locked: false },
  { id: "b", segmentIndex: 1, text: "温暖的结尾", keywords: [], mood: "温暖", spans: [], locked: false },
];
const times = new Map([
  ["a", { id: "a", startMs: 0, endMs: 1000, chars: [] }],
  ["b", { id: "b", startMs: 1000, endMs: 2000, chars: [] }],
]);
const shot = (id: string, lineId: string): Shot => ({
  id, at: { lineId, char: 0 }, kind: "placeholder", mode: "motion", motion: "none", description: "", sourceHash: "", locked: false,
  characterIds: [], referenceAssetIds: [], assetVariants: {}, candidates: [], importance: 2,
  card: { variant: "headline", headline: id }, animation: { family: "editorial", intensity: 2, anchors: [], params: {} },
});

describe("choreograph", () => {
  it("raises tense chapter openings and leaves warm beats quiet", () => {
    const result = choreograph([shot("a", "a"), shot("b", "b")], lines, times, motionProfile("geometric-editorial"));
    expect(result[0].animation?.intensity).toBe(3);
    expect(result[1].animation?.intensity).toBe(1);
    expect(result[1].transitionIn).toBe("whip");
  });

  it("uses a light transition for non-chapter family changes", () => {
    const same = lines.map((line) => ({ ...line, segmentIndex: 0 }));
    const result = choreograph([shot("a", "a"), shot("b", "b")], same, times, defaultMotionProfile);
    expect(result[1].transitionIn).toBe("fade");
  });
});
