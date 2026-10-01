import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import type { TimelineShot } from "@/lib/core/timeline";
import { FONT } from "../fonts";
import { useLayout } from "../layout";
import { useTheme } from "../theme";

export function StockShot({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames)], [1, 1.06], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: theme.ink }}>
    {shot.imageSrc ? <Img src={shot.imageSrc} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${progress})` }} /> : <Unavailable label="素材库镜头" />}
    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 55%, rgba(0,0,0,.7))" }} />
    <div style={{ position: "absolute", left: "6%", right: "6%", bottom: "10%", color: "white", fontFamily: FONT, fontSize: "4.5vw", fontWeight: 700 }}>{shot.onScreenText || shot.description || "素材库镜头"}</div>
  </AbsoluteFill>;
}

export function ChartShot({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { u, portrait } = useLayout();
  const values = shot.card.variant === "list" ? (shot.card.items ?? []).map((_, i) => 0.35 + i * 0.16) : [0.42, 0.68, 0.55, 0.88];
  const reveal = interpolate(frame, [0, Math.min(24, durationInFrames)], [0, 1], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: theme.ink, padding: u * 8, justifyContent: "center" }}>
    <div style={{ color: theme.text, fontFamily: FONT, fontWeight: 700, fontSize: u * (portrait ? 6 : 5), marginBottom: u * 5 }}>{shot.onScreenText || shot.card.headline || "数据趋势"}</div>
    <div style={{ display: "flex", alignItems: "flex-end", gap: u * 2, height: portrait ? "36%" : "42%", borderBottom: `2px solid ${theme.sub}`, borderLeft: `2px solid ${theme.sub}`, padding: `0 ${u * 3}px` }}>
      {values.map((value, i) => <div key={i} style={{ flex: 1, height: `${value * reveal * 100}%`, background: theme.accent, borderRadius: u * 0.6 }} />)}
    </div>
  </AbsoluteFill>;
}

export function UnsupportedModeShot({ shot }: { shot: TimelineShot; durationInFrames: number }) {
  return <Unavailable label={`未支持的镜头类型：${shot.kind}`} />;
}

function Unavailable({ label }: { label: string }) {
  const theme = useTheme();
  return <AbsoluteFill style={{ background: theme.ink, color: theme.text, fontFamily: FONT, alignItems: "center", justifyContent: "center", fontSize: "4vw" }}>{label}</AbsoluteFill>;
}
