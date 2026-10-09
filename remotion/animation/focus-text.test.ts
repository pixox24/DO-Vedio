import { describe, expect, it } from "vitest";
import { interpolate } from "remotion";
import { focusCounterValue, focusFadeRange, isFocusTextShot } from "./focus-text";
import type { TimelineShot } from "@/lib/core/timeline";

describe("重点文字动效", () => {
  it("短镜头不会产生倒序区间，最后一帧完成退场", () => {
    for (let duration = 1; duration <= 90; duration++) {
      const range = focusFadeRange(duration);
      for (let i = 1; i < range.length; i++) expect(range[i]).toBeGreaterThan(range[i - 1]);
      expect(() => interpolate(0, range, [0, 1, 1, 0])).not.toThrow();
      if (duration > 1) expect(interpolate(duration - 1, range, [0, 1, 1, 0])).toBe(0);
    }
  });
  it("百分比从 0 递增到原数值，年份、电话和观点数字保持原值", () => {
    expect(focusCounterValue("85%", 0)).toBe("0%");
    expect(focusCounterValue("85%", .5)).toBe("43%");
    expect(focusCounterValue("85%", 1)).toBe("85%");
    expect(focusCounterValue("2.5倍", .5)).toBe("1.3倍");
    expect(focusCounterValue("2024", .5)).toBe("2024");
    expect(focusCounterValue("第3次", .5)).toBe("第3次");
  });
  it("旧章节与金句也使用统一渲染入口", () => {
    expect(isFocusTextShot({ kind: "title", focusText: { text: "方向" } } as TimelineShot)).toBe(true);
    expect(isFocusTextShot({ kind: "image", mode: "generate", focusText: { text: "方向" } } as TimelineShot)).toBe(false);
  });
});
