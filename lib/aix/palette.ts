import type { AixStyle } from "./schema";

/**
 * Aix 风格 → Remotion 配色。
 *
 * Aix 只给一句自然语言的配色描述（如「低饱和雾青底色与暖色局部对比」），
 * 不提供色值。这里把这句话里的颜色词解析成具体的 [深, 中, 浅] 三元组和强调色，
 * 让代码画面（信息卡、标题卡、字幕强调）和使用同一张风格卡生成的画面色调一致。
 *
 * 色表是人工校准的资产：改这里等于改全部 160 张卡在代码画面上的观感。
 */

/** 颜色词 → hex。键按「长词优先」匹配，所以「深蓝」必须先于「蓝」命中 */
const LEXICON: Record<string, string> = {
  // 明暗与无彩
  纯黑: "#0a0a0b", 深黑: "#0a0a0b", 墨色: "#12100e", 黑白: "#141414", 灰黑: "#1a1c1e",
  暗黑: "#0e0f11", 暗调: "#16181c", 深灰: "#24262a", 纯白: "#fafafa", 亮白: "#fbfbf9",
  纸白: "#f5f2ea", 米白: "#f2ece1", 奶油: "#f4ecdc", 灰白: "#e6e6e4", 冷灰: "#39434d",
  黑: "#0b0b0d", 暗: "#1a1c20", 白: "#f5f5f3", 灰: "#6a6f74", 米: "#efe6d5",
  // 蓝
  深海军蓝: "#16243d", 海军蓝: "#16243d", 深靛: "#1a1f4d", 靛蓝: "#1b2a5e",
  雾青: "#6d9aa0", 青蓝: "#2b6f96", 紫蓝: "#2b2350", 灰蓝: "#3a4a5c", 天蓝: "#5a9fd4",
  亮蓝: "#3d8ee8", 宝蓝: "#1d3f8f", 藏蓝: "#152238", 深蓝: "#12233f", 蓝: "#2f5f9e",
  // 青绿
  深黑绿: "#0d1a14", 深青灰: "#2c3a42", 墨绿: "#12342a", 翠绿: "#2fa05c", 亮绿: "#4fd97a",
  荧光绿: "#7bff4d", 黄绿: "#8fc23f", 深绿: "#123528", 深青: "#0f3b3a", 青: "#2f7f86", 绿: "#2f8f5c",
  // 红橙黄
  深砖红: "#5a2118", 铁锈: "#7a4526", 砖红: "#8a3a24", 珊瑚粉: "#f08a7a", 猩红: "#c62222",
  鲜红: "#d92b2b", 暗红: "#5c1f1f", 橙红: "#e2571f", 暖橙: "#e08a2b", 芥末黄: "#c9a227",
  橙黄: "#e8a52c", 亮黄: "#f2d13a", 暖黄: "#e8bf5a", 琥珀: "#d99a2b", 土黄: "#b08a4a",
  橙: "#e2831f", 黄: "#e8c53a", 红: "#c5342f",
  // 紫粉
  紫罗兰: "#8a5fd0", 亮紫: "#9a5fe0", 洋红: "#d43b8f", 品红: "#c62a86", 粉紫: "#a86fc0",
  深紫: "#2a1a44", 紫: "#7a4fb5", 粉: "#e88fb0",
  // 环境色
  暖木: "#9a7248", 大地: "#8a6a44", 肤色: "#e2b596", 夜色: "#101a2c", 暖: "#e0a05a", 冷: "#5a86a8",
};

/** 长键优先，避免「深蓝」被「蓝」抢先命中 */
const KEYS = Object.keys(LEXICON).sort((a, b) => b.length - a.length);

const NEUTRAL = /黑白|无彩|灰|纯黑|纯白|墨色/;
/** 强提示：文案点名这是画面里的主角或强对比项 */
const ACCENT_STRONG = /(大面积|主体|大圆|撞色|主色|鲜艳|高饱和|荧光)/;
/** 弱提示：只是点缀或局部，优先级低于「饱和度最高」这个默认规则 */
const ACCENT_WEAK = /(点缀|强调|高光|局部|少量|微)/;
const DARK_HINT = /(底|背景|暗部|主调|基调)/;

export type ExtractedColor = { token: string; hex: string; index: number; strong: boolean; weak: boolean; darkHinted: boolean };

/** 从一句配色描述里按出现顺序抽出颜色词（同色值去重，保留首次出现） */
export function extractColors(text: string): ExtractedColor[] {
  const found: ExtractedColor[] = [];
  const taken: { start: number; end: number }[] = [];
  const overlaps = (start: number, end: number) => taken.some((t) => start < t.end && end > t.start);
  for (const key of KEYS) {
    let from = 0;
    for (;;) {
      const index = text.indexOf(key, from);
      if (index < 0) break;
      const end = index + key.length;
      from = end;
      if (overlaps(index, end)) continue;
      taken.push({ start: index, end });
      // 前后几个字里的修饰词决定这个色的角色：主色、点缀色，还是普通罗列
      const around = text.slice(Math.max(0, index - 5), end + 4);
      found.push({ token: key, hex: LEXICON[key], index, strong: ACCENT_STRONG.test(around), weak: ACCENT_WEAK.test(around), darkHinted: DARK_HINT.test(around) });
    }
  }
  // 同一个色值出现多次（「黑白灰」「纯黑白灰」）只留第一次，并合并它的强弱修饰
  const merged: ExtractedColor[] = [];
  for (const c of found.sort((a, b) => a.index - b.index)) {
    const seen = merged.find((m) => m.hex === c.hex);
    if (seen) {
      seen.strong ||= c.strong;
      seen.weak ||= c.weak;
      continue;
    }
    merged.push(c);
  }
  return merged;
}

