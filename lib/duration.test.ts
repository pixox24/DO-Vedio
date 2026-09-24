import { describe, expect, it } from "vitest";
import { charsFor, countChars, deviation, formatTime, normalizeMinutes, resolveRate, timeline } from "./duration";

describe("countChars", () => {
  it("汉字逐字计数，忽略标点和空白", () => {
    expect(countChars("你好，世界！\n 再见。")).toBe(6);
  });
  it("英文单词与数字串各算一个", () => {
    expect(countChars("用 ChatGPT 做 3 件事，it's easy")).toBe(8);
  });
  it("空文本为 0", () => {
    expect(countChars("")).toBe(0);
  });
});

describe("timeline", () => {
  it("按语速累加，首尾相接", () => {
    const t = timeline(["字".repeat(250), "字".repeat(125)], "medium");
    expect(t).toEqual([
      { start: 0, end: 60 },
      { start: 60, end: 90 },
    ]);
  });
});

describe("formatTime", () => {
  it("格式化为 mm:ss 并四舍五入", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(75.4)).toBe("01:15");
    expect(formatTime(599.6)).toBe("10:00");
  });
});

describe("charsFor / deviation / resolveRate", () => {
  it("时长换算字数", () => {
    expect(charsFor(5, "medium")).toBe(1250);
    expect(charsFor(3, "fast")).toBe(900);
  });
  it("偏差比例", () => {
    expect(deviation(115, 100)).toBeCloseTo(0.15);
    expect(deviation(80, 100)).toBeCloseTo(-0.2);
    expect(deviation(10, 0)).toBe(0);
  });
  it("auto 跟随模板，缺省为 medium", () => {
    expect(resolveRate("auto", { speechRate: "slow" })).toBe("slow");
    expect(resolveRate("auto")).toBe("medium");
    expect(resolveRate("fast", { speechRate: "slow" })).toBe("fast");
  });
});

describe("normalizeMinutes", () => {
  it("缩放到目标总时长", () => {
    const out = normalizeMinutes([{ minutes: 1 }, { minutes: 3 }], 8);
    expect(out.map((x) => x.minutes)).toEqual([2, 6]);
  });
  it("总和为 0 时平均分配", () => {
    expect(normalizeMinutes([{ minutes: 0 }, { minutes: 0 }], 4).map((x) => x.minutes)).toEqual([2, 2]);
  });
});
