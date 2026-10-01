import { visualStyleSchema, type VisualStyle } from "../core/types";

const base = {
  kind: "aix" as const, aixId: "Aix0001", libraryVersion: "0.6.0", styleVersion: "1.1.0", contentHash: "a".repeat(64), category: "photographic",
  features: [{ id: "F01", axis: "medium" as const, tier: "core" as const, text: "摄影式胶片画面" }], avoid: [{ id: "N01", text: "塑料磨皮" }], suitableFor: ["人物"], weakFor: [], knownFailures: [],
  provenance: { source_type: "original" as const, source_ref: null, license_ref: null, commercial_use: "allowed" as const, attribution: null },
  quality: { review_status: "passed" as const, tested_tool: null, tested_at: null, evidence_ref: null },
};

export const aixFixture = (overrides: Partial<VisualStyle> = {}): VisualStyle => visualStyleSchema.parse({
  id: "Aix0001", name: "测试 Aix 风格", description: "测试快照", medium: "photo", rendering: "胶片渲染", texture: "细腻颗粒",
  palette: { schemes: [["#18252a", "#3e6870", "#b7d2ce"]], accent: "#a8d6c8" }, colorGrade: "低饱和雾青", saturation: "mid", contrast: "mid", lighting: "柔和侧逆光", atmosphere: "克制",
  moodTweaks: {}, deniedMoods: [], lens: "", depthOfField: "shallow", composition: "大面积负空间", negative: ["塑料磨皮"], strength: "normal", suits: [], source: base, themeSource: "aix-derived", ...overrides,
});

export const aixFixtureStyles = [aixFixture(), aixFixture({ id: "Aix0002", name: "测试 Aix 插画", medium: "illustration", lighting: "通透柔光", source: { ...base, aixId: "Aix0002", category: "illustration" } })];
