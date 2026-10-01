import { z } from "zod";

export const aixCategories = ["illustration", "painting", "photographic", "3d", "graphic"] as const;
export const aixCategoryLabels = { illustration: "插画", painting: "绘画", photographic: "摄影", "3d": "3D", graphic: "平面" } as const;
export const aixIdSchema = z.string().regex(/^Aix(?:\d{4}|[1-9]\d{4,7})$/);
export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const aixFeatureSchema = z.object({ id: z.string().regex(/^F\d{2}$/), axis: z.enum(["medium", "line", "palette", "lighting", "texture", "composition"]), tier: z.enum(["core", "support", "accent"]), text: z.string().min(1) }).strict();
export const aixAvoidSchema = z.object({ id: z.string().regex(/^N\d{2}$/), text: z.string().min(1) }).strict();
export const aixProvenanceSchema = z.object({ source_type: z.enum(["original", "licensed", "public_domain", "unknown"]), source_ref: z.string().nullable(), license_ref: z.string().nullable(), commercial_use: z.enum(["allowed", "restricted", "unknown"]), attribution: z.string().nullable() }).strict();
export const aixQualitySchema = z.object({ review_status: z.enum(["pending", "passed", "failed"]), tested_tool: z.string().nullable(), tested_at: z.string().nullable(), evidence_ref: z.string().nullable() }).strict();
export const aixStyleSchema = z.object({
  schema_version: z.literal("1.0"), id: aixIdSchema, version: semverSchema, status: z.enum(["draft", "active", "deprecated"]), name: z.string().min(1), description: z.string(), category: z.enum(aixCategories), tags: z.array(z.string()), aliases: z.array(z.string()),
  thumbnail: z.object({ path: z.literal("thumbnail.webp"), media_type: z.literal("image/webp"), alt: z.string() }).strict(),
  features: z.array(aixFeatureSchema).min(1), avoid: z.array(aixAvoidSchema), suitable_for: z.array(z.string()), weak_for: z.array(z.string()), known_failures: z.array(z.string()), provenance: aixProvenanceSchema, quality: aixQualitySchema, replacement_id: aixIdSchema.nullable(),
}).strict().superRefine((s, ctx) => {
  if (!s.features.some((f) => f.tier === "core")) ctx.addIssue({ code: "custom", message: "缺少核心风格组件" });
  for (const list of [s.features, s.avoid]) if (new Set(list.map((x) => x.id)).size !== list.length) ctx.addIssue({ code: "custom", message: "组件 ID 重复" });
});
export const aixIndexEntrySchema = z.object({ id: aixIdSchema, version: semverSchema, status: z.enum(["draft", "active", "deprecated"]), name: z.string(), description: z.string(), category: z.enum(aixCategories), tags: z.array(z.string()), aliases: z.array(z.string()), thumbnail_path: z.string(), thumbnail_alt: z.string(), content_hash: digestSchema }).strict();
export const aixIndexSchema = z.object({ schema_version: z.literal("1.0"), library_version: semverSchema, source_digest: digestSchema, styles: z.array(aixIndexEntrySchema) }).strict();
export const aixLibrarySchema = z.object({ library_version: semverSchema, schema_version: z.literal("1.0"), api_version: z.literal("1.0") }).strict();
const assetPath = z.string().regex(/^\/aix\/[a-f0-9]{64}\/(thumbnails|examples)\/[A-Za-z0-9/.-]+\.webp$/);
export const aixAssetsSchema = z.object({ thumbnailPath: assetPath, thumbnailAlt: z.string(), examples: z.array(z.object({ src: assetPath, alt: z.string(), subjectCategory: z.enum(["人物", "物体", "场景"]), sourceVersion: semverSchema })).default([]) });
export const aixDetailSchema = z.object({ style: aixStyleSchema, contentHash: digestSchema, assets: aixAssetsSchema });
export const aixMetaSchema = z.object({ libraryVersion: semverSchema, schemaVersion: z.literal("1.0"), sourceDigest: digestSchema, activeCount: z.number().int().nonnegative(), generatedAt: z.string() });
export const aixCompactSchema = z.object({ id: aixIdSchema, version: semverSchema, status: z.enum(["active", "deprecated"]), name: z.string(), description: z.string(), category: z.enum(aixCategories), tags: z.array(z.string()), aliases: z.array(z.string()), contentHash: digestSchema, thumbnailPath: assetPath, thumbnailAlt: z.string() });
export const aixBundleSchema = z.object({ meta: aixMetaSchema, items: z.array(aixCompactSchema), details: z.array(aixDetailSchema) });
export type AixStyle = z.infer<typeof aixStyleSchema>;
export type AixFeature = z.infer<typeof aixFeatureSchema>;
export type AixAvoid = z.infer<typeof aixAvoidSchema>;
export type AixProvenance = z.infer<typeof aixProvenanceSchema>;
export type AixQuality = z.infer<typeof aixQualitySchema>;
export type AixCategory = typeof aixCategories[number];
export type AixDetail = z.infer<typeof aixDetailSchema>;
export type AixCompact = z.infer<typeof aixCompactSchema>;
export type AixMeta = z.infer<typeof aixMetaSchema>;
export type AixBundle = z.infer<typeof aixBundleSchema>;

export function normalizeAixId(input: string): string | null {
  const match = /^(?:aix-?)?(\d{1,8})$/i.exec(input.trim());
  if (!match || Number(match[1]) < 1) return null;
  return `Aix${String(Number(match[1])).padStart(4, "0")}`;
}
