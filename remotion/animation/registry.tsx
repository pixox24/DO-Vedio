import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReactNode } from "react";
import type { TimelineShot } from "@/lib/core/timeline";
import type { AnimationFamily } from "@/lib/core/types";
import { FONT } from "../fonts";
import { easeAt, enterOffset, staggerDelay, useCorner, useMotion } from "../layers/anim";
import { useLayout } from "../layout";
import { useTheme, pick } from "../theme";

export type AnimationRendererProps = {
  shot: TimelineShot;
  durationInFrames: number;
  anchors: NonNullable<TimelineShot["animation"]>["anchors"];
  params: NonNullable<TimelineShot["animation"]>["params"];
};
export type AnimationRenderer = (props: AnimationRendererProps) => ReactNode;

const intensityScale = (intensity: 1 | 2 | 3) => [0.78, 1, 1.24][intensity - 1];

function safePadding(shot: TimelineShot, height: number, portrait: boolean, pad: number) {
  return Math.max(pad * 1.3, height * (shot.safeArea?.bottomRatio ?? (portrait ? 0.24 : 0.075)));
}

function Surface({ shot, children, tone = 0 }: { shot: TimelineShot; children: ReactNode; tone?: number }) {
  const theme = useTheme();
  const profile = useMotion();
  const [dark, mid, light] = pick(theme.palettes, shot.seed + tone);
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const drift = Math.sin(frame / Math.max(8, 18 / profile.energy)) * u * profile.energy * 0.18;
  return (
    <AbsoluteFill style={{ background: dark, color: theme.text, overflow: "hidden", fontFamily: FONT }}>
      <AbsoluteFill style={{ background: `linear-gradient(135deg, ${dark}, ${mid} 58%, ${light})`, transform: `scale(1.04) translateX(${drift}px)` }} />
      {profile.texture !== "none" && <AbsoluteFill style={{ opacity: 0.12, mixBlendMode: "overlay", backgroundImage: profile.texture === "scanline" ? "repeating-linear-gradient(0deg, rgba(255,255,255,.5) 0 1px, transparent 1px 4px)" : "radial-gradient(rgba(255,255,255,.5) 0.7px, transparent .8px)", backgroundSize: profile.texture === "scanline" ? `${u * 1.2}px ${u * 1.2}px` : `${u * 2.5}px ${u * 2.5}px` }} />}
      {children}
    </AbsoluteFill>
  );
}

function frameProgress(frame: number, duration: number, profile: ReturnType<typeof useMotion>, start = 0, span = 22) {
  return easeAt(profile)(frame, [start, Math.min(duration, start + span)]);
}

function headlineOf(shot: TimelineShot) {
  return (shot.onScreenText || shot.card.headline || shot.keywords[0] || shot.caption.split(/[，,。！？!?；;：:、]/)[0] || "").replace(/[。！？!?]+$/, "");
}

function EditorialReveal({ shot, durationInFrames }: AnimationRendererProps) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { height, portrait, u, pad } = useLayout();
  const { fps } = useVideoConfig();
  const enter = frameProgress(frame, durationInFrames, profile, 0, 24);
  const springIn = spring({ frame, fps, config: { damping: 18, mass: 0.75 } });
  const p = Math.min(1, enter * 0.72 + springIn * 0.28);
  const offset = enterOffset(profile, p);
  const corner = useCorner(u);
  const headline = headlineOf(shot);
  const items = shot.card.items?.slice(0, 4) ?? [];
  return <Surface shot={shot}>
    <AbsoluteFill style={{ justifyContent: "center", padding: pad, paddingBottom: safePadding(shot, height, portrait, pad) }}>
      <div style={{ opacity: p, transform: `translate(${offset.x * u}px, ${offset.y * u}px) scale(${offset.scale})`, maxWidth: portrait ? "100%" : "82%" }}>
        <div style={{ width: `${interpolate(frame, [0, 20], [0, 28], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}%`, height: u * 0.7, background: theme.accent, borderRadius: corner, marginBottom: u * 3 }} />
        <div style={{ fontSize: portrait ? u * 9 : u * 7.4, fontWeight: 900, lineHeight: 1.15 }}>{headline}</div>
        {items.map((item, index) => {
          const at = staggerDelay(profile, index, 6);
          const itemP = easeAt(profile)(frame, [at, at + 15]);
          return <div key={`${item}-${index}`} style={{ marginTop: u * 2.5, fontSize: portrait ? u * 5.2 : u * 3.8, fontWeight: 700, opacity: itemP, transform: `translateX(${(1 - itemP) * u * 3}px)` }}>{item}</div>;
        })}
      </div>
    </AbsoluteFill>
  </Surface>;
}

