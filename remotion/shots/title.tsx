import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TimelineShot } from "@/lib/core/timeline";
import { FONT } from "../fonts";
import { useLayout } from "../layout";
import { enterOffset, easingFn, useCorner, useMotion } from "../layers/anim";
import { Motion } from "../layers/motion";
import { pick, useTheme } from "../theme";

/** 章节标题卡 */
export function TitleShot({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, pad } = useLayout();
  const [a, b] = pick(theme.palettes, shot.seed);
  const enter = spring({ frame, fps, config: { damping: 18, mass: 0.8 } });
  const bar = interpolate(frame, [4, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easingFn(profile.easing) });
  const title = shot.chapter?.title || shot.onScreenText || "";
  const offset = enterOffset(profile, enter);
  const corner = useCorner(u);
  return (
    <AbsoluteFill style={{ background: a }}>
      <Motion kind={shot.motion === "none" ? "zoom-in" : shot.motion} durationInFrames={durationInFrames}>
        <AbsoluteFill style={{ background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)` }} />
      </Motion>
      <AbsoluteFill style={{ justifyContent: "center", padding: pad, alignItems: portrait ? "center" : "flex-start", textAlign: portrait ? "center" : "left" }}>
        <div style={{ width: "100%", opacity: enter, transform: `translate(${offset.x * u}px, ${offset.y * u}px) scale(${offset.scale})` }}>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: u * 3.2, color: theme.accent, letterSpacing: "0.3em" }}>
            {shot.chapter ? `CHAPTER ${String(shot.chapter.index).padStart(2, "0")}` : ""}
          </div>
          <div style={{ height: u * 0.6, width: u * 14 * bar, background: theme.accent, margin: portrait ? `${u * 2.4}px auto` : `${u * 2.4}px 0`, borderRadius: corner }} />
          <div style={{ fontFamily: FONT, fontWeight: 900, fontSize: portrait ? u * 10 : u * 9, color: theme.text, lineHeight: 1.15, maxWidth: portrait ? "100%" : "80%", margin: portrait ? "0 auto" : undefined, wordBreak: "keep-all", textWrap: "balance" }}>{title}</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
