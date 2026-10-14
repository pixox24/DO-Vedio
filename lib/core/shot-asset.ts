import { isOutputAspect, outputSpecIdForAspect } from "./output-spec";
import { outputSpecs, type Aspect, type AssetFramingMode, type Shot, type ShotAssetVariant } from "./types";

/** 这一镜在指定画幅上真正播放的素材。有变体时以变体为准，否则用当前选中的素材。 */
export function playbackAssetId(shot: Pick<Shot, "assetId" | "assetVariants">, aspect: Aspect): string | undefined {
  return shot.assetVariants?.[aspect]?.assetId || shot.assetId;
}

function variantFor(shot: Shot, aspect: Aspect, assetId: string, source: ShotAssetVariant["source"], sourceAspect?: Aspect, promptHash?: string): ShotAssetVariant {
  const existing = shot.assetVariants?.[aspect];
  const spec = outputSpecs[outputSpecIdForAspect(aspect)];
  const next: ShotAssetVariant = {
    assetId,
    promptHash: promptHash ?? (existing?.assetId === assetId ? existing.promptHash : "unknown"),
    aspect,
    width: existing?.width ?? spec.width,
    height: existing?.height ?? spec.height,
    source,
  };
  if (source === "shared" && sourceAspect) next.sourceAspect = sourceAspect;
  if (existing?.generatedAt && existing.assetId === assetId) next.generatedAt = existing.generatedAt;
  return next;
}

/**
 * 把一枚候选设为当前画面。
 * 卡片读 assetId，预览和成片读当前画幅的变体，两处必须写成同一张。
 * 共享素材时每个输出画幅都指向它；分别生成时只改正在看的这一幅。
 */
export function selectShotCandidate(shot: Shot, candidateId: string, options: { aspect: Aspect; framing: AssetFramingMode; aspects?: Aspect[] }): Shot | null {
  const candidate = shot.candidates.find((item) => item.id === candidateId);
  if (!candidate) return null;
  const listed = (options.aspects ?? []).filter(isOutputAspect);
  const existing = Object.keys(shot.assetVariants ?? {}).filter(isOutputAspect);
  const targets = options.framing === "shared"
    ? [...new Set<Aspect>([options.aspect, ...listed, ...existing])]
    : [options.aspect];
  const assetVariants = { ...shot.assetVariants };
  for (const aspect of targets) {
    const source = options.framing === "shared" && aspect !== options.aspect ? "shared" : "generated";
    assetVariants[aspect] = variantFor(shot, aspect, candidate.assetId, source, source === "shared" ? options.aspect : undefined, candidate.generationPromptHash);
  }
  return {
    ...shot,
    kind: candidate.kind ?? shot.kind,
    assetId: candidate.assetId,
    // 旧候选没有来源记录时保守标记过期，不能沿用另一张图的生成指纹。
    assetPromptHash: candidate.promptHash ?? (candidate.assetId === shot.assetId ? shot.assetPromptHash : "unknown"),
    candidates: shot.candidates.map((item) => ({ ...item, selected: item.id === candidateId })),
    assetVariants,
  };
}
