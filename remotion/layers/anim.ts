import { Easing, interpolate, random } from "remotion";
import { cornerRadius, type EasingName, type MotionProfile } from "@/lib/core/motion";
import { useTheme } from "../theme";

/**
 * 动效基元 —— 把风格卡里的 motion 参数翻译成每帧可用的数值。
 *
 * 所有镜头层都从这里取缓动和幅度，不再各自写裸 interpolate：
 * 换一张 Aix 风格，画面的节奏、入场方向和幅度会跟着一起换。
 */

/** preset 的缓动名 → Remotion 缓动函数。step 类用 posterize 另做 */
export function easingFn(name: EasingName) {
  switch (name) {
    case "linear":
      return Easing.linear;
    case "expo":
      return Easing.out(Easing.exp);
    case "cinematic":
      return Easing.inOut(Easing.cubic);
    case "elastic":
      return Easing.out(Easing.back(1.4));
    case "mechanical":
      return Easing.out(Easing.poly(4));
    case "stepped":
      // 跳帧感由 posterize 实现，缓动本身保持线性
      return Easing.linear;
    case "smooth":
    default:
      return Easing.out(Easing.cubic);
  }
}

/** 0–1 的进度：带风格缓动，跳帧风格按区间长度量化成台阶 */
export function useProgress(durationInFrames: number, profile: MotionProfile, from = 0, to = durationInFrames) {
  const ease = easeAt(profile);
  return (frame: number) => ease(frame, [from, to]);
}

/**
 * 把风格缓动包成 interpolate 的简写。
 * 跳帧风格（像素、丝网印刷）用 posterize 把区间切成台阶，
 * 得到逐帧跳动的观感，而不是平滑插值。
 */
export function easeAt(profile: MotionProfile) {
  const easing = easingFn(profile.easing);
  return (frame: number, range: [number, number]) => {
    const span = Math.max(1, range[1] - range[0]);
    return interpolate(frame, range, [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing,
      posterize: profile.easing === "stepped" ? Math.max(2, Math.round(span / 6)) : undefined,
    });
  };
}

/** 入场进度：镜头开始的 0–1，带风格缓动。能量越高，入场越快 */
export function enterProgress(frame: number, profile: MotionProfile, frames = 18) {
  const span = Math.max(6, Math.round(frames * (1.5 - profile.energy * 0.5)));
  return easeAt(profile)(frame, [0, span]);
}

/** 逐项入场：第 index 项的延迟，由 preset 的节奏决定 */
export function staggerDelay(profile: MotionProfile, index: number, base = 5) {
  return Math.round(index * base * (1.4 - profile.energy * 0.5));
}

/** 元素入场方向 → 位移偏移（未乘 u 的比例，-1..1） */
export function enterOffset(profile: MotionProfile, progress: number) {
  const travel = 1 - progress;
  switch (profile.enterFrom) {
    case "side":
      return { x: travel * 6 * profile.energy, y: 0, scale: 1 };
    case "scale":
      return { x: 0, y: 0, scale: 1 - travel * 0.06 * profile.energy };
    case "none":
      return { x: 0, y: 0, scale: 1 };
    case "below":
    default:
      return { x: 0, y: travel * 5 * profile.energy, scale: 1 };
  }
}

/** 镜头内的运镜强度：由风格能量决定，punchy 风格幅度更大 */
export function motionStrength(profile: MotionProfile) {
  return { pan: 4 * profile.energy, zoom: 0.1 * profile.energy };
}

/** 当前主题的动效参数；所有渲染层统一从这里取 */
export function useMotion() {
  return useTheme().motion;
}

/** 卡片与图形的圆角（按 u 折算） */
export function useCorner(u: number) {
  return cornerRadius(useTheme().motion.corner, u);
}

/**
 * 纹理叠层的确定性噪点种子。
 * Remotion 的 random 是纯函数，同一 frame + seed 在任何机器上一致，
 * 所以预览和最终渲染逐帧相同。
 */
export function grainOpacity(frame: number, seed: number, amount = 0.05) {
  return random(`grain-${seed}-${Math.floor(frame / 2)}`) * amount;
}
