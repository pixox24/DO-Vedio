import { RENDER_OUTPUT_VERSION } from "./keys";
import type { Aspect } from "./types";

/** 当前时间轴的三份哈希。成片是否过期以它们为准，内容和动画都要看。 */
export type TimelineHashes = { contentHash: string; animationHash: string; timelineHash: string };

export type RenderMatch = {
  outputVersion?: number | null;
  contentHash?: string | null;
  animationHash?: string | null;
  timelineHash: string;
};

/**
 * 一条渲染结果是否就是当前时间轴。
 * 有动画哈希时，内容和动画都要一致；旧文件没有动画哈希时，退回整条时间轴哈希。
 * 输出版本不同（例如只渲了 3 秒的旧文件）一律不算。
 */
export function renderMatches(render: RenderMatch, current: TimelineHashes | undefined): boolean {
  if (!current || render.outputVersion !== RENDER_OUTPUT_VERSION) return false;
  if (render.animationHash) {
    return current.contentHash === (render.contentHash || render.timelineHash) && current.animationHash === render.animationHash;
  }
  return current.timelineHash === render.timelineHash;
}

export type ListedRender = RenderMatch & {
  id: string;
  aspect: Aspect;
  quality: string;
  videoHash: string;
  srtHash: string | null;
  createdAt: number;
  /** 后台追上的成片。对不上当前画面时，有手工成片就不再占列表。 */
  origin?: "manual" | "catch-up";
};

export type ExportFile = {
  aspect: Aspect;
  videoHash: string;
  srtHash: string | null;
  createdAt: number;
  /** 文件对不上当前时间轴，导出的是上一版 */
  stale: boolean;
};

export type OutputReadiness =
  | { phase: "pending"; status: string; files: ExportFile[] }
  | { phase: "empty"; status: string; files: ExportFile[] }
  | { phase: "fresh"; status: string; files: ExportFile[] }
  | { phase: "stale"; status: string; staleAspects: Aspect[]; files: ExportFile[] };

/**
 * 成片列表里看得见的版本。
 * 后台自动追上的文件，每个画幅只该留最新一份；对不上当前画面、而且已经有手工成片时，不再显示成「上一版」。
 */
export function visibleRenders<T extends ListedRender>(renders: readonly T[], hashes: Partial<Record<Aspect, TimelineHashes>>): T[] {
  return renders.filter((render) => {
    if (render.origin !== "catch-up") return true;
    const current = hashes[render.aspect];
    if (!current || renderMatches(render, current)) return true;
    const manualFinal = renders.some((other) => other.aspect === render.aspect && other.quality === "final" && other.origin !== "catch-up");
    return !manualFinal;
  });
}

/** 成片列表徽章。样片不再占「最新」；对得上的旧成片标成上一版。 */
export function renderBadge(render: ListedRender, renders: readonly ListedRender[], hashes: Partial<Record<Aspect, TimelineHashes>>): "最新" | "上一版" | "已过期" | null {
  const matches = renderMatches(render, hashes[render.aspect]);
  if (render.quality !== "final") return matches ? null : "已过期";
  if (!matches) return "已过期";
  const newerFreshFinal = renders.some((other) => other.id !== render.id && other.aspect === render.aspect && other.quality === "final" && other.createdAt > render.createdAt && renderMatches(other, hashes[other.aspect]));
  return newerFreshFinal ? "上一版" : "最新";
}

export function formatRenderAge(createdAt: number, now = Date.now()): string {
  const delta = Math.max(0, now - createdAt);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "刚刚";
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  return `${Math.floor(delta / day)} 天前`;
}

/**
 * 制作页动作条用的成片状态。只把成片算进去，历史样片不改变「还没有成片」。
 * 某个已选画幅还没有哈希时返回 pending，避免在核对完成前说「已是最新」。
 */
export function outputReadiness(aspects: readonly Aspect[], renders: readonly ListedRender[], hashes: Partial<Record<Aspect, TimelineHashes>>, now = Date.now()): OutputReadiness {
  if (aspects.some((aspect) => !hashes[aspect])) return { phase: "pending", status: "正在核对成片", files: [] };
  const files: ExportFile[] = [];
  const freshAspects: Aspect[] = [];
  const missing: Aspect[] = [];
  const outdated: Aspect[] = [];
  for (const aspect of aspects) {
    const finals = renders.filter((render) => render.aspect === aspect && render.quality === "final");
    const fresh = finals.filter((render) => renderMatches(render, hashes[aspect])).sort((a, b) => b.createdAt - a.createdAt);
    const newest = [...finals].sort((a, b) => b.createdAt - a.createdAt)[0];
    const chosen = fresh[0] ?? newest;
    if (fresh[0]) freshAspects.push(aspect);
    else if (newest) outdated.push(aspect);
    else missing.push(aspect);
    if (chosen) files.push({ aspect, videoHash: chosen.videoHash, srtHash: chosen.srtHash, createdAt: chosen.createdAt, stale: !fresh[0] });
  }
  if (freshAspects.length === aspects.length && aspects.length > 0) {
    return { phase: "fresh", status: files.map((file) => `${file.aspect} · 最新 · ${formatRenderAge(file.createdAt, now)}`).join(" · "), files };
  }
  if (files.length === 0) return { phase: "empty", status: "还没有成片", files };
  const parts: string[] = [];
  if (outdated.length) parts.push(`将重渲 ${outdated.join("、")}`);
  if (missing.length) parts.push(`将生成 ${missing.join("、")}`);
  if (freshAspects.length) parts.push(freshAspects.map((aspect) => `${aspect} 最新`).join(" · "));
  return { phase: "stale", status: parts.join(" · "), staleAspects: [...outdated, ...missing], files };
}
