import { pexelsSource } from "./pexels";
import type { StockClip, StockSearchOptions, StockSource } from "./types";

/**
 * 素材来源注册表。
 *
 * 本轮只注册 Pexels。接本地素材库（`Video-asset-library/`）时在这里加一个
 * `StockSource` 实现即可——`shot-stock` stage 只认 `searchStock` / `pickStockFile`，
 * 不知道素材是从网上还是从磁盘来的。
 *
 * **不要把 stock 加进 `providerKinds`（`lib/providers/types.ts`）**：Pexels 不是
 * 生成式服务商，混进去会污染视频模型下拉框与用量口径。
 */
export const stockSources: readonly StockSource[] = [pexelsSource];

export const defaultStockSource = pexelsSource;

export function stockSource(id?: string): StockSource | undefined {
  return id ? stockSources.find((source) => source.id === id) : defaultStockSource;
}

/** 当前有没有任何可用来源。Key 没配时「制作成片」应该先给出可读的提示，而不是排一堆注定失败的任务。 */
export function stockConfigured(id?: string): boolean {
  return stockSource(id)?.configured() ?? false;
}

export function stockSourceLabel(id?: string): string {
  return stockSource(id)?.label ?? "素材来源";
}

/** 统一入口：来源可插拔，调用方不直接 import 具体实现 */
export async function searchStock(query: string, opts: StockSearchOptions, signal: AbortSignal, id?: string): Promise<StockClip[]> {
  const source = stockSource(id);
  if (!source) throw new Error(`未注册的素材来源：${id}`);
  return source.search(query, opts, signal);
}

export type { StockClip, StockFile, StockSearchOptions, StockSource } from "./types";
