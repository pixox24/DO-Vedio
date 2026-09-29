import { strongEnd } from "../core/blocks";
import { pcmToWav } from "../providers/tts/types";

/**
 * 段落音频 → 单句（纯函数，服务端用）。
 * 有字级时间戳时按时间戳找句界，再用能量最低点微调切点；没有时间戳时（Gemini）
 * 用静音检测找候选停顿，按字数比例推算的预期位置做动态规划，挑出 N−1 个句界。
 */

export type Wav = { pcm: Int16Array; sampleRate: number };

/** 解析 16bit PCM WAV；多声道取平均。流式接口写出的 data 长度可能是 0 或 0xFFFFFFFF，按剩余字节处理 */
export function decodeWav(buf: Buffer): Wav {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("不是 WAV 音频");
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(start + 2);
      sampleRate = buf.readUInt32LE(start + 4);
      bits = buf.readUInt16LE(start + 14);
    } else if (id === "data") {
      if (bits !== 16 || !channels || !sampleRate) throw new Error("只支持 16bit PCM WAV");
      const end = size === 0 || start + size > buf.length ? buf.length : start + size;
      const frames = Math.floor((end - start) / (2 * channels));
      const pcm = new Int16Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += buf.readInt16LE(start + (f * channels + c) * 2);
        pcm[f] = Math.round(sum / channels);
      }
      return { pcm, sampleRate };
    }
    offset = start + size + (size % 2);
  }
  throw new Error("WAV 缺少 data 块");
}

export function encodeWav(w: Wav): Buffer {
  return pcmToWav(Buffer.from(w.pcm.buffer, w.pcm.byteOffset, w.pcm.byteLength), w.sampleRate);
}

export const durationMsOf = (w: Wav) => (w.pcm.length / w.sampleRate) * 1000;

/** 截取 [fromMs, toMs)，两端做几毫秒淡入淡出防止爆音 */
export function sliceWav(w: Wav, fromMs: number, toMs: number, fadeMs = 8): Wav {
  const a = Math.max(0, Math.round((fromMs / 1000) * w.sampleRate));
  const b = Math.min(w.pcm.length, Math.round((toMs / 1000) * w.sampleRate));
  const pcm = w.pcm.slice(a, Math.max(a, b));
  const fade = Math.min(Math.floor(pcm.length / 2), Math.round((fadeMs / 1000) * w.sampleRate));
  for (let k = 0; k < fade; k++) {
    const g = k / fade;
    pcm[k] = Math.round(pcm[k] * g);
    pcm[pcm.length - 1 - k] = Math.round(pcm[pcm.length - 1 - k] * g);
  }
  return { pcm, sampleRate: w.sampleRate };
}

// ---------- 能量与静音 ----------

export const FRAME_MS = 10;

/** 每 10ms 一帧的 RMS 电平（dBFS） */
export function frameDb(w: Wav, frameMs = FRAME_MS): Float32Array {
  const n = Math.max(1, Math.round((frameMs / 1000) * w.sampleRate));
  const out = new Float32Array(Math.ceil(w.pcm.length / n));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    const end = Math.min(w.pcm.length, (f + 1) * n);
    for (let i = f * n; i < end; i++) sum += w.pcm[i] * w.pcm[i];
    const rms = Math.sqrt(sum / Math.max(1, end - f * n)) / 32768;
    out[f] = 20 * Math.log10(Math.max(rms, 1e-6));
  }
  return out;
}

