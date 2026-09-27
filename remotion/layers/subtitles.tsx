import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Cue } from "@/lib/core/subtitles";
import { FONT } from "../fonts";
import { useLayout } from "../layout";
import { useTheme } from "../theme";

/** 烧录字幕：描边白字，关键词强调色 */
export function Subtitles({ cues, highlight }: { cues: Cue[]; highlight: boolean }) {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { subtitleBottom, subtitleSize, u, pad } = useLayout();
  const ms = (frame / fps) * 1000;
  const cue = cues.find((c) => ms >= c.startMs && ms < c.endMs);
  if (!cue) return null;
  const parts: { t: string; hi: boolean }[] = [];
  let pos = 0;
  for (const [a, b] of highlight ? cue.highlights : []) {
    if (a > pos) parts.push({ t: cue.text.slice(pos, a), hi: false });
    parts.push({ t: cue.text.slice(a, b), hi: true });
    pos = b;
  }
  if (pos < cue.text.length) parts.push({ t: cue.text.slice(pos), hi: false });
  const stroke = Math.max(2, u * 0.32);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: subtitleBottom, paddingLeft: pad, paddingRight: pad }}>
      <div
        style={{
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: subtitleSize,
          lineHeight: 1.25,
          color: "#fff",
          textAlign: "center",
          letterSpacing: "0.02em",
          WebkitTextStroke: `${stroke}px rgba(0,0,0,0.85)`,
          paintOrder: "stroke fill",
          textShadow: `0 ${u * 0.3}px ${u * 1.2}px rgba(0,0,0,0.55)`,
        }}
      >
        {parts.map((p, k) => (
          <span key={k} style={p.hi ? { color: theme.accent } : undefined}>
            {p.t}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
}
