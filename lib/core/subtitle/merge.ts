import type { Line } from "../types";
import { primaryHash } from "./secondary";

/**
 * 安全合并翻译结果 —— 不整体替换 lines，只按 id + 源文哈希对账后写回译文。
 *
 * 请求期间用户可能编辑源文、锁定、改语气，或增删/重排句子；
 * 因此以「当前文档」为准逐条应用：
 * - 同 id 行不存在（请求期间被删）→ 跳过，绝不复活；
 * - 当前源文哈希与请求时不一致（期间被改）→ 跳过，保留该句现有译文；
 * - 匹配 → 只更新 secondaryText / secondaryHash，其余字段原样保留。
 * 返回值总是新数组；未涉及的行走原对象引用，行的数量与顺序与传入一致。
 */
export function mergeSecondaryResults(
  lines: Line[],
  results: { id: string; text: string; primaryHash: string }[],
): Line[] {
  const merged = lines.slice();
  if (results.length === 0) return merged;

  const indexById = new Map<string, number>();
  lines.forEach((item, index) => {
    if (!indexById.has(item.id)) indexById.set(item.id, index);
  });

  const applied = new Set<string>();
  for (const result of results) {
    if (applied.has(result.id)) continue;
    const index = indexById.get(result.id);
    if (index === undefined) continue;
    applied.add(result.id);
    const current = merged[index];
    if (primaryHash(current.text) !== result.primaryHash) continue;
    merged[index] = { ...current, secondaryText: result.text, secondaryHash: result.primaryHash };
  }
  return merged;
}
