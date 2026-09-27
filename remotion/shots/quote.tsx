import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TimelineShot } from "@/lib/core/timeline";
import { FONT } from "../fonts";
import { useLayout } from "../layout";
import { Motion } from "../layers/motion";
import { pick, useTheme } from "../theme";

/** 金句卡：大字排版，关键词高亮 */
export function QuoteShot({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, pad } = useLayout();
  const [a, b] = pick(theme.palettes, shot.seed + 3);
  const text = (shot.onScreenText || shot.caption).replace(/[。！？!?]+$/, "");
  const len = text.length;
  const size = (portrait ? u * 9.5 : u * 7.6) * (len > 28 ? 0.7 : len > 18 ? 0.85 : 1);
  const enter = spring({ frame, fps, config: { damping: 20 } });
  const marks = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: "clamp" });
  // 高亮关键词
  const parts: { t: string; hi: boolean }[] = [];
  let rest = text;
  const kws = shot.keywords.filter((k) => text.includes(k));
  while (rest) {
    const hits = kws.map((k) => ({ k, i: rest.indexOf(k) })).filter((x) => x.i >= 0).sort((x, y) => x.i - y.i);
    if (!hits.length) {
      parts.push({ t: rest, hi: false });
      break;
    }
    if (hits[0].i > 0) parts.push({ t: rest.slice(0, hits[0].i), hi: false });
    parts.push({ t: hits[0].k, hi: true });
    rest = rest.slice(hits[0].i + hits[0].k.length);
  }
  return (
    <AbsoluteFill style={{ background: a }}>
      <Motion kind={shot.motion} durationInFrames={durationInFrames}>
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, ${b} 0%, ${a} 70%)` }} />
      </Motion>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: pad * 1.4, paddingBottom: portrait ? u * 50 : pad * 1.4 }}>
        <div style={{ fontFamily: FONT, fontWeight: 900, fontSize: u * 18, color: theme.accent, opacity: 0.5 * marks, lineHeight: 0.6, alignSelf: portrait ? "center" : "flex-start" }}>“</div>
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 900,
            fontSize: size,
            lineHeight: 1.35,
            color: theme.text,
            textAlign: "center",
            opacity: enter,
            transform: `scale(${0.96 + 0.04 * enter})`,
            textWrap: "balance",
          }}
        >
          {parts.map((p, k) => (
            <span key={k} style={p.hi ? { color: theme.accent } : undefined}>
              {p.t}
            </span>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
