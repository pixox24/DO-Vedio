import { describe, expect, it } from "vitest";

describe("供应商目录", () => {
  it("文本模型目录会按环境变量过滤，图片模型需要额外配置版本", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const { listProviderProfiles, listTextModels } = await import("./registry");
    const all = listProviderProfiles();
    expect(all.some((m) => m.kind === "image" && m.adapterStatus === "ready" && !m.configured)).toBe(true);
    expect(listTextModels().some((m) => m.id === "deepseek")).toBe(true);
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("保留 Claude 的旧选择 ID，同时接受 anthropic 别名", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { listTextModels, getProviderProfile } = await import("./registry");
    expect(listTextModels().find((m) => m.id === "claude")?.model).toBeTruthy();
    const model = listTextModels().find((m) => m.id === "claude")!;
    expect(getProviderProfile("claude", model.model)?.providerId).toBe("anthropic");
    delete process.env.ANTHROPIC_API_KEY;
  });
});
