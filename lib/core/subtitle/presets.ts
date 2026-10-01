import { SYSTEM_FONT_ID, SYSTEM_FONT_STACK, SYSTEM_LATIN_FONT_ID } from "./fonts";
import { subtitleConfigSchema, type SubtitleConfig, type SubtitlePreset } from "./types";

/**
 * 字幕预设与默认值 —— 从 AI-Video 字幕模块移植。
 * 预设只覆盖样式相关字段，不碰 enabled / burnIn / 字体 / 位置等用户偏好。
 */

export const DEFAULT_SUBTITLE_CONFIG: SubtitleConfig = subtitleConfigSchema.parse({
  preset: "viral-yellow",
  fontSize: 26,
  fontId: SYSTEM_FONT_ID,
  fontFamily: SYSTEM_FONT_STACK,
  secondaryFontId: SYSTEM_LATIN_FONT_ID,
  positionY: 82,
  primaryColor: "#ffffff",
  highlightColor: "#facc15",
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  showBackground: true,
  showShadow: true,
  showStroke: true,
  strokeColor: "#000000",
  animation: "pop",
  bilingual: false,
});

export type SubtitlePresetMeta = {
  id: SubtitlePreset;
  name: string;
  desc: string;
  /** 卡片标题的强调色（Tailwind 文本类），仅 UI 展示用 */
  sampleClass: string;
};

export const SUBTITLE_PRESETS: SubtitlePresetMeta[] = [
  { id: "viral-yellow", name: "抖音爆款黄白", desc: "白字搭配明黄重点，高停留率", sampleClass: "text-amber-400" },
  { id: "cinematic-bilingual", name: "电影双语大片", desc: "主行口播 + 副行翻译，院线排版", sampleClass: "text-sky-400" },
  { id: "glow-capsule", name: "荧光暗黑胶囊", desc: "半透明圆角药丸底色，极其清晰", sampleClass: "text-emerald-400" },
  { id: "neon-cyan", name: "赛博霓虹", desc: "青色主字与粉色强调，暗色底衬", sampleClass: "text-cyan-400" },
  { id: "retro-typewriter", name: "复古打字机", desc: "暖橙底衬，纪实人文感", sampleClass: "text-orange-300" },
  { id: "classic-contrast", name: "经典黑底白字", desc: "高对比度纯黑底衬，全场景适用", sampleClass: "text-zinc-200" },
];

export function subtitlePresetUpdates(preset: SubtitlePreset): Partial<SubtitleConfig> {
  switch (preset) {
    case "cinematic-bilingual":
      return {
        preset,
        primaryColor: "#ffffff",
        highlightColor: "#38bdf8",
        showBackground: false,
        showStroke: true,
        strokeColor: "#000000",
        animation: "fade",
        bilingual: true,
      };
    case "glow-capsule":
      return {
        preset,
        primaryColor: "#ffffff",
        highlightColor: "#34d399",
        showBackground: true,
        backgroundColor: "rgba(15, 23, 42, 0.85)",
        showStroke: false,
        animation: "pop",
        bilingual: false,
      };
    case "neon-cyan":
      return {
        preset,
        primaryColor: "#22d3ee",
        highlightColor: "#f43f5e",
        showBackground: true,
        backgroundColor: "rgba(5, 5, 16, 0.85)",
        showStroke: true,
        strokeColor: "#083344",
        animation: "karaoke",
        bilingual: false,
      };
    case "retro-typewriter":
      return {
        preset,
        primaryColor: "#ffedd5",
        highlightColor: "#fb923c",
        showBackground: true,
        backgroundColor: "rgba(41, 20, 5, 0.8)",
        showStroke: false,
        animation: "fade",
        bilingual: false,
      };
    case "classic-contrast":
      return {
        preset,
        primaryColor: "#ffffff",
        highlightColor: "#ffffff",
        showBackground: true,
        backgroundColor: "rgba(0, 0, 0, 0.9)",
        showStroke: false,
        animation: "none",
        bilingual: false,
      };
    default:
      return {
        preset: "viral-yellow",
        primaryColor: "#ffffff",
        highlightColor: "#facc15",
        showBackground: true,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        showStroke: true,
        strokeColor: "#000000",
        animation: "pop",
        bilingual: false,
      };
  }
}

export function applySubtitlePreset(config: SubtitleConfig, preset: SubtitlePreset): SubtitleConfig {
  return { ...config, ...subtitlePresetUpdates(preset) };
}

/**
 * 判断当前配置是否仍与该预设一致：只比较预设覆盖的字段，
 * 任一字段缺失（undefined）或不同即视为「自定义组合」，不比较字体/位置/开关等用户偏好。
 */
export function subtitlePresetMatches(config: Partial<SubtitleConfig>, preset: SubtitlePreset): boolean {
  const updates = subtitlePresetUpdates(preset) as Record<string, unknown>;
  const candidate = config as Record<string, unknown>;
  return Object.entries(updates).every(([key, value]) => candidate[key] === value);
}

export function subtitlePresetMeta(preset: SubtitlePreset): SubtitlePresetMeta {
  return SUBTITLE_PRESETS.find((item) => item.id === preset) ?? SUBTITLE_PRESETS[0];
}
