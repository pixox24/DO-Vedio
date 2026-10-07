import { anchorMs, sortShots, type LineTime } from "./shots";
import type { MotionProfile } from "./motion";
import type { Line, Shot, AnimationSpec } from "./types";

const transitionKinds = new Set(["fade", "wipe", "whip", "push", "dissolve"]);

function normalizeAnchors(spec: AnimationSpec, shot: Shot, next: Shot | undefined, times: Map<string, LineTime>) {
  const start = anchorMs(shot.at, times) ?? 0;
  const end = next ? anchorMs(next.at, times) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
  const seenEnter = new Set<string>();
  return spec.anchors
    .map((anchor) => ({ anchor, ms: anchorMs({ lineId: anchor.lineId, char: anchor.char }, times) }))
    .filter(({ anchor, ms }) => ms !== undefined && ms >= start && ms < end && times.has(anchor.lineId))
    .sort((a, b) => (a.ms! - b.ms!) || a.anchor.char - b.anchor.char)
    .map(({ anchor }) => anchor)
    .filter((anchor) => {
      if (anchor.role !== "enter" || !anchor.target) return true;
      if (seenEnter.has(anchor.target)) return false;
      seenEnter.add(anchor.target);
      return true;
    });
}

/**
 * 规范化镜头上的锚点和转场。
 * 不再把缺省动画补成旧的编辑式家族，运镜保留给生成画面。
 */
export function normalizeAnimation(
  shots: Shot[],
  lines: Line[],
  times: Map<string, LineTime>,
  _profile: MotionProfile,
): Shot[] {
  void _profile;
  if (shots.length === 0 || lines.length === 0) return [];
  const sorted = sortShots(shots, lines);
  const normalized = sorted.map((shot, index) => {
    if (!shot.animation) return shot;
    const next = sorted[index + 1];
    const spec: AnimationSpec = { ...shot.animation, anchors: [...shot.animation.anchors], params: { ...shot.animation.params } };
    return { ...shot, animation: { ...spec, anchors: normalizeAnchors(spec, shot, next, times) } };
  });

  // 相邻转场重复时，第二个转场改为 cut。
  for (let i = 1; i < normalized.length; i++) {
    const previous = normalized[i - 1].transitionIn;
    const current = normalized[i].transitionIn;
    if (current && previous === current && transitionKinds.has(current)) normalized[i] = { ...normalized[i], transitionIn: "cut" };
  }

  // 十秒窗口内最多两个高强度镜头，超出的镜头逐级降档。
  for (let i = 0; i < normalized.length; i++) {
    if ((normalized[i].animation?.intensity ?? 1) < 2) continue;
    const start = anchorMs(normalized[i].at, times) ?? 0;
    const count = normalized.slice(0, i).filter((shot) => (shot.animation?.intensity ?? 1) >= 2 && start - (anchorMs(shot.at, times) ?? 0) < 10_000).length;
    if (count >= 2) normalized[i] = { ...normalized[i], animation: { ...normalized[i].animation!, intensity: Math.max(1, normalized[i].animation!.intensity - 1) as 1 | 2 | 3 } };
  }

  // 三十秒窗口必须有留白；把窗口内最后一个有配方的镜头降到强度 1。
  for (let i = 0; i < normalized.length; i++) {
    const start = anchorMs(normalized[i].at, times) ?? 0;
    const end = start + 30_000;
    const inWindow = normalized.filter((shot) => {
      const at = anchorMs(shot.at, times) ?? 0;
      return at >= start && at <= end;
    });
    if (inWindow.length && !inWindow.some((shot) => (shot.animation?.intensity ?? 1) === 1)) {
      const last = inWindow[inWindow.length - 1];
      if (!last.animation) continue;
      const k = normalized.indexOf(last);
      normalized[k] = { ...last, animation: { ...last.animation, intensity: 1 } };
    }
  }
  return normalized;
}
