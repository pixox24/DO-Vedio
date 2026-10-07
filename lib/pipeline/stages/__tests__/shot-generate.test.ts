import { describe, expect, it } from "vitest";
import { mergeCandidateHistory } from "../shot-generate";

const candidates = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    assetId: `${prefix}-asset-${index}`,
  }));

describe("镜头候选历史合并", () => {
  it("达到上限时仍保留当前正在使用的旧素材", () => {
    const old = candidates("old", 8);
    const fresh = candidates("fresh", 2);
    const merged = mergeCandidateHistory(old, fresh, old[7].assetId, 8);

    expect(merged).toHaveLength(8);
    expect(merged.some((candidate) => candidate.assetId === old[7].assetId && candidate.selected)).toBe(true);
    expect(merged.filter((candidate) => candidate.assetId.startsWith("fresh-")).length).toBe(2);
  });

  it("当前素材仍被选中，同时保留新旧候选", () => {
    const merged = mergeCandidateHistory(
      candidates("old", 2),
      candidates("fresh", 2),
      "old-asset-0",
      8
    );

    expect(merged.find((candidate) => candidate.selected)?.assetId).toBe("old-asset-0");
    expect(merged.map((candidate) => candidate.assetId)).toEqual([
      "fresh-asset-0",
      "fresh-asset-1",
      "old-asset-0",
      "old-asset-1",
    ]);
  });

  it("旧项目只有 assetId 时也把当前素材加入历史并保持选中", () => {
    const merged = mergeCandidateHistory([], candidates("fresh", 1), "legacy-asset", 8);

    expect(merged.map((candidate) => candidate.assetId)).toEqual([
      "fresh-asset-0",
      "legacy-asset",
    ]);
    expect(merged.find((candidate) => candidate.selected)?.assetId).toBe("legacy-asset");
  });

  it("候选字段缺失时也能兼容旧镜头", () => {
    const merged = mergeCandidateHistory(undefined, candidates("fresh", 1), "legacy-asset", 8);

    expect(merged.map((candidate) => candidate.assetId)).toEqual([
      "fresh-asset-0",
      "legacy-asset",
    ]);
    expect(merged.find((candidate) => candidate.selected)?.assetId).toBe("legacy-asset");
  });

  // ========== P0 补充测试：边界情况 ==========

  it("当前素材在上限边缘位置（index === max - 1）时仍保留", () => {
    const old = candidates("old", 10);
    const fresh = candidates("fresh", 8);
    const currentAssetId = old[7].assetId; // 正好在上限边缘

    const merged = mergeCandidateHistory(old, fresh, currentAssetId, 8);

    expect(merged).toHaveLength(8);
    expect(merged.some((c) => c.assetId === currentAssetId)).toBe(true);
    expect(merged.find((c) => c.selected)?.assetId).toBe(currentAssetId);
  });

  it("新候选全部与当前素材重复时不会丢失", () => {
    const current = candidates("old", 5);
    const currentAssetId = current[2].assetId;
    // 新候选包含当前素材
    const fresh = [
      { id: "new-1", assetId: currentAssetId },
      { id: "new-2", assetId: "old-asset-1" },
    ];

    const merged = mergeCandidateHistory(current, fresh, currentAssetId, 8);

    expect(merged.find((c) => c.selected)?.assetId).toBe(currentAssetId);
    expect(merged.filter((c) => c.assetId === currentAssetId).length).toBe(1); // 去重
  });

  it("空上限时返回空数组", () => {
    const merged = mergeCandidateHistory(candidates("old", 5), candidates("fresh", 2), "old-asset-0", 0);

    expect(merged).toHaveLength(0);
  });

  it("新候选超过上限时按优先级截断", () => {
    const fresh = candidates("fresh", 10);
    const merged = mergeCandidateHistory([], fresh, undefined, 4);

    expect(merged).toHaveLength(4);
    expect(merged.map((c) => c.assetId)).toEqual([
      "fresh-asset-0",
      "fresh-asset-1",
      "fresh-asset-2",
      "fresh-asset-3",
    ]);
  });

  it("输入包含重复 assetId 时自动去重", () => {
    const duplicates = [
      { id: "id-1", assetId: "asset-A" },
      { id: "id-2", assetId: "asset-A" }, // 重复
      { id: "id-3", assetId: "asset-B" },
      { id: "id-4", assetId: "asset-A" }, // 重复
    ];

    const merged = mergeCandidateHistory([], duplicates, undefined, 8);

    expect(merged).toHaveLength(2);
    expect(merged.map((c) => c.assetId)).toEqual(["asset-A", "asset-B"]);
  });

  it("当前素材不在新旧候选中时自动插入并选中", () => {
    const old = candidates("old", 3);
    const fresh = candidates("fresh", 2);
    const orphanAssetId = "orphan-asset";

    const merged = mergeCandidateHistory(old, fresh, orphanAssetId, 8);

    expect(merged.some((c) => c.assetId === orphanAssetId)).toBe(true);
    expect(merged.find((c) => c.selected)?.assetId).toBe(orphanAssetId);
  });

  it("新候选覆盖旧候选的同 assetId 记录", () => {
    const old = [
      { id: "old-id", assetId: "asset-A" },
      { id: "old-id-2", assetId: "asset-B" },
    ];
    const fresh = [
      { id: "new-id", assetId: "asset-A" }, // 同 assetId，应该覆盖
    ];

    const merged = mergeCandidateHistory(old, fresh, undefined, 8);

    const assetA = merged.find((c) => c.assetId === "asset-A");
    expect(assetA?.id).toBe("new-id"); // 新 id 覆盖旧 id
  });

  it("保证选中逻辑优先级：当前素材 > 第一个新候选", () => {
    const old = candidates("old", 2);
    const fresh = candidates("fresh", 3);

    // 场景 1: 当前素材存在
    const merged1 = mergeCandidateHistory(old, fresh, "old-asset-0", 8);
    expect(merged1.find((c) => c.selected)?.assetId).toBe("old-asset-0");

    // 场景 2: 当前素材不存在
    const merged2 = mergeCandidateHistory(old, fresh, undefined, 8);
    expect(merged2.find((c) => c.selected)?.assetId).toBe("fresh-asset-0");
  });
});
