import type { MusicTrack } from "./timeline";
import type { Line, Mood, MusicCue } from "./types";

/**
 * 选曲 —— 纯函数。
 * 相邻、情绪相同的句子合成一个配乐片段；片段太短（< minMs）并入前一段；
 * 每段按情绪匹配曲目，尽量不重复；锁定的片段保持不变。
 */

/** 情绪相近关系：没有完全匹配的曲目时按这个顺序退让 */
const NEAR: Record<Mood, Mood[]> = {
  悬疑: ["紧张", "忧伤", "科技", "中性"],
  紧张: ["悬疑", "激昂", "史诗", "中性"],
  轻松: ["温暖", "中性", "科技"],
  温暖: ["轻松", "忧伤", "中性"],
  激昂: ["史诗", "紧张", "轻松"],
  史诗: ["激昂", "紧张", "悬疑"],
  科技: ["轻松", "中性", "激昂"],
  忧伤: ["温暖", "悬疑", "中性"],
  中性: ["轻松", "温暖", "科技"],
};

export type MoodSpan = { mood: Mood; from: number; to: number; ms: number };

export function moodSpans(lines: Pick<Line, "mood">[], durations: number[], minMs = 20_000): MoodSpan[] {
  const spans: MoodSpan[] = [];
  lines.forEach((l, k) => {
    const mood = l.mood ?? spans[spans.length - 1]?.mood ?? "中性";
    const last = spans[spans.length - 1];
    if (last && last.mood === mood) {
      last.to = k;
      last.ms += durations[k];
    } else spans.push({ mood, from: k, to: k, ms: durations[k] });
  });
  // 短片段并入相邻较长的一段（优先前一段）
  while (spans.length > 1) {
    const k = spans.findIndex((s) => s.ms < minMs);
    if (k < 0) break;
    const into = k > 0 ? k - 1 : k + 1;
    const a = spans[Math.min(k, into)];
    const b = spans[Math.max(k, into)];
    const keep = a.ms >= b.ms ? a.mood : b.mood;
    spans.splice(Math.min(k, into), 2, { mood: keep, from: a.from, to: b.to, ms: a.ms + b.ms });
  }
  return spans;
}

export function scoreTrack(t: MusicTrack, mood: Mood) {
  const i = t.moods.indexOf(mood);
  if (i >= 0) return 10 - i;
  const near = NEAR[mood];
  let best = 0;
  for (const m of t.moods) {
    const j = near.indexOf(m as Mood);
    if (j >= 0) best = Math.max(best, 5 - j);
  }
  return best;
}

export function pickMusic(lines: Line[], durations: number[], tracks: MusicTrack[], existing: MusicCue[] = []): MusicCue[] {
  if (lines.length === 0 || tracks.length === 0) return [];
  const spans = moodSpans(lines, durations);
  const used = new Map<string, number>();
  const lockedByFrom = new Map(existing.filter((c) => c.locked).map((c) => [c.fromLineId, c]));
  let prev: string | undefined;
  return spans.map((s) => {
    const fromId = lines[s.from].id;
    const toId = lines[s.to].id;
    const locked = lockedByFrom.get(fromId);
    if (locked && tracks.some((t) => t.id === locked.trackId)) {
      prev = locked.trackId;
      used.set(locked.trackId, (used.get(locked.trackId) ?? 0) + 1);
      return { ...locked, toLineId: toId };
    }
    const ranked = [...tracks].sort((a, b) => {
      const sa = scoreTrack(a, s.mood) - (used.get(a.id) ?? 0) * 3 - (a.id === prev ? 20 : 0) - (!a.loopable && a.durationMs < s.ms ? 4 : 0);
      const sb = scoreTrack(b, s.mood) - (used.get(b.id) ?? 0) * 3 - (b.id === prev ? 20 : 0) - (!b.loopable && b.durationMs < s.ms ? 4 : 0);
      return sb - sa || a.id.localeCompare(b.id);
    });
    const t = ranked[0];
    prev = t.id;
    used.set(t.id, (used.get(t.id) ?? 0) + 1);
    return { trackId: t.id, fromLineId: fromId, toLineId: toId, mood: s.mood, offsetMs: 0, locked: false };
  });
}
