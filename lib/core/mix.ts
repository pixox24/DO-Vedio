/**
 * 混音包络 —— 纯函数。
 * 自动压低（ducking）不用 FFmpeg 侧链，而是由人声区间直接算出音乐的增益曲线：
 * Remotion 预览和最终渲染用同一条曲线，听到的一模一样。
 */
import type { Ducking } from "./types";

export type Interval = { startMs: number; endMs: number };
/** [毫秒, dB]，线性插值 */
export type Envelope = [number, number][];

/** 合并间隔小于 gapMs 的人声区间 */
export function mergeIntervals(list: Interval[], gapMs: number): Interval[] {
  const sorted = [...list].filter((x) => x.endMs > x.startMs).sort((a, b) => a.startMs - b.startMs);
  const out: Interval[] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && x.startMs - last.endMs < gapMs) last.endMs = Math.max(last.endMs, x.endMs);
    else out.push({ ...x });
  }
  return out;
}

/**
 * 在 [fromMs, toMs] 范围内生成包络：人声时 underVoiceDb，长停顿时 gapDb。
 * 压下（attack）在人声开始前完成，恢复（release）在人声结束后开始。
 */
export function duckEnvelope(voice: Interval[], fromMs: number, toMs: number, d: Ducking): Envelope {
  const blocks = mergeIntervals(voice, d.minGapMs);
  const env: Envelope = [[fromMs, blocks.length && blocks[0].startMs - d.attackMs <= fromMs ? d.underVoiceDb : d.gapDb]];
  for (const b of blocks) {
    const downStart = b.startMs - d.attackMs;
    const upEnd = b.endMs + d.releaseMs;
    if (upEnd < fromMs || downStart > toMs) continue;
    env.push([Math.max(fromMs, downStart), d.gapDb], [Math.max(fromMs, b.startMs), d.underVoiceDb], [Math.min(toMs, b.endMs), d.underVoiceDb], [Math.min(toMs, upEnd), d.gapDb]);
  }
  env.push([toMs, env[env.length - 1][1]]);
  // 去掉时间倒退和重复点
  const clean: Envelope = [];
  for (const p of env) {
    const last = clean[clean.length - 1];
    if (last && p[0] < last[0]) continue;
    if (last && p[0] === last[0]) clean[clean.length - 1] = p;
    else clean.push(p);
  }
  return clean;
}

export function envelopeAt(env: Envelope, ms: number): number {
  if (env.length === 0) return 0;
  if (ms <= env[0][0]) return env[0][1];
  for (let k = 1; k < env.length; k++) {
    const [t1, v1] = env[k];
    if (ms <= t1) {
      const [t0, v0] = env[k - 1];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (ms - t0)) / (t1 - t0);
    }
  }
  return env[env.length - 1][1];
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** 淡入淡出（毫秒，相对片段），返回 0–1 */
export function fadeAt(ms: number, durationMs: number, fadeInMs: number, fadeOutMs: number) {
  const a = fadeInMs > 0 ? Math.min(1, Math.max(0, ms / fadeInMs)) : 1;
  const b = fadeOutMs > 0 ? Math.min(1, Math.max(0, (durationMs - ms) / fadeOutMs)) : 1;
  return Math.min(a, b);
}