// ---------- 色彩运算 ----------

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function hexToRgb(hex: string) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;

export function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** 相对某个端点色偏移：amount = 1 时完全变成端点色 */
export function shift(hex: string, amount: number, toward: string) {
  const { r, g, b } = hexToRgb(hex);
  const t = hexToRgb(toward);
  return toHex(r + (t.r - r) * amount, g + (t.g - g) * amount, b + (t.b - b) * amount);
}

/** 饱和度倍率（0 = 灰，1 = 原样） */
export function saturation(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** 饱和度提升（用于把强调色从底色里拉出来） */
export function saturate(hex: string, amount: number) {
  const { r, g, b } = hexToRgb(hex);
  const avg = (r + g + b) / 3;
  return toHex(avg + (r - avg) * (1 + amount), avg + (g - avg) * (1 + amount), avg + (b - avg) * (1 + amount));
}

// ---------- 主题推导 ----------

export type DerivedTheme = { schemes: [string, string, string][]; accent: string };

/**
 * 按 Aix 分类给的兜底色板：只在配色文本一个颜色词都对不上时使用。
 * 比原来「所有 photographic 共用一组」细一档，但仍然是兜底，不是主路径。
 */
const CATEGORY_FALLBACK: Record<AixStyle["category"], DerivedTheme> = {
  photographic: { schemes: [["#18252a", "#3e6870", "#b7d2ce"], ["#2b1f1a", "#8b5d43", "#e5b78e"]], accent: "#a8d6c8" },
  illustration: { schemes: [["#24304a", "#4f6f9f", "#bfd7eb"], ["#42344b", "#8e668f", "#e4b7b5"]], accent: "#f0c66a" },
  painting: { schemes: [["#25201d", "#665045", "#c7a98b"], ["#18373a", "#4f8178", "#b7d2bd"]], accent: "#e3a56a" },
  graphic: { schemes: [["#151c2d", "#314a78", "#95b8da"], ["#3c2028", "#a2474f", "#f0b06f"]], accent: "#d5ef4c" },
  "3d": { schemes: [["#172333", "#3c668c", "#a5d2e5"], ["#30213d", "#765a91", "#d8b4e8"]], accent: "#7ee5d2" },
};

/**
 * 一句配色描述 → 一组 [深, 中, 浅] + 强调色。
 * 规则：最暗的色当底、最亮的当亮部、其余取中间；强调色优先给被点名的点缀色，
 * 其次给饱和度最高的非无彩色。
 */
export function deriveTheme(paletteText: string, category: AixStyle["category"]): DerivedTheme {
  const colors = extractColors(paletteText);
  if (colors.length === 0) return CATEGORY_FALLBACK[category];

  const sorted = [...colors].sort((a, b) => luminance(a.hex) - luminance(b.hex));
  const darkest = sorted[0];
  const brightest = sorted[sorted.length - 1];
  const mids = sorted.slice(1, -1);

  // 底色：暗色直接用；中明度的（雾青、灰蓝）压深一档，否则浅色字压不住
  const darkHex = luminance(darkest.hex) <= 0.22 ? darkest.hex : shift(darkest.hex, Math.min(0.5, luminance(darkest.hex) * 0.7), "#000000");
  // 亮部：有明确浅色就用；否则把最亮的色提亮，避免深色风格出现「深—深—深」的糊画面
  const lightHex = brightest !== darkest && luminance(brightest.hex) > 0.45 ? brightest.hex : shift(brightest.hex, 0.42, "#ffffff");
  // 中间色：优先取明度居中的那个；只有两个色时用两者的中间值
  const midHex = mids.length ? mids[Math.floor(mids.length / 2)].hex : shift(darkHex, 0.46, lightHex);

  // 强调色：优先被点名的点缀色，其次饱和度最高者。黑白灰不参与竞争——
  // 「米白底、朱红大圆、深灰黑剪影」这类描述里，强调色是朱红，不是剪影的黑
  const chromatic = colors.filter((c) => !NEUTRAL.test(c.token));
  const accentPool = chromatic.length ? chromatic : colors;
  // 强调色：先看被点名为「主体 / 撞色」的色，再退回饱和度最高者。
  // 只有「点缀 / 局部」提示、没有强提示的色不优先——「米白底、朱红大圆、深灰黑剪影，
  // 辅以灰蓝暗绿微点缀」里，强调色是朱红（大面积、大圆），不是被点名点缀的灰蓝。
  const sat = (c: ExtractedColor) => saturation(c.hex) * (c.strong ? 1.5 : c.weak ? 0.85 : 1);
  const accent = [...accentPool].sort((a, b) => sat(b) - sat(a))[0].hex;

  // 第二组配色：换一个「深」的来源，让相邻镜头的卡片不雷同；只有一个深色时朝强调色偏
  const altDark = sorted.find((c) => c !== darkest && luminance(c.hex) < 0.45)?.hex ?? shift(darkHex, 0.3, accent);
  const altMid = shift(altDark, 0.5, lightHex);

  return {
    schemes: [
      [darkHex, midHex, lightHex],
      [altDark, altMid, lightHex],
    ],
    accent: saturate(accent, 0.12),
  };
}

/** 卡片正文与次要用色：由底色明暗决定，浅色底用深字，深色底用浅字 */
export function contrastInk(scheme: [string, string, string]) {
  const onDark = luminance(scheme[0]) < 0.5;
  return onDark ? { text: "#f6f7f8", sub: "rgba(246,247,248,0.66)" } : { text: "#14161a", sub: "rgba(20,22,26,0.62)" };
}
