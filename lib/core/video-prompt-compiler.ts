import { characterReferenceIds } from "./cast";
import { quickHash } from "./hash";
import { compileShotPrompt, shotCharacters, type CompiledPrompt } from "./prompt-compiler";
import type { ProjectDoc, Shot } from "./types";

import { sanitizeVideoPlan, videoReferenceDescription } from "./video-plan";
export { sanitizeVideoPlan } from "./video-plan";

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
  const content = videoReferenceDescription(shot);
  return compileShotPrompt(doc, { ...shot, description: content, prompt: shot.videoPlan ? content : shot.prompt, onScreenText: undefined });
}

/** Pure Full-Reference compiler; does not inspect images or perform a rewrite call. */
export function compileVideoPrompt(input: VideoPromptInput): CompiledVideoPrompt {
  const { doc, shot, requestDurationSeconds } = input;
  if (!Number.isInteger(requestDurationSeconds) || requestDurationSeconds < 1 || requestDurationSeconds > 15) throw new Error("视频请求时长必须是1–15秒整数");
  if (!input.referenceAssetIds.length) throw new Error("视频生成需要至少一张参考图");
  if (!shot.videoPlan || Object.values(shot.videoPlan).some((value) => !value.trim())) throw new Error("视频镜头需要完整的起始、动作、相机和结束计划");
  const plan = sanitizeVideoPlan(shot.videoPlan);
  const targetMs = input.targetDurationMs ?? requestDurationSeconds * 1000;
  if (targetMs <= 0 || targetMs > requestDurationSeconds * 1000) throw new Error("视频目标时长超出请求时长");
  const labels = input.referenceAssetIds.map((assetId, i) => ({ assetId, picture: `<Picture ${i + 1}>` }));
  const pictures = (ids: string[]) => labels.filter((entry) => ids.includes(entry.assetId)).map((entry) => entry.picture).join(", ");
  const definitions: string[] = [];
  const retention: string[] = [];
  const subjects: string[] = [];
  const anchor = labels.find((entry) => entry.assetId === shot.sourceImageAssetId);
  if (!anchor) throw new Error("视频请求缺少镜头构图参考图");
  for (const card of shotCharacters(doc, shot)) {
    const label = `<Subject ${subjects.length + 1}>`;
    const refs = pictures(characterReferenceIds(card).filter((id) => id !== anchor.assetId));
    definitions.push(`${label} is recurring character ${subjects.length + 1}${refs ? ` referenced by ${refs}` : ` visible in ${anchor.picture}`}. Character references supply identity, visible appearance and current costume only. Exclude their backgrounds, studio lighting, poses, shot scale and framing; use ${anchor.picture} for the shot composition and environment.`);
    retention.push(`${label} (appears in [Shot 1]): fully_preserved - preserve the supplied identity, visible features, presentation restrictions and current costume while allowing the planned action.`);
    subjects.push(label);
  }
  const scene = doc.scenes.find((entry) => entry.id === shot.sceneId);
  if (scene) {
    const label = `<Subject ${subjects.length + 1}>`;
    const refs = pictures(scene.referenceAssetIds.filter((id) => id !== anchor.assetId));
    definitions.push(`${label} is the environment${refs ? ` referenced by ${refs}` : ` visible in ${anchor.picture}`}. Scene references supply location, materials and fixed furnishings only; exclude any people or character identities they contain. Preserve the spatial layout, viewpoint and lighting established by ${anchor.picture}.`);
    retention.push(`${label} (appears in [Shot 1]): fully_preserved - preserve the location, spatial layout and fixed furnishings; animate only the planned subjects and camera.`);
    subjects.push(label);
  }
  definitions.push(`${anchor.picture} is the opening keyframe and composition anchor for [Shot 1]. Preserve its shot scale, viewpoint, subject placement, relative subject sizes, environment, lighting and visual style as the shot begins. The planning state below supplements this image; if it conflicts with the visible composition, the image governs the opening.`);
  retention.push(`${anchor.picture} ([Shot 1] opening keyframe and composition): fully_preserved - retain its defined opening composition, subjects and environment, then allow only the planned silent action and camera movement to evolve naturally.`);
  const styleText = `Follow the visual style, lighting and environment established in ${anchor.picture}.`;
  const prompt = [
    `subject_definitions:\n${definitions.join("\n")}`,
    `summary:\n[keyframe completion${subjects.length && labels.length > 1 ? " + reference generation" : ""}] Generate one continuous ${requestDurationSeconds}-second shot beginning from the composition of ${anchor.picture}${subjects.length ? ` and preserving ${subjects.join(", ")} within their defined roles` : ""}. The action completes within ${(targetMs / 1000).toFixed(3)} seconds and settles naturally for any remaining tail.`,
    `retention_analysis:\n${retention.join("\n")}`,
    `detailed_description:\nMaintain a consistent visual treatment. Supplied style attributes: ${styleText}\n[Shot 1] The shot begins from ${anchor.picture}; keep its opening shot scale and subject placement. Opening visible state: ${plan.startState}\n${subjects.length ? `Keep ${subjects.join(", ")} consistent with their definitions throughout this shot.\n` : ""}Silent action progression: ${plan.action}\nCamera movement: ${plan.camera}\nEnding state: ${plan.endState}\nComplete the meaningful action within ${(targetMs / 1000).toFixed(3)} seconds; sustain the settled ending naturally through the ${requestDurationSeconds}-second request. Keep one continuous take with no cuts, montage, jump cuts or additional scenes. Do not render subtitles, narration text, captions, logos or watermarks. Keep characters silent, with no speaking, speech mouth movements or lip synchronization. No dialogue, voice-over or music is requested.`,
    "overall_soundscape:\nN/A",
    "non_diegetic_music:\nN/A",
  ].join("\n\n");
  return { prompt, hash: quickHash({ version: VIDEO_PROMPT_VERSION, prompt, refs: input.referenceAssetIds }), version: VIDEO_PROMPT_VERSION, referenceAssetIds: [...input.referenceAssetIds], labels };
}
