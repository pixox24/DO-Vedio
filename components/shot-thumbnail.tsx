"use client";

import { useEffect, useRef, useState } from "react";
import { Player } from "@remotion/player";
import type { TimelineShot } from "@/lib/core/timeline";
import type { VideoTheme } from "@/lib/core/theme";
import { ShotView } from "@/remotion/video";

export function ShotThumbnail({ shot, width, height, fps, theme }: { shot: TimelineShot; width: number; height: number; fps: number; theme?: VideoTheme }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "180px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className="h-full w-full bg-[#17242c]">
    {visible ? <Player component={ShotView} inputProps={{ shot, theme, durationInFrames: Math.max(24, Math.round((shot.endMs - shot.startMs) / 1000 * fps)) }} durationInFrames={Math.max(24, Math.round((shot.endMs - shot.startMs) / 1000 * fps))} compositionWidth={width} compositionHeight={height} fps={fps} acknowledgeRemotionLicense autoPlay loop style={{ width: "100%", height: "100%" }} /> : <div className="grid h-full place-items-center text-xs text-white/35">正在加载预览</div>}
  </div>;
}
