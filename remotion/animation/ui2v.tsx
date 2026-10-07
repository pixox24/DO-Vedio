import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { ReactNode } from "react";
import type { TimelineShot } from "@/lib/core/timeline";
import type { Ui2vTemplateId } from "@/lib/core/types";
import { FONT } from "../fonts";
import { useLayout } from "../layout";
import { useTheme } from "../theme";

export type AnimationRendererProps = {
  shot: TimelineShot;
  durationInFrames: number;
  anchors: NonNullable<TimelineShot["animation"]>["anchors"];
  params: NonNullable<TimelineShot["animation"]>["params"];
};

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

/**
 * 粒子淡入、保持、淡出的四段区间。
 * Remotion 的 interpolate 要求区间严格递增。短镜头里 delay+8 会和 duration-10 重合，
 * 更晚的粒子还会倒序（例如 51 帧、delay 33 得到 [33, 41, 41, 51]）。
 */
export function particleOpacityRange(durationInFrames: number, delay: number): [number, number, number, number] {
  const end = Math.max(1, durationInFrames);
  const fadeIn = Math.min(8, end / 4);
  const fadeOut = Math.min(10, end / 4);
  const outStart = Math.max(fadeIn, end - fadeOut);
  const inStart = Math.min(Math.max(0, delay), Math.max(0, outStart - fadeIn));
  const inEnd = Math.min(outStart, inStart + fadeIn);
  return strictlyIncreasing([inStart, inEnd, outStart, end], end);
}

function strictlyIncreasing(points: [number, number, number, number], end: number): [number, number, number, number] {
  const gap = 1e-4;
  const out: [number, number, number, number] = [
    Math.min(end, Math.max(0, points[0])),
    Math.min(end, Math.max(0, points[1])),
    Math.min(end, Math.max(0, points[2])),
    Math.min(end, Math.max(0, points[3])),
  ];
  for (let i = 1; i < out.length; i++) {
    if (out[i] <= out[i - 1]) out[i] = out[i - 1] + gap;
  }
  if (out[3] > end || out[0] < 0) return [0, end / 3, (end * 2) / 3, end];
  return out;
}
const headline = (shot: TimelineShot) => (shot.onScreenText || shot.card.headline || shot.keywords[0] || shot.caption.split(/[，,。！？!?；;：:、]/)[0] || "").replace(/[。！？!?]+$/, "");

// 辅助函数：将hex转为rgba
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function TemplateFrame({ children, background, color = "#f4f0e8" }: { children: ReactNode; background: string; color?: string }) {
  return <AbsoluteFill style={{ background, color, overflow: "hidden", fontFamily: FONT }}>{children}</AbsoluteFill>;
}

function CardFallback({ shot }: { shot: TimelineShot }) {
  const { portrait, u, pad } = useLayout();
  const text = headline(shot) || "信息卡";
  return <TemplateFrame background="#0f0f1e">
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: pad }}>
      <div style={{ fontSize: portrait ? u * 8 : u * 6, fontWeight: 800, textAlign: "center", maxWidth: "80%" }}>{text}</div>
    </AbsoluteFill>
  </TemplateFrame>;
}

