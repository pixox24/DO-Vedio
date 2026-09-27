import { splitShotSize } from "./cards";
import { quickHash } from "./hash";
import { motions, type Line, type Motion, type Shot } from "./types";

/**
 * 分镜规则 —— 纯函数。大模型决定「拍什么」，这里决定「节奏」：
 * - 镜头连续覆盖整条时间轴，每个镜头只存起点（锚在某句第几个字）
 * - 镜头切在句子边界；过短合并、过长在句内逗号处拆开（拆出的镜头换景别）
 * - 开场 15 秒镜头更快
 * - 静态画面必须运镜，相邻镜头不用同一种运镜
 * - 锁定的镜头不动
 */

export const SHOT_RULES = { minMs: 1500, maxMs: 6000, openingMs: 15000, openingMaxMs: 3500 };

/** 句子在时间轴上的位置（由 timeline 算出） */
export type LineTime = { id: string; startMs: number; endMs: number; chars: { i: number; startMs: number; endMs: number }[] };

/** 锚点 → 毫秒 */
export function anchorMs(at: Shot["at"], times: Map<string, LineTime>): number | undefined {
  const t = times.get(at.lineId);
  if (!t) return undefined;
  if (at.char <= 0) return t.startMs;
  const c = t.chars.find((x) => x.i >= at.char);
  return c ? c.startMs : t.startMs;
}

/** 镜头覆盖的句子（从起点所在句到下一镜头之前） */
export function shotLineIds(shots: Shot[], lines: Line[]): Map<string, string[]> {
  const order = new Map(lines.map((l, k) => [l.id, k]));
  const sorted = sortShots(shots, lines);
  const out = new Map<string, string[]>();
  sorted.forEach((s, k) => {
    const from = order.get(s.at.lineId) ?? 0;
    const next = sorted[k + 1];
    const nextIdx = next ? (order.get(next.at.lineId) ?? lines.length) : lines.length;
    const to = next && next.at.char === 0 ? nextIdx - 1 : Math.min(nextIdx, lines.length - 1);
    out.set(s.id, lines.slice(from, Math.max(from, to) + 1).map((l) => l.id));
  });
  return out;
}

export function sortShots(shots: Shot[], lines: Line[]) {
  const order = new Map(lines.map((l, k) => [l.id, k]));
  return shots.filter((s) => order.has(s.at.lineId)).sort((a, b) => order.get(a.at.lineId)! - order.get(b.at.lineId)! || a.at.char - b.at.char);
}

export function sourceHashOf(lineIds: string[], lines: Line[]) {
  const byId = new Map(lines.map((l) => [l.id, l.text]));
  return quickHash(lineIds.map((id) => byId.get(id) ?? ""));
}

/**
 * 句子变化后修复镜头：锚点所在句被删的镜头移到下一句；同一位置只留一个；
 * 返回过期（覆盖范围内文本变了）的镜头 ID。
 */
