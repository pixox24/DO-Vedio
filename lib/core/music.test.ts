import { describe, expect, it } from "vitest";
import { coverWithTrack, retargetMusic } from "./music";
import type { MusicCue } from "./types";

const lines = [{ id: "a" }, { id: "b" }, { id: "c" }];
const cue = (trackId: string, fromLineId: string, toLineId: string, offsetMs = 0): MusicCue => ({ trackId, fromLineId, toLineId, offsetMs, locked: true });

describe("一首配乐铺满全片", () => {
  it("铺到第一句和最后一句", () => {
    expect(coverWithTrack(lines, "初遇.mp3", 1200)).toEqual([cue("初遇.mp3", "a", "c", 1200)]);
  });

  it("没有句子或不选曲时为空", () => {
    expect(coverWithTrack([], "初遇.mp3")).toEqual([]);
    expect(coverWithTrack(lines, "")).toEqual([]);
  });

  it("句子换过之后仍用原来那首，并重新铺满", () => {
    const next = retargetMusic([cue("warm.mp3", "a", "gone"), cue("other.mp3", "x", "y")], [{ id: "a" }, { id: "d" }]);
    expect(next).toEqual([cue("warm.mp3", "a", "d")]);
  });

  it("本来没选曲，重排后仍然没有", () => {
    expect(retargetMusic([], lines)).toEqual([]);
  });
});
