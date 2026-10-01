import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { CSSProperties } from "react";
import { useMotion } from "../layers/anim";

export type TransitionKind = "cut" | "fade" | "wipe" | "whip" | "push" | "dissolve";

type Props = {
  children: React.ReactNode;
  durationInFrames: number;
  transitionIn?: TransitionKind;
  transitionOut?: TransitionKind;
  overlapInFrames?: number;
  overlapOutFrames?: number;
};

/** 重叠式转场：只在相邻 Sequence 同时存活的帧里改变画面，不改变时间轴时钟。 */
export function TransitionLayer({ children, durationInFrames, transitionIn = "cut", transitionOut = "cut", overlapInFrames = 0, overlapOutFrames = 0 }: Props) {
  const frame = useCurrentFrame();
  const profile = useMotion();
  const entering = transitionIn !== "cut" && overlapInFrames > 0 && frame < overlapInFrames;
  const exiting = transitionOut !== "cut" && overlapOutFrames > 0 && frame >= durationInFrames - overlapOutFrames;
  const inProgress = entering ? interpolate(frame, [0, overlapInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const outProgress = exiting ? interpolate(frame, [durationInFrames - overlapOutFrames, durationInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  const kind = entering ? transitionIn : exiting ? transitionOut : "cut";
  const style = transitionStyle(kind, inProgress, outProgress, profile.enterFrom, profile.texture);
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
}

function transitionStyle(kind: TransitionKind, entering: number, exiting: number, enterFrom: "below" | "side" | "scale" | "none", texture: "none" | "grain" | "paper" | "scanline"): CSSProperties {
  if (kind === "fade") return { opacity: entering * (1 - exiting) };
  if (kind === "dissolve") {
    const p = entering < 1 ? entering : 1 - exiting;
    return {
      opacity: 1 - exiting,
      clipPath: `inset(${(1 - p) * 100}% 0 0 0)`,
      backgroundImage: "radial-gradient(rgba(255,255,255,.24) 0.8px, transparent 1px)",
      backgroundSize: `${Math.max(2, Math.round(8 - p * 5))}px ${Math.max(2, Math.round(8 - p * 5))}px`,
      mixBlendMode: "screen" as CSSProperties["mixBlendMode"],
    };
  }
  if (kind === "wipe") {
    const p = exiting > 0 ? 1 - exiting : entering;
    const direction = enterFrom === "side" ? "right" : enterFrom === "below" ? "bottom" : "left";
    const inset = direction === "right" ? `0 ${(1 - p) * 100}% 0 0` : direction === "bottom" ? `0 0 ${(1 - p) * 100}% 0` : `0 0 0 ${(1 - p) * 100}%`;
    return {
      opacity: 1 - exiting,
      clipPath: `inset(${inset})`,
      backgroundImage: texture === "none" ? undefined : `linear-gradient(${direction === "bottom" ? "0deg" : "90deg"}, transparent 0 46%, rgba(255,255,255,.3) 49%, rgba(120,220,255,.22) 51%, transparent 54%)`,
      backgroundSize: direction === "bottom" ? "100% 180%" : "180% 100%",
      backgroundPosition: `${p * 100}% ${p * 100}%`,
    };
  }
  if (kind === "whip") {
    const p = entering < 1 ? 1 - entering : exiting;
    const sign = enterFrom === "side" ? 1 : -1;
    return { opacity: 1 - exiting, transform: `translateX(${sign * p * 14}%)`, filter: `blur(${p * 7}px) hue-rotate(${texture === "none" ? 0 : p * 12}deg)` };
  }
  if (kind === "push") {
    const p = entering < 1 ? 1 - entering : exiting;
    const axis = enterFrom === "below" ? "Y" : "X";
    const sign = enterFrom === "below" ? 1 : -1;
    return { transform: `translate${axis}(${sign * p * 100}%)`, opacity: 1 - exiting };
  }
  return {};
}
