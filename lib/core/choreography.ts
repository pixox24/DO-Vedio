import { anchorMs, sortShots, type LineTime } from "./shots";
import type { MotionProfile } from "./motion";
import type { Line, Shot } from "./types";

const highEnergy = new Set(["激昂", "紧张", "悬疑", "史诗"]);
const lowEnergy = new Set(["忧伤", "温暖"]);

/** Assigns a restrained, mood-aware animation curve and sparse chapter transitions. */
export function choreograph(shots: Shot[], lines: Line[], times: Map<string, LineTime>, profile: MotionProfile): Shot[] {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const sorted = sortShots(shots, lines);
  const chapterHighlights = new Set<number>();
  const out = sorted.map((shot, index) => {
    const line = byId.get(shot.at.lineId);
    const mood = line?.mood;
    let intensity = Math.min(3, Math.max(1, shot.animation?.intensity ?? shot.importance)) as 1 | 2 | 3;
    if (mood && highEnergy.has(mood)) intensity = 3;
    else if (mood && lowEnergy.has(mood)) intensity = 1;
    else intensity = Math.min(intensity, 2) as 1 | 2;

    const previous = sorted[index - 1];
    const chapterStart = !!previous && previous.at.lineId !== shot.at.lineId &&
      byId.get(previous.at.lineId)?.segmentIndex !== line?.segmentIndex;
    let transitionIn: Shot["transitionIn"] = shot.transitionIn ?? "cut";
    if (chapterStart) {
      const segment = line?.segmentIndex ?? -1;
      if (segment >= 0 && !chapterHighlights.has(segment)) {
        chapterHighlights.add(segment);
        transitionIn = profile.punchy ? "whip" : "dissolve";
        intensity = 3;
      } else transitionIn = "fade";
    }
    return { ...shot, transitionIn, animation: shot.animation ? { ...shot.animation, intensity: intensity as 1 | 2 | 3 } : undefined };
  });

  // Make sure every rolling 30-second window has a quiet beat.
  for (let index = 0; index < out.length; index++) {
    const start = anchorMs(out[index].at, times) ?? 0;
    const window = out.map((shot, i) => ({ shot, i, at: anchorMs(shot.at, times) ?? 0 })).filter(({ at }) => at >= start && at < start + 30_000);
    if (window.length && !window.some(({ shot }) => (shot.animation?.intensity ?? 1) === 1)) {
      const last = window.at(-1)!;
      if (last.shot.animation) out[last.i] = { ...last.shot, animation: { ...last.shot.animation, intensity: 1 } };
    }
  }
  return out;
}