export function QuoteTemplate({ shot, durationInFrames }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { width, portrait, u } = useLayout();
  const theme = useTheme();
  const fps = useVideoConfig().fps;

  // 多阶段流畅缓动
  const reveal = spring({ frame, fps, config: { damping: 20, mass: 0.5, stiffness: 80 } });
  const glassReveal = spring({ frame: Math.max(0, frame - 8), fps, config: { damping: 25, mass: 0.8, stiffness: 60 } });
  const textReveal = spring({ frame: Math.max(0, frame - 15), fps, config: { damping: 18, mass: 0.6, stiffness: 100 } });

  const text = headline(shot) || "值得铭记的观点";
  const accent = theme.accent || "#6366f1";

  // 玻璃态背景流动效果
  const flowOffset = interpolate(frame, [0, durationInFrames], [0, 120], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) });
  const glassOpacity = glassReveal * 0.12;

  return <TemplateFrame background="linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%)">
    <AbsoluteFill>
      {/* 流动玻璃态背景层 */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(ellipse at ${50 + flowOffset * 0.3}% ${40 + Math.sin(frame * 0.05) * 20}%, ${hexToRgba(accent, 0.25)} 0%, transparent 70%)`,
        opacity: glassOpacity,
        filter: "blur(80px)",
        transform: `scale(${1 + glassReveal * 0.1})`,
      }} />
      <div style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(circle at ${30 - flowOffset * 0.2}% ${60 - Math.cos(frame * 0.04) * 25}%, ${hexToRgba(accent, 0.2)} 0%, transparent 65%)`,
        opacity: glassOpacity,
        filter: "blur(100px)",
        transform: `scale(${1 + glassReveal * 0.15})`,
      }} />

      {/* 玻璃态卡片容器 */}
      <AbsoluteFill style={{
        padding: portrait ? u * 6 : u * 8,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}>
        <div style={{
          position: "relative",
          maxWidth: portrait ? width * 0.88 : width * 0.75,
          padding: portrait ? u * 5 : u * 7,
          background: `linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))`,
          backdropFilter: `blur(${reveal * 24}px) saturate(180%)`,
          borderRadius: portrait ? u * 3 : u * 4,
          border: "1px solid rgba(255, 255, 255, 0.12)",
          boxShadow: `0 ${u * 4}px ${u * 8}px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
          opacity: reveal,
          transform: `translateY(${(1 - reveal) * u * 8}px) scale(${0.94 + reveal * 0.06})`,
        }}>
          {/* 顶部装饰光线 */}
          <div style={{
            position: "absolute",
            top: 0,
            left: "20%",
            right: "20%",
            height: 2,
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            opacity: textReveal * 0.6,
            filter: "blur(1px)",
          }} />

          {/* 引号装饰 - 渐变光效 */}
          <div style={{
            position: "absolute",
            top: portrait ? u * 2 : u * 3,
            left: portrait ? u * 2 : u * 3,
            fontSize: portrait ? u * 16 : u * 20,
            fontFamily: "Georgia, serif",
            fontWeight: 700,
            background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            opacity: textReveal * 0.85,
            transform: `scale(${0.8 + textReveal * 0.2}) rotate(${-8 + textReveal * 8}deg)`,
            lineHeight: 1,
          }}>&ldquo;</div>

          {/* 核心文本 - 字符逐个浮现 */}
          <div style={{
            position: "relative",
            fontSize: portrait ? u * 7 : u * 8.5,
            fontWeight: 600,
            lineHeight: 1.4,
            letterSpacing: portrait ? u * 0.15 : u * 0.2,
            color: "rgba(255, 255, 255, 0.95)",
            textAlign: "center",
            textShadow: `0 2px ${u}px rgba(0, 0, 0, 0.3)`,
          }}>
            {text.split("").map((char, i) => {
              const charReveal = interpolate(
                frame,
                [12 + i * 0.8, 18 + i * 0.8],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }
              );
              return <span key={i} style={{
                display: "inline-block",
                opacity: charReveal,
                transform: `translateY(${(1 - charReveal) * u * 2}px)`,
              }}>{char}</span>;
            })}
          </div>

          {/* 底部关键词标签 */}
          {shot.keywords[0] && <div style={{
            marginTop: portrait ? u * 4 : u * 5,
            display: "flex",
            justifyContent: "center",
            gap: u * 2,
            opacity: interpolate(frame, frameRange(durationInFrames, 30, 45), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}>
            <div style={{
              padding: `${u * 1.2}px ${u * 3}px`,
              background: `linear-gradient(135deg, ${hexToRgba(accent, 0.15)}, ${hexToRgba(accent, 0.06)})`,
              border: `1px solid ${hexToRgba(accent, 0.25)}`,
              borderRadius: u * 2,
              fontSize: portrait ? u * 2.8 : u * 2.5,
              color: "rgba(255, 255, 255, 0.9)",
              letterSpacing: u * 0.1,
              fontWeight: 500,
            }}>{shot.keywords[0]}</div>
          </div>}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  </TemplateFrame>;
}

export function SpotlightTemplate({ shot, durationInFrames }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { width, height, portrait, u } = useLayout();
  const theme = useTheme();
  const fps = useVideoConfig().fps;

  const title = headline(shot) || shot.chapter?.title || "新篇章开启";
  const accent = theme.accent || "#8b5cf6";

  // 粒子聚合动画
  const particleReveal = spring({ frame, fps, config: { damping: 22, mass: 1, stiffness: 70 } });
  const titleReveal = spring({ frame: Math.max(0, frame - 18), fps, config: { damping: 16, mass: 0.7, stiffness: 90 } });
  const glowIntensity = spring({ frame: Math.max(0, frame - 12), fps, config: { damping: 30, mass: 1.2, stiffness: 50 } });

  // 粒子数量和分布
  const particleCount = portrait ? 80 : 120;
  const particles = Array.from({ length: particleCount }, (_, i) => {
    const angle = (i / particleCount) * Math.PI * 2;
    const distance = portrait ? width * 0.5 : width * 0.42;
    const startX = width / 2 + Math.cos(angle) * distance * (1 - particleReveal);
    const startY = height / 2 + Math.sin(angle) * distance * (1 - particleReveal);
    const targetX = width / 2 + Math.cos(angle) * (portrait ? u * 25 : u * 35) * particleReveal;
    const targetY = height / 2 + Math.sin(angle) * (portrait ? u * 15 : u * 20) * particleReveal;
    const size = u * (0.8 + Math.sin(i * 0.5) * 0.4);
    const delay = i * 0.3;
    const opacity = interpolate(
      frame,
      particleOpacityRange(durationInFrames, delay),
      [0, 1, 1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    return { x: startX + (targetX - startX) * particleReveal, y: startY + (targetY - startY) * particleReveal, size, opacity };
  });

  return <TemplateFrame background="radial-gradient(circle at center, #0f0f23 0%, #050510 100%)">
    <AbsoluteFill>
      {/* 光效背景层 - 脉动 */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(ellipse at 50% 50%, ${hexToRgba(accent, 0.16)} 0%, transparent 60%)`,
        opacity: glowIntensity * 0.6,
        filter: "blur(120px)",
        transform: `scale(${0.8 + glowIntensity * 0.4})`,
      }} />

      {/* 粒子层 */}
      {particles.map((p, i) => (
        <div key={i} style={{
          position: "absolute",
          left: p.x - p.size / 2,
          top: p.y - p.size / 2,
          width: p.size,
          height: p.size,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accent}, ${accent}cc)`,
          opacity: p.opacity * (0.7 + Math.sin(frame * 0.1 + i * 0.5) * 0.3),
          boxShadow: `0 0 ${u * 2}px ${hexToRgba(accent, 0.5)}`,
          filter: "blur(0.5px)",
        }} />
      ))}

      {/* 中央发光核心 */}
      <div style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: portrait ? u * 60 : u * 80,
        height: portrait ? u * 35 : u * 45,
        background: `radial-gradient(ellipse, ${hexToRgba(accent, 0.12)} 0%, transparent 70%)`,
        opacity: particleReveal,
        filter: "blur(40px)",
      }} />

      {/* 标题文本 */}
      <AbsoluteFill style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: portrait ? u * 8 : u * 10,
      }}>
        <div style={{
          position: "relative",
          textAlign: "center",
          maxWidth: portrait ? width * 0.85 : width * 0.7,
        }}>
          {/* 主标题 */}
          <h1 style={{
            margin: 0,
            fontSize: portrait ? u * 9 : u * 11,
            fontWeight: 700,
            lineHeight: 1.1,
            color: "rgba(255, 255, 255, 0.98)",
            letterSpacing: portrait ? u * 0.2 : u * 0.3,
            textShadow: `0 0 ${u * 3}px ${hexToRgba(accent, 0.4)}, 0 ${u}px ${u * 2}px rgba(0, 0, 0, 0.5)`,
            opacity: titleReveal,
            transform: `translateY(${(1 - titleReveal) * u * 5}px) scale(${0.92 + titleReveal * 0.08})`,
          }}>
            {title}
          </h1>

          {/* 装饰线条 - 左右延伸 */}
          <div style={{
            position: "relative",
            marginTop: portrait ? u * 4 : u * 5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: u * 3,
            opacity: interpolate(frame, frameRange(durationInFrames, 25, 40), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}>
            <div style={{
              width: portrait ? u * 15 : u * 25,
              height: 2,
              background: `linear-gradient(90deg, transparent, ${accent})`,
              boxShadow: `0 0 ${u}px ${accent}`,
            }} />
            <div style={{
              width: u * 1.5,
              height: u * 1.5,
              borderRadius: "50%",
              background: accent,
              boxShadow: `0 0 ${u * 2}px ${accent}`,
            }} />
            <div style={{
              width: portrait ? u * 15 : u * 25,
              height: 2,
              background: `linear-gradient(90deg, ${accent}, transparent)`,
              boxShadow: `0 0 ${u}px ${accent}`,
            }} />
          </div>

          {/* 副标题 */}
          {shot.keywords[0] && <div style={{
            marginTop: portrait ? u * 3 : u * 4,
            fontSize: portrait ? u * 3.5 : u * 3,
            fontWeight: 500,
            letterSpacing: u * 0.3,
            color: "rgba(255, 255, 255, 0.7)",
            textTransform: "uppercase",
            opacity: interpolate(frame, frameRange(durationInFrames, 35, 50), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}>
            {shot.keywords[0]}
          </div>}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  </TemplateFrame>;
}

export function SplitWipeTemplate({ shot, durationInFrames }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { portrait, u } = useLayout();
  const theme = useTheme();
  const fps = useVideoConfig().fps;

  const sides = shot.card.sides ?? splitText(headline(shot));
  const accent = theme.accent || "#ec4899";

  // 3D翻转动画
  const flipProgress = spring({ frame, fps, config: { damping: 20, mass: 1.2, stiffness: 60 } });
  const contentReveal = spring({ frame: Math.max(0, frame - 10), fps, config: { damping: 18, mass: 0.8, stiffness: 80 } });

  // 左右面板的翻转时序
  const leftFlip = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const rightFlip = interpolate(frame, [8, 28], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

  const renderPanel = (content: string, index: number, flipValue: number) => {
    const isDark = index === 0;
    const rotateAngle = interpolate(flipValue, [0, 1], [portrait ? -90 : 90, 0]);
    const panelScale = interpolate(flipValue, [0, 0.6, 1], [0.8, 0.95, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

    return (
      <div style={{
        position: "relative",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: portrait ? u * 6 : u * 8,
        background: isDark
          ? `linear-gradient(135deg, #1a1a2e 0%, #0f0f1e 100%)`
          : `linear-gradient(135deg, #fafafa 0%, #f0f0f5 100%)`,
        overflow: "hidden",
        transform: portrait
          ? `perspective(${portrait ? 1200 : 1600}px) rotateX(${rotateAngle}deg) scale(${panelScale})`
          : `perspective(${portrait ? 1200 : 1600}px) rotateY(${rotateAngle}deg) scale(${panelScale})`,
        transformOrigin: "center center",
        opacity: interpolate(flipValue, [0, 0.3, 1], [0, 0.8, 1]),
      }}>
        {/* 背景装饰网格 */}
        <div style={{
          position: "absolute",
          inset: 0,
          background: isDark
            ? `repeating-linear-gradient(90deg, ${hexToRgba(accent, 0.05)} 0px, transparent 1px, transparent ${u * 8}px), repeating-linear-gradient(0deg, ${hexToRgba(accent, 0.05)} 0px, transparent 1px, transparent ${u * 8}px)`
            : `repeating-linear-gradient(90deg, ${hexToRgba(accent, 0.04)} 0px, transparent 1px, transparent ${u * 8}px), repeating-linear-gradient(0deg, ${hexToRgba(accent, 0.04)} 0px, transparent 1px, transparent ${u * 8}px)`,
          opacity: 0.4,
        }} />

        {/* 渐变光晕 */}
        <div style={{
          position: "absolute",
          top: index === 0 ? "-20%" : "auto",
          bottom: index === 1 ? "-20%" : "auto",
          left: "50%",
          transform: "translateX(-50%)",
          width: "80%",
          height: "40%",
          background: `radial-gradient(ellipse, ${hexToRgba(accent, isDark ? 0.15 : 0.08)} 0%, transparent 70%)`,
          filter: "blur(60px)",
          opacity: contentReveal,
        }} />

        {/* 内容区 */}
        <div style={{
          position: "relative",
          zIndex: 1,
          maxWidth: portrait ? "90%" : "75%",
          textAlign: "center",
        }}>
          {/* 标签 */}
          <div style={{
            marginBottom: portrait ? u * 3 : u * 4,
            fontSize: portrait ? u * 2.5 : u * 2,
            fontWeight: 600,
            letterSpacing: u * 0.25,
            color: accent,
            textTransform: "uppercase",
            opacity: interpolate(frame, frameRange(durationInFrames, index === 0 ? 15 : 25, index === 0 ? 30 : 40), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}>
            {index === 0 ? "前" : "后"}
          </div>

          {/* 主文本 */}
          <div style={{
            fontSize: portrait ? u * 7 : u * 8,
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: portrait ? u * 0.15 : u * 0.2,
            color: isDark ? "rgba(255, 255, 255, 0.95)" : "rgba(15, 15, 30, 0.95)",
            textShadow: isDark ? `0 2px ${u * 2}px rgba(0, 0, 0, 0.3)` : `0 1px ${u}px rgba(255, 255, 255, 0.5)`,
            opacity: contentReveal,
            transform: `translateY(${(1 - contentReveal) * u * 3}px)`,
          }}>
            {content}
          </div>

          {/* 装饰线 */}
          <div style={{
            marginTop: portrait ? u * 3 : u * 4,
            width: portrait ? u * 12 : u * 18,
            height: 3,
            marginLeft: "auto",
            marginRight: "auto",
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            borderRadius: u,
            opacity: interpolate(frame, frameRange(durationInFrames, index === 0 ? 25 : 35, index === 0 ? 40 : 50), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }} />
        </div>
      </div>
    );
  };

  return <TemplateFrame background="linear-gradient(135deg, #1a1a2e 0%, #2d2d44 50%, #1a1a2e 100%)">
    <AbsoluteFill style={{
      display: "flex",
      flexDirection: portrait ? "column" : "row",
      opacity: flipProgress,
    }}>
      {renderPanel(sides[0], 0, leftFlip)}
      {renderPanel(sides[1], 1, rightFlip)}

      {/* 中央分隔光线 */}
      <div style={{
        position: "absolute",
        zIndex: 10,
        ...(portrait ? {
          left: 0,
          right: 0,
          top: "50%",
          height: u * 0.8,
          transform: `translateY(-50%) scaleX(${Math.min(leftFlip, rightFlip)})`,
        } : {
          top: 0,
          bottom: 0,
          left: "50%",
          width: u * 0.8,
          transform: `translateX(-50%) scaleY(${Math.min(leftFlip, rightFlip)})`,
        }),
        background: `linear-gradient(${portrait ? "90deg" : "180deg"}, transparent, ${accent}, ${accent}, transparent)`,
        boxShadow: `0 0 ${u * 3}px ${accent}`,
        opacity: interpolate(frame, frameRange(durationInFrames, 5, 20), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      }} />
    </AbsoluteFill>
  </TemplateFrame>;
}

function splitText(text: string): [string, string] {
  const words = text.split(/[，,。！？!?；;：:、\s]+/).filter(Boolean);
  const midpoint = Math.max(1, Math.ceil(words.length / 2));
  return [words.slice(0, midpoint).join(" ") || "一面", words.slice(midpoint).join(" ") || "另一面"];
}

// ============ 新增卡片模板 ============

// 数据卡 - 聚焦放大效果
function StatTemplate({ shot }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { width, portrait, u } = useLayout();
  const theme = useTheme();
  const fps = useVideoConfig().fps;

  const stat = shot.card.stat;
  if (!stat) return <CardFallback shot={shot} />;

  const accent = theme.accent || "#3b82f6";

  // 从虚焦到清晰的聚焦动画
  const focusReveal = spring({ frame, fps, config: { damping: 24, mass: 1, stiffness: 70 } });
  const valueReveal = spring({ frame: Math.max(0, frame - 8), fps, config: { damping: 16, mass: 0.6, stiffness: 100 } });
  const labelReveal = spring({ frame: Math.max(0, frame - 20), fps, config: { damping: 20, mass: 0.8, stiffness: 80 } });

  const blurAmount = interpolate(focusReveal, [0, 1], [20, 0]);

  return <TemplateFrame background="radial-gradient(circle at 50% 40%, #0d1117 0%, #010409 100%)">
    <AbsoluteFill>
      {/* 渐变光晕背景 */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(ellipse at 50% 45%, ${hexToRgba(accent, 0.18)} 0%, transparent 65%)`,
        opacity: focusReveal * 0.7,
        filter: `blur(${80 + (1 - focusReveal) * 40}px)`,
        transform: `scale(${0.8 + focusReveal * 0.3})`,
      }} />

      <AbsoluteFill style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: portrait ? u * 8 : u * 10,
        filter: `blur(${blurAmount}px)`,
      }}>
        {/* 核心数值 */}
        <div style={{
          position: "relative",
          marginBottom: portrait ? u * 6 : u * 8,
        }}>
          <div style={{
            fontSize: portrait ? u * 18 : u * 22,
            fontWeight: 800,
            lineHeight: 0.9,
            background: `linear-gradient(135deg, ${accent}, ${accent}dd)`,
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            opacity: valueReveal,
            transform: `scale(${0.85 + valueReveal * 0.15})`,
            textShadow: `0 0 ${u * 4}px ${hexToRgba(accent, 0.3)}`,
            display: "flex",
            alignItems: "baseline",
            gap: u * 2,
          }}>
            <span>{stat.value}</span>
            {stat.unit && <span style={{
              fontSize: portrait ? u * 8 : u * 10,
              fontWeight: 600,
              opacity: 0.85,
            }}>{stat.unit}</span>}
          </div>

          {/* 装饰光效 */}
          <div style={{
            position: "absolute",
            bottom: -u * 2,
            left: "50%",
            transform: "translateX(-50%)",
            width: portrait ? u * 40 : u * 50,
            height: 3,
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            opacity: valueReveal * 0.6,
            boxShadow: `0 0 ${u * 2}px ${accent}`,
          }} />
        </div>

        {/* 标签文字 */}
        <div style={{
          fontSize: portrait ? u * 4.5 : u * 4,
          fontWeight: 500,
          color: "rgba(255, 255, 255, 0.75)",
          letterSpacing: u * 0.15,
          textAlign: "center",
          maxWidth: portrait ? width * 0.75 : width * 0.6,
          opacity: labelReveal,
          transform: `translateY(${(1 - labelReveal) * u * 2}px)`,
        }}>
          {stat.label}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  </TemplateFrame>;
}

// 列表卡 - 逐条浮现
function ListTemplate({ shot }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { width, portrait, u } = useLayout();
  const theme = useTheme();
  const fps = useVideoConfig().fps;

  const items = shot.card.items ?? [];
  const headline = shot.card.headline;
  const accent = theme.accent || "#8b5cf6";

  const titleReveal = spring({ frame, fps, config: { damping: 20, mass: 0.8, stiffness: 80 } });

  return <TemplateFrame background="linear-gradient(135deg, #0f0f1e 0%, #1a1a2e 50%, #0f0f1e 100%)">
    <AbsoluteFill>
      {/* 微妙背景光效 */}
      <div style={{
        position: "absolute",
        top: "20%",
        left: "50%",
        transform: "translateX(-50%)",
        width: portrait ? "70%" : "50%",
        height: "60%",
        background: `radial-gradient(ellipse, ${hexToRgba(accent, 0.08)} 0%, transparent 70%)`,
        filter: "blur(80px)",
        opacity: titleReveal * 0.6,
      }} />

      <AbsoluteFill style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: portrait ? u * 8 : u * 10,
      }}>
        {/* 标题 */}
        {headline && <div style={{
          marginBottom: portrait ? u * 6 : u * 8,
          fontSize: portrait ? u * 5 : u * 4.5,
          fontWeight: 600,
          color: accent,
          letterSpacing: u * 0.2,
          textTransform: "uppercase",
          opacity: titleReveal,
          transform: `translateY(${(1 - titleReveal) * u * 3}px)`,
        }}>
          {headline}
        </div>}

        {/* 列表项容器 */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: portrait ? u * 4 : u * 5,
          maxWidth: portrait ? width * 0.85 : width * 0.7,
        }}>
          {items.map((item, index) => {
            const itemReveal = spring({
              frame: Math.max(0, frame - 15 - index * 6),
              fps,
              config: { damping: 18, mass: 0.7, stiffness: 90 },
            });

            return (
              <div key={index} style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: u * 3,
                padding: `${u * 3}px ${u * 4}px`,
                background: `linear-gradient(135deg, ${hexToRgba(accent, 0.08)}, ${hexToRgba(accent, 0.02)})`,
                border: `1px solid ${hexToRgba(accent, 0.15)}`,
                borderRadius: u * 2,
                opacity: itemReveal,
                transform: `translateX(${(1 - itemReveal) * u * 4}px)`,
              }}>
                {/* 序号圆点 */}
                <div style={{
                  flexShrink: 0,
                  width: u * 6,
                  height: u * 6,
                  borderRadius: "50%",
                  background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: u * 3,
                  fontWeight: 700,
                  color: "#fff",
                  boxShadow: `0 0 ${u * 2}px ${hexToRgba(accent, 0.4)}`,
                }}>
                  {index + 1}
                </div>

                {/* 文字 */}
                <div style={{
                  flex: 1,
                  fontSize: portrait ? u * 4.5 : u * 4,
                  fontWeight: 500,
                  color: "rgba(255, 255, 255, 0.9)",
                  letterSpacing: u * 0.08,
                  lineHeight: 1.4,
                }}>
                  {item}
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  </TemplateFrame>;
}

// 问答卡 - 对话展开
function QATemplate({ shot }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { portrait, u } = useLayout();
  const theme = useTheme();
  const fps = useVideoConfig().fps;

  const qa = shot.card.qa;
  if (!qa) return <CardFallback shot={shot} />;

  const accent = theme.accent || "#10b981";

  const questionReveal = spring({ frame, fps, config: { damping: 20, mass: 0.8, stiffness: 75 } });
  const answerReveal = spring({ frame: Math.max(0, frame - 25), fps, config: { damping: 18, mass: 0.9, stiffness: 70 } });

  return <TemplateFrame background="linear-gradient(135deg, #0a0e27 0%, #151b2e 100%)">
    <AbsoluteFill>
      <AbsoluteFill style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: portrait ? u * 8 : u * 10,
        gap: portrait ? u * 8 : u * 10,
      }}>
        {/* 问题区块 */}
        <div style={{
          position: "relative",
          width: portrait ? "90%" : "75%",
          padding: portrait ? u * 5 : u * 6,
          background: `linear-gradient(135deg, ${hexToRgba(accent, 0.06)}, ${hexToRgba(accent, 0.02)})`,
          border: `1px solid ${hexToRgba(accent, 0.2)}`,
          borderRadius: u * 3,
          opacity: questionReveal,
          transform: `translateY(${(1 - questionReveal) * u * 5}px) scale(${0.96 + questionReveal * 0.04})`,
        }}>
          {/* Q标识 */}
          <div style={{
            position: "absolute",
            top: -u * 3,
            left: portrait ? u * 5 : u * 6,
            width: u * 8,
            height: u * 8,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${accent}, ${accent}dd)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: u * 4.5,
            fontWeight: 700,
            color: "#fff",
            boxShadow: `0 ${u}px ${u * 3}px rgba(0, 0, 0, 0.3), 0 0 ${u * 2}px ${hexToRgba(accent, 0.5)}`,
          }}>
            Q
          </div>

          <div style={{
            fontSize: portrait ? u * 4.5 : u * 4.2,
            fontWeight: 500,
            color: "rgba(255, 255, 255, 0.9)",
            lineHeight: 1.5,
            letterSpacing: u * 0.08,
          }}>
            {qa.question}
          </div>
        </div>

        {/* 答案区块 */}
        <div style={{
          position: "relative",
          width: portrait ? "90%" : "75%",
          padding: portrait ? u * 5 : u * 6,
          background: `linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02))`,
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: u * 3,
          opacity: answerReveal,
          transform: `translateY(${(1 - answerReveal) * u * 5}px) scale(${0.96 + answerReveal * 0.04})`,
        }}>
          {/* A标识 */}
          <div style={{
            position: "absolute",
            top: -u * 3,
            left: portrait ? u * 5 : u * 6,
            width: u * 8,
            height: u * 8,
            borderRadius: "50%",
            background: "linear-gradient(135deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.08))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: u * 4.5,
            fontWeight: 700,
            color: accent,
            boxShadow: `0 ${u}px ${u * 3}px rgba(0, 0, 0, 0.3)`,
          }}>
            A
          </div>

          <div style={{
            fontSize: portrait ? u * 5 : u * 4.8,
            fontWeight: 600,
            color: "rgba(255, 255, 255, 0.95)",
            lineHeight: 1.5,
            letterSpacing: u * 0.1,
          }}>
            {qa.answer}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  </TemplateFrame>;
}

// 号召卡 - 脉动强调
function CTATemplate({ shot, durationInFrames }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { portrait, u } = useLayout();
  const theme = useTheme();
  const fps = useVideoConfig().fps;

  const cta = shot.card.cta;
  if (!cta) return <CardFallback shot={shot} />;

  const accent = theme.accent || "#f59e0b";

  const reveal = spring({ frame, fps, config: { damping: 18, mass: 1, stiffness: 70 } });
  const pulse = Math.sin(frame * 0.08) * 0.5 + 0.5;

  return <TemplateFrame background="radial-gradient(ellipse at center, #1a1a2e 0%, #0f0f1e 100%)">
    <AbsoluteFill>
      {/* 脉动光晕 */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(circle at 50% 50%, ${hexToRgba(accent, 0.2)} 0%, transparent 60%)`,
        opacity: reveal * (0.4 + pulse * 0.3),
        filter: "blur(100px)",
        transform: `scale(${0.9 + pulse * 0.15})`,
      }} />

      <AbsoluteFill style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: portrait ? u * 8 : u * 10,
      }}>
        {/* 核心行动按钮效果 */}
        <div style={{
          position: "relative",
          padding: `${portrait ? u * 6 : u * 7}px ${portrait ? u * 10 : u * 12}px`,
          background: `linear-gradient(135deg, ${accent}, ${accent}dd)`,
          borderRadius: u * 4,
          boxShadow: `0 ${u * 2}px ${u * 6}px rgba(0, 0, 0, 0.4), 0 0 ${u * 4}px ${hexToRgba(accent, 0.6)}`,
          opacity: reveal,
          transform: `scale(${0.9 + reveal * 0.1 + pulse * 0.02})`,
        }}>
          {/* 核心文字 */}
          <div style={{
            fontSize: portrait ? u * 7 : u * 6.5,
            fontWeight: 700,
            color: "#fff",
            letterSpacing: u * 0.15,
            textShadow: `0 ${u}px ${u * 2}px rgba(0, 0, 0, 0.3)`,
            textAlign: "center",
          }}>
            {cta.action}
          </div>

          {/* 装饰光线 */}
          <div style={{
            position: "absolute",
            top: 0,
            left: "20%",
            right: "20%",
            height: 2,
            background: "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent)",
            opacity: reveal * 0.8,
          }} />
        </div>

        {/* 副标题 */}
        {cta.subtitle && <div style={{
          marginTop: portrait ? u * 5 : u * 6,
          fontSize: portrait ? u * 3.5 : u * 3,
          fontWeight: 500,
          color: "rgba(255, 255, 255, 0.7)",
          letterSpacing: u * 0.1,
          textAlign: "center",
          opacity: interpolate(frame, frameRange(durationInFrames, 25, 40), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}>
          {cta.subtitle}
        </div>}
      </AbsoluteFill>
    </AbsoluteFill>
  </TemplateFrame>;
}

// 提示卡 - 边框呼吸
function AlertTemplate({ shot }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { portrait, u } = useLayout();
  const fps = useVideoConfig().fps;

  const alert = shot.card.alert;
  if (!alert) return <CardFallback shot={shot} />;

  const typeColors = {
    info: "#3b82f6",
    warning: "#f59e0b",
    success: "#10b981",
    danger: "#ef4444",
  };
  const color = typeColors[alert.type];

  const reveal = spring({ frame, fps, config: { damping: 20, mass: 0.8, stiffness: 75 } });
  const breathe = Math.sin(frame * 0.06) * 0.5 + 0.5;

  return <TemplateFrame background="linear-gradient(135deg, #0f0f1e 0%, #1a1a2e 100%)">
    <AbsoluteFill>
      <AbsoluteFill style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: portrait ? u * 8 : u * 10,
      }}>
        <div style={{
          position: "relative",
          width: portrait ? "85%" : "70%",
          padding: portrait ? u * 6 : u * 7,
          background: `linear-gradient(135deg, ${hexToRgba(color, 0.08)}, ${hexToRgba(color, 0.03)})`,
          border: `2px solid ${color}`,
          borderRadius: u * 3,
          boxShadow: `0 0 ${u * 3}px ${hexToRgba(color, 0.4 + breathe * 0.3)}, inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
          opacity: reveal,
          transform: `scale(${0.94 + reveal * 0.06})`,
        }}>
          {/* 图标 */}
          <div style={{
            position: "absolute",
            top: -u * 4,
            left: "50%",
            transform: "translateX(-50%)",
            width: u * 10,
            height: u * 10,
            borderRadius: "50%",
            background: color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: u * 5,
            fontWeight: 700,
            color: "#fff",
            boxShadow: `0 ${u * 2}px ${u * 4}px rgba(0, 0, 0, 0.3), 0 0 ${u * 3}px ${hexToRgba(color, 0.6)}`,
          }}>
            {alert.type === "info" && "i"}
            {alert.type === "warning" && "!"}
            {alert.type === "success" && "✓"}
            {alert.type === "danger" && "×"}
          </div>

          {/* 内容文字 */}
          <div style={{
            marginTop: u * 2,
            fontSize: portrait ? u * 5 : u * 4.5,
            fontWeight: 600,
            color: "rgba(255, 255, 255, 0.95)",
            textAlign: "center",
            lineHeight: 1.5,
            letterSpacing: u * 0.08,
          }}>
            {alert.content}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  </TemplateFrame>;
}

// 定义卡 - 分层展开
function DefinitionTemplate({ shot }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { width, portrait, u } = useLayout();
  const theme = useTheme();
  const accent = theme.accent || "#8b5cf6";
  const fps = useVideoConfig().fps;

  const definition = shot.card.definition;
  if (!definition) return <CardFallback shot={shot} />;


  const termReveal = spring({ frame, fps, config: { damping: 20, mass: 0.8, stiffness: 80 } });
  const meaningReveal = spring({ frame: Math.max(0, frame - 18), fps, config: { damping: 18, mass: 0.9, stiffness: 75 } });

  return <TemplateFrame background="linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0a0a0f 100%)">
    <AbsoluteFill>
      <AbsoluteFill style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: portrait ? u * 8 : u * 10,
        gap: portrait ? u * 6 : u * 8,
      }}>
        {/* 术语部分 */}
        <div style={{
          position: "relative",
          opacity: termReveal,
          transform: `translateY(${(1 - termReveal) * u * 4}px)`,
        }}>
          <div style={{
            fontSize: portrait ? u * 8 : u * 7,
            fontWeight: 700,
            background: `linear-gradient(135deg, ${accent}, ${accent}dd)`,
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: u * 0.2,
            textAlign: "center",
          }}>
            {definition.term}
          </div>

          {/* 下划线 */}
          <div style={{
            marginTop: u * 2,
            height: 3,
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            borderRadius: u,
            opacity: 0.6,
          }} />
        </div>

        {/* 定义部分 */}
        <div style={{
          maxWidth: portrait ? width * 0.85 : width * 0.7,
          padding: portrait ? u * 5 : u * 6,
          background: "linear-gradient(135deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02))",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: u * 3,
          opacity: meaningReveal,
          transform: `translateY(${(1 - meaningReveal) * u * 4}px) scale(${0.96 + meaningReveal * 0.04})`,
        }}>
          <div style={{
            fontSize: portrait ? u * 4.5 : u * 4,
            fontWeight: 500,
            color: "rgba(255, 255, 255, 0.9)",
            lineHeight: 1.6,
            letterSpacing: u * 0.08,
            textAlign: "center",
          }}>
            {definition.meaning}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  </TemplateFrame>;
}

// 时间线卡 - 横向流动
function TimelineTemplate({ shot }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { portrait, u } = useLayout();
  const theme = useTheme();
  const fps = useVideoConfig().fps;

  const timeline = shot.card.timeline ?? [];
  if (timeline.length === 0) return <CardFallback shot={shot} />;

  const accent = theme.accent || "#06b6d4";

  return <TemplateFrame background="linear-gradient(135deg, #0f0f1e 0%, #16213e 100%)">
    <AbsoluteFill>
      <AbsoluteFill style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: portrait ? u * 6 : u * 8,
      }}>
        <div style={{
          display: "flex",
          flexDirection: portrait ? "column" : "row",
          alignItems: "center",
          gap: portrait ? u * 6 : u * 8,
          maxWidth: portrait ? "90%" : "80%",
        }}>
          {timeline.map((item, index) => {
            const nodeReveal = spring({
              frame: Math.max(0, frame - 10 - index * 8),
              fps,
              config: { damping: 18, mass: 0.8, stiffness: 85 },
            });

            const isLast = index === timeline.length - 1;

            return (
              <div key={index} style={{
                display: "flex",
                flexDirection: portrait ? "row" : "column",
                alignItems: "center",
                gap: u * 2,
                flex: portrait ? "none" : 1,
                width: portrait ? "100%" : "auto",
              }}>
                {/* 节点 */}
                <div style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: u * 2,
                  opacity: nodeReveal,
                  transform: `scale(${0.8 + nodeReveal * 0.2})`,
                }}>
                  {/* 圆点 */}
                  <div style={{
                    width: u * 8,
                    height: u * 8,
                    borderRadius: "50%",
                    background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                    border: `2px solid ${hexToRgba(accent, 0.3)}`,
                    boxShadow: `0 0 ${u * 3}px ${hexToRgba(accent, 0.5)}, inset 0 1px 0 rgba(255, 255, 255, 0.2)`,
                  }} />

                  {/* 时间 */}
                  <div style={{
                    fontSize: portrait ? u * 3.5 : u * 3,
                    fontWeight: 600,
                    color: accent,
                    letterSpacing: u * 0.1,
                    whiteSpace: "nowrap",
                  }}>
                    {item.time}
                  </div>

                  {/* 事件 */}
                  <div style={{
                    fontSize: portrait ? u * 3.8 : u * 3.5,
                    fontWeight: 500,
                    color: "rgba(255, 255, 255, 0.85)",
                    textAlign: "center",
                    maxWidth: portrait ? u * 50 : u * 30,
                    lineHeight: 1.4,
                  }}>
                    {item.event}
                  </div>
                </div>

                {/* 连接线 */}
                {!isLast && <div style={{
                  [portrait ? "height" : "width"]: portrait ? u * 4 : "100%",
                  [portrait ? "width" : "height"]: 2,
                  background: `linear-gradient(${portrait ? "180deg" : "90deg"}, ${accent}, transparent)`,
                  opacity: nodeReveal * 0.5,
                }} />}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  </TemplateFrame>;
}

// 人物卡 - 渐入聚焦
function ProfileTemplate({ shot, durationInFrames }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { width, portrait, u } = useLayout();
  const theme = useTheme();
  const fps = useVideoConfig().fps;

  const profile = shot.card.profile;
  if (!profile) return <CardFallback shot={shot} />;

  const accent = theme.accent || "#ec4899";

  const reveal = spring({ frame, fps, config: { damping: 20, mass: 1, stiffness: 70 } });
  const contentReveal = spring({ frame: Math.max(0, frame - 12), fps, config: { damping: 18, mass: 0.8, stiffness: 80 } });

  return <TemplateFrame background="radial-gradient(ellipse at 50% 40%, #1a1a2e 0%, #0f0f1e 100%)">
    <AbsoluteFill>
      {/* 背景光晕 */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(circle at 50% 35%, ${hexToRgba(accent, 0.12)} 0%, transparent 60%)`,
        opacity: reveal * 0.7,
        filter: "blur(90px)",
      }} />

      <AbsoluteFill style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: portrait ? u * 8 : u * 10,
      }}>
        <div style={{
          position: "relative",
          maxWidth: portrait ? width * 0.85 : width * 0.65,
          padding: portrait ? u * 7 : u * 8,
          background: "linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02))",
          backdropFilter: "blur(16px)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: u * 4,
          boxShadow: `0 ${u * 4}px ${u * 8}px rgba(0, 0, 0, 0.4)`,
          opacity: reveal,
          transform: `scale(${0.92 + reveal * 0.08})`,
        }}>
          {/* 装饰顶线 */}
          <div style={{
            position: "absolute",
            top: 0,
            left: "25%",
            right: "25%",
            height: 3,
            background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            opacity: 0.6,
          }} />

          {/* 姓名 */}
          <div style={{
            fontSize: portrait ? u * 7 : u * 6.5,
            fontWeight: 700,
            color: "rgba(255, 255, 255, 0.95)",
            letterSpacing: u * 0.15,
            textAlign: "center",
            marginBottom: u * 3,
            opacity: contentReveal,
            transform: `translateY(${(1 - contentReveal) * u * 2}px)`,
          }}>
            {profile.name}
          </div>

          {/* 角色/职位 */}
          {profile.role && <div style={{
            fontSize: portrait ? u * 3.8 : u * 3.5,
            fontWeight: 500,
            color: accent,
            letterSpacing: u * 0.12,
            textAlign: "center",
            marginBottom: u * 4,
            opacity: interpolate(frame, frameRange(durationInFrames, 18, 30), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}>
            {profile.role}
          </div>}

          {/* 简介 */}
          {profile.bio && <div style={{
            fontSize: portrait ? u * 3.5 : u * 3.2,
            fontWeight: 400,
            color: "rgba(255, 255, 255, 0.7)",
            lineHeight: 1.6,
            letterSpacing: u * 0.08,
            textAlign: "center",
            opacity: interpolate(frame, frameRange(durationInFrames, 25, 40), [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}>
            {profile.bio}
          </div>}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  </TemplateFrame>;
}

/**
 * 电影海报式信息帧。
 * 所有信息卡共用同一套黑底、细线、编号和节奏，只按内容选择排版。
 * 这样可以避免连续镜头在视觉上变成一排不同风格的 UI 卡片。
 */
export function CinematicCardTemplate({ shot, durationInFrames }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { portrait, u, pad } = useLayout();
  const card = shot.card;
  const variant = card.variant;
  const { opacity, blur, translateY } = cinematicMotion(frame, durationInFrames, variant);
  const chapter = shot.chapter?.index ?? 1;
  const eyebrow = cardLabel(variant);

  const headlineText = fitEight(shot.onScreenText || card.headline || shot.keywords[0] || shot.caption);
  const quoteText = fitEight(card.headline || headlineText || "值得记住");
  const stat = card.stat;
  const definition = card.definition;
  const profile = card.profile;
  const timeline = card.timeline ?? [];
  const list = card.items ?? [];
  const sides = card.sides ?? ["之前", "之后"];
  const typedQuote = typewriterText(quoteText, frame, durationInFrames, variant);
  const introReveal = revealBetween(frame, durationInFrames, 4, 22);
  const footerReveal = revealBetween(frame, durationInFrames, 12, 34);

  const baseContent: ReactNode = variant === "stat" && stat ? (
    <div style={{ width: "100%", maxWidth: portrait ? "88%" : "68%", textAlign: "left" }}>
      <MicroLabel text="数据记录" reveal={introReveal} />
      <div style={{ display: "flex", alignItems: "baseline", gap: u * 1.4, marginTop: u * 2, opacity: introReveal, transform: `translateY(${(1 - introReveal) * u}px)` }}>
        <span style={{ fontSize: portrait ? u * 20 : u * 25, fontWeight: 900, lineHeight: 0.9, letterSpacing: -u * 0.8 }}>{countUpText(stat.value, frame, durationInFrames)}</span>
        {stat.unit && <span style={{ fontSize: portrait ? u * 7 : u * 8, fontWeight: 700, color: "rgba(244,240,232,.6)" }}>{fitEight(stat.unit)}</span>}
      </div>
      <Rule width={portrait ? "62%" : "42%"} marginTop={u * 4} reveal={revealBetween(frame, durationInFrames, 14, 32)} />
      {(() => {
        const labelReveal = revealBetween(frame, durationInFrames, 22, 46);
        return <div style={{ marginTop: u * 2.5, fontSize: portrait ? u * 4.1 : u * 3.4, color: "rgba(244,240,232,.62)", letterSpacing: u * 0.08, opacity: labelReveal, transform: `translateY(${(1 - labelReveal) * u * 2}px)` }}>{fitEight(stat.label || headlineText, "数据变化")}</div>;
      })()}
    </div>
  ) : variant === "list" ? (
    <div style={{ width: "100%", maxWidth: portrait ? "88%" : "68%", textAlign: "left" }}>
      <MicroLabel text={fitEight(card.headline || "关键节点", "关键节点")} reveal={introReveal} />
      <div style={{ marginTop: u * 3 }}>
        {list.slice(0, 4).map((item, index) => {
          const reveal = staggerReveal(frame, durationInFrames, index, Math.min(4, list.length));
          return <div key={`${item}-${index}`} style={{ position: "relative", display: "flex", alignItems: "baseline", gap: u * 2, padding: `${u * 2.3}px 0`, color: "#f4f0e8", opacity: reveal, transform: `translateX(${(1 - reveal) * u * 3}px)`, filter: `blur(${(1 - reveal) * 3}px)` }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: `${reveal * 100}%`, height: 1, background: "rgba(244,240,232,.24)" }} />
            <span style={{ fontFamily: "DOV Sans SC", fontSize: u * 2.5, color: "rgba(244,240,232,.42)", letterSpacing: u * 0.1 }}>{String(index + 1).padStart(2, "0")}</span>
            <span style={{ fontSize: portrait ? u * 5.5 : u * 4.6, fontWeight: 700, lineHeight: 1.1 }}>{fitEight(item)}</span>
          </div>;
        })}
      </div>
    </div>
  ) : variant === "split" ? (
    <div style={{ width: "100%", maxWidth: portrait ? "88%" : "76%", display: "flex", flexDirection: portrait ? "column" : "row", alignItems: "stretch", gap: portrait ? u * 5 : u * 8 }}>
      {sides.map((side, index) => {
        const reveal = staggerReveal(frame, durationInFrames, index, sides.length);
        return <div key={`${side}-${index}`} style={{ flex: 1, paddingTop: u * 2, borderTop: "1px solid rgba(244,240,232,.55)", opacity: reveal, transform: `translateY(${(1 - reveal) * u * 1.5}px)`, filter: `blur(${(1 - reveal) * 3}px)` }}>
          <MicroLabel text={index === 0 ? "原状" : "转向"} reveal={reveal} />
          <div style={{ marginTop: u * 3, fontSize: portrait ? u * 7.2 : u * 7.8, fontWeight: 900, lineHeight: 1, letterSpacing: -u * 0.25 }}>{fitEight(side)}</div>
        </div>;
      })}
    </div>
  ) : variant === "definition" && definition ? (
    <div style={{ width: "100%", maxWidth: portrait ? "88%" : "72%", textAlign: "left" }}>
      <MicroLabel text="术语" reveal={introReveal} />
      <div style={{ marginTop: u * 2, fontSize: portrait ? u * 11 : u * 12, fontWeight: 900, lineHeight: 0.95, letterSpacing: -u * 0.3, opacity: staggerReveal(frame, durationInFrames, 0, 2) }}>{fitEight(definition.term, headlineText)}</div>
      <Rule width="100%" marginTop={u * 4} />
      <div style={{ marginTop: u * 2.5, maxWidth: "78ch", fontSize: portrait ? u * 4.2 : u * 3.7, lineHeight: 1.45, color: "rgba(244,240,232,.68)", opacity: staggerReveal(frame, durationInFrames, 1, 2), transform: `translateY(${(1 - staggerReveal(frame, durationInFrames, 1, 2)) * u}px)` }}>{fitEight(definition.meaning, headlineText)}</div>
    </div>
  ) : variant === "timeline" && timeline.length > 0 ? (
    <div style={{ width: "100%", maxWidth: portrait ? "88%" : "82%" }}>
      <MicroLabel text="时间线" reveal={introReveal} />
      <div style={{ position: "relative", display: "flex", flexDirection: portrait ? "column" : "row", gap: portrait ? u * 4 : u * 6, marginTop: u * 7 }}>
        {!portrait && <div style={{ position: "absolute", left: 0, right: 0, top: u * 1.5, borderTop: "1px solid rgba(244,240,232,.45)", transform: `scaleX(${revealBetween(frame, durationInFrames, 10, 34)})`, transformOrigin: "left center" }} />}
        {timeline.slice(0, 4).map((item, index) => {
          const reveal = staggerReveal(frame, durationInFrames, index, Math.min(4, timeline.length));
          return <div key={`${item.time}-${index}`} style={{ position: "relative", flex: 1, display: "flex", flexDirection: portrait ? "row" : "column", gap: u * 1.8, alignItems: portrait ? "baseline" : "center", textAlign: portrait ? "left" : "center", opacity: reveal, transform: `translateY(${(1 - reveal) * u * 1.5}px)`, filter: `blur(${(1 - reveal) * 2.5}px)` }}>
            <span style={{ position: "relative", zIndex: 1, width: u * 3, height: u * 3, flexShrink: 0, border: "1px solid #f4f0e8", borderRadius: "50%", background: "#050505", transform: `scale(${0.78 + reveal * 0.22})` }} />
            <div style={{ width: portrait ? "auto" : "100%" }}>
              <div style={{ fontSize: portrait ? u * 4 : u * 3.6, color: "rgba(244,240,232,.5)", letterSpacing: u * 0.1 }}>{fitEight(item.time)}</div>
              <div style={{ marginTop: u, fontSize: portrait ? u * 5 : u * 4.4, fontWeight: 700 }}>{fitEight(item.event)}</div>
            </div>
          </div>;
        })}
      </div>
    </div>
  ) : variant === "profile" && profile ? (
    <div style={{ width: "100%", maxWidth: portrait ? "88%" : "72%", textAlign: "left" }}>
      <MicroLabel text="人物档案" reveal={introReveal} />
      <div style={{ marginTop: u * 2, fontSize: portrait ? u * 12 : u * 13, fontWeight: 900, lineHeight: 0.92, letterSpacing: -u * 0.4 }}>{fitEight(profile.name, headlineText)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: u * 2, marginTop: u * 3 }}><Rule width={u * 13} marginTop={0} /><span style={{ fontSize: portrait ? u * 4.1 : u * 3.6, color: "rgba(244,240,232,.62)" }}>{fitEight(profile.role || profile.bio || "人物")}</span></div>
    </div>
  ) : (
    <div style={{ width: "100%", maxWidth: portrait ? "88%" : "78%", textAlign: variant === "quote" || variant === "headline" ? "center" : "left" }}>
      <MicroLabel text={eyebrow} reveal={introReveal} />
      <div style={{ marginTop: u * 3, fontSize: portrait ? u * 10 : u * 11.5, fontWeight: 900, lineHeight: 0.98, letterSpacing: -u * 0.35, opacity: revealBetween(frame, durationInFrames, 8, 38) }}>{typedQuote}</div>
      <Rule width={variant === "quote" ? u * 18 : u * 11} marginTop={u * 4} reveal={revealBetween(frame, durationInFrames, 22, 44)} />
    </div>
  );

  return (
    <TemplateFrame background="#050505" color="#f4f0e8">
      <AbsoluteFill style={{ opacity, filter: `blur(${blur}px)`, transform: `translateY(${translateY}px)` }}>
        <div style={{ position: "absolute", inset: portrait ? u * 5 : u * 4, border: "1px solid rgba(244,240,232,.12)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: pad, left: pad, right: pad, display: "flex", justifyContent: "space-between", alignItems: "center", color: "rgba(244,240,232,.5)", fontSize: portrait ? u * 2.8 : u * 2.1, letterSpacing: u * 0.18, opacity: introReveal, transform: `translateY(${(1 - introReveal) * u}px)` }}>
          <span>{String(chapter).padStart(2, "0")} / 04</span><span>{eyebrow}</span>
        </div>
        <div style={{ position: "absolute", left: pad, right: pad, bottom: pad, display: "flex", justifyContent: "space-between", alignItems: "flex-end", color: "rgba(244,240,232,.42)", fontSize: portrait ? u * 2.4 : u * 1.9, letterSpacing: u * 0.12, opacity: footerReveal, transform: `translateY(${(1 - footerReveal) * u}px)` }}>
          <span>{fitEight(shot.keywords[0] || shot.caption, "FILM STUDY")}</span><span>DO / 2026</span>
        </div>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: portrait ? u * 10 : u * 12 }}>{baseContent}</AbsoluteFill>
      </AbsoluteFill>
    </TemplateFrame>
  );
}

function cinematicMotion(frame: number, durationInFrames: number, variant: string) {
  const end = Math.max(1, durationInFrames);
  const enter = Math.min(18, Math.max(1, end * 0.2));
  const exit = Math.max(enter + 0.01, end - Math.min(18, Math.max(1, end * 0.2)));
  const opacity = interpolate(frame, [0, enter, exit, end], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const focusWindow = variant === "stat" ? [0, Math.min(28, end * 0.3)] : [0, enter];
  const blur = interpolate(frame, focusWindow, [variant === "stat" ? 20 : 10, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const translateY = interpolate(frame, [0, enter], [variant === "stat" ? 10 : 14, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return { opacity, blur, translateY };
}

function typewriterText(text: string, frame: number, durationInFrames: number, variant: string) {
  if (variant !== "quote" && variant !== "headline") return text;
  const end = Math.max(1, durationInFrames);
  const start = Math.min(10, Math.max(1, end * 0.08));
  const finish = Math.max(start + 1, Math.min(end * 0.42, start + 34));
  const progress = interpolate(frame, [start, finish], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return text.slice(0, Math.max(1, Math.ceil(text.length * progress)));
}

function revealBetween(frame: number, durationInFrames: number, start: number, end: number) {
  const duration = Math.max(1, durationInFrames);
  const safeStart = Math.min(Math.max(0, start), Math.max(0, duration - 1));
  const safeEnd = Math.min(duration, Math.max(safeStart + 0.01, end));
  return interpolate(frame, [safeStart, safeEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
}

function countUpText(value: string, frame: number, durationInFrames: number) {
  const clean = value.trim();
  const match = clean.match(/^(\D*)([\d,.]+)(.*)$/);
  if (!match) return fitEight(value, "0");
  const prefix = match[1] ?? "";
  const numericText = match[2] ?? "0";
  const suffix = match[3] ?? "";
  const numeric = Number(numericText.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return fitEight(value, "0");
  const decimals = numericText.includes(".") ? numericText.split(".")[1]?.length ?? 0 : 0;
  const progress = revealBetween(frame, durationInFrames, 6, Math.min(34, durationInFrames * 0.35));
  const current = numeric * progress;
  const formatted = decimals > 0 ? current.toFixed(decimals) : Math.round(current).toLocaleString("en-US");
  return `${prefix}${formatted}${suffix}`;
}

function staggerReveal(frame: number, durationInFrames: number, index: number, count: number) {
  const end = Math.max(1, durationInFrames);
  const start = Math.min(18 + index * 5, end * 0.5);
  const finish = Math.min(end, start + Math.max(8, Math.min(16, end * 0.14)));
  return interpolate(frame, [start, finish], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }) * (count > 0 ? 1 : 0);
}

function fitEight(value: string | undefined, fallback = "") {
  const clean = (value ?? fallback).replace(/[\n\r]/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= 8) return clean;
  return `${clean.slice(0, 7)}…`;
}

function cardLabel(variant: string) {
  const labels: Record<string, string> = { quote: "引言", headline: "章节", split: "对照", stat: "数据", list: "列表", alert: "提示", definition: "定义", timeline: "时间线", profile: "人物", qa: "信息", cta: "行动" };
  return labels[variant] ?? "信息";
}

function MicroLabel({ text, reveal = 1 }: { text: string; reveal?: number }) {
  return <div style={{ fontSize: 18, letterSpacing: 5, color: "rgba(244,240,232,.52)", textTransform: "uppercase", opacity: reveal, transform: `translateY(${(1 - reveal) * 5}px)`, filter: `blur(${(1 - reveal) * 2}px)` }}>{text}</div>;
}

function Rule({ width, marginTop, reveal = 1 }: { width: number | string; marginTop: number; reveal?: number }) {
  return <div style={{ width, height: 1, marginTop, background: "rgba(244,240,232,.6)", opacity: reveal, transform: `scaleX(${reveal})`, transformOrigin: "left center" }} />;
}

export const cardTemplateRenderers: Record<Ui2vTemplateId, (props: AnimationRendererProps) => ReactNode> = {
  "creator-cinema-editorial-quote": CinematicCardTemplate,
  "hero-spotlight-stage": CinematicCardTemplate,
  "hero-split-wipe": CinematicCardTemplate,
  "card-stat": CinematicCardTemplate,
  "card-list": CinematicCardTemplate,
  "card-qa": CinematicCardTemplate,
  "card-cta": CinematicCardTemplate,
  "card-alert": CinematicCardTemplate,
  "card-definition": CinematicCardTemplate,
  "card-timeline": CinematicCardTemplate,
  "card-profile": CinematicCardTemplate,
};

export function renderUi2vTemplate(shot: TimelineShot, durationInFrames: number) {
  const templateId = shot.animation?.templateId;
  if (!templateId) return null;
  const Renderer = cardTemplateRenderers[templateId];
  if (!Renderer) return null;
  return <Renderer shot={shot} durationInFrames={durationInFrames} anchors={shot.animation?.anchors ?? []} params={shot.animation?.params ?? {}} />;
}

// 导出所有新增的卡片模板用于 demo
export {
  StatTemplate,
  ListTemplate,
  QATemplate,
  CTATemplate,
  AlertTemplate,
  DefinitionTemplate,
  TimelineTemplate,
  ProfileTemplate,
};
