import { useVideoConfig } from "remotion";

/** 横竖屏自适应的尺寸基准：u = 短边的 1%；竖屏时字幕和标识避开平台界面遮挡区 */
export function useLayout() {
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  const u = Math.min(width, height) / 100;
  return {
    width,
    height,
    portrait,
    u,
    /** 字幕基线距底部 */
    subtitleBottom: portrait ? height * 0.24 : height * 0.075,
    subtitleSize: portrait ? u * 5.6 : u * 5.2,
    /** 安全边距 */
    pad: portrait ? u * 7 : u * 6,
  };
}
