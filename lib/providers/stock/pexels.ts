import type { GenerationFrame } from "../../core/output-spec";
import { networkError } from "../http";
import { PermanentError } from "../../pipeline/stage";
import type { StockClip, StockFile, StockSearchOptions, StockSource } from "./types";

/**
 * Pexels 视频检索。纯 HTTP，不做缓存、不写文档、不碰任务系统——
 * 缓存与写回分别在 `lib/core/stock.ts` 和 `shot-stock` stage 里。
 *
 * 免费额度是 200 请求/小时，检索与下载都算，所以 stage 的并发上限是 1。
 */

const BASE_URL = "https://api.pexels.com";
const SEARCH_PATH = "/videos/search";
/** 一次最多取多少条。免费额度和候选池都撑不住更大的值。 */
const MAX_PER_PAGE = 80;

/** 来源层自己的错误：带 HTTP 状态，让 `isRetryable` 能按 408/429/5xx 判断。 */
export class PexelsError extends Error {
  constructor(message: string, readonly status?: number, readonly retryAfterMs?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PexelsError";
  }
}

export function pexelsApiKey(value = process.env.PEXELS_API_KEY): string | undefined {
  return value?.trim() || undefined;
}

export function pexelsConfigured(value?: string): boolean {
  return !!pexelsApiKey(value);
}

/** 只认秒或 HTTP 日期两种写法；解析不出来就不带延迟重试。 */
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/**
 * Pexels 的返回不可信：字段缺失、档位列表为空、甚至整个 body 不是 JSON 都可能发生。
 * 这里只做「能读就读，读不出就丢掉这一条」，不抛错——一条坏数据不该让整次检索失败。
 */
function toClip(value: unknown): StockClip | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "number" ? raw.id : Number(raw.id);
  if (!Number.isFinite(id)) return undefined;
  const user = (raw.user && typeof raw.user === "object" ? raw.user : {}) as Record<string, unknown>;
  const files: StockFile[] = Array.isArray(raw.video_files) ? raw.video_files.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const file = entry as Record<string, unknown>;
    const fileId = typeof file.id === "number" ? file.id : Number(file.id);
    const width = typeof file.width === "number" ? file.width : Number(file.width);
    const height = typeof file.height === "number" ? file.height : Number(file.height);
    if (!Number.isFinite(fileId) || !Number.isFinite(width) || !Number.isFinite(height)) return [];
    if (typeof file.link !== "string" || !file.link) return [];
    return [{ id: fileId, url: file.link, width, height, quality: typeof file.quality === "string" ? file.quality : "", fileType: typeof file.file_type === "string" ? file.file_type : "" }];
  }) : [];
  return {
    id,
    pageUrl: typeof raw.url === "string" ? raw.url : "",
    author: typeof user.name === "string" ? user.name : "",
    authorUrl: typeof user.url === "string" ? user.url : "",
    durationSec: Number.isFinite(Number(raw.duration)) ? Number(raw.duration) : 0,
    width: Number.isFinite(Number(raw.width)) ? Number(raw.width) : 0,
    height: Number.isFinite(Number(raw.height)) ? Number(raw.height) : 0,
    files,
  };
}

export type PexelsIo = { fetchImpl?: typeof fetch; baseUrl?: string; apiKey?: string };

/**
 * 检索视频素材。按方向与最短时长在**服务端**过滤，省额度也省带宽。
 *
 * 失败分层（漏了任何一层都会让「Key 填错」被当成「网络抖动」反复重试）：
 * - 401 / 403 → `PermanentError`：Key 无效，重试一万次也没用
 * - 429 → `PexelsError(status 429, retryAfterMs)`：可重试，且带上来源要求的等待时间
 * - 其余 HTTP 错误 → `PexelsError(status)`：由 `isRetryable` 按状态码判断
 * - 非 JSON / 网络错误 → 可重试的普通错误
 */
export async function searchVideos(query: string, opts: StockSearchOptions = {}, signal?: AbortSignal, io: PexelsIo = {}): Promise<StockClip[]> {
  const apiKey = pexelsApiKey(io.apiKey);
  if (!apiKey) throw new PermanentError("未配置 PEXELS_API_KEY，请在模型中心配置");
  const trimmed = query.trim();
  if (!trimmed) throw new PermanentError("检索词为空，请先填写镜头描述");

  const url = new URL(SEARCH_PATH, io.baseUrl ?? BASE_URL);
  url.searchParams.set("query", trimmed);
  if (opts.orientation) url.searchParams.set("orientation", opts.orientation);
  // 向上取整：min_duration 是下限，宁可少拿到几条，也不能拿回一条比镜头短的。
  if (opts.minDurationSec) url.searchParams.set("min_duration", String(Math.max(1, Math.ceil(opts.minDurationSec))));
  // medium = 至少 Full HD。档位选「能填满画布的最小档」时，低于目标分辨率的档本来就用不上。
  url.searchParams.set("size", "medium");
  url.searchParams.set("per_page", String(Math.min(MAX_PER_PAGE, Math.max(1, Math.round(opts.perPage ?? 15)))));

  let response: Response;
  try {
    response = await (io.fetchImpl ?? fetch)(url, { headers: { Authorization: apiKey, Accept: "application/json" }, signal });
  } catch (e) {
    // 取消要原样抛出，否则任务取消会被翻译成「网络错误」而重试。
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw networkError(e, "检索 Pexels 素材");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new PermanentError("Pexels API Key 无效或权限不足，请在模型中心检查");
    const retryAfter = retryAfterMs(response.headers.get("retry-after"));
    if (response.status === 429) throw new PexelsError("Pexels 请求过于频繁（免费额度 200 请求/小时），稍后自动重试", 429, retryAfter);
    throw new PexelsError(`Pexels 检索失败（HTTP ${response.status}）`, response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    // 不挂 status：网关偶发返回 HTML 错误页是暂时性的，应该允许重试。
    throw new PexelsError("Pexels 返回了非 JSON 响应", undefined, undefined, { cause: e });
  }
  const videos = (body && typeof body === "object" ? (body as { videos?: unknown }).videos : undefined);
  if (!Array.isArray(videos)) throw new PexelsError("Pexels 响应缺少 videos 列表", undefined, undefined, { cause: body });
  return videos.flatMap((entry) => toClip(entry) ?? []);
}

/**
 * 选一个「能填满画布的最小档」。
 *
 * 三道过滤缺一不可：
 * 1. 只要 mp4 —— 别的容器 remotion 与 ffprobe 都不吃
 * 2. 宽高都不小于目标 —— 小档会被放大，画质不可逆地变差
 * 3. 方向必须与画幅一致 —— 横屏档塞进竖屏画幅会被 cover 裁掉两侧，等于白拿
 *
 * 最后取面积最小的一档：满足「填满」的前提下体积最小，下载最快。
 * 返回 undefined 表示这条素材不可用，调用方跳到下一条。
 */
export function pickFile(clip: StockClip, frame: GenerationFrame): StockFile | undefined {
  const wantPortrait = frame.height > frame.width;
  return clip.files
    .filter((file) => file.fileType === "video/mp4"
      && file.width >= frame.width && file.height >= frame.height
      && (file.height > file.width) === wantPortrait)
    .sort((a, b) => a.width * a.height - b.width * b.height || a.id - b.id)[0];
}

export const pexelsSource: StockSource = {
  id: "pexels",
  label: "Pexels",
  configured: () => pexelsConfigured(),
  search: (query, opts, signal) => searchVideos(query, opts, signal),
  pickFile,
};