function KineticPhrase({ shot, durationInFrames }: AnimationRendererProps) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { height, portrait, u, pad } = useLayout();
  const phrases = splitPhrases(headlineOf(shot));
  const scale = intensityScale(shot.animation?.intensity ?? 1);
  const fontSize = (portrait ? u * 8 : u * 6.3) * Math.min(1.1, scale);
  return <Surface shot={shot} tone={2}>
    <AbsoluteFill style={{ justifyContent: "center", padding: pad, paddingBottom: safePadding(shot, height, portrait, pad) }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: `${u * 1.1}px ${u * 1.6}px`, maxWidth: portrait ? "100%" : "88%" }}>
        {phrases.map((phrase, index) => {
          const start = staggerDelay(profile, index, 7);
          const p = easeAt(profile)(frame, [start, Math.min(durationInFrames, start + Math.max(10, 18 / scale))]);
          const emphasized = index === phrases.length - 1 || shot.keywords.some((keyword) => phrase.includes(keyword));
          return <span key={`${phrase}-${index}`} style={{ display: "inline-block", color: emphasized ? theme.accent : theme.text, fontFamily: FONT, fontWeight: emphasized ? 900 : 400, fontSize, lineHeight: 1.16, clipPath: `inset(${(1 - p) * 100}% 0 0 0)`, transform: `translateY(${(1 - p) * u * 4}px)`, opacity: p }}>{phrase}</span>;
        })}
      </div>
    </AbsoluteFill>
  </Surface>;
}

function StatBurst({ shot, durationInFrames }: AnimationRendererProps) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { height, portrait, u, pad } = useLayout();
  const stat = shot.card.stat;
  const raw = stat?.value ?? headlineOf(shot);
  const match = raw.match(/^([\d,.]+)(.*)$/);
  const numeric = match ? Number(match[1].replaceAll(",", "")) : Number.NaN;
  const p = frameProgress(frame, durationInFrames, profile, 0, 30);
  const value = Number.isFinite(numeric) ? String(Math.round(numeric * p * 100) / 100) : raw;
  const unitP = easeAt(profile)(frame, [staggerDelay(profile, 3), staggerDelay(profile, 3) + 14]);
  const labelP = easeAt(profile)(frame, [staggerDelay(profile, 5), staggerDelay(profile, 5) + 16]);
  const scale = intensityScale(shot.animation?.intensity ?? 1);
  return <Surface shot={shot} tone={4}>
    <AbsoluteFill style={{ justifyContent: "center", padding: pad, paddingBottom: safePadding(shot, height, portrait, pad) }}>
      <div style={{ position: "absolute", inset: `${pad * 1.5}px ${pad}px`, opacity: 0.2, backgroundImage: `repeating-linear-gradient(90deg, ${theme.text} 0 1px, transparent 1px ${u * 8}px)`, transform: `scaleX(${p})`, transformOrigin: "left center" }} />
      <div style={{ position: "relative", textAlign: portrait ? "center" : "left" }}>
        {shot.card.headline && shot.card.variant === "stat" && <div style={{ fontSize: u * 4, opacity: 0.76, marginBottom: u * 2 }}>{shot.card.headline}</div>}
        {stat?.label && <div style={{ fontSize: u * 4, opacity: 0.76, marginBottom: u * 2 }}>{stat.label}</div>}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: portrait ? "center" : "flex-start", color: theme.text }}>
          <span style={{ fontSize: (portrait ? u * 19 : u * 18) * scale, fontWeight: 900, letterSpacing: "0.01em" }}>{value}{match?.[2] ?? ""}</span>
          {stat?.unit && <span style={{ marginLeft: u, fontSize: portrait ? u * 8 : u * 7, fontWeight: 700, opacity: unitP }}>{stat.unit}</span>}
        </div>
        {shot.card.headline && shot.card.variant !== "stat" && <div style={{ marginTop: u * 3, fontSize: u * 4.2, opacity: labelP }}>{shot.card.headline}</div>}
      </div>
    </AbsoluteFill>
  </Surface>;
}

