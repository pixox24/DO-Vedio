import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TimelineShot } from "@/lib/core/timeline";
import { FONT } from "../fonts";
import { useLayout } from "../layout";
import { pick, useTheme } from "../theme";

/**
 * 占位画面 / 信息卡：内容全部来自 shot.card（大模型抽取或规则兜底）。
 * 字幕已经在念这句话，这里只放关键词、数据、要点，不复述整句。
 */
export function PlaceholderShot({ shot }: { shot: TimelineShot; durationInFrames: number }) {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, pad } = useLayout();
  const [dark, mid, light] = pick(theme.palettes, shot.seed);
  const enter = spring({ frame, fps, config: { damping: 19, mass: 0.8 } });
  const fade = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
  const rule = interpolate(frame, [4, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const card = shot.card;
  const headline = (shot.onScreenText || card.headline || shot.keywords[0] || "").replace(/[。！？!?]+$/, "");
  const common = { fontFamily: FONT, color: "#fff", overflowWrap: "anywhere" as const, lineHeight: 1.2 };
  const motion = { opacity: fade, transform: `translateY(${(1 - enter) * u * 5}px)` };
  const big = (s: string) => Math.min(portrait ? u * 9 : u * 8, (portrait ? 800 : 1000) / Math.max(8, s.length));
  const sides = card.sides;
  return <AbsoluteFill style={{ background: `linear-gradient(130deg, ${dark}, ${mid} 65%, ${light})`, overflow: "hidden" }}>
    <AbsoluteFill style={{ opacity: 0.16, backgroundImage: "linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: `${u * 15}px 100%` }} />
    {card.variant === "split" && sides && <AbsoluteFill style={{ flexDirection: portrait ? "column" : "row", paddingBottom: portrait ? u * 36 : 0, background: portrait ? light : undefined }}>
      {/* 两边各自一半：文字放在自己那一半的中间，竖屏为上下分屏（避开底部字幕区） */}
      {sides.map((side, i) => <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: pad * 0.6, background: i === 0 ? dark : light, transform: portrait ? `translateY(${(1 - enter) * (i === 0 ? -30 : 30)}%)` : `translateX(${(1 - enter) * (i === 0 ? -30 : 30)}%)` }}>
        <span style={{ ...common, fontWeight: 900, fontSize: big(side), textAlign: "center", color: i === 0 ? "#fff" : dark, opacity: fade }}>{side}</span>
      </div>)}
      <div style={{ position: "absolute", left: "50%", top: portrait ? `calc(50% - ${u * 18}px)` : "50%", transform: `translate(-50%, -50%) scale(${enter})`, ...common, fontWeight: 900, fontSize: u * 4.5, color: theme.ink, background: theme.accent, borderRadius: 999, padding: `${u * 1.2}px ${u * 2.4}px` }}>VS</div>
    </AbsoluteFill>}
    <AbsoluteFill style={{ justifyContent: "center", padding: pad * 1.3, paddingBottom: portrait ? u * 36 : pad * 1.3 }}>
      {card.variant === "stat" && card.stat ? <div style={motion}>
        {card.headline && <div style={{ ...common, fontSize: u * 4, opacity: 0.8, marginBottom: u * 2 }}>{card.headline}</div>}
        <div style={{ ...common, fontWeight: 900, color: light, maxWidth: "100%" }}>
          <span style={{ fontSize: portrait ? u * 19 : u * 18 }}>{card.stat.value}</span>
          {card.stat.unit && <span style={{ fontSize: portrait ? u * 8 : u * 7, marginLeft: u }}>{card.stat.unit}</span>}
        </div>
        {card.stat.label && <div style={{ ...common, fontSize: u * 4.3, marginTop: u * 3, maxWidth: "85%" }}>{card.stat.label}</div>}
      </div> : card.variant === "list" && card.items?.length ? <div style={{ ...motion, maxWidth: "90%" }}>
        {card.headline && <div style={{ ...common, fontSize: u * 4, opacity: 0.8, marginBottom: u * 5 }}>{card.headline}</div>}
        {card.items.map((item, i) => <div key={i} style={{ ...common, fontSize: portrait ? u * 6.5 : u * 6, fontWeight: 700, padding: `${u * 2}px 0`, borderTop: `2px solid ${light}`, opacity: interpolate(frame, [i * 6, i * 6 + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>{item}</div>)}
      </div> : card.variant === "split" && sides ? null : card.variant === "quote" && headline ? <div style={{ ...motion, ...common, fontSize: portrait ? u * 8 : u * 7.5, fontWeight: 800, textAlign: "center", maxWidth: "90%", margin: "auto" }}><span style={{ color: light }}>“</span>{headline}<span style={{ color: light }}>”</span></div> : headline ? <div style={motion}>
        <div style={{ ...common, fontSize: big(headline), fontWeight: 900, maxWidth: portrait ? "100%" : "80%" }}>{headline}</div>
        <div style={{ width: `${rule * 36}%`, height: u * 0.7, background: light, marginTop: u * 3 }} />
      </div> : null}
    </AbsoluteFill>
  </AbsoluteFill>;
}
