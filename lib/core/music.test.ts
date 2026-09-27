import { describe, expect, it } from "vitest";
import { moodSpans, pickMusic } from "./music";
import type { Line } from "./types";

const L = (id: string, mood?: Line["mood"]): Line => ({ id, segmentIndex: 0, text: "x", spans: [], keywords: [], locked: false, mood });
const tracks = [
  { id: "epic", title: "", assetId: "", durationMs: 200000, moods: ["史诗", "激昂"], loopable: true },
  { id: "warm", title: "", assetId: "", durationMs: 200000, moods: ["温暖", "轻松"], loopable: true },
  { id: "dark", title: "", assetId: "", durationMs: 200000, moods: ["悬疑", "忧伤"], loopable: true },
];

describe("选曲", () => {
  it("相同情绪合并、短片段并入相邻段", () => {
    const lines = [L("a", "悬疑"), L("b", "悬疑"), L("c", "温暖"), L("d", "悬疑"), L("e", "激昂"), L("f", "激昂")];
    const spans = moodSpans(lines, [15000, 15000, 3000, 10000, 20000, 20000]);
    expect(spans.map((s) => s.mood)).toEqual(["悬疑", "激昂"]);
    expect(spans[0]).toMatchObject({ from: 0, to: 3 });
  });

  it("短视频不会频繁换曲", () => {
    const lines = ["悬疑", "轻松", "中性", "轻松", "温暖", "中性", "温暖", "轻松"].map((m, k) => L(`l${k}`, m as Line["mood"]));
    const spans = moodSpans(lines, lines.map(() => 4000));
    expect(spans.length).toBe(1);
  });

  it("按情绪选曲，相邻不重复，锁定保持", () => {
    const lines = [L("a", "悬疑"), L("b", "激昂"), L("c", "温暖")];
    const cues = pickMusic(lines, [30000, 30000, 30000], tracks);
    expect(cues.map((c) => c.trackId)).toEqual(["dark", "epic", "warm"]);
    const locked = pickMusic(lines, [30000, 30000, 30000], tracks, [{ ...cues[0], trackId: "warm", locked: true }]);
    expect(locked[0].trackId).toBe("warm");
    expect(locked[1].trackId).not.toBe("warm");
  });
});