function CompareSplit({ shot, durationInFrames }: AnimationRendererProps) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { height, width, portrait, u, pad } = useLayout();
  const corner = useCorner(u);
  const sides = shot.card.sides ?? [headlineOf(shot), "另一面"];
  const p = frameProgress(frame, durationInFrames, profile, 0, 24);
  const second = easeAt(profile)(frame, [staggerDelay(profile, 1, 8), staggerDelay(profile, 1, 8) + 18]);
  const lineSize = u * (shot.animation?.intensity === 3 ? 0.8 : 0.45);
  const panelStyle = { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: pad, color: theme.text, fontFamily: FONT, fontSize: portrait ? u * 7 : u * 5.5, fontWeight: 900, textAlign: "center" as const, lineHeight: 1.2, borderRadius: corner };
  return <Surface shot={shot} tone={6}>
    <AbsoluteFill style={{ justifyContent: "center", padding: pad, paddingBottom: safePadding(shot, height, portrait, pad) }}>
      <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", alignItems: "stretch", width: "100%", height: portrait ? "72%" : "58%", maxWidth: portrait ? "100%" : width * 0.86, alignSelf: "center", gap: portrait ? u * 1.5 : u * 2 }}>
        <div style={{ ...panelStyle, background: theme.ink, transform: `translate${portrait ? "Y" : "X"}(${(1 - p) * (portrait ? -16 : -12)}%)`, opacity: p }}>{sides[0]}</div>
        <div style={{ ...panelStyle, background: theme.accent, color: theme.ink, transform: `translate${portrait ? "Y" : "X"}(${(1 - second) * (portrait ? 16 : 12)}%)`, opacity: second }}>{sides[1]}</div>
      </div>
      <div style={{ position: "absolute", left: portrait ? "50%" : "50%", top: portrait ? "50%" : "50%", transform: "translate(-50%, -50%)", padding: `${u * 1.2}px ${u * 2}px`, background: theme.text, color: theme.ink, borderRadius: corner, fontWeight: 900, fontSize: u * 3.5, boxShadow: `0 0 ${u * 2}px ${theme.accent}` }}>VS</div>
      <div style={{ position: "absolute", background: theme.text, opacity: 0.7, ...(portrait ? { left: "20%", right: "20%", top: "50%", height: lineSize } : { top: "26%", bottom: "26%", left: "50%", width: lineSize }) }} />
    </AbsoluteFill>
  </Surface>;
}

