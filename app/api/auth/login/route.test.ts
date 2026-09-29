import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/auth/login/route";

const originalToken = process.env.DO_VEDIO_ACCESS_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.DO_VEDIO_ACCESS_TOKEN;
  else process.env.DO_VEDIO_ACCESS_TOKEN = originalToken;
});

function login(url: string, forwardedProto?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (forwardedProto) headers.set("x-forwarded-proto", forwardedProto);
  return POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ token: "test-shared-token" }) }));
}

describe("登录 route", () => {
  it("设置 HttpOnly Cookie，HTTP 本地访问不强制 Secure", async () => {
    process.env.DO_VEDIO_ACCESS_TOKEN = "test-shared-token";
    const response = await login("http://localhost/api/auth/login");
    const cookie = response.headers.get("set-cookie")?.toLowerCase() ?? "";
    expect(response.status).toBe(200);
    expect(cookie).toContain("httponly");
    expect(cookie).not.toContain("secure");
  });

  it("HTTPS 反向代理启用 Secure Cookie", async () => {
    process.env.DO_VEDIO_ACCESS_TOKEN = "test-shared-token";
    const response = await login("http://app.internal/api/auth/login", "https");
    expect(response.headers.get("set-cookie")?.toLowerCase()).toContain("secure");
  });
});
