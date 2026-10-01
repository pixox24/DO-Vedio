import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import type { TimelineShot } from "@/lib/core/timeline";
import { FONT } from "../fonts";
import { easeAt, useMotion } from "../layers/anim";
import { useLayout } from "../layout";
import { Motion } from "../layers/motion";
import { useTheme } from "../theme";
import { PlaceholderShot } from "./placeholder";

/** 图片镜头（上传图 / P2 的 AI 生图）：按焦点裁剪填满画面 + 运镜；底图模糊铺满防止黑边 */
export function ImageShot({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  if (!shot.imageSrc) return <PlaceholderShot shot={shot} durationInFrames={durationInFrames} />;
  if (shot.mode === "composite") return <ParallaxImageShot shot={shot} durationInFrames={durationInFrames} />;
  const pos = `${Math.round((shot.focus?.x ?? 0.5) * 100)}% ${Math.round((shot.focus?.y ?? 0.5) * 100)}%`;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Motion kind={shot.motion} durationInFrames={durationInFrames} origin={pos}>
        <Img src={shot.imageSrc} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: pos }} />
      </Motion>
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.18), transparent 30%, transparent 62%, rgba(0,0,0,0.5))" }} />
    </AbsoluteFill>
  );
}

/** composite 的最小两层实现：底图缓慢位移，信息层按较浅深度跟随，字幕安全区来自时间轴。 */
function ParallaxImageShot({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { height, portrait, u, pad } = useLayout();
  const progress = easeAt(profile)(frame, [0, Math.max(1, durationInFrames)]);
  const pan = interpolate(progress, [0, 1], [-1, 1]) * profile.energy;
  const focus = shot.focus ?? { x: 0.5, y: 0.5 };
  const src = shot.imageSrc;
  if (!src) return <PlaceholderShot shot={shot} durationInFrames={durationInFrames} />;
  const pos = `${Math.round(focus.x * 100)}% ${Math.round(focus.y * 100)}%`;
  const headline = shot.onScreenText || shot.card.headline || shot.keywords[0];
  const bottom = Math.max(pad * 1.3, height * (shot.safeArea?.bottomRatio ?? (portrait ? 0.24 : 0.075)));
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translateX(${pan * 1.8}%) scale(1.08)` }}>
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: pos }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.12), transparent 35%, rgba(0,0,0,0.58))" }} />
      {headline && <div style={{ position: "absolute", left: pad, right: pad, bottom, color: theme.text, fontFamily: FONT, fontSize: portrait ? u * 7 : u * 5, fontWeight: 900, lineHeight: 1.16, transform: `translateX(${pan * 0.55 * u}px)`, textShadow: "0 2px 14px rgba(0,0,0,.45)" }}>{headline}</div>}
    </AbsoluteFill>
  );
}
