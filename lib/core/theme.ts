import { defaultMotionProfile, type MotionProfile } from "./motion";
import type { VisualStyle } from "./types";

/** Remotion 代码画面的主题：由项目的视觉风格卡派生，让信息卡和生成画面色调统一 */
export type VideoTheme = {
  accent: string;
  ink: string;
  text: string;
  sub: string;
  /** 渐变配色池 [深, 中, 浅]，按镜头 seed 取 */
  palettes: [string, string, string][];
  /** 动效：缓动、幅度、入场方向、纹理。换风格时连同画面节奏一起换 */
  motion: MotionProfile;
};

export const defaultTheme: VideoTheme = {
  accent: "#cdff3a",
  ink: "#07080a",
  text: "#f4f4f5",
  sub: "rgba(244,244,245,0.62)",
  palettes: [
    ["#173653", "#24728a", "#8bd4d7"],
    ["#40254f", "#975179", "#e4a4a4"],
    ["#123f3e", "#358873", "#bee2ad"],
    ["#56401f", "#ba8535", "#f5d58d"],
    ["#273d58", "#507eb0", "#b7d7ef"],
    ["#5a283d", "#b75269", "#efb4a3"],
  ],
  motion: defaultMotionProfile,
};

const lum = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/**
 * 卡片正文用色随底色明暗翻转。风格卡的 palettes 深浅不一，
 * 只用一套白字会在浅色风格（米白、纸白、朱日禅意）上糊成一片。
 */
function inkFor(schemes: [string, string, string][]) {
  const avg = schemes.reduce((a, s) => a + lum(s[0]), 0) / Math.max(1, schemes.length);
  return avg < 0.5
    ? { text: "#f6f7f8", sub: "rgba(246,247,248,0.66)" }
    : { text: "#14161a", sub: "rgba(20,22,26,0.62)" };
}

export function themeOf(style: Pick<VisualStyle, "palette" | "motion"> | null | undefined): VideoTheme {
  if (!style) return defaultTheme;
  const palettes = style.palette.schemes.map((s) => [...s] as [string, string, string]);
  return { ...defaultTheme, accent: style.palette.accent, palettes, motion: style.motion, ...inkFor(palettes) };
}
