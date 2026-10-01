import { z } from "zod";

/**
 * 动效预设 —— 纯数据，被风格卡、Remotion 渲染层和测试共用。
 *
 * preset 是封闭枚举而不是自由维度组合：8 个动效维度的笛卡尔积会产生大量
 * 「能跑但很丑」的风格（锐利几何 + 弹性缓动 + 纸张纹理）。先收敛成十几个
 * 校准过的组合，再留少量字段给风格卡和用户做微调。
 */

export const easingNames = ["linear", "smooth", "expo", "cinematic", "elastic", "mechanical", "stepped"] as const;
export type EasingName = (typeof easingNames)[number];

export const easingLabels: Record<EasingName, string> = {
  linear: "匀速",
  smooth: "平滑",
  expo: "急促收尾",
  cinematic: "电影感",
  elastic: "回弹",
  mechanical: "机械",
  stepped: "跳帧",
};

export const motionPresetIds = [
  "editorial-restrained",
  "documentary-observant",
  "geometric-editorial",
  "ink-bleed",
  "clay-stopmotion",
  "neon-hud",
  "cel-animation",
  "comic-panel",
  "painterly-soft",
  "print-halftone",
  "pixel-step",
  "concept-render",
] as const;
export type MotionPresetId = (typeof motionPresetIds)[number];

export const motionPresetLabels: Record<MotionPresetId, string> = {
  "editorial-restrained": "克制编辑",
  "documentary-observant": "纪录观察",
  "geometric-editorial": "几何平面",
  "ink-bleed": "水墨晕染",
  "clay-stopmotion": "定格手作",
  "neon-hud": "霓虹界面",
  "cel-animation": "赛璐璐动画",
  "comic-panel": "漫画分格",
  "painterly-soft": "绘画柔缓",
  "print-halftone": "丝网印刷",
  "pixel-step": "像素跳帧",
  "concept-render": "概念渲染",
};

export const motionProfileSchema = z.object({
  preset: z.enum(motionPresetIds).default("editorial-restrained"),
  easing: z.enum(easingNames).default("smooth"),
  /** 位移与缩放幅度系数：水墨慢而沉，像素快而跳 */
  energy: z.number().min(0.3).max(2).default(0.85),
  /** 入场时的位移方向偏好 */
  enterFrom: z.enum(["below", "side", "scale", "none"]).default("below"),
  /** 相邻镜头的运镜幅度是否要比常规更大（用于「张力」类风格） */
  punchy: z.boolean().default(false),
  /** 卡片与图形的圆角基调（乘 u 之前的系数） */
  corner: z.enum(["sharp", "soft", "round"]).default("soft"),
  /** 纹理叠层 */
  texture: z.enum(["none", "grain", "paper", "scanline"]).default("none"),
});
export type MotionProfile = z.infer<typeof motionProfileSchema>;

/** 每个 preset 的基准参数，派生时只在此基础上做微调 */
export const motionPresets: Record<MotionPresetId, Omit<MotionProfile, "preset">> = {
  "editorial-restrained": { easing: "smooth", energy: 0.85, enterFrom: "below", punchy: false, corner: "soft", texture: "none" },
  "documentary-observant": { easing: "linear", energy: 0.9, enterFrom: "none", punchy: false, corner: "soft", texture: "grain" },
  "geometric-editorial": { easing: "expo", energy: 1.25, enterFrom: "side", punchy: true, corner: "sharp", texture: "none" },
  "ink-bleed": { easing: "cinematic", energy: 0.6, enterFrom: "scale", punchy: false, corner: "soft", texture: "paper" },
  "clay-stopmotion": { easing: "elastic", energy: 1, enterFrom: "scale", punchy: false, corner: "round", texture: "grain" },
  "neon-hud": { easing: "mechanical", energy: 1.3, enterFrom: "side", punchy: true, corner: "sharp", texture: "scanline" },
  "cel-animation": { easing: "smooth", energy: 1.1, enterFrom: "side", punchy: false, corner: "soft", texture: "none" },
  "comic-panel": { easing: "expo", energy: 1.2, enterFrom: "side", punchy: true, corner: "sharp", texture: "grain" },
  "painterly-soft": { easing: "cinematic", energy: 0.7, enterFrom: "scale", punchy: false, corner: "soft", texture: "grain" },
  "print-halftone": { easing: "stepped", energy: 1, enterFrom: "below", punchy: false, corner: "sharp", texture: "paper" },
  "pixel-step": { easing: "stepped", energy: 1.2, enterFrom: "none", punchy: true, corner: "sharp", texture: "none" },
  "concept-render": { easing: "cinematic", energy: 1.05, enterFrom: "scale", punchy: false, corner: "soft", texture: "none" },
};

/** 按 preset 装配一份完整参数（补上 preset 字段本身） */
export function motionProfile(preset: MotionPresetId = "editorial-restrained"): MotionProfile {
  return { preset, ...motionPresets[preset] };
}

/** 品牌默认动效 */
export const defaultMotionProfile: MotionProfile = motionProfile("editorial-restrained");

/** 圆角系数 → 实际像素（u = 短边的 1%） */
export const cornerRadius = (corner: MotionProfile["corner"], u: number) =>
  corner === "sharp" ? 0 : corner === "round" ? u * 2.2 : u * 0.8;
