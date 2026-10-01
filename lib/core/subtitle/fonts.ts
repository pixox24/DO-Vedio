import { DEFAULT_FONT_ID, DEFAULT_SECONDARY_FONT_ID, type SubtitleConfig } from "./types";

/**
 * 字幕字体管理器 —— 从 AI-Video 字幕模块移植。
 *
 * 字体分两类：系统字体（不下载，直接走字体栈）和内置字体（public/fonts 下的 ttf，
 * 用 FontFace 按需加载）。浏览器预览与 Remotion 成片渲染共用这里的加载与回退逻辑。
 */

export type StudioFontScript = "cjk" | "latin";

/** 内置字体加载状态；系统字体与回退后的未知 id 恒为 ready */
export type StudioFontLoadState = "unloaded" | "loading" | "ready" | "error";

export const SYSTEM_FONT_ID = DEFAULT_FONT_ID;
export const SYSTEM_LATIN_FONT_ID = DEFAULT_SECONDARY_FONT_ID;

const CJK_FALLBACK = '"PingFang SC", "Microsoft YaHei", sans-serif';
const LATIN_FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const SYSTEM_FONT_STACK = `${LATIN_FALLBACK}, ${CJK_FALLBACK}`;
export const SYSTEM_LATIN_STACK = `"Segoe UI", ${LATIN_FALLBACK}, ${CJK_FALLBACK}`;

export interface StudioFont {
  id: string;
  name: string;
  desc: string;
  family: string;
  /** public 下的字体文件地址；系统字体没有 */
  url?: string;
  synthBold: boolean;
  script: StudioFontScript;
  stack?: string;
  /**
   * 字体文件是否已随仓库内置。
   * nanxi-youmo-song（40MB）和 xiangcui-jixue-song（14.5MB）未复制进来；
   * 把它们放进 public/fonts 后改成 true 即可在面板中选择。
   */
  bundled: boolean;
}

export interface SubtitleTypeface {
  primaryFamily: string;
  primaryWeight: string;
  secondaryFamily: string;
  secondaryWeight: string;
}

export const STUDIO_FONTS: StudioFont[] = [
  {
    id: SYSTEM_FONT_ID,
    name: "系统黑体",
    desc: "清晰通用，全场景适用",
    family: "system-ui",
    synthBold: true,
    script: "cjk",
    stack: SYSTEM_FONT_STACK,
    bundled: true,
  },
  {
    id: "lemi-shigu-song",
    name: "乐米石鼓旧宋",
    desc: "石鼓碑意，旧宋书卷气",
    family: "StudioLemiShiguSong",
    url: "/fonts/lemi-shigu-song.ttf",
    synthBold: false,
    script: "cjk",
    bundled: true,
  },
  {
    id: "nanxi-youmo-song",
    name: "南西油墨宋",
    desc: "油墨印迹，宋体标题感",
    family: "StudioNanxiYoumoSong",
    url: "/fonts/nanxi-youmo-song.ttf",
    synthBold: false,
    script: "cjk",
    bundled: false,
  },
  {
    id: "wuhan-yingxiong",
    name: "武汉英雄体",
    desc: "手写力量感，适合短视频标题",
    family: "StudioWuhanYingxiong",
    url: "/fonts/wuhan-yingxiong.ttf",
    synthBold: false,
    script: "cjk",
    bundled: true,
  },
  {
    id: "xiangcui-jixue-song",
    name: "香萃积雪宋",
    desc: "细宋积雪，清冷雅致",
    family: "StudioXiangcuiJixueSong",
    url: "/fonts/xiangcui-jixue-song.ttf",
    synthBold: false,
    script: "cjk",
    bundled: false,
  },
  {
    id: "yaoxing-qingnian-hei",
    name: "摇醒青年黑",
    desc: "青年黑体，利落有力",
    family: "StudioYaoxingQingnianHei",
    url: "/fonts/yaoxing-qingnian-hei.ttf",
    synthBold: false,
    script: "cjk",
    bundled: true,
  },
  {
    id: "zhuote-ziyou",
    name: "卓特自由体",
    desc: "自由手写，轻松随性",
    family: "StudioZhuoteZiyou",
    url: "/fonts/zhuote-ziyou.ttf",
    synthBold: false,
    script: "cjk",
    bundled: true,
  },
  {
    id: SYSTEM_LATIN_FONT_ID,
    name: "系统西文",
    desc: "清晰无衬线，适合英文字幕",
    family: "Segoe UI",
    synthBold: true,
    script: "latin",
    stack: SYSTEM_LATIN_STACK,
    bundled: true,
  },
  {
    id: "latin-serif",
    name: "西文衬线",
    desc: "Georgia 书卷感，适合旁白",
    family: "Georgia",
    synthBold: false,
    script: "latin",
    stack: `Georgia, "Times New Roman", serif, ${CJK_FALLBACK}`,
    bundled: true,
  },
  {
    id: "latin-impact",
    name: "西文粗体",
    desc: "短视频标题感，高对比",
    family: "Impact",
    synthBold: false,
    script: "latin",
    stack: `Impact, "Arial Black", ${LATIN_FALLBACK}, ${CJK_FALLBACK}`,
    bundled: true,
  },
  {
    id: "latin-mono",
    name: "西文等宽",
    desc: "打字机 / 纪实感",
    family: "Consolas",
    synthBold: false,
    script: "latin",
    stack: `Consolas, "Courier New", ui-monospace, monospace, ${CJK_FALLBACK}`,
    bundled: true,
  },
];

