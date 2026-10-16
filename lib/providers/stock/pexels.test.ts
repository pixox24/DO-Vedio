import { describe, expect, it, vi } from "vitest";
import { PermanentError } from "@/lib/pipeline/stage";
import { PexelsError, pexelsConfigured, pickFile, retryAfterMs, searchVideos } from "./pexels";
import type { StockClip } from "./types";

const frame = { aspect: "16:9" as const, width: 1920, height: 1080, fps: 30 };
const portraitFrame = { aspect: "9:16" as const, width: 1080, height: 1920, fps: 30 };

const clip = (patch: Partial<StockClip> = {}): StockClip => ({
  id: 1, pageUrl: "https://www.pexels.com/video/1", author: "A", authorUrl: "https://www.pexels.com/@a",
  durationSec: 12, width: 1920, height: 1080,
  files: [{ id: 10, url: "https://cdn/10.mp4", width: 1920, height: 1080, quality: "hd", fileType: "video/mp4" }],
  ...patch,
});

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

/** 给 mock 显式参数类型，否则 `mock.calls[0][0]` 推成空元组读不出 URL。 */
type FetchImpl = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const mockFetch = (impl: FetchImpl) => vi.fn(impl);

describe("Pexels 检索：请求构造", () => {
  it("把方向、最短时长与每页条数都放到服务端过滤，省额度也省带宽", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse({ videos: [] }));
    await searchVideos("woman walking", { orientation: "portrait", minDurationSec: 7.4, perPage: 9 }, undefined, { apiKey: "k", fetchImpl });
    const url = fetchImpl.mock.calls[0][0] as URL;
    expect(url.origin + url.pathname).toBe("https://api.pexels.com/videos/search");
    expect(url.searchParams.get("query")).toBe("woman walking");
    expect(url.searchParams.get("orientation")).toBe("portrait");
    // Pexels 的 min_duration 只认整数秒：向上取整，宁可选到略长的素材
    expect(url.searchParams.get("min_duration")).toBe("8");
    expect(url.searchParams.get("per_page")).toBe("9");
    expect(url.searchParams.get("size")).toBe("medium");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "k" } });
  });

  it("每页条数被上限夹住，不传方向时不带该参数", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse({ videos: [] }));
    await searchVideos("nature", { perPage: 5000 }, undefined, { apiKey: "k", fetchImpl });
    const url = fetchImpl.mock.calls[0][0] as URL;
    expect(url.searchParams.get("per_page")).toBe("80");
    expect(url.searchParams.has("orientation")).toBe(false);
  });

  it("没配 Key 时直接拒绝，不打网络", async () => {
    const fetchImpl = vi.fn();
    await expect(searchVideos("nature", {}, undefined, { apiKey: "   ", fetchImpl })).rejects.toBeInstanceOf(PermanentError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(pexelsConfigured("  ")).toBe(false);
    expect(pexelsConfigured("abc")).toBe(true);
  });

  it("空检索词不打网络：它是缓存键的一部分，空值会污染缓存", async () => {
    const fetchImpl = vi.fn();
    await expect(searchVideos("   ", {}, undefined, { apiKey: "k", fetchImpl })).rejects.toBeInstanceOf(PermanentError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Pexels 检索：失败分层", () => {
  it("401/403 是 PermanentError：Key 无效，重试一万次也没用", async () => {
    for (const status of [401, 403]) {
      await expect(searchVideos("nature", {}, undefined, { apiKey: "k", fetchImpl: mockFetch(async () => new Response("", { status })) }))
        .rejects.toBeInstanceOf(PermanentError);
    }
  });

  it("429 是可重试错误并带上来源要求的等待时间", async () => {
    const fetchImpl = mockFetch(async () => new Response("", { status: 429, headers: { "retry-after": "42" } }));
    const error = await searchVideos("nature", {}, undefined, { apiKey: "k", fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PexelsError);
    expect((error as PexelsError).status).toBe(429);
    expect((error as PexelsError).retryAfterMs).toBe(42_000);
  });

  it("其余 HTTP 错误带上状态码，交给 isRetryable 判断", async () => {
    const fetchImpl = mockFetch(async () => new Response("", { status: 500 }));
    const error = await searchVideos("nature", {}, undefined, { apiKey: "k", fetchImpl }).catch((e: unknown) => e);
    expect((error as PexelsError).status).toBe(500);
  });

  it("非 JSON 响应不挂状态码：网关偶发返回 HTML 错误页是暂时性的，应该允许重试", async () => {
    const fetchImpl = mockFetch(async () => new Response("<html>bad gateway</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const error = await searchVideos("nature", {}, undefined, { apiKey: "k", fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PexelsError);
    expect((error as PexelsError).status).toBeUndefined();
  });

  it("取消原样抛出，不被翻译成「网络错误」而重试", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = mockFetch(async () => { throw abort; });
    await expect(searchVideos("nature", {}, undefined, { apiKey: "k", fetchImpl })).rejects.toBe(abort);
  });

  it("网络错误翻译成可读原因", async () => {
    const fetchImpl = mockFetch(async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }); });
    const error = await searchVideos("nature", {}, undefined, { apiKey: "k", fetchImpl }).catch((e: unknown) => e);
    expect((error as Error).message).toContain("找不到服务商地址");
    expect((error as Error).message).toContain("ENOTFOUND");
  });

  it("retry-after 支持秒数与 HTTP 日期两种写法", () => {
    expect(retryAfterMs("30")).toBe(30_000);
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs("not-a-date")).toBeUndefined();
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(retryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(10_000);
    expect(retryAfterMs("Thu, 01 Jan 2020 00:00:00 GMT", now)).toBe(0);
  });
});

describe("Pexels 检索：响应解析", () => {
  it("丢掉字段缺失的条目，而不是让整次检索失败", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse({ videos: [
      null, "nope", { id: "not-a-number" },
      { id: 7, duration: "9", width: 1920, height: 1080, url: "https://page/7", user: { name: "B", url: "https://@b" }, video_files: [
        { id: 1, link: "https://cdn/1.mp4", width: "1920", height: 1080, quality: "hd", file_type: "video/mp4" },
        { id: 2, width: 1920, height: 1080, file_type: "video/mp4" },
        "garbage",
      ] },
    ] }));
    const clips = await searchVideos("nature", {}, undefined, { apiKey: "k", fetchImpl });
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ id: 7, durationSec: 9, author: "B", pageUrl: "https://page/7" });
    // 没有 link 的档被丢掉，只剩一条
    expect(clips[0].files).toEqual([{ id: 1, url: "https://cdn/1.mp4", width: 1920, height: 1080, quality: "hd", fileType: "video/mp4" }]);
  });

  it("缺少 videos 列表时报错，不静默返回空数组", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse({ error: "nope" }));
    await expect(searchVideos("nature", {}, undefined, { apiKey: "k", fetchImpl })).rejects.toBeInstanceOf(PexelsError);
  });

  it("合法但为空的结果返回空数组（由调用方决定怎么提示）", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse({ videos: [] }));
    await expect(searchVideos("nature", {}, undefined, { apiKey: "k", fetchImpl })).resolves.toEqual([]);
  });
});

