import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const originalToken = process.env.DO_VEDIO_ACCESS_TOKEN;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalToken === undefined) delete process.env.DO_VEDIO_ACCESS_TOKEN;
  else process.env.DO_VEDIO_ACCESS_TOKEN = originalToken;
  if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
});

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, cookie ? { headers: { cookie } } : undefined);
}

describe("访问保护 proxy", () => {
  it("未授权 API 返回 401", async () => {
    process.env.DO_VEDIO_ACCESS_TOKEN = "test-shared-token";
    const response = proxy(request("/api/projects"));
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("未授权页面重定向到登录页并保留目标路径", () => {
    process.env.DO_VEDIO_ACCESS_TOKEN = "test-shared-token";
    const response = proxy(request("/projects/demo?tab=video"));
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost/login?next=%2Fprojects%2Fdemo%3Ftab%3Dvideo");
  });

  it("正确 cookie 通过，登录 API 保持可访问", () => {
    process.env.DO_VEDIO_ACCESS_TOKEN = "test-shared-token";
    expect(proxy(request("/projects/demo", "do_vedio_access=test-shared-token"))?.status).toBe(200);
    expect(proxy(request("/api/auth/login"))?.status).toBe(200);
  });

  it("开发环境未配置令牌时直通", () => {
    delete process.env.DO_VEDIO_ACCESS_TOKEN;
    Reflect.set(process.env, "NODE_ENV", "test");
    expect(proxy(request("/api/projects"))).toBeDefined();
    expect(proxy(request("/projects/demo"))?.status).toBe(200);
  });

  it("生产环境漏配令牌时拒绝请求", () => {
    delete process.env.DO_VEDIO_ACCESS_TOKEN;
    Reflect.set(process.env, "NODE_ENV", "production");
    expect(proxy(request("/api/projects"))?.status).toBe(503);
  });
});