function percentile(values: Float32Array, p: number) {
  if (!values.length) return -120;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** 语音/静音阈值：随整段响度自适应，夹在 [-65, -30] dBFS */
export function silenceThreshold(db: Float32Array) {
  return Math.min(-30, Math.max(-65, Math.max(percentile(db, 0.1) + 10, percentile(db, 0.9) - 28)));
}

export type Silence = { startMs: number; endMs: number };

/** 连续低于阈值且不短于 minMs 的区间 */
export function findSilences(db: Float32Array, opts: { thresholdDb?: number; minMs?: number; frameMs?: number } = {}): Silence[] {
  const frameMs = opts.frameMs ?? FRAME_MS;
  const thr = opts.thresholdDb ?? silenceThreshold(db);
  const minFrames = Math.ceil((opts.minMs ?? 120) / frameMs);
  const out: Silence[] = [];
  let from = -1;
  for (let f = 0; f <= db.length; f++) {
    const quiet = f < db.length && db[f] < thr;
    if (quiet && from < 0) from = f;
    if (!quiet && from >= 0) {
      if (f - from >= minFrames) out.push({ startMs: from * frameMs, endMs: f * frameMs });
      from = -1;
    }
  }
  return out;
}

/** 整段有效语音区间（首个到最后一个高于阈值的帧） */
export function speechBounds(db: Float32Array, thr = silenceThreshold(db), frameMs = FRAME_MS) {
  let a = 0;
  let b = db.length - 1;
  while (a < db.length && db[a] < thr) a++;
  while (b > a && db[b] < thr) b--;
  return a >= db.length ? { startMs: 0, endMs: 0 } : { startMs: a * frameMs, endMs: (b + 1) * frameMs };
}

/** 区间内能量最低的帧中心 */
function quietestMs(db: Float32Array, fromMs: number, toMs: number, frameMs = FRAME_MS) {
  const a = Math.max(0, Math.floor(fromMs / frameMs));
  const b = Math.min(db.length - 1, Math.ceil(toMs / frameMs));
  let best = a;
  for (let f = a; f <= b; f++) if (db[f] < db[best]) best = f;
  return best * frameMs + frameMs / 2;
}

// ---------- 句界 ----------

export type SplitLine = {
  /** 本句有效语音区间（段落音频内的毫秒） */
  startMs: number;
  endMs: number;
  /** 本句切片范围：相邻两句共用一个切点 */
  cutStartMs: number;
  cutEndMs: number;
};
export type SplitBoundary = { cutMs: number; gapMs: number; confidence: number };
export type SplitResult = { lines: SplitLine[]; boundaries: SplitBoundary[]; confidence: number; source: "provider" | "vad" };

function assemble(bounds: { startMs: number; endMs: number }, durationMs: number, boundaries: (SplitBoundary & { prevEndMs: number; nextStartMs: number })[], source: SplitResult["source"]): SplitResult {
  const lines: SplitLine[] = [];
  for (let k = 0; k <= boundaries.length; k++) {
    const prev = boundaries[k - 1];
    const next = boundaries[k];
    const startMs = prev ? prev.nextStartMs : bounds.startMs;
    const endMs = next ? next.prevEndMs : bounds.endMs;
    lines.push({ startMs, endMs: Math.max(startMs + 1, endMs), cutStartMs: prev ? prev.cutMs : 0, cutEndMs: next ? next.cutMs : durationMs });
  }
  const clean = boundaries.map(({ cutMs, gapMs, confidence }) => ({ cutMs, gapMs, confidence }));
  return { lines, boundaries: clean, confidence: clean.length ? Math.min(...clean.map((b) => b.confidence)) : 1, source };
}

/**
 * 有时间戳：lineTimes 为每句首字开始、末字结束（段落音频内毫秒）。
 * 句界附近若有静音，以静音为准（时间戳常把尾音算短）；否则切在能量最低处。
 */
export function splitByTimestamps(db: Float32Array, lineTimes: { startMs: number; endMs: number }[], durationMs: number): SplitResult {
  const thr = silenceThreshold(db);
  const silences = findSilences(db, { thresholdDb: thr, minMs: 60 });
  const bounds = speechBounds(db, thr);
  const boundaries = lineTimes.slice(0, -1).map((cur, k) => {
    const next = lineTimes[k + 1];
    const from = Math.min(cur.endMs, next.startMs) - 80;
    const to = Math.max(cur.endMs, next.startMs) + 80;
    const hit = silences.filter((s) => s.endMs > from && s.startMs < to).sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))[0];
    if (hit) return { cutMs: (hit.startMs + hit.endMs) / 2, gapMs: hit.endMs - hit.startMs, confidence: 1, prevEndMs: hit.startMs, nextStartMs: hit.endMs };
    const cutMs = quietestMs(db, from, to);
    return { cutMs, gapMs: 0, confidence: 0.6, prevEndMs: cutMs, nextStartMs: cutMs };
  });
  return assemble(bounds, durationMs, boundaries, "provider");
}

/** 切分用的句子描述：有效字数、是否句末强停顿、句内可能停顿的位置（逗号等之前的有效字数） */
export type SilenceLine = { chars: number; strongEnd: boolean; pauses?: number[] };

export function silenceLine(text: string): SilenceLine {
  const pauses: number[] = [];
  let n = 0;
  const chars = [...text];
  chars.forEach((ch, k) => {
    if (/[，,、：:；;—…]/.test(ch) && n > 0 && chars.slice(k + 1).some((c) => !/[\s\p{P}\p{S}]/u.test(c))) {
      if (pauses[pauses.length - 1] !== n) pauses.push(n);
    } else if (!/[\s\p{P}\p{S}]/u.test(ch)) n++;
  });
  return { chars: n, strongEnd: strongEnd(text), pauses };
}

/**
 * 无时间戳：把静音候选按顺序对齐到「停顿槽」上，取句末槽作为句界。
 * 停顿槽 = 每句句末（必须分到一个静音）+ 句内逗号处（可以分到静音，也可以没有停顿）。
 * 句内槽的作用：朗读时逗号处常有比句间更长的戏剧性停顿（如「他说，……继续。」），
 * 让它被句内槽「吸收」，句末槽才不会被抢到错误的位置。
 * 代价 = 与预期位置的偏差² + 停顿偏短的惩罚；句内槽不停顿有小额代价。
 * 预期位置在「只计有声帧」的时间轴上按字数比例估算：停顿长短不会把后面的预期位置整体推后。
 */
