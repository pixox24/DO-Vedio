import { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useDelayRender, useVideoConfig } from "remotion";
import { highlightsIn } from "@/lib/core/subtitles";
import { subtitleLineOffsets, typedCharsAt } from "@/lib/core/timeline";
import { calculateSubtitleLayout, type FormattedSubtitleBlock } from "@/lib/core/subtitle/formatter";
import {
  isStudioFontReady,
  loadStudioFont,
  resolveSecondarySubtitleFontId,
  resolveSubtitleFontId,
  resolveSubtitleTypeface,
  type SubtitleTypeface,
} from "@/lib/core/subtitle/fonts";
import type { SubtitleBlock, SubtitleConfig } from "@/lib/core/subtitle/types";

/**
 * 烧录字幕：样式与排版来自 lib/core/subtitle 模块（从 AI-Video 移植）。
 * 排版用离屏 canvas 测量，行、字号、位置与 Canvas 渲染器完全一致；
 * 字体按需加载，加载完成前 delayRender 阻塞截图，避免录到回退字体。
 */

/** 测量用的离屏 canvas；浏览器预览和 Remotion 无头 Chrome 都可用 */
let measureContext: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!measureContext) measureContext = document.createElement("canvas").getContext("2d");
  return measureContext;
}

const remotionFontUrl = (path: string) => staticFile(path.replace(/^\//, ""));

/**
 * 确保配置里的字幕字体就绪。返回的版本号在字体加载完成后递增，
 * 供排版 useMemo 重新测量（字体不同，同样文本的宽度也不同）。
 */
function useSubtitleFontRevision(config: SubtitleConfig): number {
  const { delayRender, continueRender } = useDelayRender();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const targets = [resolveSubtitleFontId(config)];
    if (config.bilingual) targets.push(resolveSecondarySubtitleFontId(config));
    const ids = Array.from(new Set(targets));
    if (ids.every(isStudioFontReady)) return;
    const handle = delayRender("加载字幕字体", { timeoutInMilliseconds: 60_000 });
    let alive = true;
    void Promise.all(ids.map((id) => loadStudioFont(id, remotionFontUrl))).finally(() => {
      if (!alive) return;
      setRevision((value) => value + 1);
      requestAnimationFrame(() => continueRender(handle));
    });
    return () => {
      alive = false;
      continueRender(handle);
    };
  }, [config, delayRender, continueRender]);

  return revision;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 画布夹取：双语块变高后不许伸出上下安全区，与 Canvas 渲染器一致 */
function centerYFor(boxHeight: number, height: number, positionY: number): number {
  const safeTop = height * 0.06;
  const safeBottom = height * 0.94;
  const halfBox = boxHeight / 2;
  return clamp(height * (positionY / 100), safeTop + halfBox, safeBottom - halfBox);
}

type ColorMark = { start: number; end: number; color: string };

/** 按字符着色再合并连续同色片段，避免逐字生成大量 span */
function lineNodes(line: string, offset: number, defaultColor: string, marks: ColorMark[]) {
  const colors = new Array<string>(line.length).fill(defaultColor);
  for (const mark of marks) {
    const from = Math.max(0, mark.start - offset);
    const to = Math.min(line.length, mark.end - offset);
    for (let i = from; i < to; i++) colors[i] = mark.color;
  }
  const nodes: { text: string; color: string }[] = [];
  for (let i = 0; i < line.length; i++) {
    const last = nodes[nodes.length - 1];
    if (last && last.color === colors[i]) last.text += line[i];
    else nodes.push({ text: line[i], color: colors[i] });
  }
  return nodes.map((node, index) => (
    <span key={index} style={{ color: node.color }}>
      {node.text}
    </span>
  ));
}

function PrimaryLines({ layout, block, config, ms }: { layout: FormattedSubtitleBlock; block: SubtitleBlock; config: SubtitleConfig; ms: number }) {
  const marks: ColorMark[] = [];
  if (config.highlight) {
    for (const [start, end] of highlightsIn(block.text, block.keywords)) {
      marks.push({ start, end, color: config.highlightColor });
    }
  }
  if (config.animation === "karaoke") {
    // 优先真实字级时间（charTimes），缺失时在 typedCharsAt 内回退整句均匀进度
    const typed = typedCharsAt(block, ms);
    marks.push({ start: 0, end: typed, color: config.highlightColor });
  }
  const offsets = subtitleLineOffsets(block.text, layout.lines);
  return (
    <>
      {layout.lines.map((line, index) => (
        <div key={index} style={{ lineHeight: `${layout.lineHeight}px` }}>
          {lineNodes(line, offsets[index], config.primaryColor, marks)}
        </div>
      ))}
    </>
  );
}

export function Subtitles({ blocks, config }: { blocks: SubtitleBlock[]; config: SubtitleConfig }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const revision = useSubtitleFontRevision(config);
  const ms = (frame / fps) * 1000;
  const block = blocks.find((item) => ms >= item.startMs && ms < item.endMs);

  const layout = useMemo(() => {
    if (!block) return null;
    const ctx = measureCtx();
    if (!ctx) return null;
    const baseFontSize = Math.round(config.fontSize * (width / 950));
    const typeface = resolveSubtitleTypeface(config);
    return calculateSubtitleLayout(
      ctx,
      block.text,
      config.bilingual ? block.secondaryText : undefined,
      width,
      baseFontSize,
      config.bilingual,
      config.maxWidthRatio || 0.84,
      config.maxLines || 3,
      typeface,
    );
    // revision 在字体加载完成后变化，需要重新测量
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block, config, width, revision]);

  const typeface: SubtitleTypeface = useMemo(() => resolveSubtitleTypeface(config), [config]);

  if (!block || !layout || layout.lines.length === 0) return null;

  const progress = clamp((ms - block.startMs) / Math.max(1, block.endMs - block.startMs), 0, 1);
  const scale = config.animation === "pop" && progress < 0.15 ? 0.92 + (progress / 0.15) * 0.08 : 1;
  const opacity = config.animation === "fade" ? Math.min(1, progress / 0.15) : 1;
  const paddingX = Math.round(layout.fontSize * 0.85);
  const paddingY = Math.round(layout.fontSize * 0.55);
  const radius = Math.min(layout.boxHeight * 0.35, layout.fontSize * 0.5);
  const centerY = centerYFor(layout.boxHeight, height, config.positionY);
  const strokeWidth = Math.max(2, layout.fontSize * 0.16);
  const textShadow = config.showShadow ? `0 ${(layout.fontSize * 0.08).toFixed(1)}px ${(layout.fontSize * 0.32).toFixed(1)}px rgba(0, 0, 0, 0.55)` : undefined;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* 外层撑满画面宽度再居中：绝对定位 + left:50% 会把可用宽度压成一半，
          导致排版好的行在 DOM 里被浏览器二次折行 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: centerY,
          transform: `translateY(-50%) scale(${scale})`,
          transformOrigin: "center center",
          opacity,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            maxWidth: `${Math.round(width * (config.maxWidthRatio || 0.84) + paddingX * 2)}px`,
            padding: config.showBackground ? `${paddingY}px ${paddingX}px` : undefined,
            borderRadius: config.showBackground ? `${radius}px` : undefined,
            background: config.showBackground ? config.backgroundColor || "rgba(0, 0, 0, 0.75)" : undefined,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: typeface.primaryFamily,
              fontWeight: Number(typeface.primaryWeight) || typeface.primaryWeight,
              fontSize: `${layout.fontSize}px`,
              color: config.primaryColor,
              WebkitTextStroke: config.showStroke ? `${strokeWidth}px ${config.strokeColor || "#000000"}` : undefined,
              paintOrder: "stroke fill",
              textShadow,
            }}
          >
            <PrimaryLines layout={layout} block={block} config={config} ms={ms} />
          </div>
          {layout.secondaryLines.length > 0 && (
            <div
              style={{
                fontFamily: typeface.secondaryFamily,
                fontWeight: Number(typeface.secondaryWeight) || typeface.secondaryWeight,
                fontSize: `${layout.secondaryFontSize}px`,
                color: config.highlightColor,
                marginTop: `${Math.round(layout.fontSize * 0.25)}px`,
                WebkitTextStroke: config.showStroke ? `${Math.max(1.5, layout.secondaryFontSize * 0.15)}px rgba(0, 0, 0, 0.8)` : undefined,
                paintOrder: "stroke fill",
                textShadow,
              }}
            >
              {layout.secondaryLines.map((line, index) => (
                <div key={index} style={{ lineHeight: `${layout.secondaryLineHeight}px` }}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
}
