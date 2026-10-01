import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TimelineShot } from "@/lib/core/timeline";
import { FONT } from "../fonts";
import { useLayout } from "../layout";
import { easeAt, enterOffset, grainOpacity, staggerDelay, useCorner, useMotion } from "../layers/anim";
import { Motion } from "../layers/motion";
import { pick, useTheme } from "../theme";

/**
 * 占位画面 / 信息卡：内容全部来自 shot.card（大模型抽取或规则兜底）。
 * 字幕已经在念这句话，这里只放关键词、数据、要点，不复述整句。
 */
export function PlaceholderShot({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  const theme = useTheme();
  const profile = useMotion();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { u, portrait, pad, height } = useLayout();
  const [dark, mid, light] = pick(theme.palettes, shot.seed);
  const enter = spring({ frame, fps, config: { damping: 19, mass: 0.8 } });
  const ease = easeAt(profile);
  const fade = ease(frame, [0, 18]);
  const rule = ease(frame, [4, 22]);
  const corner = useCorner(u);
  const offset = enterOffset(profile, enter);
  const card = shot.card;
  const headline = (shot.onScreenText || card.headline || shot.keywords[0] || "").replace(/[。！？!?]+$/, "");
  const common = { fontFamily: FONT, color: theme.text, overflowWrap: "anywhere" as const, lineHeight: 1.2 };
  const motion = { opacity: fade, transform: `translate(${offset.x * u}px, ${offset.y * u}px) scale(${offset.scale})` };
  const big = (s: string) => Math.min(portrait ? u * 9 : u * 8, (portrait ? 800 : 1000) / Math.max(8, s.length));
  const sides = card.sides;
  return <AbsoluteFill style={{ background: dark, overflow: "hidden" }}>
    {/* 背景层运镜，内容层保持不动：卡片文字与字幕争抢注意力会让人读不下去 */}
    <Motion kind={shot.motion} durationInFrames={durationInFrames}>
      <AbsoluteFill style={{ background: `linear-gradient(130deg, ${dark}, ${mid} 65%, ${light})` }} />
      <AbsoluteFill style={{ opacity: 0.16, backgroundImage: "linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: `${u * 15}px 100%` }} />
    </Motion>
    {theme.motion.texture !== "none" && <Texture kind={theme.motion.texture} u={u} frame={frame} seed={shot.seed} corner={corner} />}
    {card.variant === "split" && sides && <AbsoluteFill style={{ flexDirection: portrait ? "column" : "row", paddingBottom: portrait ? u * 36 : 0, background: portrait ? light : undefined }}>
      {/* 两边各自一半：文字放在自己那一半的中间，竖屏为上下分屏（避开底部字幕区） */}
      {sides.map((side, i) => <div key={i} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: pad * 0.6, background: i === 0 ? dark : light, transform: portrait ? `translateY(${(1 - enter) * (i === 0 ? -30 : 30)}%)` : `translateX(${(1 - enter) * (i === 0 ? -30 : 30)}%)` }}>
        <span style={{ ...common, fontWeight: 900, fontSize: big(side), textAlign: "center", color: i === 0 ? theme.text : theme.ink, opacity: fade }}>{side}</span>
      </div>)}
      <div style={{ position: "absolute", left: "50%", top: portrait ? `calc(50% - ${u * 18}px)` : "50%", transform: `translate(-50%, -50%) scale(${enter})`, ...common, fontWeight: 900, fontSize: u * 4.5, color: theme.ink, background: theme.accent, borderRadius: corner === 0 ? 0 : 999, padding: `${u * 1.2}px ${u * 2.4}px` }}>VS</div>
    </AbsoluteFill>}
    <AbsoluteFill style={{ justifyContent: "center", padding: pad * 1.3, paddingBottom: Math.max(pad * 1.3, height * (shot.safeArea?.bottomRatio ?? (portrait ? 0.24 : 0.075))) }}>
      {card.variant === "stat" && card.stat ? <div style={motion}>
        {card.headline && <div style={{ ...common, fontSize: u * 4, opacity: 0.8, marginBottom: u * 2 }}>{card.headline}</div>}
        <div style={{ ...common, fontWeight: 900, color: light, maxWidth: "100%" }}>
          <span style={{ fontSize: portrait ? u * 19 : u * 18 }}>{card.stat.value}</span>
          {card.stat.unit && <span style={{ fontSize: portrait ? u * 8 : u * 7, marginLeft: u, opacity: ease(frame, [staggerDelay(profile, 3), staggerDelay(profile, 3) + 14]) }}>{card.stat.unit}</span>}
        </div>
        {card.stat.label && <div style={{ ...common, fontSize: u * 4.3, marginTop: u * 3, maxWidth: "85%", opacity: ease(frame, [staggerDelay(profile, 5), staggerDelay(profile, 5) + 16]) }}>{card.stat.label}</div>}
      </div> : card.variant === "list" && card.items?.length ? <div style={{ ...motion, maxWidth: "90%" }}>
        {card.headline && <div style={{ ...common, fontSize: u * 4, opacity: 0.8, marginBottom: u * 5 }}>{card.headline}</div>}
        {card.items.map((item, i) => {
          // 逐项入场：延迟由风格节奏决定，弹跳风格错峰更明显
          const at = staggerDelay(profile, i);
          const p = ease(frame, [at, at + 16]);
          return <div key={i} style={{ ...common, fontSize: portrait ? u * 6.5 : u * 6, fontWeight: 700, padding: `${u * 2}px 0`, borderTop: `2px solid ${light}`, opacity: p, transform: `translateX(${(1 - p) * offset.x * u * 1.5}px)` }}>{item}</div>;
        })}
      </div> : card.variant === "split" && sides ? null : card.variant === "quote" && headline ? <div style={{ ...motion, ...common, fontSize: portrait ? u * 8 : u * 7.5, fontWeight: 800, textAlign: "center", maxWidth: "90%", margin: "auto" }}><span style={{ color: light }}>“</span>{headline}<span style={{ color: light }}>”</span></div> : headline ? <div style={motion}>
        <div style={{ ...common, fontSize: big(headline), fontWeight: 900, maxWidth: portrait ? "100%" : "80%" }}>{headline}</div>
        <div style={{ width: `${rule * 36}%`, height: u * 0.7, background: light, marginTop: u * 3, borderRadius: corner }} />
      </div> : null}
    </AbsoluteFill>
  </AbsoluteFill>;
}

/** 纹理叠层：颗粒 / 纸纹 / 扫描线。确定性噪点，预览和渲染逐帧一致 */
function Texture({ kind, u, frame, seed, corner }: { kind: "grain" | "paper" | "scanline"; u: number; frame: number; seed: number; corner: number }) {
  if (kind === "scanline") {
    return <AbsoluteFill style={{ opacity: 0.1, backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 4px)", backgroundSize: `100% ${u * 1.2}px`, pointerEvents: "none" }} />;
  }
  const amount = kind === "paper" ? 0.09 : 0.06;
  const radius = Math.round((seed % 97) * 7 + frame * 13);
  // 用一张随机的 SVG 噪点图铺满：比逐像素绘制便宜，且完全确定性
  const noise = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${kind === "paper" ? "0.9" : "0.65"}' numOctaves='3' seed='${radius % 100}'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='${amount}'/></svg>`;
  return <AbsoluteFill style={{ backgroundImage: `url("data:image/svg+xml;utf8,${noise.replace(/#/g, "%23")}")`, backgroundRepeat: "repeat", mixBlendMode: "overlay", opacity: grainOpacity(frame, seed, 0.9) + 0.25, borderRadius: corner, pointerEvents: "none" }} />;
}
