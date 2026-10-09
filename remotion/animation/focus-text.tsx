import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { CSSProperties } from "react";
import { focusVisualWidth } from "@/lib/core/focus";
import type { FocusPresetId } from "@/lib/core/types";
import type { TimelineShot } from "@/lib/core/timeline";
import { FONT } from "../fonts";
import { useTheme } from "../theme";

const PAPER = "#f1f0e9";
const MUTED = "#8c948d";
const INK = "#101312";
const ACCENTS = ["#d48b78", "#8eafbf", "#d4ba72", "#9ebaa9"];

type SymbolKind = "plus" | "cross" | "circle" | "square" | "diamond" | "pill" | "dots" | "four-dots";
type Recipe = { x: number; y: number; subX: number; subY: number; sx: number; sy: number; color: number; symbol: SymbolKind; background: 0 | 1 | 2; motion: "rise" | "blur" | "mask" | "type" | "fade"; font?: "song" | "youth"; outline?: boolean; vertical?: boolean; rule?: boolean };
const RECIPES: Record<FocusPresetId, Recipe> = {
  "embedded-type": { x: .18, y: .36, subX: .19, subY: .65, sx: .76, sy: .43, color: 0, symbol: "circle", background: 2, motion: "mask", font: "youth", rule: true },
  "number-space": { x: .14, y: .3, subX: .16, subY: .66, sx: .77, sy: .35, color: 1, symbol: "circle", background: 1, motion: "rise", rule: true },
  "masked-slice": { x: .12, y: .37, subX: .14, subY: .68, sx: .77, sy: .26, color: 2, symbol: "square", background: 0, motion: "mask", font: "youth", outline: true },
  "vertical-arc": { x: .41, y: .17, subX: .61, subY: .72, sx: .22, sy: .36, color: 3, symbol: "circle", background: 2, motion: "blur", font: "song", vertical: true },
  "offset-fade": { x: .2, y: .42, subX: .21, subY: .7, sx: .74, sy: .27, color: 1, symbol: "plus", background: 1, motion: "blur" },
  "time-scale": { x: .16, y: .32, subX: .17, subY: .65, sx: .79, sy: .54, color: 2, symbol: "dots", background: 0, motion: "type", rule: true },
  "tilt-vertical": { x: .42, y: .17, subX: .64, subY: .68, sx: .24, sy: .6, color: 0, symbol: "plus", background: 1, motion: "mask", font: "youth", vertical: true },
  "solid-outline": { x: .17, y: .37, subX: .18, subY: .7, sx: .79, sy: .29, color: 3, symbol: "square", background: 2, motion: "fade", outline: true },
  order: { x: .14, y: .33, subX: .15, subY: .66, sx: .75, sy: .33, color: 0, symbol: "plus", background: 1, motion: "rise", rule: true },
  diamond: { x: .17, y: .38, subX: .18, subY: .68, sx: .76, sy: .32, color: 2, symbol: "diamond", background: 0, motion: "mask" },
  pill: { x: .15, y: .39, subX: .16, subY: .68, sx: .73, sy: .42, color: 3, symbol: "pill", background: 1, motion: "blur", rule: true },
  "three-dots": { x: .14, y: .31, subX: .15, subY: .67, sx: .75, sy: .3, color: 0, symbol: "dots", background: 0, motion: "rise" },
  steps: { x: .3, y: .37, subX: .31, subY: .66, sx: .14, sy: .3, color: 3, symbol: "square", background: 2, motion: "type", rule: true },
  "four-dots": { x: .32, y: .34, subX: .33, subY: .66, sx: .14, sy: .39, color: 2, symbol: "four-dots", background: 0, motion: "fade" },
  "cross-space": { x: .14, y: .33, subX: .15, subY: .67, sx: .75, sy: .32, color: 1, symbol: "cross", background: 0, motion: "mask", outline: true },
  chapter: { x: .36, y: .34, subX: .37, subY: .67, sx: .15, sy: .4, color: 3, symbol: "square", background: 1, motion: "type", rule: true },
  "serif-contrast": { x: .17, y: .36, subX: .18, subY: .67, sx: .78, sy: .31, color: 0, symbol: "diamond", background: 2, motion: "blur", font: "song", rule: true },
  focus: { x: .22, y: .38, subX: .23, subY: .68, sx: .75, sy: .29, color: 1, symbol: "circle", background: 2, motion: "fade", outline: true },
};

