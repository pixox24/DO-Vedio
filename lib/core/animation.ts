import { anchorMs, sortShots, type LineTime } from "./shots";
import type { MotionProfile } from "./motion";
import type { Line, Shot, AnimationFamily, AnimationSpec } from "./types";

const transitionKinds = new Set(["fade", "wipe", "whip", "push", "dissolve"]);
const textFamilies = new Set<AnimationFamily>(["stat", "kinetic", "compare"]);

const legacyFamily = (motion: Shot["motion"]): AnimationFamily => motion === "none" ? "none" : "editorial";
const bare = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, "");
const specOf = (shot: Shot): AnimationSpec => {
  if (shot.animation) return { ...shot.animation, anchors: [...shot.animation.anchors], params: { ...shot.animation.params } };
  return { family: legacyFamily(shot.motion), intensity: 1, anchors: [], params: {} };
};

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

function captionFor(shot: Shot, lines: Line[], next: Shot | undefined) {
  const order = new Map(lines.map((line, index) => [line.id, index]));
  const from = order.get(shot.at.lineId);
  const to = next ? order.get(next.at.lineId) : lines.length;
  if (from === undefined) return "";
  return lines.slice(from, Math.max(from + 1, to ?? lines.length)).map((line) => line.text).join("");
}

/**
 * 规范化模型产出的动画配方。所有规则都是纯函数，渲染层只接收规范化后的结果。
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
    const next = sorted[index + 1];
    const spec = specOf(shot);
    const anchors = normalizeAnchors(spec, shot, next, times);
    const caption = captionFor(shot, lines, next);
    const output = Object.values(spec.params).some((value) => typeof value === "string" && textFamilies.has(spec.family) && bare(value) && bare(value) === bare(caption));
    const clean: AnimationSpec = output ? { family: "none", intensity: 1, anchors: [], params: {} } : { ...spec, anchors };
    const motion = shot.animation ? shot.motion : "none";
    return { ...shot, animation: clean, motion };
  });

  // 连续三个同 family 时，第三个退回克制的 none。
  for (let i = 2; i < normalized.length; i++) {
    const a = normalized[i - 2].animation!;
    const b = normalized[i - 1].animation!;
    const c = normalized[i].animation!;
    if (a.family !== "none" && a.family === b.family && b.family === c.family) normalized[i] = { ...normalized[i], animation: { ...c, family: "none", intensity: 1, anchors: [], params: {} } };
  }

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

  // HUD 的发光/闪烁只允许少量出现，避免连续镜头变成高频噪声。
  let hudCount = 0;
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i].animation?.family !== "hud") continue;
    hudCount++;
    if (hudCount > 2) normalized[i] = { ...normalized[i], animation: { ...normalized[i].animation!, intensity: 1 } };
  }

  // 三十秒窗口必须有留白；把窗口内最后一个镜头降到强度 1。
  for (let i = 0; i < normalized.length; i++) {
    const start = anchorMs(normalized[i].at, times) ?? 0;
    const end = start + 30_000;
    const inWindow = normalized.filter((shot) => {
      const at = anchorMs(shot.at, times) ?? 0;
      return at >= start && at <= end;
    });
    if (inWindow.length && !inWindow.some((shot) => (shot.animation?.intensity ?? 1) === 1)) {
      const last = inWindow[inWindow.length - 1];
      const k = normalized.indexOf(last);
      normalized[k] = { ...last, animation: { ...last.animation!, intensity: 1 } };
    }
  }
  return normalized;
}
