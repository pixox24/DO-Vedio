import { z } from "zod";

/**
 * 字幕模块配置 —— 从 AI-Video 字幕模块移植。
 *
 * 本模块负责「字幕长什么样」：预设、字体、字号、位置、颜色、背景/描边、入场动效和双语副行；
 * 「字幕什么时候出现」仍由 lib/core/subtitles.ts 的断句与时间戳负责。
 * 预览（Remotion Player）和成片渲染读取同一份配置，保证所见即所得。
 */

export const subtitlePresetIds = [
  "viral-yellow",
  "cinematic-bilingual",
  "glow-capsule",
  "neon-cyan",
  "retro-typewriter",
  "classic-contrast",
] as const;
export type SubtitlePreset = (typeof subtitlePresetIds)[number];

export const subtitleAnimations = ["pop", "fade", "karaoke", "none"] as const;
export type SubtitleAnimation = (typeof subtitleAnimations)[number];
export const subtitleAnimationLabels: Record<SubtitleAnimation, string> = {
  pop: "弹性弹出",
  fade: "平滑淡入",
  karaoke: "逐字高亮",
  none: "不动",
};

export const DEFAULT_FONT_ID = "system-cjk";
export const DEFAULT_SECONDARY_FONT_ID = "system-latin";
/** 系统无衬线字体栈：西文优先，中文回退 */
export const DEFAULT_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

export const subtitleConfigSchema = z.object({
  /** 总开关：关闭后不生成字幕块，预览和成片都没有字幕 */
  enabled: z.boolean().default(true),
  /** 是否把字幕烤录进成片；关闭后预览不显示（SRT 仍可下载） */
  burnIn: z.boolean().default(true),
  /** 关键词强调：命中的关键词用 highlightColor 显示 */
  highlight: z.boolean().default(true),
  preset: z.enum(subtitlePresetIds).default("viral-yellow"),
  /** 基准字号 18 - 48，以 950px 宽画面为基准，渲染时按实际画幅等比缩放 */
  fontSize: z.number().min(18).max(48).default(26),
  /** 口播字体 id，见 lib/core/subtitle/fonts.ts */
  fontId: z.string().default(DEFAULT_FONT_ID),
  /** 字体回退栈；选择字体时一并写入，fontId 失效时按它匹配 */
  fontFamily: z.string().default(DEFAULT_FONT_STACK),
  /** 双语副行字体 id */
  secondaryFontId: z.string().default(DEFAULT_SECONDARY_FONT_ID),
  /** 字幕块中心相对画面顶部的位置（百分比） */
  positionY: z.number().min(20).max(90).default(82),
  primaryColor: z.string().default("#ffffff"),
  highlightColor: z.string().default("#facc15"),
  backgroundColor: z.string().default("rgba(0, 0, 0, 0.7)"),
  showBackground: z.boolean().default(true),
  showShadow: z.boolean().default(true),
  showStroke: z.boolean().default(true),
  strokeColor: z.string().default("#000000"),
  animation: z.enum(subtitleAnimations).default("pop"),
  /** 双语字幕：主行口播 + 副行翻译 */
  bilingual: z.boolean().default(false),
  /** 自动折行的最大行数；超过后自动缩小字号 */
  maxLines: z.number().int().min(2).max(4).default(3),
  /** 安全排版宽度占画面宽度的比例 */
  maxWidthRatio: z.number().min(0.7).max(0.92).default(0.84),
});
export type SubtitleConfig = z.infer<typeof subtitleConfigSchema>;
export type SubtitleConfigInput = z.input<typeof subtitleConfigSchema>;

/** 一个字幕显示块：一句口播在其时间范围内的完整字幕（含可选翻译副行） */
export type SubtitleBlock = {
  lineId: string;
  startMs: number;
  endMs: number;
  text: string;
  secondaryText?: string;
  keywords: string[];
  /** 真实 TTS 的字级绝对时间（原文 code unit 索引）；缺失时 Karaoke 回退整句均匀进度 */
  charTimes?: { i: number; startMs: number; endMs: number }[];
};
