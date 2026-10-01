import type { AixDetail, AixFeature, AixStyle } from "./schema";
import { deriveTheme } from "./palette";
import { deriveMotion } from "./motion";
import { visualStyleSchema, type StyleMedium, type VisualStyle } from "../core/types";

const mediumByCategory: Record<AixStyle["category"], StyleMedium> = {
  photographic: "photo",
  illustration: "illustration",
  painting: "oil",
  graphic: "flat-vector",
  "3d": "3d",
};

const textOf = (features: AixFeature[], axis: AixFeature["axis"], tiers: Set<AixFeature["tier"]>) =>
  features.filter((f) => f.axis === axis && tiers.has(f.tier)).map((f) => f.text).join("；");

function mediumOf(style: AixStyle): StyleMedium {
  const medium = style.features.find((f) => f.axis === "medium")?.text ?? "";
  if (/水彩/.test(medium)) return "watercolor";
  if (/水墨|墨线|宣纸/.test(medium)) return "ink";
  if (/油画|厚涂/.test(medium)) return "oil";
  if (/漫画|美漫/.test(medium)) return "comic";
  if (/像素/.test(medium)) return "pixel";
  if (/剪纸/.test(medium)) return "paper-cut";
  if (/动漫|二次元/.test(medium)) return "anime";
  return mediumByCategory[style.category];
}

/** Convert one validated Aix record into the project's immutable style snapshot. */
export function aixToVisualStyle(detail: AixDetail, strength: "light" | "normal" | "strong" = "normal", libraryVersion = "0.6.0"): VisualStyle {
  const { style, contentHash } = detail;
  const tiers = strength === "light" ? new Set(["core"] as const) : strength === "strong" ? new Set(["core", "support", "accent"] as const) : new Set(["core", "support"] as const);
  // 配色由「palette」轴的描述推导出真实色值，代码画面才和生成画面同调；解析不出来时按分类兜底
  const theme = deriveTheme(textOf(style.features, "palette", new Set(["core", "support", "accent"] as const)), style.category);
  const source = {
    kind: "aix" as const, aixId: style.id, libraryVersion, styleVersion: style.version, contentHash,
    category: style.category, features: style.features, avoid: style.avoid, suitableFor: style.suitable_for, weakFor: style.weak_for,
    knownFailures: style.known_failures, provenance: style.provenance, quality: style.quality,
  };
  return visualStyleSchema.parse({
    id: style.id, name: style.name, description: style.description, medium: mediumOf(style),
    rendering: textOf(style.features, "line", tiers), texture: textOf(style.features, "texture", tiers),
    palette: { schemes: theme.schemes, accent: theme.accent }, colorGrade: textOf(style.features, "palette", tiers),
    saturation: /低饱和|哑光|灰调/.test(textOf(style.features, "palette", tiers)) ? "low" : "mid",
    contrast: /高对比|强对比|极高明暗/.test(textOf(style.features, "palette", tiers)) ? "high" : "mid",
    lighting: textOf(style.features, "lighting", tiers),
    // Aix 没有独立的 atmosphere 轴，用构图与光影文本合成氛围描述，供情绪调制和提示词使用
    atmosphere: [textOf(style.features, "composition", tiers), textOf(style.features, "lighting", tiers)].filter(Boolean).join("；"),
    moodTweaks: {}, deniedMoods: [],
    lens: textOf(style.features, "line", tiers), depthOfField: /浅景深/.test(textOf(style.features, "composition", tiers)) ? "shallow" : "deep",
    composition: textOf(style.features, "composition", tiers), negative: style.avoid.map((a) => a.text), strength,
    suits: style.suitable_for, motion: deriveMotion(style), themeSource: "aix-derived", source,
  });
}

export function aixSnapshot(detail: AixDetail) {
  return aixToVisualStyle(detail);
}