function ProcessPath({ shot, durationInFrames }: AnimationRendererProps) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { height, portrait, u, pad } = useLayout();
  const items = (shot.card.items?.length ? shot.card.items : [headlineOf(shot)]).slice(0, 4);
  const p = frameProgress(frame, durationInFrames, profile, 0, 30);
  const nodeSize = u * 4.5;
  const startX = portrait ? 18 : 10;
  const endX = portrait ? 18 : 90;
  const startY = portrait ? 10 : 50;
  const endY = portrait ? 88 : 50;
  const points = items.map((_, index) => portrait ? [startX, startY + ((endY - startY) * index) / Math.max(1, items.length - 1)] : [startX + ((endX - startX) * index) / Math.max(1, items.length - 1), startY]);
  const path = points.map(([x, y], index) => `${index ? "L" : "M"} ${x} ${y}`).join(" ");
  return <Surface shot={shot} tone={8}>
    <AbsoluteFill style={{ justifyContent: "center", padding: pad, paddingBottom: safePadding(shot, height, portrait, pad) }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: pad, width: `calc(100% - ${pad * 2}px)`, height: `calc(100% - ${pad * 2}px)` }}>
        <path d={path} fill="none" stroke={theme.text} strokeOpacity={0.3} strokeWidth={1.2} vectorEffect="non-scaling-stroke" strokeDasharray="100" strokeDashoffset={100 * (1 - p)} />
        <path d={path} fill="none" stroke={theme.accent} strokeWidth={0.55} vectorEffect="non-scaling-stroke" strokeDasharray="100" strokeDashoffset={100 * (1 - p)} />
        {points.map(([x, y], index) => {
          const at = staggerDelay(profile, index, 7);
          const nodeP = easeAt(profile)(frame, [at, at + 12]);
          return <g key={index} opacity={nodeP}><circle cx={x} cy={y} r={nodeSize / u * 0.55} fill={theme.accent} /><circle cx={x} cy={y} r={nodeSize / u * 0.9} fill="none" stroke={theme.text} strokeOpacity={0.55} strokeWidth={0.4} /></g>;
        })}
      </svg>
      <div style={{ position: "relative", display: "flex", flexDirection: portrait ? "column" : "row", justifyContent: "space-between", gap: portrait ? u * 4 : u * 2, width: "100%", height: portrait ? "76%" : "auto", alignItems: portrait ? "stretch" : "center" }}>
        {items.map((item, index) => <div key={`${item}-${index}`} style={{ maxWidth: portrait ? "78%" : "22%", alignSelf: portrait ? (index % 2 ? "flex-end" : "flex-start") : undefined, padding: `${u * 1.8}px ${u * 2.2}px`, background: theme.ink, border: `${Math.max(1, u * 0.2)}px solid ${theme.accent}`, color: theme.text, fontSize: portrait ? u * 4.8 : u * 3.4, fontWeight: 700, textAlign: "center", opacity: easeAt(profile)(frame, [staggerDelay(profile, index, 7), staggerDelay(profile, index, 7) + 14]) }}>{item}</div>)}
      </div>
    </AbsoluteFill>
  </Surface>;
}

function CalloutFocus({ shot, durationInFrames }: AnimationRendererProps) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { height, portrait, u, pad } = useLayout();
  const focus = shot.focus ?? { x: 0.5, y: 0.42 };
  const p = frameProgress(frame, durationInFrames, profile, 0, 20);
  const label = headlineOf(shot);
  const boxW = portrait ? 34 : 28;
  const boxH = portrait ? 18 : 24;
  const left = Math.min(100 - boxW, Math.max(0, focus.x * 100 - boxW / 2));
  const top = Math.min(74, Math.max(8, focus.y * 100 - boxH / 2));
  const labelTop = top > 54 ? 7 : 86;
  const safeBottom = safePadding(shot, height, portrait, pad);
  return <Surface shot={shot} tone={10}>
    <AbsoluteFill style={{ padding: pad, paddingBottom: safeBottom }}>
      <div style={{ position: "absolute", left: `${left}%`, top: `${top}%`, width: `${boxW}%`, height: `${boxH}%`, border: `${Math.max(2, u * 0.45)}px solid ${theme.accent}`, opacity: p, transform: `scale(${0.82 + p * 0.18})`, transformOrigin: "center" }} />
      <div style={{ position: "absolute", left: `${focus.x * 100}%`, top: `${focus.y * 100}%`, width: u * 1.5, height: u * 1.5, borderRadius: "50%", background: theme.accent, boxShadow: `0 0 ${u * 3}px ${theme.accent}`, transform: "translate(-50%, -50%)", opacity: p }} />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: p }}>
        <path d={`M ${focus.x * 100} ${focus.y * 100} L 78 ${labelTop}`} fill="none" stroke={theme.accent} strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ position: "absolute", left: "72%", top: `${labelTop}%`, maxWidth: "25%", padding: `${u * 1.4}px ${u * 1.8}px`, color: theme.ink, background: theme.accent, fontSize: portrait ? u * 4.3 : u * 3.2, fontWeight: 900, lineHeight: 1.2, opacity: p }}>{label}</div>
      <div style={{ position: "absolute", bottom: safeBottom, left: pad, right: pad, color: theme.text, fontSize: portrait ? u * 4.8 : u * 3.5, opacity: 0.78 }}>{shot.card.headline && shot.card.headline !== label ? shot.card.headline : "重点信息"}</div>
    </AbsoluteFill>
  </Surface>;
}