export function splitBySilence(db: Float32Array, lines: SilenceLine[], durationMs: number): SplitResult {
  const thr = silenceThreshold(db);
  const bounds = speechBounds(db, thr);
  const K = lines.length - 1;
  if (K <= 0) return assemble(bounds, durationMs, [], "vad");
  const cands = findSilences(db, { thresholdDb: thr, minMs: 80 }).filter((s) => s.startMs > bounds.startMs && s.endMs < bounds.endMs);
  const total = Math.max(1, lines.reduce((s, l) => s + Math.max(1, l.chars), 0));
  // voiced[f]：第 f 帧之前累计的有声时长（毫秒）
  const voiced = new Float64Array(db.length + 1);
  for (let f = 0; f < db.length; f++) voiced[f + 1] = voiced[f] + (db[f] >= thr ? FRAME_MS : 0);
  const span = Math.max(1, voiced[db.length]);
  const voicedAt = (ms: number) => voiced[Math.min(db.length, Math.max(0, Math.floor(ms / FRAME_MS)))];
  /** 有声时长 → 真实时间（用于停顿不够时硬切） */
  const wallAt = (v: number) => {
    let f = 0;
    while (f < db.length && voiced[f + 1] < v) f++;
    return f * FRAME_MS;
  };
  const at = (chars: number) => (span * chars) / total;
  // 停顿槽：句内（可选）与句末（必选，最后一句除外）
  type Slot = { expected: number; line: number; end: boolean; refLen: number };
  const slots: Slot[] = [];
  let cum = 0;
  lines.forEach((l, k) => {
    for (const p of l.pauses ?? []) if (p > 0 && p < l.chars) slots.push({ expected: at(cum + p), line: k, end: false, refLen: 120 });
    cum += Math.max(1, l.chars);
    if (k < K) slots.push({ expected: at(cum), line: k, end: true, refLen: l.strongEnd ? 250 : 120 });
  });
  const expectedEnds = slots.filter((x) => x.end).map((x) => x.expected);
  const avgLine = span / lines.length;
  const center = (s: Silence) => (s.startMs + s.endMs) / 2;
  const pos = (s: Silence) => voicedAt(s.startMs);

  if (cands.length < K) {
    // 停顿不够：按预期位置附近的能量最低点硬切，置信度记为 0，交给上层降级
    const boundaries = expectedEnds.map((e) => {
      const cutMs = quietestMs(db, wallAt(e) - 400, wallAt(e) + 400);
      return { cutMs, gapMs: 0, confidence: 0, prevEndMs: cutMs, nextStartMs: cutMs };
    });
    return assemble(bounds, durationMs, boundaries, "vad");
  }

  const SKIP_SLOT = 0.4;
  const assign = (slot: Slot, s: Silence) => ((pos(s) - slot.expected) / span * 10) ** 2 + (slot.end ? 1 : 0.2) * Math.min(3, slot.refLen / (s.endMs - s.startMs));
  // dp[i][j]：前 i 个停顿槽用掉前 j 个静音候选的最小代价；静音可以不分给任何槽（换气、强调），句内槽可以不停顿
  const S = slots.length;
  const M = cands.length;
  const dp = Array.from({ length: S + 1 }, () => new Float64Array(M + 1).fill(Infinity));
  const move = Array.from({ length: S + 1 }, () => new Int8Array(M + 1));
  dp[0][0] = 0;
  for (let i = 0; i <= S; i++)
    for (let j = 0; j <= M; j++) {
      const cur = dp[i][j];
      if (cur === Infinity) continue;
      if (j < M && cur < dp[i][j + 1]) {
        dp[i][j + 1] = cur;
        move[i][j + 1] = 1; // 跳过这个静音
      }
      if (i < S && !slots[i].end && cur + SKIP_SLOT < dp[i + 1][j]) {
        dp[i + 1][j] = cur + SKIP_SLOT;
        move[i + 1][j] = 2; // 句内槽不停顿
      }
      if (i < S && j < M) {
        const c = cur + assign(slots[i], cands[j]);
        if (c < dp[i + 1][j + 1]) {
          dp[i + 1][j + 1] = c;
          move[i + 1][j + 1] = 3; // 槽 i 用静音 j
        }
      }
    }
  const pickedBySlot = new Array<number>(S).fill(-1);
  for (let i = S, j = M; i > 0 || j > 0; ) {
    const m = move[i][j];
    if (m === 1) j--;
    else if (m === 2) i--;
    else {
      pickedBySlot[i - 1] = j - 1;
      i--;
      j--;
    }
  }
  const endSlots = slots.map((slot, i) => ({ slot, idx: pickedBySlot[i] })).filter((x) => x.slot.end);
  const boundaries = endSlots.map(({ slot, idx }) => {
    const s = cands[idx];
    const gapMs = s.endMs - s.startMs;
    const dev = Math.abs(pos(s) - slot.expected) / (0.5 * avgLine);
    const confidence = Math.max(0, Math.min(1, 1 - dev)) * Math.min(1, gapMs / slot.refLen);
    return { cutMs: center(s), gapMs, confidence: Math.round(confidence * 100) / 100, prevEndMs: s.startMs, nextStartMs: s.endMs };
  });
  return assemble(bounds, durationMs, boundaries, "vad");
}
