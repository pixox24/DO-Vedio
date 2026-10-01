import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { Motion as MotionKind } from "@/lib/core/types";
import { easingFn, motionStrength, useMotion } from "./anim";

/**
 * 运镜：推、拉、左右摇。静态画面也要动起来。
 *
 * 幅度和缓动来自风格卡的 motion 参数：水墨推得慢而轻，几何平面推得快而狠。
 */
export function Motion({ kind, durationInFrames, children, origin = "50% 50%" }: { kind: MotionKind; durationInFrames: number; children: ReactNode; origin?: string }) {
  const frame = useCurrentFrame();
  const profile = useMotion();
  const { pan, zoom } = motionStrength(profile);
  const p = interpolate(frame, [0, Math.max(1, durationInFrames)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    // 运镜本身保持近匀速（真实的推轨不会突然加速），只在收尾略作缓和
    easing: profile.easing === "stepped" ? easingFn("linear") : easingFn("cinematic"),
  });
  let transform = "none";
  if (kind === "zoom-in") transform = `scale(${1.04 + zoom * p})`;
  else if (kind === "zoom-out") transform = `scale(${1.04 + zoom * (1 - p)})`;
  else if (kind === "pan-left") transform = `scale(${1.04 + zoom}) translateX(${pan - 2 * pan * p}%)`;
  else if (kind === "pan-right") transform = `scale(${1.04 + zoom}) translateX(${-pan + 2 * pan * p}%)`;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform, transformOrigin: origin, willChange: "transform" }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
}
