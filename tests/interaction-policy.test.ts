import { describe, expect, it } from "vitest";
import { CONFIRM_POLICY, costLabel, costSuffix, costSuffixAtLeast, needsConfirm } from "../lib/core/interaction";

describe("needsConfirm", () => {
  it("便宜的单次操作不打断", () => {
    expect(needsConfirm({ units: 1, costYuan: 0.004 })).toBe(false);
  });

  it("一个满段落（8 句）不打断——这是保护最高频路径的关键断言", () => {
    // 阈值一旦被改回 8，「重录本段」就会被误拦。这条断言就是防那个的。
    expect(needsConfirm({ units: 8, costYuan: 0.03 })).toBe(false);
  });

  it("达到单元阈值就打断", () => {
    expect(needsConfirm({ units: CONFIRM_POLICY.minUnits, costYuan: 0.001 })).toBe(true);
  });

  it("金额够大、但单元数很少也打断（未来接贵模型时的兜底）", () => {
    expect(needsConfirm({ units: 1, costYuan: 0.6 })).toBe(true);
  });

  it("金额刚好等于阈值就打断", () => {
    expect(needsConfirm({ units: 1, costYuan: CONFIRM_POLICY.minCostYuan })).toBe(true);
  });

  it("无法估算金额时只按单元数裁决", () => {
    expect(needsConfirm({ units: 1, costYuan: null })).toBe(false);
    expect(needsConfirm({ units: 60, costYuan: null })).toBe(true);
  });

  it("一个满段落必须落在阈值下方（不变式）", () => {
    // 段落上限变化时这条会失败，提醒重算 minUnits。
    const oneParagraph = 8;
    expect(oneParagraph).toBeLessThan(CONFIRM_POLICY.minUnits);
  });
});

describe("costLabel", () => {
  it("不足一分显示「不足 ¥0.01」而不是 ¥0.00", () => {
    expect(costLabel(0.004)).toBe("不足 ¥0.01");
  });

  it("可读金额保留两位小数", () => {
    expect(costLabel(0.03)).toBe("约 ¥0.03");
  });

  it("无法估算返回空串，由调用方只显示数量", () => {
    expect(costLabel(null)).toBe("");
  });

  it("0 或负值不显示金额（当作免费/未知）", () => {
    expect(costLabel(0)).toBe("");
    expect(costLabel(-1)).toBe("");
  });

  it("金额刚够阈值按确切数字显示", () => {
    expect(costLabel(CONFIRM_POLICY.readableCostYuan)).toBe("约 ¥0.01");
  });
});

describe("costSuffix", () => {
  it("数量 + 金额", () => {
    expect(costSuffix({ units: 8, unit: "句", costYuan: 0.03 })).toBe("8 句 · 约 ¥0.03");
  });

  it("无单价时只显示数量", () => {
    expect(costSuffix({ units: 3, unit: "张", costYuan: null })).toBe("3 张");
  });

  it("金额过小时显示不足一分", () => {
    expect(costSuffix({ units: 1, unit: "句", costYuan: 0.004 })).toBe("1 句 · 不足 ¥0.01");
  });
});

describe("costSuffixAtLeast", () => {
  it("段落模式标注为「起」，避免给出偏低的确切数字", () => {
    expect(costSuffixAtLeast({ units: 12, unit: "句", costYuan: 0.05 })).toBe("12 句 · 约 ¥0.05 起");
  });

  it("无金额时退化为只有数量", () => {
    expect(costSuffixAtLeast({ units: 12, unit: "句", costYuan: null })).toBe("12 句");
  });
});