function TimelineFlow({ shot, durationInFrames }: AnimationRendererProps) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { height, portrait, u, pad } = useLayout();
  const items = (shot.card.items?.length ? shot.card.items : [shot.card.headline || headlineOf(shot), "现在", "未来"]).slice(0, 5);
  const p = frameProgress(frame, durationInFrames, profile, 0, 28);
  const years = items.map((item, index) => ({ label: item, year: String(2020 + index * 5) }));
  return <Surface shot={shot} tone={12}>
    <AbsoluteFill style={{ padding: pad, paddingBottom: safePadding(shot, height, portrait, pad), justifyContent: "center" }}>
      <div style={{ fontSize: portrait ? u * 6 : u * 4.5, fontWeight: 900, marginBottom: u * 5 }}>{shot.card.headline || "时间线"}</div>
      <div style={{ position: "relative", display: "flex", flexDirection: portrait ? "column" : "row", justifyContent: "space-between", gap: portrait ? u * 4 : u * 2, padding: portrait ? `0 ${u * 8}px` : `0 ${u * 3}px` }}>
        <div style={{ position: "absolute", background: theme.accent, opacity: 0.35, ...(portrait ? { top: 0, bottom: 0, left: u * 9, width: u * 0.6, transform: `scaleY(${p})`, transformOrigin: "top" } : { left: 0, right: 0, top: "50%", height: u * 0.6, transform: `scaleX(${p})`, transformOrigin: "left" }) }} />
        {years.map(({ label, year }, index) => {
          const q = easeAt(profile)(frame, [staggerDelay(profile, index, 6), staggerDelay(profile, index, 6) + 14]);
          return <div key={`${year}-${index}`} style={{ position: "relative", display: "flex", flexDirection: portrait ? "row" : "column", alignItems: "center", gap: u * 1.2, opacity: q, transform: `translate${portrait ? "X" : "Y"}(${(1 - q) * u * 3}px)`, maxWidth: portrait ? "82%" : "22%" }}>
            <div style={{ width: u * 2.5, height: u * 2.5, borderRadius: "50%", background: theme.accent, border: `${u * 0.5}px solid ${theme.text}`, flexShrink: 0 }} />
            <div style={{ color: theme.text, textAlign: portrait ? "left" : "center" }}><div style={{ color: theme.accent, fontSize: u * 3.2, fontWeight: 900 }}>{year}</div><div style={{ fontSize: portrait ? u * 4.6 : u * 3.2, fontWeight: 700, lineHeight: 1.2 }}>{label}</div></div>
          </div>;
        })}
      </div>
    </AbsoluteFill>
  </Surface>;
}

