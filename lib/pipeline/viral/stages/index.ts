import { analyzeViralReference } from "../../../viral/analysis";
import { generateViralAngles } from "../../../viral/angles";
import { calibrateViralScript, generateViralOutline, generateViralScript, rewriteViralSegment, type ViralGenerationOptions } from "../../../viral/generation";
import { angleContextCompatible, outlineSourceFingerprint } from "../../../viral/invalidation";
import { buildGenerationContext } from "../../../viral/prompts";
import { reviewAndRepairViralScript } from "../../../viral/review";
import type { ViralIssueResolution, ViralStage, ViralStageArtifacts, ViralStageResult, ViralTaskSnapshot } from "../../../viral/types";

export type ViralStageOptions = ViralGenerationOptions & { resolutions?: ViralIssueResolution[] };

/** Storage/leases belong to the runner. Every writing call receives only the reduced generation DTO. */
export async function runViralStage(stage: ViralStage, snapshot: ViralTaskSnapshot, artifacts: ViralStageArtifacts, options: ViralStageOptions = {}): Promise<ViralStageResult> {
  options.signal?.throwIfAborted();
  if (stage === "analysis") return { stage, analysis: await analyzeViralReference({ ...snapshot.input, modelId: snapshot.modelId }, options) };
  const currentSnapshot = {
    ...snapshot,
    mechanisms: artifacts.analysis?.mechanisms ?? snapshot.mechanisms,
    selectedAngle: snapshot.selectedAngle ?? artifacts.angles.find((angle) => angle.id === artifacts.selectedAngleId) ?? null,
    outline: snapshot.outline ?? artifacts.outline,
  };
  const context = buildGenerationContext(currentSnapshot, artifacts.analysis);
  if (stage === "angles") {
    const result = await generateViralAngles(context, snapshot.modelId, options);
    // A platform/time update should never silently replace the user's selected angle.
    const retained = angleContextCompatible(artifacts.anglesSourceFingerprint, currentSnapshot)
      && artifacts.selectedAngleId && artifacts.angles.find((angle) => angle.id === artifacts.selectedAngleId);
    return { stage, ...result, ...(retained ? { angles: [...result.angles, retained], selectedAngleId: retained.id } : {}) };
  }
  if (stage === "outline") return { stage, outline: await generateViralOutline(context, snapshot.modelId, outlineSourceFingerprint(currentSnapshot), options) };
  const protectedText = artifacts.analysis?.distinctiveElements.map((element) => element.text) ?? [];
  if (stage === "generation") {
    if (snapshot.command === "rewrite") {
      if (!artifacts.version) throw new Error("请先选择要修改的完整稿件");
      return { stage, version: artifacts.version, candidateVersion: await rewriteViralSegment(context, currentSnapshot, artifacts.version, { ...options, protectedText }) };
    }
    if (snapshot.command === "calibrate") {
      if (!artifacts.version) throw new Error("请先选择需要校准的稿件");
      return { stage, version: await calibrateViralScript(context, currentSnapshot, artifacts.version, { ...options, protectedText }) };
    }
    return { stage, version: await generateViralScript(context, currentSnapshot, artifacts.version, { ...options, protectedText }) };
  }
  if (!artifacts.version) throw new Error("没有可检查的口播稿");
  return { stage: "review", ...await reviewAndRepairViralScript(currentSnapshot, artifacts.version, artifacts.analysis, { ...options, previousReview: artifacts.review }) };
}

export const executeViralStage = runViralStage;
