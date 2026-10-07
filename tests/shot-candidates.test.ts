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

  it("旧项目只有 assetId 时也把当前素材加入历史并保持选中", () => {
    const merged = mergeCandidateHistory([], candidates("fresh", 1), "legacy-asset", 8);
    expect(merged.map((candidate) => candidate.assetId)).toEqual(["fresh-asset-0", "legacy-asset"]);
    expect(merged.find((candidate) => candidate.selected)?.assetId).toBe("legacy-asset");
  });

  it("候选字段缺失时也能兼容旧镜头", () => {
    const merged = mergeCandidateHistory(undefined, candidates("fresh", 1), "legacy-asset", 8);
    expect(merged.map((candidate) => candidate.assetId)).toEqual(["fresh-asset-0", "legacy-asset"]);
    expect(merged.find((candidate) => candidate.selected)?.assetId).toBe("legacy-asset");
  });

  it("当前素材位于容量边界时不会被新候选挤出", () => {
    const old = candidates("old", 3);
    const merged = mergeCandidateHistory(old, candidates("fresh", 2), old[2].assetId, 4);
    expect(merged).toHaveLength(4);
    expect(merged.find((candidate) => candidate.selected)?.assetId).toBe(old[2].assetId);
    expect(merged.some((candidate) => candidate.assetId === old[2].assetId)).toBe(true);
  });

  it("新候选全部重复时仍保持唯一且保留当前素材", () => {
    const current = candidates("old", 2);
    const merged = mergeCandidateHistory(current, [{ id: "fresh", assetId: current[0].assetId }, { id: "fresh-dup", assetId: current[0].assetId }], current[1].assetId, 4);
    expect(merged.map((candidate) => candidate.assetId)).toEqual([current[0].assetId, current[1].assetId]);
    expect(merged.find((candidate) => candidate.selected)?.assetId).toBe(current[1].assetId);
  });

  it("候选上限为零时返回空列表而不是写入越界元素", () => {
    expect(mergeCandidateHistory(candidates("old", 1), candidates("fresh", 1), "old-asset-0", 0)).toEqual([]);
  });
});
