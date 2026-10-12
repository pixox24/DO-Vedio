import { charsFor, countChars, deviation, secondsFor, TOLERANCE } from "../duration";
import type { SpeechRate } from "../types";
import type { ViralInput, ViralPlatform, ViralScriptVersion } from "./types";

export function platformDefaults(platform: ViralPlatform | null): { targetSeconds: number; aspectRatio: "9:16" | "16:9"; recommendedSeconds: [number, number] } {
  return platform === "bilibili" || platform === "xigua"
    ? { targetSeconds: 300, aspectRatio: "16:9", recommendedSeconds: [180, 600] }
    : { targetSeconds: 120, aspectRatio: "9:16", recommendedSeconds: [60, 180] };
}
export function selectPlatform(input: ViralInput, platform: ViralPlatform): ViralInput {
  const defaults = platformDefaults(platform);
  const aspectRatio = input.handoff.aspectRatioIsManual ? input.handoff.aspectRatio : defaults.aspectRatio;
  return { ...input, platform, targetSeconds: input.durationIsManual ? input.targetSeconds : defaults.targetSeconds, handoff: { ...input.handoff, aspectRatio, settingsVersion: input.handoff.settingsVersion + Number(aspectRatio !== input.handoff.aspectRatio) } };
}
export function setTargetSeconds(input: ViralInput, targetSeconds: number): ViralInput { return { ...input, targetSeconds, durationIsManual: true }; }
export function setAspectRatio(input: ViralInput, aspectRatio: "9:16" | "16:9"): ViralInput {
  return { ...input, handoff: { aspectRatio, aspectRatioIsManual: true, settingsVersion: input.handoff.settingsVersion + Number(aspectRatio !== input.handoff.aspectRatio) } };
}
export function resolveViralRate(input: Pick<ViralInput, "rate" | "style">): SpeechRate { return input.rate === "auto" ? input.style.speechRate : input.rate; }
export function targetCharCount(input: Pick<ViralInput, "targetSeconds" | "rate" | "style">): number { return charsFor(input.targetSeconds / 60, resolveViralRate(input)); }
export function estimateScriptDuration(version: Pick<ViralScriptVersion, "segments">, input: Pick<ViralInput, "targetSeconds" | "rate" | "style">) {
  const text = version.segments.map((item) => item.text).join("\n");
  const estimatedSeconds = secondsFor(text, resolveViralRate(input));
  const relativeDeviation = deviation(estimatedSeconds, input.targetSeconds);
  return { charCount: countChars(text), estimatedSeconds, targetCharCount: targetCharCount(input), relativeDeviation, needsCalibration: Math.abs(relativeDeviation) > TOLERANCE + Number.EPSILON, isEstimate: true as const };
}