export function focusFadeRange(duration: number): [number, number, number, number] {
  const end = Math.max(1, duration - 1);
  return [0, Math.min(16, end * .22), end - Math.min(18, end * .22), end];
}
function fade(frame: number, duration: number) {
  return interpolate(frame, focusFadeRange(duration), [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) });
}

function reveal(frame: number, duration: number, offset = 0) {
  const delay = Math.min(offset, duration * .08);
  return interpolate(frame, [delay, delay + Math.min(22, Math.max(1, duration) * 0.25)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) });
}

function Symbol({ kind, color, size, hollow = false, style }: { kind: SymbolKind; color: string; size: number; hollow?: boolean; style?: CSSProperties }) {
  const fill = hollow ? "transparent" : color;
  const border = hollow ? `2px solid ${color}` : undefined;
  if (kind === "plus" || kind === "cross") return <span style={{ position: "absolute", width: size, height: size, ...style }}><span style={{ position: "absolute", inset: 0, transform: kind === "cross" ? "rotate(45deg)" : undefined }}><i style={{ position: "absolute", left: size * .44, top: 0, width: size * .12, height: size, background: color }} /><i style={{ position: "absolute", left: 0, top: size * .44, width: size, height: size * .12, background: color }} /></span></span>;
  if (kind === "dots" || kind === "four-dots") {
    const points = kind === "dots" ? [[.38, 0], [0, .66], [.76, .66]] : [[0, 0], [.74, .08], [.65, .72], [.04, .65]];
    return <span style={{ position: "absolute", width: size, height: size, ...style }}>{points.map(([x, y], i) => <i key={i} style={{ position: "absolute", left: x * size, top: y * size, width: size * .24, height: size * .24, borderRadius: 99, boxSizing: "border-box", background: fill, border }} />)}</span>;
  }
  return <span style={{ position: "absolute", width: size, height: kind === "pill" ? size * .38 : size, ...style }}><i style={{ position: "absolute", inset: 0, boxSizing: "border-box", background: fill, border, borderRadius: kind === "circle" || kind === "pill" ? 99 : 0, transform: kind === "diamond" ? "rotate(45deg)" : undefined }} /></span>;
}

function Background({ accent, variant }: { accent: string; variant: number }) {
  return <>
    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${118 + variant * 11}deg, #ffffff05, transparent 42%, ${accent}08)` }} />
    {variant % 3 === 0 && <div style={{ position: "absolute", right: "8%", top: "16%", width: "21%", height: "16%", opacity: 0.2, backgroundImage: `radial-gradient(${accent} 1px, transparent 1px)`, backgroundSize: "18px 18px", maskImage: "linear-gradient(90deg, transparent, black)" }} />}
    {variant % 3 === 1 && <div style={{ position: "absolute", left: "57%", top: 0, width: "43%", height: "100%", background: "#ffffff03", borderLeft: "1px solid #ffffff08" }} />}
    {variant % 3 === 2 && <div style={{ position: "absolute", left: "12%", top: "18%", width: "68%", height: "62%", border: "1px solid #ffffff09" }} />}
  </>;
}

export function focusCounterValue(value: string, progress: number): string {
  const match = value.match(/^(\d+(?:\.\d+)?)([%％倍])$/);
  if (!match || progress >= 1) return value;
  const number = Number(match[1]) * Math.max(0, progress);
  return `${match[1].includes(".") ? number.toFixed(match[1].split(".")[1].length) : Math.round(number)}${match[2]}`;
}

