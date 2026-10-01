import { describe, expect, it } from "vitest";
import { emptyDoc, projectDocSchema } from "../lib/core/types";
import { aspectsForSettings, normalizeSettings, outputSpecForRequest, outputSpecsFor, previewSpecFor } from "../lib/core/output-spec";

describe("输出规格与旧项目迁移", () => {
  it("新项目默认只有横屏 1080p", () => {
    const doc = emptyDoc();
    expect(doc.settings.outputSpecIds).toEqual(["landscape-1080p"]);
    expect(outputSpecsFor(doc.settings).map((spec) => spec.id)).toEqual(["landscape-1080p"]);
    expect(previewSpecFor(doc.settings).aspect).toBe("16:9");
  });

  it.each([
    [["16:9"], ["landscape-1080p"]],
    [["9:16"], ["portrait-1080p"]],
    [["16:9", "9:16"], ["landscape-1080p", "portrait-1080p"]],
  ])("旧项目画幅 %j 保持输出目标", (aspects, ids) => {
    const settings = normalizeSettings({ aspects });
    expect(settings.outputSpecIds).toEqual(ids);
    expect(aspectsForSettings(settings)).toEqual(aspects);
  });

  it("已有 outputSpecIds 优先于不一致的旧 aspects，并推导合法预览", () => {
    const settings = normalizeSettings({ aspects: ["16:9"], outputSpecIds: ["portrait-1080p"], previewAspect: "16:9" });
    expect(settings.outputSpecIds).toEqual(["portrait-1080p"]);
    expect(settings.previewAspect).toBe("9:16");
    expect(outputSpecForRequest(settings).id).toBe("portrait-1080p");
  });

  it("旧 shot 没有 assetVariants 时仍可通过 schema 读取", () => {
    const doc = projectDocSchema.parse({ ...emptyDoc(), shots: [{ id: "s", at: { lineId: "l", char: 0 }, kind: "image", assetId: "legacy", description: "旧图" }] });
    expect(doc.shots[0].assetId).toBe("legacy");
    expect(doc.shots[0].assetVariants).toEqual({});
  });
});