function CollageCut({ shot, durationInFrames }: AnimationRendererProps) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { height, portrait, u, pad } = useLayout();
  const title = headlineOf(shot);
  const p = frameProgress(frame, durationInFrames, profile, 0, 24);
  const strips = [title.slice(0, 5), title.slice(5, 10), title.slice(10, 15)].filter(Boolean);
  return <Surface shot={shot} tone={14}>
    <AbsoluteFill style={{ padding: pad, paddingBottom: safePadding(shot, height, portrait, pad), justifyContent: "center", alignItems: "center" }}>
      <div style={{ position: "relative", width: "100%", maxWidth: portrait ? "100%" : "86%", transform: `rotate(${(1 - p) * -2}deg)` }}>
        {strips.map((text, index) => {
          const q = easeAt(profile)(frame, [staggerDelay(profile, index, 5), staggerDelay(profile, index, 5) + 16]);
          const offset = (1 - q) * (index % 2 ? 8 : -8);
          return <div key={`${text}-${index}`} style={{ margin: `${u * 1.5}px 0`, padding: `${u * 2}px ${u * 3}px`, background: index % 2 ? theme.accent : theme.ink, color: index % 2 ? theme.ink : theme.text, fontSize: portrait ? u * 9 : u * 7, fontWeight: 900, lineHeight: 1.05, transform: `translate(${offset * u}px, ${(1 - q) * u * 4}px) rotate(${(index - 1) * 1.2}deg)`, opacity: q, clipPath: `polygon(${index * 3}% 0, 100% ${index % 2 ? 4 : 0}%, ${100 - index * 3}% 100%, 0 ${index % 2 ? 96 : 100}%)` }}>{text}</div>;
        })}
      </div>
    </AbsoluteFill>
  </Surface>;
}

function HudOverlay({ shot, durationInFrames }: AnimationRendererProps) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { height, portrait, u, pad } = useLayout();
  const p = frameProgress(frame, durationInFrames, profile, 0, 18);
  const flicker = Math.sin(frame * 1.7) > 0.65 ? 0.55 : 1;
  const label = headlineOf(shot);
  return <Surface shot={shot} tone={16}>
    <AbsoluteFill style={{ padding: pad, paddingBottom: safePadding(shot, height, portrait, pad), color: theme.text }}>
      <AbsoluteFill style={{ opacity: 0.16, backgroundImage: `linear-gradient(${theme.accent} 1px, transparent 1px), linear-gradient(90deg, ${theme.accent} 1px, transparent 1px)`, backgroundSize: `${u * 9}px ${u * 9}px`, transform: `scale(${1 + (1 - p) * 0.06})` }} />
      <div style={{ position: "absolute", top: pad, left: pad, right: pad, display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: u * 2.8, color: theme.accent, opacity: p * flicker }}><span>SYS // VISUAL</span><span>REC {String(Math.round(frame / 3)).padStart(4, "0")}</span></div>
      <div style={{ position: "relative", margin: "auto", width: portrait ? "80%" : "62%", aspectRatio: "1.45", border: `${u * 0.5}px solid ${theme.accent}`, boxShadow: `0 0 ${u * 2}px ${theme.accent}`, opacity: p * flicker }}>
        <div style={{ position: "absolute", left: "50%", top: "50%", width: u * 2, height: u * 2, borderRadius: "50%", background: theme.accent, transform: "translate(-50%, -50%)" }} />
        <div style={{ position: "absolute", left: "8%", right: "8%", top: "50%", height: u * 0.35, background: theme.accent, opacity: 0.8 }} />
        <div style={{ position: "absolute", left: "50%", top: "8%", bottom: "8%", width: u * 0.35, background: theme.accent, opacity: 0.8 }} />
      </div>
      <div style={{ position: "relative", margin: `0 auto ${safePadding(shot, height, portrait, pad) * 0.25}px`, maxWidth: "80%", padding: `${u * 1.2}px ${u * 2}px`, color: theme.ink, background: theme.accent, fontFamily: "monospace", fontSize: portrait ? u * 4.8 : u * 3.5, fontWeight: 900, textAlign: "center", opacity: p * flicker }}>{label}</div>
    </AbsoluteFill>
  </Surface>;
}

