import { characterReferenceIds } from "./cast";
import { quickHash } from "./hash";
import { compileShotPrompt, shotCharacters, type CompiledPrompt } from "./prompt-compiler";
import type { ProjectDoc, Shot } from "./types";

import { VIDEO_PROMPT_COMPILER_VERSION } from "./video";
export const VIDEO_PROMPT_VERSION = VIDEO_PROMPT_COMPILER_VERSION;
type CompileDoc = Pick<ProjectDoc, "shots" | "lines" | "brief" | "visualStyle" | "characters" | "scenes">;
export type VideoPromptInput = {
  doc: CompileDoc;
  shot: Shot;
  /** Exact final request order: element zero is ref_image_0 / Picture 1. */
  referenceAssetIds: string[];
  requestDurationSeconds: number;
  targetDurationMs?: number;
};
export type CompiledVideoPrompt = {
  prompt: string;
  hash: string;
  version: string;
  referenceAssetIds: string[];
  labels: { assetId: string; picture: string }[];
};

/** The reference image describes a static planning state, never the action sequence. */
export function compileVideoReferencePrompt(doc: CompileDoc, shot: Shot): CompiledPrompt {
  const content = shot.videoPlan?.startState.trim() || shot.description;
  return compileShotPrompt(doc, { ...shot, description: content, prompt: shot.videoPlan ? content : shot.prompt, onScreenText: undefined });
}

/** Pure Full-Reference compiler; does not inspect images or perform a rewrite call. */
export function compileVideoPrompt(input: VideoPromptInput): CompiledVideoPrompt {
  const { doc, shot, requestDurationSeconds } = input;
  if (!Number.isInteger(requestDurationSeconds) || requestDurationSeconds < 1 || requestDurationSeconds > 15) throw new Error("视频请求时长必须是1–15秒整数");
  if (!input.referenceAssetIds.length) throw new Error("视频生成需要至少一张参考图");
  const plan = shot.videoPlan;
  if (!plan || Object.values(plan).some((value) => !value.trim())) throw new Error("视频镜头需要完整的起始、动作、相机和结束计划");
  const targetMs = input.targetDurationMs ?? requestDurationSeconds * 1000;
  if (targetMs <= 0 || targetMs > requestDurationSeconds * 1000) throw new Error("视频目标时长超出请求时长");
  const labels = input.referenceAssetIds.map((assetId, i) => ({ assetId, picture: `<Picture ${i + 1}>` }));
  const pictures = (ids: string[]) => labels.filter((entry) => ids.includes(entry.assetId)).map((entry) => entry.picture).join(", ");
  const definitions: string[] = [];
  const retention: string[] = [];
  const subjects: string[] = [];
  for (const card of shotCharacters(doc, shot)) {
    const label = `<Subject ${subjects.length + 1}>`;
    const refs = pictures(characterReferenceIds(card));
    definitions.push(`${label} is recurring character ${subjects.length + 1}${refs ? ` referenced by ${refs}` : " defined by the supplied planning state"}. Preserve the identity, visible features and current costume described in the English opening state below; the supplied references provide appearance guidance.`);
    retention.push(`${label} (appears in [Shot 1]): fully_preserved - preserve the supplied identity, visible features, presentation restrictions and current costume while allowing the planned action.`);
    subjects.push(label);
  }
  const scene = doc.scenes.find((entry) => entry.id === shot.sceneId);
  if (scene) {
    const label = `<Subject ${subjects.length + 1}>`;
    const refs = pictures(scene.referenceAssetIds);
    definitions.push(`${label} is the environment${refs ? ` referenced by ${refs}` : " defined by the supplied scene card"}. Follow the environment described in the English opening state below; preserve its spatial layout and fixed furnishings.`);
    retention.push(`${label} (appears in [Shot 1]): fully_preserved - preserve the location, spatial layout and fixed furnishings; animate only the planned subjects and camera.`);
    subjects.push(label);
  }
  for (const entry of labels) {
    const userDescription = entry.assetId === shot.sourceImageAssetId ? shot.sourceImageDescription?.trim() : undefined;
    definitions.push(`${entry.picture} is reference image ${labels.indexOf(entry) + 1}, providing visual planning guidance for [Shot 1].${entry.assetId === shot.sourceImageAssetId ? ` The supplied opening-state description is: ${plan.startState}.` : ""}${userDescription ? ` Supplied image description (user-authored, not visually inspected): ${userDescription}. Follow these supplied image facts if they differ from the planned visible state, while retaining the planned action.` : ""} It is a reference, not a prescribed exact first frame; no unprovided image contents are asserted.`);
    retention.push(`${entry.picture} ([Shot 1] visual guidance): weak_reference - use its composition and applicable visual attributes as guidance, with the opening state and action specified below.`);
  }
  const styleText = "Follow the visual style, lighting and environment established in the English opening state and supplied reference images.";
  const prompt = [
    `subject_definitions:\n${definitions.join("\n")}`,
    `summary:\n[reference generation] Generate one continuous ${requestDurationSeconds}-second shot using ${labels.map((entry) => entry.picture).join(", ")} as visual references${subjects.length ? ` and preserving ${subjects.join(", ")}` : ""}. The action completes within ${(targetMs / 1000).toFixed(3)} seconds and settles naturally for any remaining tail.`,
    `retention_analysis:\n${retention.join("\n")}`,
    `detailed_description:\nMaintain a consistent visual treatment. Supplied style attributes: ${styleText}\n[Shot 1] Opening composition and visible state: ${plan.startState}\n${subjects.length ? `Keep ${subjects.join(", ")} consistent with their definitions throughout this shot.\n` : ""}Action progression: ${plan.action}\nCamera movement: ${plan.camera}\nEnding state: ${plan.endState}\nComplete the meaningful action within ${(targetMs / 1000).toFixed(3)} seconds; sustain the settled ending naturally through the ${requestDurationSeconds}-second request. Keep one continuous take with no cuts, montage, jump cuts or additional scenes. Do not render subtitles, narration text, captions, logos or watermarks. No dialogue, lip synchronization, voice-over or music is requested.`,
    "overall_soundscape:\nN/A",
    "non_diegetic_music:\nN/A",
  ].join("\n\n");
  return { prompt, hash: quickHash({ version: VIDEO_PROMPT_VERSION, prompt, refs: input.referenceAssetIds }), version: VIDEO_PROMPT_VERSION, referenceAssetIds: [...input.referenceAssetIds], labels };
}
