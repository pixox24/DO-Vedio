import type { Card, Shot, ShotKind, Ui2vTemplateId } from "./types";

export type Ui2vTemplateMeta = {
  id: Ui2vTemplateId;
  label: string;
  family: "quote" | "hero" | "compare";
  durationMs: number;
  supportedAspects: ("16:9" | "9:16")[];
  sourcePath: string;
  licenseStatus: "pending";
};

/** Quick-validation catalog. Source packages stay in motions/ and are not bundled. */
export const ui2vTemplates: Record<Ui2vTemplateId, Ui2vTemplateMeta> = {
  "creator-cinema-editorial-quote": {
    id: "creator-cinema-editorial-quote",
    label: "观点金句 · 暖纸编辑",
    family: "quote",
    durationMs: 8000,
    supportedAspects: ["16:9", "9:16"],
    sourcePath: "motions/creator-cinema-editorial-quote",
    licenseStatus: "pending",
  },
  "hero-spotlight-stage": {
    id: "hero-spotlight-stage",
    label: "片头聚光 · 舞台",
    family: "hero",
    durationMs: 4500,
    supportedAspects: ["16:9", "9:16"],
    sourcePath: "motions/hero-spotlight-stage",
    licenseStatus: "pending",
  },
  "hero-split-wipe": {
    id: "hero-split-wipe",
    label: "分屏擦除 · 编辑",
    family: "compare",
    durationMs: 4500,
    supportedAspects: ["16:9", "9:16"],
    sourcePath: "motions/hero-split-wipe",
    licenseStatus: "pending",
  },
};

export const ui2vTemplateOptions = Object.values(ui2vTemplates);

function hasCardVariant(shot: Pick<Shot, "card">, variant: Card["variant"]) {
  return shot.card?.variant === variant;
}

/** Default mapping for the quick validation; explicit templateId always wins. */
export function defaultUi2vTemplateForShot(shot: Pick<Shot, "kind" | "card" | "animation">): Ui2vTemplateId | undefined {
  if (shot.animation?.templateId) return shot.animation.templateId;
  if (shot.kind === "title") return "hero-spotlight-stage";
  if (shot.kind === "quote" || hasCardVariant(shot, "quote")) return "creator-cinema-editorial-quote";
  if (hasCardVariant(shot, "split") || shot.animation?.family === "compare") return "hero-split-wipe";
  return undefined;
}

export function isUi2vTemplateForKind(templateId: Ui2vTemplateId, kind: ShotKind) {
  if (templateId === "hero-spotlight-stage") return kind === "title";
  if (templateId === "creator-cinema-editorial-quote") return kind === "quote" || kind === "placeholder";
  return kind === "placeholder" || kind === "quote";
}
