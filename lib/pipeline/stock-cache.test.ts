import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, expect, it } from "vitest";

/**
 * 素材缓存的两条不变量：**空结果永不缓存**、**密钥绝不落盘**。
 * 加上「素材被回收后视为未命中」——否则会写回一个库里已经没有的 assetId，
 * 门禁查 `getAsset` 时才发现，表现成「视频缺失」但看不出原因。
 */

let dir = "";
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "dovedio-stock-cache-")); process.env.DATA_DIR = dir; });
afterAll(async () => { (await import("@/lib/server/db")).closeDb(); rmSync(dir, { recursive: true, force: true }); });

const newAsset = async (seed: number) => (await import("@/lib/server/media")).putBuffer(new Uint8Array([seed, seed, seed]), { ext: "bin" });

it("按快照哈希复用同一镜的素材：第二次不再打网络", async () => {
  const { cachedStockAsset, rememberStockAsset, stockAssetKey } = await import("./stock-cache");
  const { cacheHas } = await import("../server/cache");
  const asset = await newAsset(1);
  const hash = "snapshot-a";

  expect(cacheHas(stockAssetKey(hash))).toBe(false);
  expect(cachedStockAsset(hash)).toBeUndefined();

  rememberStockAsset(hash, { source: "pexels", assetId: asset.hash, clipId: 7, author: "A", pageUrl: "https://page/7" });
  expect(cachedStockAsset(hash)).toMatchObject({ assetId: asset.hash, clipId: 7, pageUrl: "https://page/7" });
});

it("空结果不写缓存：没有「记住没搜到」这个入口", async () => {
  const { cachedStockAsset, rememberStockAsset, stockAssetKey } = await import("./stock-cache");
  const { cacheHas } = await import("../server/cache");
  const hash = "snapshot-empty";

  rememberStockAsset(hash, { source: "pexels", assetId: "", clipId: 0, author: "", pageUrl: "" });
  expect(cacheHas(stockAssetKey(hash))).toBe(false);
  expect(cachedStockAsset(hash)).toBeUndefined();
});

it("素材被回收后缓存视为未命中", async () => {
  const { cachedStockAsset, rememberStockAsset } = await import("./stock-cache");
  const { run } = await import("../server/db");
  const asset = await newAsset(2);
  const hash = "snapshot-gc";
  rememberStockAsset(hash, { source: "pexels", assetId: asset.hash, clipId: 1, author: "", pageUrl: "" });
  expect(cachedStockAsset(hash)).toBeDefined();
  run("DELETE FROM assets WHERE hash = ?", asset.hash);
  expect(cachedStockAsset(hash)).toBeUndefined();
});

it("URL 缓存让同一条素材只下一次，且不同来源/不同地址互不串味", async () => {
  const { cachedStockFile, rememberStockFile } = await import("./stock-cache");
  const asset = await newAsset(3);
  const url = "https://player.vimeo.com/external/1.mp4?s=signed-token";

  expect(cachedStockFile("pexels", url)).toBeUndefined();
  rememberStockFile("pexels", url, asset.hash);
  expect(cachedStockFile("pexels", url)).toBe(asset.hash);
  expect(cachedStockFile("local", url)).toBeUndefined();
  expect(cachedStockFile("pexels", `${url}x`)).toBeUndefined();
});

it("带签名的下载地址不以明文进库：键是哈希、值只有 assetId", async () => {
  const { rememberStockFile, stockUrlKey } = await import("./stock-cache");
  const { cacheHas, cacheMany } = await import("../server/cache");
  const asset = await newAsset(4);
  const url = "https://player.vimeo.com/external/1.mp4?s=SECRET-TOKEN";

  rememberStockFile("pexels", url, asset.hash);
  const key = stockUrlKey("pexels", url);
  expect(key).not.toContain("SECRET-TOKEN");
  expect(key).not.toContain("vimeo");
  expect(cacheHas(key)).toBe(true);
  expect(JSON.stringify([...cacheMany([key]).values()])).not.toContain("SECRET-TOKEN");
});

it("URL 缓存也认素材是否还在库里", async () => {
  const { cachedStockFile, rememberStockFile } = await import("./stock-cache");
  const { run } = await import("../server/db");
  const asset = await newAsset(5);
  const url = "https://cdn.example/5.mp4";
  rememberStockFile("pexels", url, asset.hash);
  expect(cachedStockFile("pexels", url)).toBe(asset.hash);
  run("DELETE FROM assets WHERE hash = ?", asset.hash);
  expect(cachedStockFile("pexels", url)).toBeUndefined();
});
