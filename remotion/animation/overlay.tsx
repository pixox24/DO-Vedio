import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import type { ReactNode } from "react";
import type { TimelineShot } from "@/lib/core/timeline";
import { FONT } from "../fonts";
import { easeAt, useMotion } from "../layers/anim";
import { useLayout } from "../layout";
import { useTheme } from "../theme";

function frameRange(durationInFrames: number, start: number, end: number): [number, number] {
  const last = Math.max(1, durationInFrames);
  if (last < end) {
    const scale = last / Math.max(1, end);
    start *= scale;
    end = last;
  }
  const boundedEnd = Math.min(last, Math.max(1, end));
  return [Math.min(boundedEnd - 1, Math.max(0, start)), boundedEnd];
}

function headlineOf(shot: TimelineShot) {
  return (shot.onScreenText || shot.card.headline || shot.keywords[0] || shot.caption.split(/[，,。！？!?；;：:、]/)[0] || "").replace(/[。！？!?]+$/, "");
}

function OverlayRoot({ children }: { children: ReactNode }) {
  return <AbsoluteFill data-composite-animation="true" style={{ pointerEvents: "none", overflow: "hidden", fontFamily: FONT }}>{children}</AbsoluteFill>;
}

function AccentOverlay({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const profile = useMotion();
  const { height, portrait, u, pad } = useLayout();
  const p = easeAt(profile)(frame, frameRange(durationInFrames, 0, 24));
  const width = portrait ? 42 : 28;
  return <OverlayRoot>
    <div style={{ position: "absolute", top: pad, left: pad, width: `${width}%`, height: u * 0.55, background: theme.accent, transformOrigin: "left center", transform: `scaleX(${p})`, opacity: 0.92 }} />
    <div style={{ position: "absolute", top: pad * 1.8, left: pad, color: theme.text, fontSize: portrait ? u * 2.8 : u * 2, letterSpacing: u * 0.18, opacity: p * 0.78 }}>{headlineOf(shot) || "FOCUS"}</div>
    <div style={{ position: "absolute", top: height * 0.16, right: pad, width: u * 4.5, height: u * 4.5, borderTop: `${Math.max(1, u * 0.25)}px solid ${theme.accent}`, borderRight: `${Math.max(1, u * 0.25)}px solid ${theme.accent}`, opacity: p * 0.8 }} />
  </OverlayRoot>;
}

function QuoteOverlay({ durationInFrames }: { durationInFrames: number }) {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const profile = useMotion();
  const { height, portrait, u, pad } = useLayout();
  const p = easeAt(profile)(frame, frameRange(durationInFrames, 0, 30));
  return <OverlayRoot>
    <div style={{ position: "absolute", left: pad, top: height * 0.14, color: theme.accent, fontFamily: "Georgia, serif", fontSize: portrait ? u * 18 : u * 14, lineHeight: 0.7, opacity: p * 0.88, transform: `translateY(${(1 - p) * u * 2}px) rotate(${-8 + p * 8}deg)` }}>“</div>
    <div style={{ position: "absolute", left: pad, right: pad, top: height * 0.25, height: u * 0.45, background: theme.accent, transformOrigin: "left center", transform: `scaleX(${p})`, opacity: 0.85 }} />
  </OverlayRoot>;
}

function SpotlightOverlay({ durationInFrames }: { durationInFrames: number }) {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { height, portrait, u, pad } = useLayout();
  const p = interpolate(frame, frameRange(durationInFrames, 0, 34), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const sweep = interpolate(frame, frameRange(durationInFrames, 8, 70), [-28, 28], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const size = portrait ? 60 : 42;
  return <OverlayRoot>
    <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse ${size}% ${portrait ? 36 : 52}% at ${50 + sweep}% 36%, ${theme.text}30 0%, transparent 62%)`, mixBlendMode: "screen", opacity: p * 0.9 }} />
    <div style={{ position: "absolute", top: pad, left: pad, right: pad, bottom: Math.max(pad, height * 0.18), border: `${Math.max(1, u * 0.22)}px solid ${theme.text}55`, opacity: p * 0.72 }} />
    <div style={{ position: "absolute", left: pad, bottom: Math.max(pad, height * 0.18) + u * 2, color: theme.text, fontSize: portrait ? u * 2.8 : u * 2, letterSpacing: u * 0.28, opacity: p * 0.72 }}>FEATURE / LIVE</div>
  </OverlayRoot>;
}

function SplitOverlay({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { height, portrait, u, pad } = useLayout();
  const p = interpolate(frame, frameRange(durationInFrames, 0, 28), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const sides = shot.card.sides ?? ["过去", "现在"];
  return <OverlayRoot>
    <div style={{ position: "absolute", background: theme.accent, opacity: p * 0.9, ...(portrait ? { left: "50%", top: pad, bottom: Math.max(pad, height * 0.18), width: u * 0.55, transform: "translateX(-50%) scaleY(1)", transformOrigin: "center" } : { top: "50%", left: pad, right: pad, height: u * 0.55, transform: "translateY(-50%) scaleX(1)", transformOrigin: "center" }) }} />
    <div style={{ position: "absolute", top: portrait ? pad * 1.5 : "50%", left: portrait ? pad : pad * 1.5, color: theme.text, fontSize: portrait ? u * 3 : u * 2.2, letterSpacing: u * 0.2, opacity: p * 0.82, transform: portrait ? undefined : "translateY(-50%)" }}>{sides[0]}</div>
    <div style={{ position: "absolute", top: portrait ? undefined : "50%", right: portrait ? pad : pad * 1.5, bottom: portrait ? Math.max(pad, height * 0.18) + u * 2 : undefined, color: theme.text, fontSize: portrait ? u * 3 : u * 2.2, letterSpacing: u * 0.2, opacity: p * 0.82, transform: portrait ? undefined : "translateY(-50%)" }}>{sides[1]}</div>
  </OverlayRoot>;
}

function CalloutOverlay({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { u } = useLayout();
  const p = interpolate(frame, frameRange(durationInFrames, 0, 24), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const focus = shot.focus ?? { x: 0.5, y: 0.42 };
  const label = headlineOf(shot) || "重点信息";
  const boxW = 24;
  const boxH = 16;
  const left = Math.min(100 - boxW, Math.max(0, focus.x * 100 - boxW / 2));
  const top = Math.min(74, Math.max(8, focus.y * 100 - boxH / 2));
  return <OverlayRoot>
    <div style={{ position: "absolute", left: `${left}%`, top: `${top}%`, width: `${boxW}%`, height: `${boxH}%`, border: `${Math.max(1, u * 0.35)}px solid ${theme.accent}`, opacity: p, transform: `scale(${0.82 + p * 0.18})`, transformOrigin: "center" }} />
    <div style={{ position: "absolute", left: `${focus.x * 100}%`, top: `${focus.y * 100}%`, width: u * 1.3, height: u * 1.3, borderRadius: "50%", background: theme.accent, boxShadow: `0 0 ${u * 2.5}px ${theme.accent}`, transform: "translate(-50%, -50%)", opacity: p }} />
    <div style={{ position: "absolute", left: "72%", top: `${top}%`, maxWidth: "24%", padding: `${u * 1.2}px ${u * 1.6}px`, color: theme.ink, background: theme.accent, fontSize: u * 2.8, fontWeight: 900, lineHeight: 1.2, opacity: p }}>{label}</div>
  </OverlayRoot>;
}

function HudOverlay({ durationInFrames }: { durationInFrames: number }) {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { u, pad } = useLayout();
  const p = interpolate(frame, frameRange(durationInFrames, 0, 20), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return <OverlayRoot>
    <AbsoluteFill style={{ background: "repeating-linear-gradient(0deg, transparent 0 7px, rgba(255,255,255,.06) 8px 9px)", opacity: p * 0.35, mixBlendMode: "screen" }} />
    <div style={{ position: "absolute", inset: pad, border: `${Math.max(1, u * 0.24)}px solid ${theme.accent}`, opacity: p * 0.7 }} />
    <div style={{ position: "absolute", top: pad * 1.5, left: pad * 1.5, color: theme.accent, fontSize: u * 2, letterSpacing: u * 0.26, opacity: p * 0.85 }}>SYS // VISUAL</div>
    <div style={{ position: "absolute", right: pad * 1.5, bottom: Math.max(pad, u * 5), width: u * 3.5, height: u * 3.5, border: `${Math.max(1, u * 0.24)}px solid ${theme.accent}`, opacity: p * 0.85 }} />
  </OverlayRoot>;
}

export function renderOverlayAnimation(shot: TimelineShot, durationInFrames: number) {
  const template = shot.animation?.templateId;
  if (template === "creator-cinema-editorial-quote") return <QuoteOverlay durationInFrames={durationInFrames} />;
  if (template === "hero-spotlight-stage") return <SpotlightOverlay durationInFrames={durationInFrames} />;
  if (template === "hero-split-wipe") return <SplitOverlay shot={shot} durationInFrames={durationInFrames} />;

  switch (shot.animation?.family) {
    case "callout":
      return <CalloutOverlay shot={shot} durationInFrames={durationInFrames} />;
    case "hud":
      return <HudOverlay durationInFrames={durationInFrames} />;
    case "compare":
      return <SplitOverlay shot={shot} durationInFrames={durationInFrames} />;
    case "stat":
    case "editorial":
    case "kinetic":
    case "process":
    case "timeline":
    case "collage":
    case "ink":
      return <AccentOverlay shot={shot} durationInFrames={durationInFrames} />;
    default:
      // Selecting composite mode alone must still produce a visible, restrained layer.
      return <AccentOverlay shot={shot} durationInFrames={durationInFrames} />;
  }
}
