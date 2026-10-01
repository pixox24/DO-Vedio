/**
 * 可自定义字幕模块 —— 从 AI-Video 字幕模块完整移植。
 *
 * 能力：
 * - 6 套预设 + 字号 / 位置 / 颜色 / 背景 / 描边 / 阴影
 * - 字体选择（系统字体 + public/fonts 内置字体）与按需加载
 * - 自动折行、标点平衡、字号自适应的排版引擎
 * - pop / fade / karaoke / none 入场动效
 * - 双语字幕（主行口播 + 副行翻译）与逐句翻译对账
 */

export * from "./types";
export * from "./language";
export * from "./fonts";
export * from "./formatter";
export * from "./presets";
export * from "./secondary";
export * from "./renderer";
