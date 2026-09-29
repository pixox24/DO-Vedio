import { afterEach, describe, expect, it } from "vitest";
import { accessTokensMatch, safeNextPath } from "@/lib/auth";

const originalToken = process.env.DO_VEDIO_ACCESS_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.DO_VEDIO_ACCESS_TOKEN;
  else process.env.DO_VEDIO_ACCESS_TOKEN = originalToken;
});

describe("访问令牌", () => {
  it("比较正确令牌并拒绝错误令牌", () => {
    process.env.DO_VEDIO_ACCESS_TOKEN = "test-shared-token";
    expect(accessTokensMatch("test-shared-token")).toBe(true);
    expect(accessTokensMatch("wrong-token")).toBe(false);
    expect(accessTokensMatch("")).toBe(false);
  });

  it("只允许站内 next 路径", () => {
    expect(safeNextPath("/projects/one?tab=video")).toBe("/projects/one?tab=video");
    expect(safeNextPath("https://example.com")).toBe("/");
    expect(safeNextPath("//example.com")).toBe("/");
    expect(safeNextPath("/\\example.com")).toBe("/");
  });
});
