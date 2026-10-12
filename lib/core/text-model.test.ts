import { describe, expect, it } from "vitest";
import { pickTextModelId } from "./text-model";

describe("pickTextModelId", () => {
  const models = [{ id: "deepseek" }, { id: "claude" }];

  it("按设置、文案页的顺序选用仍启用的模型", () => {
    expect(pickTextModelId(["claude", "deepseek"], models)).toBe("claude");
    expect(pickTextModelId(["", "deepseek"], models)).toBe("deepseek");
  });

  it("选定的模型不在名单里时用第一个可用模型", () => {
    expect(pickTextModelId(["gone", ""], models)).toBe("deepseek");
    expect(pickTextModelId(["", ""], [])).toBe("");
  });
});
