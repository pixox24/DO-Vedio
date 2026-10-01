import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReactNode } from "react";
import type { TimelineShot } from "@/lib/core/timeline";
import type { Ui2vTemplateId } from "@/lib/core/types";
import { FONT } from "../fonts";
import { useLayout } from "../layout";
import { useTheme } from "../theme";
import type { AnimationRendererProps } from "./registry";

const clampProgress = (frame: number, durationInFrames: number, end = 26) => interpolate(frame, [0, Math.min(durationInFrames, end)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
const frameRange = (durationInFrames: number, start: number, end: number): [number, number] => {
  const last = Math.max(1, durationInFrames);
  if (last < end) {
    const scale = last / Math.max(1, end);
    start *= scale;
    end = last;
  }
  const boundedEnd = Math.min(last, Math.max(1, end));
  const boundedStart = Math.min(boundedEnd - 1, Math.max(0, start));
  return [boundedStart, boundedEnd];
};
const headline = (shot: TimelineShot) => (shot.onScreenText || shot.card.headline || shot.keywords[0] || shot.caption.split(/[，,。！？!?；;：:、]/)[0] || "").replace(/[。！？!?]+$/, "");

function TemplateFrame({ children, background, color = "#f4f0e8" }: { children: ReactNode; background: string; color?: string }) {
  return <AbsoluteFill style={{ background, color, overflow: "hidden", fontFamily: FONT }}>{children}</AbsoluteFill>;
}

function QuoteTemplate({ shot, durationInFrames }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { height, portrait, u } = useLayout();
  const theme = useTheme();
  const p = clampProgress(frame, durationInFrames, 30);
  const springP = spring({ frame, fps: useVideoConfig().fps, config: { damping: 18, mass: 0.75 } });
  const reveal = Math.min(1, p * 0.72 + springP * 0.28);
  const text = headline(shot) || "值得留下的观点";
  const words = text.split(/[，,。！？!?；;：:、\s]+/).filter(Boolean);
  const first = words.slice(0, Math.max(1, Math.ceil(words.length / 2))).join("，");
  const second = words.slice(Math.max(1, Math.ceil(words.length / 2))).join("，") || first;
  const accent = theme.accent || "#c23a27";
  return <TemplateFrame background="#ede7da" color="#24231f">
    <AbsoluteFill style={{ padding: portrait ? u * 7 : u * 5.5, justifyContent: "space-between" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #24231f55", paddingBottom: u * 2, fontSize: portrait ? u * 3.4 : u * 2, letterSpacing: u * 0.35, opacity: 0.9 }}>
        <span>THOUGHTS WORTH KEEPING</span><span>观点 / {String((shot.seed % 99) + 1).padStart(2, "0")}</span>
      </div>
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: portrait ? u * 2 : u * 5, paddingBottom: height * (shot.safeArea?.bottomRatio ?? (portrait ? 0.24 : 0.075)) }}>
        <div style={{ position: "absolute", left: portrait ? -u * 1 : -u * 2, top: portrait ? "10%" : "16%", fontFamily: "Georgia, serif", fontSize: portrait ? u * 40 : u * 42, lineHeight: 1, color: accent, opacity: reveal * 0.95, transform: `rotate(${-18 + reveal * 18}deg) scale(${0.3 + reveal * 0.7})` }}>“</div>
        <div style={{ position: "relative", fontSize: portrait ? u * 8.2 : u * 7, lineHeight: 1.35, letterSpacing: u * 0.18, opacity: reveal, transform: `translateY(${(1 - reveal) * u * 5}px)` }}>
          <div>{first}</div>
          <div style={{ paddingLeft: portrait ? u * 3 : u * 10, marginTop: u * 1.2 }}>{second || first}</div>
          <div style={{ position: "relative", width: `${Math.max(20, p * 100)}%`, height: u * 0.5, marginTop: u * 1.5, background: accent, transformOrigin: "left center", transform: `scaleX(${p})` }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: u * 1.8, paddingLeft: portrait ? u * 3 : u * 10, marginTop: u * 2.5, fontSize: portrait ? u * 3.3 : u * 2.3, letterSpacing: u * 0.16, opacity: interpolate(frame, frameRange(durationInFrames, 18, 34), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}><span style={{ width: u * 5, height: 2, background: accent }} /><span>{shot.keywords[0] || "留给认真创作的人"}</span></div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: portrait ? u * 2.6 : u * 1.8, letterSpacing: u * 0.12, opacity: 0.75 }}><span>不止记录，也在思考。</span><span style={{ color: accent, fontSize: portrait ? u * 5 : u * 3.6 }}>01</span><span>KEEP YOUR CURIOSITY.</span></div>
    </AbsoluteFill>
  </TemplateFrame>;
}

function SpotlightTemplate({ shot, durationInFrames }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { portrait, u, pad } = useLayout();
  const p = clampProgress(frame, durationInFrames, 28);
  const title = headline(shot) || shot.chapter?.title || "Feature Debut";
  const stageInset = portrait ? u * 3 : u * 18;
  const curtain = interpolate(frame, frameRange(durationInFrames, 10, 42), [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const spotlight = interpolate(frame, frameRange(durationInFrames, 30, 58), [0.15, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <TemplateFrame background="#050505">
    <AbsoluteFill style={{ padding: stageInset }}>
      <div style={{ position: "relative", flex: 1, overflow: "hidden", borderRadius: 8, background: "#111", opacity: p, transform: `scale(${0.96 + p * 0.04})` }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 0%, rgba(255,255,255,.35) 0%, rgba(255,255,255,.08) 32%, transparent 62%)", mixBlendMode: "screen", opacity: spotlight, transform: `translateX(${interpolate(frame, frameRange(durationInFrames, 60, durationInFrames), [0, portrait ? u * 2 : u * 4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)` }} />
        <div style={{ position: "absolute", inset: 0, width: "50%", background: "#7f1d1d", transform: `translateX(-${curtain}%)`, zIndex: 2 }} />
        <div style={{ position: "absolute", inset: 0, left: "50%", width: "50%", background: "#7f1d1d", transform: `translateX(${curtain}%)`, zIndex: 2 }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", padding: pad, textAlign: "center", opacity: interpolate(frame, frameRange(durationInFrames, 38, 60), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), transform: `translateY(${interpolate(frame, frameRange(durationInFrames, 38, 60), [u * 3, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })}px)`, zIndex: 1 }}><div style={{ maxWidth: "90%", fontSize: portrait ? u * 8.2 : u * 9.5, fontFamily: "Georgia, serif", fontWeight: 700, lineHeight: 1.05 }}>{title}</div></div>
      </div>
      <div style={{ position: "absolute", left: stageInset, right: stageInset, bottom: portrait ? pad * 1.5 : pad, textAlign: "center", fontSize: portrait ? u * 3.2 : u * 2.2, letterSpacing: u * 0.28, color: "#fca5a5", opacity: interpolate(frame, frameRange(durationInFrames, 52, 70), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>FEATURE DEBUT</div>
    </AbsoluteFill>
  </TemplateFrame>;
}

function SplitWipeTemplate({ shot, durationInFrames }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { portrait, u, pad } = useLayout();
  const p = clampProgress(frame, durationInFrames, 24);
  const sides = shot.card.sides ?? splitText(headline(shot));
  const panelProgress = interpolate(frame, frameRange(durationInFrames, 14, 42), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const wipeProgress = interpolate(frame, frameRange(durationInFrames, 3, 20), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  const vertical = portrait;
  const panel = (side: string, index: number) => <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: pad, background: index === 0 ? "#101010" : "#f4f0e8", color: index === 0 ? "#f4f0e8" : "#101010", transform: vertical ? `translateY(${(1 - panelProgress) * (index === 0 ? -100 : 100)}%)` : `translateX(${(1 - panelProgress) * (index === 0 ? -100 : 100)}%)` }}><div style={{ fontSize: portrait ? u * 3.2 : u * 2.2, letterSpacing: u * 0.28, color: index === 0 ? "#f4f0e8" : "#be123c", textTransform: "uppercase" }}>EDITORIAL · {index === 0 ? "LEFT" : "RIGHT"}</div><div style={{ marginTop: u * 5, fontFamily: "Georgia, serif", fontSize: portrait ? u * 8 : u * 8.3, fontWeight: 700, lineHeight: 0.95 }}>{side}</div></div>;
  return <TemplateFrame background="#f4f0e8" color="#101010">
    <AbsoluteFill style={{ display: "flex", flexDirection: vertical ? "column" : "row", opacity: p }}>{panel(sides[0], 0)}{panel(sides[1], 1)}<div style={{ position: "absolute", zIndex: 3, background: "#e11d48", ...(vertical ? { left: 0, right: 0, top: "50%", height: u * 1.5, transformOrigin: "50% 0%", transform: `scaleY(${wipeProgress})` } : { top: 0, bottom: 0, left: "50%", width: u * 1.5, transformOrigin: "50% 0%", transform: `scaleY(${wipeProgress})` }) }} /><div style={{ position: "absolute", zIndex: 4, ...(vertical ? { left: 0, right: 0, top: "50%", textAlign: "center", transform: "translateY(-50%)" } : { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }), fontSize: portrait ? u * 3 : u * 2, letterSpacing: u * 0.18, opacity: interpolate(frame, frameRange(durationInFrames, 42, 58), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>UI2V HERO</div></AbsoluteFill>
  </TemplateFrame>;
}

function splitText(text: string): [string, string] {
  const words = text.split(/[，,。！？!?；;：:、\s]+/).filter(Boolean);
  const midpoint = Math.max(1, Math.ceil(words.length / 2));
  return [words.slice(0, midpoint).join(" ") || "一面", words.slice(midpoint).join(" ") || "另一面"];
}

const renderers: Record<Ui2vTemplateId, (props: AnimationRendererProps) => ReactNode> = {
  "creator-cinema-editorial-quote": QuoteTemplate,
  "hero-spotlight-stage": SpotlightTemplate,
  "hero-split-wipe": SplitWipeTemplate,
};

export function renderUi2vTemplate(shot: TimelineShot, durationInFrames: number) {
  const templateId = shot.animation?.templateId;
  if (!templateId) return null;
  const Renderer = renderers[templateId];
  if (!Renderer) return null;
  return <Renderer shot={shot} durationInFrames={durationInFrames} anchors={shot.animation?.anchors ?? []} params={shot.animation?.params ?? {}} />;
}
