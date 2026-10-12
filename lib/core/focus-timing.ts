/** 文字动画的节拍。画面和音效共用，避免起拍写两处。 */

export type FocusBeat = { lead: number; gap: number; span: number };

export function focusFadeRange(duration: number): [number, number, number, number] {
  const end = Math.max(1, duration - 1);
  return [0, Math.min(16, end * .22), end - Math.min(18, end * .22), end];
}

/** 数字从零涨到终值的那一帧。和画面里的 numberProgress 是同一个区间。 */
export function focusCountSettleFrame(duration: number): number {
  return Math.min(duration * 0.52, 28);
}

function fitBeat(duration: number, count: number, preferred: FocusBeat): FocusBeat {
  const fadeAt = Math.max(1, focusFadeRange(duration)[2] - 1);
  let { lead, gap, span } = preferred;
  const endAt = () => lead + span + Math.max(0, count - 1) * gap;
  if (count > 1 && endAt() > fadeAt) gap = Math.max(0, (fadeAt - lead - span) / (count - 1));
  if (endAt() > fadeAt) lead = Math.max(0, fadeAt - span - Math.max(0, count - 1) * gap);
  if (endAt() > fadeAt) {
    gap = 0;
    lead = 0;
    span = Math.max(1, fadeAt);
  }
  return { lead, gap, span };
}

/** Word stagger. Spacing shrinks on a short shot; the ease stays outCubic. */
export function staggerLineTiming(duration: number, count: number, role: "main" | "support" = "main", mainCount = count): FocusBeat {
  const main = role === "support" ? staggerLineTiming(duration, mainCount, "main") : undefined;
  const mainEnd = main ? main.lead + main.span + Math.max(0, mainCount - 1) * main.gap : 0;
  const lead = main ? main.lead + (mainEnd - main.lead) * 0.5 : Math.min(8, Math.round(duration * 0.06));
  const gap = role === "main" ? (count > 4 ? 2 : 3.5) : 2.5;
  return fitBeat(duration, Math.max(1, count), { lead, gap, span: 20 });
}

/** Letterpress. Glyph gap drops from 3 frames to 2 before the window itself shrinks. */
export function pressGlyphTiming(duration: number, count: number): FocusBeat {
  const fadeAt = Math.max(1, focusFadeRange(duration)[2] - 1);
  const span = 12;
  const lead = 10;
  let gap = 3;
  const endAt = () => lead + span + Math.max(0, count - 1) * gap;
  if (count > 1 && endAt() > fadeAt) gap = 2;
  return fitBeat(duration, Math.max(1, count), { lead, gap, span });
}

export function pressSupportStart(duration: number, glyphCount: number, smallLength: number): number {
  const glyphs = pressGlyphTiming(duration, glyphCount);
  const fadeAt = Math.max(1, focusFadeRange(duration)[2] - 1);
  const per = 0.7;
  const start = glyphs.lead + glyphs.span;
  if (smallLength <= 0) return start;
  return Math.max(0, Math.min(start, fadeAt - smallLength * per));
}
