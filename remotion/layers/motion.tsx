import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { Motion as MotionKind } from "@/lib/core/types";

/** 运镜：推、拉、左右摇。静态画面也要动起来 */
export function Motion({ kind, durationInFrames, children, origin = "50% 50%" }: { kind: MotionKind; durationInFrames: number; children: ReactNode; origin?: string }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, Math.max(1, durationInFrames)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  let transform = "none";
  if (kind === "zoom-in") transform = `scale(${1.04 + 0.1 * p})`;
  else if (kind === "zoom-out") transform = `scale(${1.14 - 0.1 * p})`;
  else if (kind === "pan-left") transform = `scale(1.14) translateX(${4 - 8 * p}%)`;
  else if (kind === "pan-right") transform = `scale(1.14) translateX(${-4 + 8 * p}%)`;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform, transformOrigin: origin, willChange: "transform" }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
}
