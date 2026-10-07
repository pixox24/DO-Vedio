import { describe, expect, it } from "vitest";
import { defaultMotionProfile } from "./motion";
import { normalizeAnimation } from "./animation";
import { blankShot } from "./shots";
import type { Line, Shot } from "./types";

const lines: Line[] = [
  { id: "a", segmentIndex: 0, text: "数字十三亿。", spans: [], keywords: [], locked: false },
  { id: "b", segmentIndex: 0, text: "第二句。", spans: [], keywords: [], locked: false },
  { id: "c", segmentIndex: 0, text: "第三句。", spans: [], keywords: [], locked: false },
];
const times = new Map(lines.map((line, index) => [line.id, { id: line.id, startMs: index * 10_000, endMs: index * 10_000 + 9_000, chars: [...line.text].map((_, char) => ({ i: char, startMs: index * 10_000 + char * 500, endMs: index * 10_000 + (char + 1) * 500 })) }]));
const shot = (id: string, lineId: string, animation: Shot["animation"]): Shot => ({ ...blankShot(id, lineId), animation });

describe("normalizeAnimation", () => {
  it("空镜头表和无效锚点保持为空", () => {
    expect(normalizeAnimation([], lines, times, defaultMotionProfile)).toEqual([]);
    const result = normalizeAnimation([shot("a", "a", { family: "editorial", intensity: 1, anchors: [{ lineId: "missing", char: 0, role: "enter", target: "x" }], params: {} })], lines, times, defaultMotionProfile);
    expect(result[0].animation?.anchors).toEqual([]);
  });

  it("按时间排序锚点，并为同一 target 只保留最早 enter", () => {
    const result = normalizeAnimation([
      shot("a", "a", { family: "editorial", intensity: 1, anchors: [
        { lineId: "a", char: 3, role: "emphasis", target: "value" },
        { lineId: "a", char: 2, role: "enter", target: "value" },
        { lineId: "a", char: 0, role: "enter", target: "value" },
      ], params: {} }),
      shot("b", "b", { family: "none", intensity: 1, anchors: [], params: {} }),
    ], lines, times, defaultMotionProfile);
    expect(result[0].animation?.anchors.map((anchor) => anchor.char)).toEqual([0, 3]);
  });

  it("没有动画配方时保留运镜，不再补成旧家族", () => {
    const result = normalizeAnimation([{ ...blankShot("a", "a"), motion: "zoom-in" }], lines, times, defaultMotionProfile);
    expect(result[0].animation).toBeUndefined();
    expect(result[0].motion).toBe("zoom-in");
  });

  it("相邻重复转场改为 cut", () => {
    const result = normalizeAnimation([
      { ...shot("a", "a", { family: "none", intensity: 1, anchors: [], params: {} }), transitionIn: "fade" },
      { ...shot("b", "b", { family: "none", intensity: 1, anchors: [], params: {} }), transitionIn: "fade" },
    ], lines, times, defaultMotionProfile);
    expect(result.map((item) => item.transitionIn)).toEqual(["fade", "cut"]);
  });

  it("十秒窗口最多两个高强度镜头，且窗口内保留留白", () => {
    const denseTimes = new Map([...times].map(([id, value], index) => [id, { ...value, startMs: index * 4_000, endMs: index * 4_000 + 3_000, chars: value.chars.map((char) => ({ ...char, startMs: index * 4_000 + char.i * 150, endMs: index * 4_000 + (char.i + 1) * 150 })) }]));
    const result = normalizeAnimation(["a", "b", "c"].map((id) => shot(id, id, { family: "editorial", intensity: 3, anchors: [], params: {} })), lines, denseTimes, defaultMotionProfile);
    expect(result[2].animation?.intensity).toBeLessThanOrEqual(2);
    expect(result.some((item) => item.animation?.intensity === 1)).toBe(true);
  });

});
