import type { Card, Shot, ShotKind, ShotMode, LegacyTemplateId } from "./types";

export type LegacyTemplateMeta = {
  id: LegacyTemplateId;
  label: string;
  family: "quote" | "hero" | "compare" | "stat" | "list" | "qa" | "cta" | "alert" | "definition" | "timeline" | "profile";
  durationMs: number;
  supportedAspects: ("16:9" | "9:16")[];
  sourcePath: string;
  licenseStatus: "pending" | "original";
};

/** 成片用的卡片模板。旧版问答/号召模板保留在目录里，仅用于读取历史项目。 */
export const legacyTemplates: Record<LegacyTemplateId, LegacyTemplateMeta> = {
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
  "card-stat": {
    id: "card-stat",
    label: "数据卡 · 聚焦放大",
    family: "stat",
    durationMs: 4000,
    supportedAspects: ["16:9", "9:16"],
    sourcePath: "remotion/animation/legacy-templates.tsx",
    licenseStatus: "original",
  },
  "card-list": {
    id: "card-list",
    label: "列表卡 · 逐条浮现",
    family: "list",
    durationMs: 4000,
    supportedAspects: ["16:9", "9:16"],
    sourcePath: "remotion/animation/legacy-templates.tsx",
    licenseStatus: "original",
  },
  "card-qa": {
    id: "card-qa",
    label: "问答卡 · 对话展开",
    family: "qa",
    durationMs: 4000,
    supportedAspects: ["16:9", "9:16"],
    sourcePath: "remotion/animation/legacy-templates.tsx",
    licenseStatus: "original",
  },
  "card-cta": {
    id: "card-cta",
    label: "号召卡 · 脉动强调",
    family: "cta",
    durationMs: 4000,
    supportedAspects: ["16:9", "9:16"],
    sourcePath: "remotion/animation/legacy-templates.tsx",
    licenseStatus: "original",
  },
  "card-alert": {
    id: "card-alert",
    label: "提示卡 · 边框呼吸",
    family: "alert",
    durationMs: 4000,
    supportedAspects: ["16:9", "9:16"],
    sourcePath: "remotion/animation/legacy-templates.tsx",
    licenseStatus: "original",
  },
  "card-definition": {
    id: "card-definition",
    label: "定义卡 · 分层展开",
    family: "definition",
    durationMs: 4000,
    supportedAspects: ["16:9", "9:16"],
    sourcePath: "remotion/animation/legacy-templates.tsx",
    licenseStatus: "original",
  },
  "card-timeline": {
    id: "card-timeline",
    label: "时间线卡 · 节点流动",
    family: "timeline",
    durationMs: 4000,
    supportedAspects: ["16:9", "9:16"],
    sourcePath: "remotion/animation/legacy-templates.tsx",
    licenseStatus: "original",
  },
  "card-profile": {
    id: "card-profile",
    label: "人物卡 · 渐入聚焦",
    family: "profile",
    durationMs: 4000,
    supportedAspects: ["16:9", "9:16"],
    sourcePath: "remotion/animation/legacy-templates.tsx",
    licenseStatus: "original",
  },
};

export const legacyTemplateOptions = Object.values(legacyTemplates);

/** 旧项目仍可读取问答/号召模板，但新分镜和手动选择不再提供它们。 */
export const removedLegacyTemplateIds = new Set<LegacyTemplateId>(["card-qa", "card-cta"]);
export const activeLegacyTemplateOptions = legacyTemplateOptions.filter((template) => !removedLegacyTemplateIds.has(template.id));

export function isActiveLegacyTemplate(id: LegacyTemplateId | undefined): id is LegacyTemplateId {
  return !!id && !removedLegacyTemplateIds.has(id);
}

const pictureKinds = new Set<ShotKind>(["image", "video", "upload", "stock", "chart"]);

/** 全屏卡片镜头：标题、金句，以及信息卡。生成画面和复合画面不套这些模板。 */
export function isCodeCardShot(shot: { kind: ShotKind; mode?: ShotMode }): boolean {
  if (shot.kind === "title" || shot.kind === "quote") return true;
  if (pictureKinds.has(shot.kind)) return false;
  if (shot.mode === "generate" || shot.mode === "composite" || shot.mode === "real") return false;
  return shot.kind === "placeholder" || shot.mode === "motion";
}

function templateForCard(card: Card | undefined): LegacyTemplateId | undefined {
  if (!card) return undefined;
  switch (card.variant) {
    case "stat":
      return card.stat?.value ? "card-stat" : undefined;
    case "list":
      return (card.items?.length ?? 0) >= 2 ? "card-list" : undefined;
    case "split":
      return card.sides ? "hero-split-wipe" : undefined;
    case "quote":
      return card.headline ? "creator-cinema-editorial-quote" : undefined;
    // 问答卡、号召卡和通用文字卡仅保留旧数据兼容，不再自动匹配模板。
    case "qa":
    case "cta":
    case "headline":
      return undefined;
    case "alert":
      return card.alert?.content ? "card-alert" : undefined;
    case "definition":
      return card.definition?.term && card.definition.meaning ? "card-definition" : undefined;
    case "timeline":
      return (card.timeline?.length ?? 0) > 0 ? "card-timeline" : undefined;
    case "profile":
      return card.profile?.name ? "card-profile" : undefined;
    default:
      return undefined;
  }
}

/**
 * 按镜头类型和卡片内容选择模板。
 * 标题和金句优先于卡片版式；普通标题卡使用片头聚光；字段不齐时也回到片头聚光，避免掉回旧占位。
 */
export function inferCardTemplate(shot: Pick<Shot, "kind" | "mode" | "card">): LegacyTemplateId | undefined {
  if (!isCodeCardShot(shot)) return undefined;
  if (shot.kind === "title") return "hero-spotlight-stage";
  if (shot.kind === "quote") return "creator-cinema-editorial-quote";
  if (shot.card && ["headline", "qa", "cta"].includes(shot.card.variant)) return undefined;
  if (shot.card?.variant === "list" && !(shot.card.items?.length)) return undefined;
  return templateForCard(shot.card) ?? "hero-spotlight-stage";
}

/** 手动指定的模板优先；清空后回到 inferCardTemplate。 */
export function defaultLegacyTemplateForShot(shot: Pick<Shot, "kind" | "mode" | "card" | "animation">): LegacyTemplateId | undefined {
  if (!isCodeCardShot(shot)) return undefined;
  if (isActiveLegacyTemplate(shot.animation?.templateId)) return shot.animation.templateId;
  return inferCardTemplate(shot);
}
