import type { VisualStyle } from "./types";

/** Remotion 代码画面的主题：由项目的视觉风格卡派生，让信息卡和生成画面色调统一 */
export type VideoTheme = {
  accent: string;
  ink: string;
  text: string;
  sub: string;
  /** 渐变配色池 [深, 中, 浅]，按镜头 seed 取 */
  palettes: [string, string, string][];
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
};

export function themeOf(style: Pick<VisualStyle, "palette"> | null | undefined): VideoTheme {
  if (!style) return defaultTheme;
  return { ...defaultTheme, accent: style.palette.accent, palettes: style.palette.schemes.map((s) => [...s] as [string, string, string]) };
}
