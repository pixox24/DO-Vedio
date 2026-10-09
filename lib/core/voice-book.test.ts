import { describe, expect, it } from "vitest";
import { voiceIdAfterModelChange, voiceNameError, voiceParamError } from "./voice-book";

describe("音色参数", () => {
  it("接受官网 voice 参数和带点的版本号", () => {
    expect(voiceParamError("longanhuan_v3")).toBeNull();
    expect(voiceParamError(" longanhuan_v3.6 ")).toBeNull();
    expect(voiceParamError("cosyvoice-v3-flash-myvoice-abc")).toBeNull();
  });

  it("拒绝空值、中文、空格和超长参数", () => {
    expect(voiceParamError("  ")).toBe("请填写音色参数");
    expect(voiceParamError("龙安欢")).toMatch(/字母/);
    expect(voiceParamError("long an")).toMatch(/字母/);
    expect(voiceParamError("a".repeat(129))).toMatch(/128/);
  });

  it("显示名可空，但不能太长或带控制字符", () => {
    expect(voiceNameError("")).toBeNull();
    expect(voiceNameError("龙安欢 V3")).toBeNull();
    expect(voiceNameError("名".repeat(41))).toMatch(/40/);
    expect(voiceNameError("a<b")).toMatch(/控制字符/);
  });

  it("换模型时只保留新名单里已有的音色", () => {
    expect(voiceIdAfterModelChange("longanyang", ["longanyang", "longanhuan"])).toBe("longanyang");
    expect(voiceIdAfterModelChange("longanhuan_v3", ["longanyang"])).toBe("");
  });
});
