import { assetStale, needsGeneratedImage } from "./prompt-compiler";
import { acceptsFreeVoiceInstruction, type ProjectDoc, type VoiceSettings } from "./types";

/** 进度格在没有进行中的任务时，可以改用这些状态。进行中和失败仍以任务为准。 */
export type StepHint = {
  tone: "done" | "hold";
  message?: string;
  /** 分镜正在生图时，满格青绿色轻微呼吸 */
  pulse?: boolean;
};

/** 配音口吻：不接收说明、或已经写过，这一格直接完成。写成失败不标红。 */
export function voiceDirectionHint(voice: Pick<VoiceSettings, "model" | "instruction">, wroteNothing: boolean): StepHint | null {
  if (!acceptsFreeVoiceInstruction(voice.model)) return { tone: "done", message: "当前音色不需要" };
  if (voice.instruction.trim()) return { tone: "done", message: "已有口吻" };
  if (wroteNothing) return { tone: "done", message: "未写成，配音继续" };
  return null;
}

/**
 * 分镜文案已经写完之后看画面。
 * 还缺图时保持满格，用青绿色表示「写完了，图还没有」；图齐了，或没有镜头需要生图，才算完成。
 * 锁定的镜头不参加全量生图，也不算缺图。
 */
export function storyboardImageHint(doc: Pick<ProjectDoc, "shots" | "lines" | "brief" | "visualStyle" | "characters" | "scenes">, generating: boolean): StepHint | null {
  if (doc.shots.length === 0) return null;
  const wanting = doc.shots.filter((shot) => !shot.locked && needsGeneratedImage(shot));
  const missing = wanting.filter((shot) => !shot.assetId || assetStale(doc, shot));
  if (missing.length === 0) return { tone: "done" };
  if (generating) return { tone: "hold", message: `生成图片 ${wanting.length - missing.length}/${wanting.length}`, pulse: true };
  return { tone: "hold", message: `待生成图片 · 还缺 ${missing.length} 个` };
}