describe("pickFile：能填满画布的最小档", () => {
  it("只要 mp4、宽高都不小于目标、方向一致，取面积最小", () => {
    const files = [
      { id: 1, url: "a", width: 1920, height: 1080, quality: "hd", fileType: "video/mp4" },
      { id: 2, url: "b", width: 3840, height: 2160, quality: "uhd", fileType: "video/mp4" },
      { id: 3, url: "c", width: 960, height: 540, quality: "sd", fileType: "video/mp4" },
      { id: 4, url: "d", width: 1920, height: 1080, quality: "hd", fileType: "video/webm" },
      { id: 5, url: "e", width: 1080, height: 1920, quality: "hd", fileType: "video/mp4" },
    ];
    expect(pickFile(clip({ files }), frame)?.id).toBe(1);
  });

  it("面积相同时按 id 取，保证同一素材每次选到同一档", () => {
    const files = [
      { id: 9, url: "z", width: 1920, height: 1080, quality: "", fileType: "video/mp4" },
      { id: 3, url: "y", width: 1920, height: 1080, quality: "", fileType: "video/mp4" },
    ];
    expect(pickFile(clip({ files }), frame)?.id).toBe(3);
  });

  it("方向不符的档一律跳过：横屏档塞进竖屏画幅会被 cover 裁掉两侧", () => {
    const files = [{ id: 1, url: "a", width: 3840, height: 2160, quality: "uhd", fileType: "video/mp4" }];
    expect(pickFile(clip({ files }), portraitFrame)).toBeUndefined();
  });

  it("没有合格档时返回 undefined，由调用方跳到下一条素材", () => {
    expect(pickFile(clip({ files: [] }), frame)).toBeUndefined();
    expect(pickFile(clip({ files: [{ id: 1, url: "a", width: 640, height: 360, quality: "sd", fileType: "video/mp4" }] }), frame)).toBeUndefined();
  });

  it("竖屏画幅能选到 1080×1920 而不是更大的 2160×3840", () => {
    const files = [
      { id: 1, url: "a", width: 2160, height: 3840, quality: "uhd", fileType: "video/mp4" },
      { id: 2, url: "b", width: 1080, height: 1920, quality: "hd", fileType: "video/mp4" },
    ];
    expect(pickFile(clip({ files }), portraitFrame)?.id).toBe(2);
  });
});
