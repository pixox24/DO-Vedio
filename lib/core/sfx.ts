import { focusColumnUnits } from "./focus";
import { focusCountSettleFrame, pressGlyphTiming, staggerLineTiming } from "./focus-timing";
import type { FocusPresetId, TransitionIn } from "./types";

/**
 * 动画音效。
 * 每个动画挂一个固定角色，同一类动作共用一声。
 * 一个镜头只留一声：转场真的叠进来时，转场优先于文字。
 */

export const SFX_FPS = 30;
export const WHOOSH_LEAD_MS = 80;

export const sfxRoles = ["swipe", "whoosh", "thud", "bloom", "stamp", "tick", "count"] as const;
export type SfxRole = (typeof sfxRoles)[number];
export type SfxSources = Partial<Record<SfxRole, string>>;

export const sfxRoleLabels: Record<SfxRole, string> = {
  swipe: "擦过",
  whoosh: "甩动",
  thud: "推到位",
  bloom: "打开",
  stamp: "压印",
  tick: "起拍",
  count: "数字上涨",
};

export const sfxAssetNames: Record<SfxRole, string> = {
  swipe: "sfx.swipe.v1",
  whoosh: "sfx.whoosh.v2",
  thud: "sfx.thud.v1",
  bloom: "sfx.bloom.v1",
  stamp: "sfx.stamp.v1",
  tick: "sfx.tick.v1",
  count: "sfx.count.v1",
};

export type SfxSpec = { durationMs: number; gain: number };

export const sfxSpecs: Record<SfxRole, SfxSpec> = {
  swipe: { durationMs: 280, gain: 0.28 },
  whoosh: { durationMs: 450, gain: 0.32 },
  thud: { durationMs: 220, gain: 0.34 },
  bloom: { durationMs: 320, gain: 0.22 },
  stamp: { durationMs: 180, gain: 0.3 },
  tick: { durationMs: 120, gain: 0.22 },
  count: { durationMs: 400, gain: 0.24 },
};

/** 揭开共用擦过。虚化、淡入、非数字的升起共用打开。两个数字预设单独上涨。 */
export const focusSfxMount: Record<FocusPresetId, SfxRole> = {
  "embedded-type": "swipe",
  "masked-slice": "swipe",
  "tilt-vertical": "swipe",
  diamond: "swipe",
  "cross-space": "swipe",
  "vertical-arc": "bloom",
  "offset-fade": "bloom",
  pill: "bloom",
  "serif-contrast": "bloom",
  "solid-outline": "bloom",
  "four-dots": "bloom",
  focus: "bloom",
  order: "bloom",
  "number-space": "count",
  "three-dots": "count",
  "time-scale": "tick",
  steps: "tick",
  chapter: "tick",
  "blur-slide": "tick",
  "ink-press": "stamp",
};

/** 切镜、淡入、溶解是气口。甩镜、擦除、推入才有声音。 */
export const transitionSfxMount: Record<TransitionIn, SfxRole | null> = {
  cut: null,
  fade: null,
  dissolve: null,
  wipe: "swipe",
  whip: "whoosh",
  push: "thud",
};

export type SfxShot = {
  startMs: number;
  endMs: number;
  overlapInFrames?: number;
  transitionIn?: TransitionIn;
  mode?: string;
  kind?: string;
  focusText?: { text?: string; presetId?: FocusPresetId };
};

export type ScoredSfx = { role: SfxRole; offsetMs: number; gain: number; durationMs: number };

export type SfxCue = { role: SfxRole; src: string; atMs: number; gain: number; durationMs: number };

const typePresets = new Set<FocusPresetId>(["time-scale", "steps", "chapter"]);

function shotFrames(shot: SfxShot) {
  return Math.max(1, Math.round(((shot.endMs - shot.startMs) / 1000) * SFX_FPS));
}

function framesToMs(frames: number) {
  return Math.round((frames / SFX_FPS) * 1000);
}

/** 数字音效在涨到终值时收住。 */
export function countOffsetMs(durationMs: number) {
  const frames = Math.max(1, Math.round((durationMs / 1000) * SFX_FPS));
  const settle = focusCountSettleFrame(frames);
  const soundFrames = (sfxSpecs.count.durationMs / 1000) * SFX_FPS;
  return framesToMs(Math.max(0, settle - soundFrames));
}

function textOffsetMs(role: SfxRole, shot: SfxShot) {
  const frames = shotFrames(shot);
  const text = shot.focusText?.text ?? "";
  if (role === "stamp") return framesToMs(pressGlyphTiming(frames, Math.max(1, Array.from(text).length)).lead);
  if (role === "tick" && shot.focusText?.presetId === "blur-slide") {
    const units = Math.max(1, focusColumnUnits(text).length);
    return framesToMs(staggerLineTiming(frames, units, "main").lead);
  }
  if (role === "tick" && shot.focusText?.presetId && typePresets.has(shot.focusText.presetId)) return 0;
  if (role === "count") return countOffsetMs(shot.endMs - shot.startMs);
  if (role === "whoosh") return -WHOOSH_LEAD_MS;
  return 0;
}

function scored(role: SfxRole, offsetMs: number): ScoredSfx {
  return { role, offsetMs, ...sfxSpecs[role] };
}

function carriesFocus(shot: SfxShot) {
  return !!shot.focusText?.presetId && (shot.mode === "motion" || shot.kind === "title" || shot.kind === "quote");
}

/** 转场只有在这一镜真的叠进来时才算数。第一镜没有入场重叠，改听文字。 */
export function scoreShot(shot: SfxShot): ScoredSfx | null {
  const transition = shot.transitionIn ? transitionSfxMount[shot.transitionIn] : null;
  if (transition && (shot.overlapInFrames ?? 0) > 0) return scored(transition, textOffsetMs(transition, shot));
  if (!carriesFocus(shot) || !shot.focusText?.presetId) return null;
  const role = focusSfxMount[shot.focusText.presetId];
  return scored(role, textOffsetMs(role, shot));
}

export function scoreTimelineSfx(shots: readonly SfxShot[], sources: SfxSources | undefined): SfxCue[] {
  const cues: SfxCue[] = [];
  for (const shot of shots) {
    const cue = scoreShot(shot);
    const src = cue ? sources?.[cue.role] : undefined;
    if (!cue || !src) continue;
    cues.push({
      role: cue.role,
      src,
      atMs: Math.max(0, shot.startMs + cue.offsetMs),
      gain: cue.gain,
      durationMs: cue.durationMs,
    });
  }
  return cues;
}

export function sfxLabel(role: SfxRole | null | undefined) {
  return role ? `声音 ${sfxRoleLabels[role]}` : "无声";
}
