import type { MusicTrack } from "./timeline";
import type { Line, Mood, MusicCue } from "./types";
import type { MusicEnergy, RightsStatus } from "./music-library";

/**
 * 选曲 —— 纯函数。
 * 相邻、情绪相同的句子合成一个配乐片段；片段太短（< minMs）并入前一段；
 * 每段按情绪、能量、BPM、长度和冷却情况打分选曲，尽量不重复；锁定的片段保持不变。
 * 只有 rightsStatus=verified 且未被禁用的曲目参与自动选曲；没有合格曲目时抛错，不静默降级。
 */

/** 情绪相近关系：没有完全匹配的曲目时按这个顺序退让 */
export const NEAR: Record<Mood, Mood[]> = {
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

/** 可参与选曲的曲目：在基础曲目上带授权/节奏元数据 */
export type SelectableMusicTrack = MusicTrack & {
  rightsStatus?: RightsStatus;
  disabledReason?: string;
  bpm?: number | null;
  energy?: MusicEnergy | null;
  instrumental?: boolean | null;
  tags?: string[];
};

export type PickMusicOptions = {
  /** 单一曲目占全片总时长的上限（软约束，有替代曲目时生效）；默认 0.4 */
  maxTrackShare?: number;
  /** 同一曲目每用一次的冷却惩罚；默认 4 */
  cooldownPenalty?: number;
  /** 允许参与自动选曲的授权状态；默认仅 verified */
  allowedRights?: RightsStatus[];
};

export class NoEligibleMusicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoEligibleMusicError";
  }
}

export function isEligibleTrack(t: Pick<SelectableMusicTrack, "rightsStatus" | "disabledReason">, allowedRights: RightsStatus[] = ["verified"]): boolean {
  return allowedRights.includes(t.rightsStatus ?? "pending") && !t.disabledReason;
}

/** 情绪退让顺序：精确情绪 → NEAR 列表 → 其余情绪（保底，仍只选已核实曲目） */
export function moodFallbackOrder(mood: Mood): Mood[] {
  const all: Mood[] = ["悬疑", "紧张", "轻松", "温暖", "激昂", "史诗", "科技", "忧伤", "中性"];
  return [...new Set<Mood>([mood, ...NEAR[mood], ...all])];
}

const energyNeighbors: Record<MusicEnergy, MusicEnergy[]> = {
  low: ["medium"],
  medium: ["low", "high"],
  high: ["medium"],
};

export function energyDistance(a: MusicEnergy, b: MusicEnergy): number {
  if (a === b) return 0;
  return energyNeighbors[a].includes(b) ? 1 : 2;
}

/** 内容节奏：语速（字/秒）映射为低/中/高能量，用于和曲目的 energy / BPM 匹配 */
export function contentEnergy(lines: Pick<Line, "text">[], durations: number[], from: number, to: number): MusicEnergy {
  let chars = 0;
  let ms = 0;
  for (let k = from; k <= to && k < lines.length; k++) {
    chars += lines[k]?.text?.length ?? 0;
    ms += durations[k] ?? 0;
  }
  if (ms <= 0) return "medium";
  const cps = chars / (ms / 1000);
  if (cps < 3.6) return "low";
  if (cps < 4.6) return "medium";
  return "high";
}

export function targetBpm(energy: MusicEnergy): number {
  return energy === "low" ? 84 : energy === "medium" ? 100 : 122;
}

export type TrackScore = { score: number; reason: string; projectedShare: number };

type ScoreContext = {
  span: MoodSpan;
  energy: MusicEnergy;
  totalMs: number;
  index: number;
  prev?: string;
  usedMs: Map<string, number>;
  usedCount: Map<string, number>;
  lastIndex: Map<string, number>;
  maxTrackShare: number;
  cooldownPenalty: number;
};