export function repairShots(shots: Shot[], prevLines: Pick<Line, "id">[], lines: Line[]): { shots: Shot[]; stale: Set<string> } {
  const alive = new Set(lines.map((l) => l.id));
  const prevOrder = prevLines.map((l) => l.id);
  const moved = shots
    .map((s) => {
      if (alive.has(s.at.lineId)) return s;
      // 找旧顺序里之后第一个仍存在的句子
      const k = prevOrder.indexOf(s.at.lineId);
      const next = k >= 0 ? prevOrder.slice(k + 1).find((id) => alive.has(id)) : undefined;
      return next ? { ...s, at: { lineId: next, char: 0 } } : null;
    })
    .filter((s): s is Shot => !!s);
  const seen = new Set<string>();
  const dedup = sortShots(moved, lines).filter((s) => {
    const k = `${s.at.lineId}:${s.at.char}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (dedup.length && lines.length && dedup[0].at.lineId !== lines[0].id) dedup[0] = { ...dedup[0], at: { lineId: lines[0].id, char: 0 } };
  const covers = shotLineIds(dedup, lines);
  const stale = new Set(dedup.filter((s) => !s.locked && s.sourceHash !== sourceHashOf(covers.get(s.id) ?? [], lines)).map((s) => s.id));
  return { shots: dedup, stale };
}

/** 句内按逗号的切分点（原文下标），用于拆长镜头 */
function softCuts(line: Line): number[] {
  const out: number[] = [];
  for (const m of line.text.matchAll(/[，,；;：:、—]+/g)) {
    const i = m.index! + m[0].length;
    if (i > 2 && i < line.text.length - 2) out.push(i);
  }
  return out;
}

const pickMotion = (prev: Motion | undefined, k: number): Motion => {
  const pool = motions.filter((m) => m !== "none" && m !== prev);
  return pool[k % pool.length];
};

/**
 * 节奏规范化。newId 生成新镜头 ID。
 * 输入的镜头可能来自大模型或上一次结果；输出满足全部规则。
 */
export function normalizeShots(shots: Shot[], lines: Line[], times: Map<string, LineTime>, totalMs: number, newId: () => string): Shot[] {
  if (lines.length === 0) return [];
  const list = sortShots(shots, lines);
  if (list.length === 0 || list[0].at.lineId !== lines[0].id || list[0].at.char !== 0) {
    if (list.length && !list[0].locked && anchorMs(list[0].at, times)! < SHOT_RULES.minMs) list[0] = { ...list[0], at: { lineId: lines[0].id, char: 0 } };
    else list.unshift(blankShot(newId(), lines[0].id));
  }

  const startOf = (s: Shot) => anchorMs(s.at, times) ?? 0;
  const endOf = (k: number, l: Shot[]) => (k + 1 < l.length ? startOf(l[k + 1]) : totalMs);

  // 1) 合并过短：短镜头默认并入前一个（前一个延长）；第一个镜头太短时吞掉下一个；
  //    前一个锁定时，改为把后一个镜头提前到这里。锁定的镜头自身不删除
  for (let pass = 0; pass < list.length + 2; pass++) {
    let changed = false;
    for (let k = 0; k < list.length && list.length > 1; k++) {
      const s = list[k];
      if (endOf(k, list) - startOf(s) >= SHOT_RULES.minMs) continue;
      const prev = list[k - 1];
      const next = list[k + 1];
      if (k === 0 || s.locked) {
        // 保留当前镜头，删掉下一个起点让它延长
        if (next && !next.locked) {
          list.splice(k + 1, 1);
          changed = true;
        }
      } else if (!prev.locked) {
        list.splice(k, 1);
        changed = true;
      } else if (next && !next.locked) {
        list[k + 1] = { ...next, at: s.at };
        list.splice(k, 1);
        changed = true;
      }
      if (changed) break;
    }
    if (!changed) break;
  }

  // 2) 拆过长：在句子边界或句内逗号处插入新镜头（继承原镜头的描述，换运镜）
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const out: Shot[] = [];
  for (let k = 0; k < list.length; k++) {
    const s = list[k];
    out.push(s);
    const start = startOf(s);
    const end = endOf(k, list);
    const limit = start < SHOT_RULES.openingMs ? SHOT_RULES.openingMaxMs : SHOT_RULES.maxMs;
    if (end - start <= limit || s.locked || s.kind === "title") continue;
    // 候选切点：范围内所有句首和逗号处
    const cands: { at: Shot["at"]; ms: number }[] = [];
    for (const l of lines) {
      const t = times.get(l.id);
      if (!t || t.endMs <= start || t.startMs >= end) continue;
      if (t.startMs > start) cands.push({ at: { lineId: l.id, char: 0 }, ms: t.startMs });
      for (const c of softCuts(lineById.get(l.id)!)) {
        const ms = anchorMs({ lineId: l.id, char: c }, times)!;
        if (ms > start && ms < end) cands.push({ at: { lineId: l.id, char: c }, ms });
      }
    }
    cands.sort((a, b) => a.ms - b.ms);
    let cursor = start;
    let splitK = 0;
    while (end - cursor > limit) {
      const target = cursor + Math.min(limit, (end - cursor) / Math.ceil((end - cursor) / limit));
      // 选离目标最近、且两边都不短于最短时长的切点；句首优先（加 400ms 偏好）
      const all = cands.filter((c) => c.ms - cursor >= SHOT_RULES.minMs && end - c.ms >= SHOT_RULES.minMs && c.ms > cursor);
      // 优先不超过上限的切点；都超了才退而求其次
      const within = all.filter((c) => c.ms - cursor <= limit);
      const ok = within.length ? within : all;
      if (ok.length === 0) break;
      const best = ok.reduce((a, b) => (Math.abs(b.ms - target) - (b.at.char === 0 ? 400 : 0) < Math.abs(a.ms - target) - (a.at.char === 0 ? 400 : 0) ? b : a));
      // 拆出来的镜头：同一主体换景别；信息卡数据属于原镜头，新镜头按自己覆盖的旁白兜底
      const k2 = ++splitK;
      const child: Shot = { ...s, id: newId(), at: best.at, motion: pickMotion(s.motion, k2), locked: false, kind: s.kind === "upload" && !s.assetId ? "placeholder" : s.kind, onScreenText: s.kind === "quote" ? undefined : s.onScreenText, card: undefined };
      if (s.kind === "quote") Object.assign(child, { kind: "placeholder", mode: "motion" });
      if (child.mode !== "motion") child.shotSize = splitShotSize(s.shotSize, k2);
      out.push(child);
      cursor = best.ms;
    }
  }

  // 3) 运镜：静态画面必须运镜，相邻不同
  let prev: Motion | undefined;
  return out.map((s, k) => {
    let motion = s.motion;
    if (!s.locked && (motion === "none" || motion === prev) && s.kind !== "title") motion = pickMotion(prev, k);
    prev = motion;
    return motion === s.motion ? s : { ...s, motion };
  });
}

export function blankShot(id: string, lineId: string, char = 0): Shot {
  return { id, at: { lineId, char }, kind: "placeholder", description: "", motion: "zoom-in", importance: 1, referenceAssetIds: [], characterIds: [], candidates: [], sourceHash: "", locked: false };
}

/** 刷新每个镜头的 sourceHash（生成或确认后调用） */
export function stampShots(shots: Shot[], lines: Line[]): Shot[] {
  const covers = shotLineIds(shots, lines);
  return shots.map((s) => ({ ...s, sourceHash: sourceHashOf(covers.get(s.id) ?? [], lines) }));
}
