import { describe, expect, it } from "vitest";
import { interpolate } from "remotion";
import { legacyTemplateIds } from "@/lib/core/types";
import { cardTemplateRenderers, particleOpacityRange } from "./legacy-templates";

describe("卡片模板渲染器", () => {
  it("每一张登记过的模板都有渲染器", () => {
    expect(Object.keys(cardTemplateRenderers).sort()).toEqual([...legacyTemplateIds].sort());
    for (const id of legacyTemplateIds) expect(cardTemplateRenderers[id]).toBeTypeOf("function");
  });

  it("短镜头的粒子透明度区间严格递增", () => {
    const crashed = particleOpacityRange(51, 33);
    expect(crashed[0]).toBeCloseTo(33);
    expect(crashed[3]).toBe(51);
    expect(() => interpolate(40, crashed, [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })).not.toThrow();

    const lastDelay = 119 * 0.3;
    for (let duration = 1; duration <= 90; duration++) {
      for (const delay of [0, 33, lastDelay, duration + 20]) {
        const range = particleOpacityRange(duration, delay);
        expect(range[0]).toBeGreaterThanOrEqual(0);
        expect(range[3]).toBeLessThanOrEqual(Math.max(1, duration));
        for (let i = 1; i < range.length; i++) expect(range[i]).toBeGreaterThan(range[i - 1]!);
        expect(() => interpolate(0, range, [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })).not.toThrow();
      }
    }
  });

  it("够长的镜头仍按原淡入淡出时间", () => {
    expect(particleOpacityRange(300, 0)).toEqual([0, 8, 290, 300]);
    expect(particleOpacityRange(300, 35.7)).toEqual([35.7, 43.7, 290, 300]);
    expect(particleOpacityRange(51, 0)).toEqual([0, 8, 41, 51]);
  });
});
