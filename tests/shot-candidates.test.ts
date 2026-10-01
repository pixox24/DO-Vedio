import { describe, expect, it } from "vitest";
import { mergeCandidateHistory } from "@/lib/pipeline/stages/shot-generate";

const candidates = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, assetId: `${prefix}-asset-${index}` }));

describe("镜头候选历史", () => {
  it("达到上限时仍保留当前正在使用的旧素材", () => {
    const old = candidates("old", 8);
    const fresh = candidates("fresh", 2);
    const merged = mergeCandidateHistory(old, fresh, old[7].assetId, 8);
    expect(merged).toHaveLength(8);
    expect(merged.some((candidate) => candidate.assetId === old[7].assetId && candidate.selected)).toBe(true);
    expect(merged.filter((candidate) => candidate.assetId.startsWith("fresh-")).length).toBe(2);
  });

  it("当前素材仍被选中，同时保留新旧候选", () => {
    const merged = mergeCandidateHistory(candidates("old", 2), candidates("fresh", 2), "old-asset-0", 8);
    expect(merged.find((candidate) => candidate.selected)?.assetId).toBe("old-asset-0");
    expect(merged.map((candidate) => candidate.assetId)).toEqual(["fresh-asset-0", "fresh-asset-1", "old-asset-0", "old-asset-1"]);
  });
});
