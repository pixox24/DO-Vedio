import type { Timeline } from "./timeline";

/** 样片和成片都按时间轴上的输出规格出片，不再缩分辨率，也不再截成固定 3 秒。 */
export const renderEncode = { crf: 18, scale: 1, jpegQuality: 92, x264Preset: "medium" as const };

/** Remotion 合成的时长和像素。调用方传入的是已经按输出规格排好的时间轴。 */
export function videoCompositionMetadata(timeline: Pick<Timeline, "durationInFrames" | "fps" | "width" | "height">) {
  return {
    durationInFrames: Math.max(1, Math.round(timeline.durationInFrames)),
    fps: timeline.fps,
    width: timeline.width,
    height: timeline.height,
  };
}
