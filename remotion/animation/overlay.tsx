import type { ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
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

/** 复合画面上的固定轻标记。卡片模板是不透明全屏，不叠到素材上。 */
function AccentOverlay({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const profile = useMotion();
  const { portrait, u, pad } = useLayout();
  const p = easeAt(profile)(frame, frameRange(durationInFrames, 0, 24));
  const width = portrait ? 42 : 28;
  return <OverlayRoot>
    <div style={{ position: "absolute", top: pad, left: pad, width: `${width}%`, height: u * 0.55, background: theme.accent, transformOrigin: "left center", transform: `scaleX(${p})`, opacity: 0.92 }} />
    <div style={{ position: "absolute", top: pad * 1.8, left: pad, color: theme.text, fontSize: portrait ? u * 2.8 : u * 2, letterSpacing: u * 0.18, opacity: p * 0.78 }}>{headlineOf(shot) || "FOCUS"}</div>
    <div style={{ position: "absolute", top: "16%", right: pad, width: u * 4.5, height: u * 4.5, borderTop: `${Math.max(1, u * 0.25)}px solid ${theme.accent}`, borderRight: `${Math.max(1, u * 0.25)}px solid ${theme.accent}`, opacity: p * 0.8 }} />
  </OverlayRoot>;
}

export function renderOverlayAnimation(shot: TimelineShot, durationInFrames: number) {
  return <AccentOverlay shot={shot} durationInFrames={durationInFrames} />;
}