export const CJK_FONTS = STUDIO_FONTS.filter((font) => font.script === "cjk" && font.bundled);
export const LATIN_FONTS = STUDIO_FONTS.filter((font) => font.script === "latin" && font.bundled);

const fontByIdMap = new Map(STUDIO_FONTS.map((font) => [font.id, font]));
const loadPromises = new Map<string, Promise<boolean>>();
const readyIds = new Set<string>(STUDIO_FONTS.filter((font) => !font.url).map((font) => font.id));
const fontStates = new Map<string, StudioFontLoadState>();
for (const font of STUDIO_FONTS) {
  fontStates.set(font.id, font.url ? "unloaded" : "ready");
}
const listeners = new Set<() => void>();

function notifyFontListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore subscriber errors
    }
  });
}

function markFontReady(id: string) {
  const changed = fontStates.get(id) !== "ready";
  readyIds.add(id);
  fontStates.set(id, "ready");
  if (changed) notifyFontListeners();
}

function usable(font: StudioFont): boolean {
  return font.bundled;
}

export function studioFontById(id: string | null | undefined): StudioFont {
  const font = id ? fontByIdMap.get(id) : undefined;
  return font && usable(font) ? font : STUDIO_FONTS[0];
}

export function fontsForScript(script: StudioFontScript): StudioFont[] {
  return script === "latin" ? LATIN_FONTS : CJK_FONTS;
}

export function defaultFontIdForScript(script: StudioFontScript): string {
  return script === "latin" ? SYSTEM_LATIN_FONT_ID : SYSTEM_FONT_ID;
}

export function fontFamilyStack(font: StudioFont): string {
  if (font.stack) return font.stack;
  if (!font.url) return SYSTEM_FONT_STACK;
  if (font.script === "latin") return `"${font.family}", ${SYSTEM_LATIN_STACK}`;
  return `"${font.family}", ${CJK_FALLBACK}, ${LATIN_FALLBACK}`;
}

export function resolveSubtitleFontId(config?: Partial<SubtitleConfig> | null): string {
  const rawId = String(config?.fontId || "").trim();
  const direct = rawId ? fontByIdMap.get(rawId) : undefined;
  if (direct && usable(direct)) return rawId;

  const family = String(config?.fontFamily || "");
  if (family) {
    const matched = STUDIO_FONTS.find((font) => font.url && usable(font) && family.includes(font.family));
    if (matched) return matched.id;
    const latin = LATIN_FONTS.find((font) => family.includes(font.family));
    if (latin) return latin.id;
  }

  return SYSTEM_FONT_ID;
}

