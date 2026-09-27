import { createContext, useContext } from "react";
import { defaultTheme, type VideoTheme } from "@/lib/core/theme";

/** 画面主题：来自时间轴（由项目的视觉风格卡派生），缺省为品牌默认主题 */
export const ThemeContext = createContext<VideoTheme>(defaultTheme);
export const useTheme = () => useContext(ThemeContext);

export const pick = <T,>(list: T[], seed: number) => list[Math.abs(seed) % list.length];
