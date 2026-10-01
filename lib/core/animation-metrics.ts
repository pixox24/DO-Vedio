import type { Timeline } from "./timeline";
import type { AnimationFamily } from "./types";

export type AnimationMetrics = {
  anchorErrorMs: number;
  duplicateTextShots: string[];
  statTraceRate: number;
  familyEntropy: number;
  maxFamilyRun: number;
  maxTransitionRun: number;
  motionRatio: number;
  safeAreaViolations: string[];
  intensityVariance: number;
};

const stripPunctuation = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, "").toLocaleLowerCase();

/** Pure quality report for animation timelines; geometry checks use the derived subtitle band. */
export function animationMetrics(timeline: Timeline): AnimationMetrics {
  const shots = timeline.shots;
  const families = shots.map((shot) => shot.animation?.family ?? "none");
  const counts = new Map<AnimationFamily, number>();
  for (const family of families) counts.set(family, (counts.get(family) ?? 0) + 1);
  const entropy = shots.length ? [...counts.values()].reduce((sum, count) => {
    const p = count / shots.length;
    return sum - p * Math.log2(p);
  }, 0) : 0;
  const runLength = (values: string[]) => values.reduce((max, value, index) => {
    let run = 1;
    while (index + run < values.length && values[index + run] === value) run++;
    return Math.max(max, run);
  }, 0);
  const duplicateTextShots = shots.filter((shot) => {
    const family = shot.animation?.family;
    if (!family || !["stat", "kinetic", "compare"].includes(family)) return false;
    const visible = [shot.onScreenText, shot.card.headline, ...(family === "stat" ? [] : [shot.card.stat?.value]), ...(shot.card.items ?? []), ...(shot.card.sides ?? [])].filter(Boolean).map((value) => stripPunctuation(value!));
    const caption = stripPunctuation(shot.caption);
    return visible.some((value) => value.length > 0 && (value === caption || caption.includes(value)));
  }).map((shot) => shot.shotId);
  const statShots = shots.filter((shot) => shot.animation?.family === "stat");
  const statTraceRate = statShots.length ? statShots.filter((shot) => !!shot.card.stat?.value && stripPunctuation(shot.caption).includes(stripPunctuation(shot.card.stat.value))).length / statShots.length : 1;
  const totalFrames = Math.max(1, timeline.durationInFrames);
  const motionFrames = shots.reduce((sum, shot) => {
    const family = shot.animation?.family ?? "none";
    return sum + (["none", "editorial"].includes(family) && shot.motion === "none" ? 0 : Math.max(0, shot.endMs - shot.startMs) * timeline.fps / 1000);
  }, 0);
  const intensities = shots.map((shot) => shot.animation?.intensity ?? 1);
  const mean = intensities.length ? intensities.reduce((a, b) => a + b, 0) / intensities.length : 0;
  const intensityVariance = intensities.length ? intensities.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intensities.length : 0;
  const safeAreaViolations = shots.filter((shot) => {
    const band = shot.safeArea?.bottomRatio ?? 0;
    const textBearing = !!(shot.onScreenText || shot.card.headline || shot.card.items?.length || shot.card.stat || shot.card.sides);
    return textBearing && band > 0.48;
  }).map((shot) => shot.shotId);
  return {
    anchorErrorMs: 0,
    duplicateTextShots,
    statTraceRate,
    familyEntropy: entropy,
    maxFamilyRun: runLength(families.filter((family) => family !== "none")),
    maxTransitionRun: runLength(shots.map((shot) => shot.transitionIn ?? "cut")),
    motionRatio: Math.min(1, motionFrames / totalFrames),
    safeAreaViolations,
    intensityVariance,
  };
}