export function resolveSecondarySubtitleFontId(config?: Partial<SubtitleConfig> | null): string {
  const rawId = String(config?.secondaryFontId || "").trim();
  const direct = rawId ? fontByIdMap.get(rawId) : undefined;
  if (direct && usable(direct)) return rawId;
  return SYSTEM_LATIN_FONT_ID;
}

export function resolveSubtitleTypeface(config?: Partial<SubtitleConfig> | null): SubtitleTypeface {
  const primary = studioFontById(resolveSubtitleFontId(config));
  const secondary = studioFontById(resolveSecondarySubtitleFontId(config));
  return {
    primaryFamily: fontFamilyStack(primary),
    primaryWeight: primary.synthBold ? "bold" : "400",
    secondaryFamily: fontFamilyStack(secondary),
    secondaryWeight: secondary.synthBold ? "600" : "400",
  };
}

export function subtitleCanvasFont(family: string, size: number, weight: string): string {
  return `${weight} ${Math.max(1, Math.round(size))}px ${family}`;
}

export function isStudioFontReady(id: string): boolean {
  return readyIds.has(studioFontById(id).id);
}

/** 查询字体加载状态；未知/未内置 id 先回退系统字体，再返回其状态 */
export function studioFontState(id: string): StudioFontLoadState {
  const font = studioFontById(id);
  if (!font.url) return "ready";
  return fontStates.get(font.id) ?? "unloaded";
}

export function subscribeStudioFonts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Remotion 里把 public 路径交给 staticFile 处理；浏览器预览直接用原路径 */
export type FontUrlResolver = (path: string) => string;
const identityUrl: FontUrlResolver = (path) => path;

export function loadStudioFont(id: string, resolveUrl: FontUrlResolver = identityUrl): Promise<boolean> {
  const font = studioFontById(id);
  if (!font.url || typeof document === "undefined" || typeof FontFace === "undefined") {
    markFontReady(font.id);
    return Promise.resolve(true);
  }
  const cached = loadPromises.get(font.id);
  if (cached) return cached;
  if (fontStates.get(font.id) === "ready") return Promise.resolve(true);

  fontStates.set(font.id, "loading");
  notifyFontListeners();

  const promise = (async () => {
    try {
      const face = new FontFace(font.family, `url(${resolveUrl(font.url!)}) format("truetype")`, {
        weight: "400",
        style: "normal",
        display: "swap",
      });
      const loaded = await face.load();
      document.fonts.add(loaded);
      await document.fonts.load(`400 32px "${font.family}"`);
      markFontReady(font.id);
      return true;
    } catch (err) {
      console.warn(`[SubtitleFonts] Failed to load ${font.id}:`, err);
      loadPromises.delete(font.id);
      fontStates.set(font.id, "error");
      notifyFontListeners();
      return false;
    }
  })();

  loadPromises.set(font.id, promise);
  return promise;
}

/** 清除失败状态与缓存后重新加载；加载中/已就绪时沿用现有结果 */
export function retryStudioFont(id: string): Promise<boolean> {
  const font = studioFontById(id);
  if (!font.url) {
    markFontReady(font.id);
    return Promise.resolve(true);
  }
  if (fontStates.get(font.id) === "error") {
    loadPromises.delete(font.id);
    readyIds.delete(font.id);
    fontStates.set(font.id, "unloaded");
    notifyFontListeners();
  }
  return loadStudioFont(font.id);
}

export async function ensureSubtitleFonts(config?: Partial<SubtitleConfig> | null, resolveUrl?: FontUrlResolver): Promise<boolean> {
  const results = await Promise.all(subtitleFontIds(config).map((id) => loadStudioFont(id, resolveUrl)));
  return results.every(Boolean);
}

export function subtitleFontIds(config?: Partial<SubtitleConfig> | null): string[] {
  const ids = [resolveSubtitleFontId(config)];
  if (config?.bilingual) ids.push(resolveSecondarySubtitleFontId(config));
  return Array.from(new Set(ids));
}
