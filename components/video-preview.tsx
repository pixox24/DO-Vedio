"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { forwardRef, useImperativeHandle, useRef } from "react";
import type { Timeline } from "@/lib/core/timeline";
import { Video } from "@/remotion/video";

export type VideoPreviewHandle = { seekToMs: (ms: number) => void; togglePlayPause: () => void; isPlaying: () => boolean; currentMs: () => number };

/** 浏览器预览：与最终渲染同一套 Remotion 组件、同一份时间轴 */
export const VideoPreview = forwardRef<VideoPreviewHandle, { timeline: Timeline }>(function VideoPreview({ timeline }, ref) {
  const playerRef = useRef<PlayerRef>(null);
  useImperativeHandle(ref, () => ({
    seekToMs: (ms) => playerRef.current?.seekTo(Math.max(0, Math.round((ms / 1000) * timeline.fps))),
    togglePlayPause: () => { if (playerRef.current?.isPlaying()) playerRef.current.pause(); else playerRef.current?.play(); },
    isPlaying: () => Boolean(playerRef.current?.isPlaying()),
    currentMs: () => (playerRef.current?.getCurrentFrame() ?? 0) * 1000 / timeline.fps,
  }), [timeline.fps]);
  return (
    <Player
      ref={playerRef}
      component={Video}
      inputProps={{ timeline }}
      durationInFrames={timeline.durationInFrames}
      compositionWidth={timeline.width}
      compositionHeight={timeline.height}
      fps={timeline.fps}
      controls
      acknowledgeRemotionLicense
      style={{ width: "100%", aspectRatio: `${timeline.width} / ${timeline.height}`, borderRadius: 16, overflow: "hidden", background: "#000" }}
    />
  );
});
