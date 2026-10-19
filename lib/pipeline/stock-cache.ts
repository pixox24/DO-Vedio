import { quickHash } from "../core/hash";
import { cacheGet, cachePut } from "../server/cache";
import { getAsset } from "../server/media";

/**
 * 素材检索的两层缓存。
 *
 * 为什么是两层：
 * - **按快照哈希**（`stockAssetKey`）：这一镜的检索输入没变就直接复用上次定下的素材，
 *   连搜索都不打。额度是 200 请求/小时，同一镜重试一次就白花一次额度。
 * - **按下载地址**（`stockUrlKey`）：存储层是 sha256 内容寻址、天然去重，但
 *   **没有「按 URL 复用」这一层**——同一条素材被两个镜头选中会下载两次。
 *
 * 两条不变量：
 * 1. **空结果永不缓存**。没有「缓存空结果」这个入口，所以「没搜到」与「请求失败」
 *    都不会被记住，下次会重新打。把两者混在一起缓存，用户改完描述还得手动清缓存。
 * 2. **密钥绝不落盘**。缓存键是 URL 的哈希、缓存值是 assetId，所以带签名的下载地址
 *    既不做键也不做值。素材的 `meta` 里同理只放 `pageUrl`（人可点的网页地址）。
 */

/** 一次成功检索的落点：这一镜最终用了哪条素材。 */
export type StockAssetRecord = {
  source: string;
  assetId: string;
  clipId: number;
  author: string;
  pageUrl: string;
};

export const stockAssetKey = (snapshotHash: string) => `stock:${snapshotHash}`;

/**
 * 下载地址的缓存键。键里带上来源 id，避免不同来源的 URL 撞在一起；
 * `quickHash` 让带签名/token 的地址不以明文进库。
 */
export const stockUrlKey = (source: string, url: string) => `stock-url:${source}:${quickHash(url)}`;

/** 命中要求素材仍在库里：素材被回收（`lib/server/gc.ts`）后必须当未命中。 */
export function cachedStockAsset(snapshotHash: string): StockAssetRecord | undefined {
  const entry = cacheGet<StockAssetRecord>(stockAssetKey(snapshotHash));
  return entry?.assetId && getAsset(entry.assetId) ? entry : undefined;
}

/** 只缓存确实拿到素材的结果。没有 assetId 的调用是空操作，不是「记住没搜到」。 */
export function rememberStockAsset(snapshotHash: string, record: StockAssetRecord) {
  if (!record.assetId) return;
  cachePut(stockAssetKey(snapshotHash), "stock", record);
}

/** 这条下载地址是不是已经下过了。命中就不必再拉一遍。 */
export function cachedStockFile(source: string, url: string): string | undefined {
  const entry = cacheGet<{ assetId?: string }>(stockUrlKey(source, url));
  return entry?.assetId && getAsset(entry.assetId) ? entry.assetId : undefined;
}

export function rememberStockFile(source: string, url: string, assetId: string) {
  if (!assetId) return;
  cachePut(stockUrlKey(source, url), "stock", { assetId });
}
