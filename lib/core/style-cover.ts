/** 风格封面用哪张图。配色组不再充当封面。 */

export type StyleThumbnail = { src: string; alt: string };

export type StyleCoverMode =
  | { kind: "thumbnail"; src: string; alt: string }
  | { kind: "samples"; assets: string[] }
  | { kind: "neutral" };

/**
 * 封面优先级：Aix 官方缩略图 > 已生成的样张 > 中性底。
 * 缩略图存在时不再退回配色渐变，避免和风格快照里的色值搅在一起。
 */
export function resolveStyleCover(input: {
  thumbnail?: StyleThumbnail | null;
  samples?: Array<string | null | undefined> | null;
}): StyleCoverMode {
  const src = input.thumbnail?.src.trim();
  if (src) return { kind: "thumbnail", src, alt: input.thumbnail?.alt.trim() || "风格缩略图" };
  const assets = (input.samples ?? []).filter((asset): asset is string => !!asset);
  if (assets.length) return { kind: "samples", assets };
  return { kind: "neutral" };
}
