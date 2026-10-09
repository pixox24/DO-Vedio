import { describe, expect, it } from "vitest";
import { outputSpecs } from "./types";
import { renderEncode, videoCompositionMetadata } from "./video-composition";

describe("视频合成规格", () => {
  it("时长和像素跟随时间轴，样片不再缩小", () => {
    const landscape = videoCompositionMetadata({ durationInFrames: 3021, fps: 30, width: outputSpecs["landscape-1080p"].width, height: outputSpecs["landscape-1080p"].height });
    expect(landscape).toEqual({ durationInFrames: 3021, fps: 30, width: 1920, height: 1080 });
    const portrait = videoCompositionMetadata({ durationInFrames: 90.2, fps: outputSpecs["portrait-1080p"].fps, width: outputSpecs["portrait-1080p"].width, height: outputSpecs["portrait-1080p"].height });
    expect(portrait).toEqual({ durationInFrames: 90, fps: 30, width: 1080, height: 1920 });
    expect(renderEncode.scale).toBe(1);
  });
});
