import { describe, expect, it } from "vitest";
import { blankShot } from "./shots";
import { selectShotCandidate } from "./shot-asset";
import type { Shot, ShotAssetVariant } from "./types";

function variant(aspect: "16:9" | "9:16", assetId: string, extra: Partial<ShotAssetVariant> = {}): ShotAssetVariant {
  const portrait = aspect === "9:16";
  return { assetId, promptHash: "hash", aspect, width: portrait ? 1080 : 1920, height: portrait ? 1920 : 1080, source: "generated", generatedAt: "2026-10-10T00:00:00.000Z", ...extra };
}

function shot(): Shot {
  return {
    ...blankShot("s1", "line"),
    kind: "image",
    assetId: "old",
    assetPromptHash: "shot-hash",
    candidates: [
      { id: "old", assetId: "old", selected: true },
      { id: "new", assetId: "new", selected: false },
    ],
    assetVariants: {
      "16:9": variant("16:9", "old"),
      "9:16": variant("9:16", "portrait-old"),
    },
  };
}

describe("选中候选", () => {
  it("分别生成时只改正在看的画幅，卡片和这一幅指向同一张", () => {
    const before = shot();
    const next = selectShotCandidate(before, "new", { aspect: "16:9", framing: "smart-dual", aspects: ["16:9", "9:16"] });
    expect(next).not.toBeNull();
    expect(before.assetId).toBe("old");
    expect(before.candidates[0]?.selected).toBe(true);
    expect(next!.assetId).toBe("new");
    expect(next!.candidates.map((item) => item.selected)).toEqual([false, true]);
    expect(next!.assetVariants["16:9"]).toMatchObject({ assetId: "new", source: "generated", width: 1920, height: 1080 });
    expect(next!.assetVariants["16:9"]?.generatedAt).toBeUndefined();
    expect(next!.assetVariants["9:16"]).toEqual(before.assetVariants["9:16"]);
    expect(next!.assetPromptHash).toBe("unknown");
  });

  it("逐画幅生成同样只改当前这一幅", () => {
    const next = selectShotCandidate(shot(), "new", { aspect: "9:16", framing: "per-output", aspects: ["16:9", "9:16"] });
    expect(next!.assetId).toBe("new");
    expect(next!.assetVariants["9:16"]?.assetId).toBe("new");
    expect(next!.assetVariants["16:9"]?.assetId).toBe("old");
  });

  it("共享素材时每个输出画幅都指向这张，其他画幅标明来源", () => {
    const next = selectShotCandidate(shot(), "new", { aspect: "16:9", framing: "shared", aspects: ["16:9", "9:16"] });
    expect(next!.assetVariants["16:9"]).toMatchObject({ assetId: "new", source: "generated" });
    expect(next!.assetVariants["16:9"]?.sourceAspect).toBeUndefined();
    expect(next!.assetVariants["9:16"]).toMatchObject({ assetId: "new", source: "shared", sourceAspect: "16:9", width: 1080, height: 1920 });
  });

  it("再次选中同一张时保留生成时间", () => {
    const next = selectShotCandidate(shot(), "old", { aspect: "16:9", framing: "smart-dual" });
    expect(next!.assetVariants["16:9"]?.generatedAt).toBe("2026-10-10T00:00:00.000Z");
    expect(next!.assetVariants["16:9"]?.assetId).toBe("old");
  });

  it("没有这枚候选时不改镜头", () => {
    const before = shot();
    expect(selectShotCandidate(before, "missing", { aspect: "16:9", framing: "smart-dual" })).toBeNull();
    expect(before.assetId).toBe("old");
  });

  it("新旧候选切换各自恢复生成指纹，切回旧图仍然过期", () => {
    const current = shot();
    current.candidates = [
      { id: "old", assetId: "old", selected: true, promptHash: "old-source", generationPromptHash: "old-generation" },
      { id: "new", assetId: "new", selected: false, promptHash: "current-source", generationPromptHash: "new-generation" },
    ];
    const fresh = selectShotCandidate(current, "new", { aspect: "16:9", framing: "shared" })!;
    expect(fresh.assetPromptHash).toBe("current-source");
    expect(fresh.assetVariants["16:9"]?.promptHash).toBe("new-generation");
    const old = selectShotCandidate(fresh, "old", { aspect: "16:9", framing: "shared" })!;
    expect(old.assetPromptHash).toBe("old-source");
    expect(old.assetVariants["16:9"]?.promptHash).toBe("old-generation");
  });
});