export function FocusTextShot({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const theme = useTheme();
  const focus = shot.focusText;
  if (!focus) return null;
  const preset = focus.presetId ?? "focus";
  const baseRecipe = RECIPES[preset];
  const visualWidth = Math.max(1, focusVisualWidth(focus.text));
  const numberPreset = /\d/.test(focus.text);
  const vertical = !!baseRecipe.vertical && visualWidth <= 4 && !numberPreset;
  const recipe = baseRecipe.vertical && !vertical ? { ...baseRecipe, x: .16, y: .34, subX: .17, subY: .67, sx: .77, sy: .22 } : baseRecipe;
  // The project selects a fixed pair, so changing layout does not cycle colors.
  const colorSeed = Array.from(theme.accent).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const accent = ACCENTS[colorSeed % ACCENTS.length];
  const opacity = fade(frame, durationInFrames);
  const revealProgress = reveal(frame, durationInFrames);
  const contentTop = height * (shot.safeArea?.topRatio ?? 0);
  const contentHeight = Math.max(height * .2, height * (1 - Math.max(.12, shot.safeArea?.bottomRatio ?? 0)) - contentTop);
  const symbolSize = Math.min(width, height) * (width > height ? .095 : .07);
  // Leave a separate column for decoration; title and support share a grid edge.
  const titleRight = recipe.sx > recipe.x ? Math.min(.88, recipe.sx - .055) : .89;
  const titleSize = vertical
    ? Math.min(width * .21, contentHeight * .5 / visualWidth)
    : Math.min(contentHeight * (visualWidth <= 2 ? .29 : .23), width * (titleRight - recipe.x) / (visualWidth * (recipe.font === "youth" ? 1.4 : 1.15)));
  const support = focus.support;
  const textStyle: CSSProperties = {
    color: PAPER, fontFamily: recipe.font === "song" ? '"DOV Song", serif' : recipe.font === "youth" ? '"DOV Youth", sans-serif' : FONT, fontWeight: recipe.font ? 400 : 900, fontSize: titleSize,
    lineHeight: 1.05, letterSpacing: 0, whiteSpace: "nowrap",
  };
  const transform = vertical ? `rotate(${preset === "tilt-vertical" ? -7 : 0}deg)` : recipe.motion === "rise" ? `translateY(${(1 - revealProgress) * 24}px)` : undefined;
  const numberProgress = interpolate(frame, [0, Math.min(durationInFrames * 0.52, 28)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const typed = recipe.motion === "type" && focus.text.length >= 5 ? Array.from(focus.text).slice(0, Math.max(1, Math.ceil(focus.text.length * revealProgress))).join("") : focus.text;
  const emphasized = !numberPreset && focus.emphasis && typed.includes(focus.emphasis);
  const emphasisStart = emphasized ? typed.indexOf(focus.emphasis!) : -1;
  const varied = ["embedded-type", "solid-outline", "offset-fade", "serif-contrast", "diamond", "steps", "chapter"].includes(preset);
  const midpoint = Math.ceil(Array.from(focus.text).length / 2);
  const secondaryAccent = ACCENTS[(colorSeed + 2) % ACCENTS.length];
  const supportX = vertical ? .64 : recipe.subX;
  const supportY = vertical ? .53 : Math.max(recipe.subY, recipe.y + titleSize * 1.18 / contentHeight + .075);
  const renderText = () => {
    if (numberPreset) return focusCounterValue(focus.text, numberProgress);
    return Array.from(typed).map((char, index) => {
      const start = Array.from(typed).slice(0, index).join("").length;
      const highlighted = emphasisStart >= 0 && start >= emphasisStart && start < emphasisStart + focus.emphasis!.length;
      const large = !varied || index >= midpoint || focus.text.length <= 2;
      return <span key={index} style={{
        display: "inline-block", fontSize: large ? "1em" : ".65em",
        fontFamily: preset === "serif-contrast" && large ? FONT : undefined,
        fontWeight: preset === "offset-fade" && !large ? 400 : undefined,
        color: highlighted ? accent : preset === "solid-outline" && !large ? "transparent" : undefined,
        WebkitTextStroke: preset === "solid-outline" && !large ? "1px #a7b2a8" : undefined,
        transform: preset === "steps" ? `translateY(${index * titleSize * .055}px)` : preset === "diamond" && index >= midpoint ? `translateY(${titleSize * .16}px)` : undefined,
        opacity: reveal(frame, durationInFrames, Math.min(index * 2, 8)),
      }}>{char}</span>;
    });
  };
  return <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: INK, opacity }}>
    <Background accent={accent} variant={recipe.background} />
    <div style={{ position: "absolute", left: 0, right: 0, top: contentTop, height: contentHeight }}>
    <div style={{ position: "absolute", left: "8%", top: "13%", width: Math.max(24, width * .025), height: 2, background: accent, opacity: revealProgress }} />
    {recipe.rule && <div style={{ position: "absolute", left: "13%", top: `${Math.min(.95, supportY + .1) * 100}%`, width: "48%", height: 1, background: "#ffffff29", opacity: revealProgress }} />}
    {recipe.outline && <div style={{ position: "absolute", left: `${recipe.x * 100 + 2}%`, top: `${recipe.y * 100 - 13}%`, ...textStyle, color: "transparent", WebkitTextStroke: "1px #6d756d", opacity: revealProgress * .35 }}>{focus.text}</div>}
    <div style={{ position: "absolute", left: `${recipe.x * 100}%`, top: `${recipe.y * 100}%`, transform, transformOrigin: "center", writingMode: vertical ? "vertical-rl" : undefined, clipPath: recipe.motion === "mask" ? `inset(0 ${Math.round((1 - revealProgress) * 100)}% 0 0)` : undefined, filter: recipe.motion === "blur" ? `blur(${(1 - revealProgress) * 12}px)` : undefined, opacity: revealProgress, ...textStyle }}>
      {renderText()}
    </div>
    {preset === "masked-slice" && <div style={{ position: "absolute", left: `${recipe.x * 100}%`, top: `${recipe.y * 100}%`, width: width * .4, height: Math.max(2, titleSize * .025), background: INK, transform: `translateY(${titleSize * .6}px) rotate(-1deg)`, opacity: revealProgress }} />}
    {vertical && <div style={{ position: "absolute", left: "28%", top: "12%", width: "38%", height: "65%", border: `1px solid ${accent}55`, borderRadius: "50%", transform: "rotate(18deg)", opacity: revealProgress }} />}
    {support && <div style={{ position: "absolute", left: `${supportX * 100}%`, top: `${supportY * 100}%`, color: MUTED, fontFamily: FONT, fontSize: Math.min(Math.max(18, width * .024), width * (.9 - supportX) / Math.max(1, focusVisualWidth(support) * 1.08)), letterSpacing: width * .001, opacity: reveal(frame, durationInFrames, 8), transform: `translateY(${(1 - reveal(frame, durationInFrames, 8)) * 13}px)`, whiteSpace: "nowrap" }}>{support}</div>}
    <Symbol kind={recipe.symbol} color={accent} size={symbolSize} hollow={recipe.symbol === "circle" || preset === "solid-outline"} style={{ left: `${recipe.sx * 100}%`, top: `${recipe.sy * 100}%`, opacity: reveal(frame, durationInFrames, 5), transform: `translateY(${(1 - reveal(frame, durationInFrames, 5)) * 12}px) scale(${.94 + .06 * reveal(frame, durationInFrames, 5)})` }} />
    {width > height && ["order", "diamond", "pill", "three-dots", "four-dots", "cross-space", "chapter", "serif-contrast", "focus"].includes(preset) && <Symbol kind={recipe.symbol === "plus" ? "circle" : recipe.symbol} size={symbolSize * .42} color={secondaryAccent} hollow style={{ left: "83%", top: "70%", opacity: reveal(frame, durationInFrames, 10) }} />}
    {!recipe.rule && <div style={{ position: "absolute", left: "8%", right: "8%", bottom: "12%", height: 1, background: "#ffffff1f", opacity: revealProgress }} />}
    </div>
  </div>;
}

export function isFocusTextShot(shot: TimelineShot) {
  return !!shot.focusText && (shot.mode === "motion" || shot.kind === "title" || shot.kind === "quote");
}