function InkBleed({ shot, durationInFrames }: AnimationRendererProps) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { height, portrait, u, pad } = useLayout();
  const p = frameProgress(frame, durationInFrames, profile, 0, 34);
  const label = headlineOf(shot);
  const path = portrait ? "M18 14 C48 24, 45 38, 28 48 S50 70, 80 86" : "M8 54 C28 20, 42 78, 62 42 S82 26, 94 58";
  return <Surface shot={shot} tone={18}>
    <AbsoluteFill style={{ padding: pad, paddingBottom: safePadding(shot, height, portrait, pad), justifyContent: "center", alignItems: "center" }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: pad, width: `calc(100% - ${pad * 2}px)`, height: `calc(100% - ${pad * 2}px)`, opacity: p }}>
        <path d={path} fill="none" stroke={theme.accent} strokeWidth="6" strokeLinecap="round" strokeDasharray="150" strokeDashoffset={150 * (1 - p)} opacity="0.22" />
        <path d={path} fill="none" stroke={theme.text} strokeWidth="1.1" strokeLinecap="round" strokeDasharray="150" strokeDashoffset={150 * (1 - p)} />
        <circle cx={portrait ? 80 : 94} cy={portrait ? 86 : 58} r={10 + p * 8} fill={theme.accent} opacity={0.16 * p} />
      </svg>
      <div style={{ position: "relative", color: theme.text, fontSize: portrait ? u * 9 : u * 7, fontWeight: 900, textAlign: "center", transform: `scale(${0.9 + p * 0.1})`, opacity: p }}>{label}</div>
    </AbsoluteFill>
  </Surface>;
}

function splitPhrases(text: string) {
  const parts = text.split(/[，,。！？!?；;：:、\s]+/).filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 8);
  return Array.from({ length: Math.ceil(text.length / 3) }, (_, index) => text.slice(index * 3, index * 3 + 3)).filter(Boolean);
}

function UnsupportedAnimation({ shot }: AnimationRendererProps) {
  const theme = useTheme();
  const { height, portrait, pad, u } = useLayout();
  return <AbsoluteFill data-animation-fallback={shot.animation?.family} style={{ background: theme.ink, color: theme.text, justifyContent: "center", alignItems: "center", padding: pad, paddingBottom: safePadding(shot, height, portrait, pad), fontFamily: FONT, textAlign: "center" }}><div style={{ fontSize: u * 6, fontWeight: 900 }}>{headlineOf(shot)}</div><div style={{ marginTop: u * 2, fontSize: u * 2.5, color: theme.sub }}>动画配方暂未实现</div></AbsoluteFill>;
}

export const animationRenderers: Record<AnimationFamily, AnimationRenderer | undefined> = {
  none: undefined,
  editorial: EditorialReveal,
  kinetic: KineticPhrase,
  stat: StatBurst,
  compare: CompareSplit,
  process: ProcessPath,
  callout: CalloutFocus,
  timeline: TimelineFlow,
  collage: CollageCut,
  hud: HudOverlay,
  ink: InkBleed,
};

export function renderAnimation(shot: TimelineShot, durationInFrames: number) {
  const family = shot.animation?.family ?? "none";
  const Renderer = animationRenderers[family];
  if (!Renderer) return family === "none" ? null : <UnsupportedAnimation shot={shot} durationInFrames={durationInFrames} anchors={shot.animation?.anchors ?? []} params={shot.animation?.params ?? {}} />;
  return <Renderer shot={shot} durationInFrames={durationInFrames} anchors={shot.animation?.anchors ?? []} params={shot.animation?.params ?? {}} />;
}
