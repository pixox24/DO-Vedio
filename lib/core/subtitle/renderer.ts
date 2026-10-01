import { calculateSubtitleLayout, type FormattedSubtitleBlock } from "./formatter";
import { resolveSubtitleTypeface, subtitleCanvasFont, type SubtitleTypeface } from "./fonts";
import type { SubtitleBlock, SubtitleConfig } from "./types";

/**
 * Canvas 字幕绘制 —— 从 AI-Video 字幕模块移植。
 *
 * 与 Remotion 的 DOM 渲染共用同一套 calculateSubtitleLayout 排版结果，
 * 保留给需要在 Canvas 上直接画字幕的场景（导出、快照、自动化测试）。
 */

export interface PreparedSubtitleLayout {
  layout: FormattedSubtitleBlock;
  typeface: SubtitleTypeface;
}

/**
 * Subtitle layout is independent of the frame timestamp. Exporters can prepare
 * it once per clip instead of repeating text measurement on every frame.
 */
export function prepareSubtitleLayout(
  ctx: CanvasRenderingContext2D,
  w: number,
  block: SubtitleBlock,
  config: SubtitleConfig,
  subtitleText?: string,
): PreparedSubtitleLayout | null {
  const text = subtitleText ?? block.text;
  if (!text) return null;

  const baseFontSize = Math.round(config.fontSize * (w / 950));
  const maxWidthRatio = config.maxWidthRatio || 0.84;
  const maxLines = config.maxLines || 3;
  const typeface = resolveSubtitleTypeface(config);

  // Translation line is only included when it is still paired with this exact line text.
  const secondaryText = config.bilingual && block.secondaryText ? block.secondaryText.trim() : undefined;

  const layout = calculateSubtitleLayout(ctx, text, secondaryText, w, baseFontSize, config.bilingual, maxWidthRatio, maxLines, typeface);

  if (layout.lines.length === 0) return null;
  return { layout, typeface };
}

export function drawSubtitles(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  block: SubtitleBlock,
  config: SubtitleConfig,
  progress: number,
  subtitleText?: string,
  prepared?: PreparedSubtitleLayout | null,
) {
  const posY = (h * config.positionY) / 100;
  const resolved = prepared || prepareSubtitleLayout(ctx, w, block, config, subtitleText);
  if (!resolved) return;
  const { layout, typeface } = resolved;

  // Pop scale animation
  let scale = 1.0;
  if (config.animation === "pop") {
    scale = progress < 0.15 ? 0.92 + (progress / 0.15) * 0.08 : 1.0;
  }

  // Canvas clamp: 双语块变高后底部不许伸出画面
  const halfBox = layout.boxHeight / 2;
  const safeTop = h * 0.06;
  const safeBottom = h * 0.94;
  let centerY = posY;
  if (centerY + halfBox > safeBottom) centerY = safeBottom - halfBox;
  if (centerY - halfBox < safeTop) centerY = safeTop + halfBox;

  ctx.save();
  ctx.translate(w / 2, centerY);
  ctx.scale(scale, scale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Draw background box / capsule
  if (config.showBackground) {
    ctx.fillStyle = config.backgroundColor || "rgba(0, 0, 0, 0.75)";
    const radius = Math.min(layout.boxHeight * 0.35, layout.fontSize * 0.5);
    ctx.beginPath();
    ctx.roundRect(-layout.boxWidth / 2, -layout.boxHeight / 2, layout.boxWidth, layout.boxHeight, radius);
    ctx.fill();
  }

  const primaryBlockHeight = layout.lines.length * layout.lineHeight;
  const startY = -layout.totalHeight / 2 + layout.lineHeight / 2;

  // Primary spoken narration lines
  ctx.font = subtitleCanvasFont(typeface.primaryFamily, layout.fontSize, typeface.primaryWeight);

  layout.lines.forEach((line, idx) => {
    const lineY = startY + idx * layout.lineHeight;

    if (config.showStroke) {
      ctx.strokeStyle = config.strokeColor || "#000000";
      ctx.lineWidth = Math.max(3, layout.fontSize * 0.16);
      ctx.lineJoin = "round";
      ctx.strokeText(line, 0, lineY);
    }

    ctx.fillStyle = config.primaryColor || "#ffffff";
    ctx.fillText(line, 0, lineY);
  });

  // Secondary translation lines
  if (layout.secondaryLines.length > 0) {
    ctx.font = subtitleCanvasFont(typeface.secondaryFamily, layout.secondaryFontSize, typeface.secondaryWeight);
    const secondaryStartY = -layout.totalHeight / 2 + primaryBlockHeight + layout.fontSize * 0.25 + layout.secondaryLineHeight / 2;

    layout.secondaryLines.forEach((secLine, idx) => {
      const secLineY = secondaryStartY + idx * layout.secondaryLineHeight;

      if (config.showStroke) {
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = Math.max(2, layout.secondaryFontSize * 0.15);
        ctx.lineJoin = "round";
        ctx.strokeText(secLine, 0, secLineY);
      }

      ctx.fillStyle = config.highlightColor || "#facc15";
      ctx.fillText(secLine, 0, secLineY);
    });
  }

  ctx.restore();
}
