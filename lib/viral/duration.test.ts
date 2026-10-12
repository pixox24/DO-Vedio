import { describe, expect, it } from "vitest";
import { estimateScriptDuration, selectPlatform, setAspectRatio, setTargetSeconds, targetCharCount } from "./duration";
import { defaultViralInput } from "./state";

describe("平台默认值和独立制作设置", () => {
  it("未手改时随平台类别更新时长与画幅", () => {
    const short = selectPlatform(defaultViralInput(), "douyin");
    expect([short.targetSeconds, short.handoff.aspectRatio]).toEqual([120, "9:16"]);
    const long = selectPlatform(short, "bilibili");
    expect([long.targetSeconds, long.handoff.aspectRatio]).toEqual([300, "16:9"]);
  });
  it("手改值跨平台保留，制作版本只在画幅值变化时递增", () => {
    const custom = setAspectRatio(setTargetSeconds(selectPlatform(defaultViralInput(), "douyin"), 90), "16:9");
    const long = selectPlatform(custom, "xigua");
    expect(long.targetSeconds).toBe(90); expect(long.handoff.aspectRatio).toBe("16:9");
    expect(long.handoff.settingsVersion).toBe(custom.handoff.settingsVersion);
    expect(setAspectRatio(long, "16:9").handoff.settingsVersion).toBe(long.handoff.settingsVersion);
  });
});
describe("口播估算复用现有计量", () => {
  it("中英文数字口播计数，标题不计入预计配音时长", () => {
    const input = defaultViralInput();
    expect(estimateScriptDuration({ segments: [{ id: "s1", title: "不配音", text: "用 AI 做 3 件事", materialIds: [] }] }, input).charCount).toBe(6);
    expect(targetCharCount(input)).toBe(500);
  });
  it("±15% 边界不显示校准，正负超出均显示", () => {
    const input = { ...defaultViralInput(), targetSeconds: 60 };
    const estimate = (chars: number) => estimateScriptDuration({ segments: [{ id: "s1", title: "", text: "字".repeat(chars), materialIds: [] }] }, input);
    expect(estimate(287).needsCalibration).toBe(false);
    expect(estimate(288).needsCalibration).toBe(true);
    expect(estimate(213).needsCalibration).toBe(false);
    expect(estimate(212).needsCalibration).toBe(true);
    expect(estimate(250).isEstimate).toBe(true);
  });
});