export function scoreTrackDetailed(t: SelectableMusicTrack, ctx: ScoreContext): TrackScore {
  let score = 0;
  const reasons: string[] = [];
  const order = moodFallbackOrder(ctx.span.mood);

  const exact = t.moods.indexOf(ctx.span.mood);
  if (exact >= 0) {
    score += 10 - Math.min(exact, 3);
    reasons.push(`情绪精确匹配（${ctx.span.mood}）`);
  } else {
    let best = -1;
    let bestMood: Mood | undefined;
    for (const m of t.moods) {
      const j = order.indexOf(m as Mood);
      if (j > 0 && (best < 0 || j < best)) {
        best = j;
        bestMood = m as Mood;
      }
    }
    if (best > 0) {
      score += Math.max(2, 7 - best);
      reasons.push(`情绪相近退让（${ctx.span.mood} → ${bestMood}）`);
    } else {
      reasons.push(`无相近情绪曲目，按能量/节奏退让（目标 ${targetBpm(ctx.energy)} BPM）`);
    }
  }

  if (t.energy) {
    const d = energyDistance(t.energy, ctx.energy);
    if (d === 0) {
      score += 4;
      reasons.push("能量匹配");
    } else score -= d * 2;
  }
  if (t.bpm) score += Math.max(0, 5 - Math.abs(t.bpm - targetBpm(ctx.energy)) / 10);

  if (t.durationMs > 0) {
    if (t.durationMs >= ctx.span.ms) score += 3;
    else if (t.loopable) {
      score += 1;
      reasons.push("可循环覆盖长片段");
    } else score -= 4;
  }

  if (t.instrumental === true) score += 2;
  else if (t.instrumental === false) score -= 2;

  const used = ctx.usedCount.get(t.id) ?? 0;
  if (used > 0) score -= used * ctx.cooldownPenalty;
  const last = ctx.lastIndex.get(t.id);
  if (last !== undefined) score -= Math.max(0, 3 - (ctx.index - last)) * 2;
  if (t.id === ctx.prev) score -= 20;

  const projectedShare = ctx.totalMs > 0 ? ((ctx.usedMs.get(t.id) ?? 0) + ctx.span.ms) / ctx.totalMs : 0;
  if (projectedShare > ctx.maxTrackShare) score -= 50;

  return { score, reason: reasons.join("；"), projectedShare };
}

export function pickMusic(
  lines: Line[],
  durations: number[],
  tracks: SelectableMusicTrack[],
  existing: MusicCue[] = [],
  options: PickMusicOptions = {},
): MusicCue[] {
  if (lines.length === 0) return [];
  const spans = moodSpans(lines, durations);
  const allowedRights = options.allowedRights ?? ["verified"];
  const eligible = tracks.filter((t) => isEligibleTrack(t, allowedRights));
  const lockedByFrom = new Map(existing.filter((c) => c.locked).map((c) => [c.fromLineId, c]));
  const hasUnlocked = spans.some((s) => !lockedByFrom.has(lines[s.from].id));
  if (eligible.length === 0 && hasUnlocked) {
    throw new NoEligibleMusicError(
      tracks.length === 0
        ? "曲库为空：请导入授权音乐并运行 npm run library:ingest"
        : `曲库中没有已核实授权的可用曲目（共 ${tracks.length} 首，均未通过 rightsStatus=verified 或已被禁用）`,
    );
  }

  const totalMs = spans.reduce((sum, s) => sum + s.ms, 0);
  const ctx: ScoreContext = {
    span: spans[0],
    energy: "medium",
    totalMs,
    index: 0,
    usedMs: new Map(),
    usedCount: new Map(),
    lastIndex: new Map(),
    maxTrackShare: options.maxTrackShare ?? 0.4,
    cooldownPenalty: options.cooldownPenalty ?? 4,
  };

  return spans.map((s, index) => {
    const fromId = lines[s.from].id;
    const toId = lines[s.to].id;
    const locked = lockedByFrom.get(fromId);
    if (locked && eligible.some((t) => t.id === locked.trackId)) {
      ctx.usedMs.set(locked.trackId, (ctx.usedMs.get(locked.trackId) ?? 0) + s.ms);
      ctx.usedCount.set(locked.trackId, (ctx.usedCount.get(locked.trackId) ?? 0) + 1);
      ctx.lastIndex.set(locked.trackId, index);
      ctx.prev = locked.trackId;
      return { ...locked, toLineId: toId };
    }
    ctx.span = s;
    ctx.energy = contentEnergy(lines, durations, s.from, s.to);
    ctx.index = index;
    const scored = eligible.map((t) => ({ t, ...scoreTrackDetailed(t, ctx) }));
    scored.sort((a, b) => b.score - a.score || a.projectedShare - b.projectedShare || a.t.id.localeCompare(b.t.id));
    const best = scored[0];
    ctx.usedMs.set(best.t.id, (ctx.usedMs.get(best.t.id) ?? 0) + s.ms);
    ctx.usedCount.set(best.t.id, (ctx.usedCount.get(best.t.id) ?? 0) + 1);
    ctx.lastIndex.set(best.t.id, index);
    ctx.prev = best.t.id;
    return { trackId: best.t.id, fromLineId: fromId, toLineId: toId, mood: s.mood, offsetMs: 0, locked: false, reason: best.reason };
  });
}
