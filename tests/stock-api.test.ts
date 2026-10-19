import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

/**
 * `/api/stock` 是设置面板的 Key 状态与「测试连接」入口。
 *
 * 它必须是一条**独立轻量路由**：`providerKinds`（`lib/providers/types.ts`）
 * 是生成式服务商的分类，把 Pexels 塞进去会让视频模型下拉框多出一个选不了的
 * 「模型」，用量口径也会混。
 */

let dir = "";
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "dovedio-stock-api-")); process.env.DATA_DIR = dir; });
afterAll(async () => { (await import("@/lib/server/db")).closeDb(); rmSync(dir, { recursive: true, force: true }); });

const original = process.env.PEXELS_API_KEY;
afterEach(() => {
  vi.unstubAllGlobals();
  if (original === undefined) delete process.env.PEXELS_API_KEY;
  else process.env.PEXELS_API_KEY = original;
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** 给 mock 显式参数类型，否则 `mock.calls[0][0]` 推成空元组读不出 URL。 */
type FetchImpl = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const mockFetch = (impl: FetchImpl) => vi.fn(impl);

it("GET 报告 Key 状态与来源名，未配置时给出可操作提示", async () => {
  const routes = await import("@/app/api/stock/route");
  delete process.env.PEXELS_API_KEY;
  expect(await (await routes.GET()).json()).toMatchObject({ configured: false, provider: "pexels", label: "Pexels" });
  expect((await (await routes.GET()).json()).hint).toContain("PEXELS_API_KEY");

  process.env.PEXELS_API_KEY = "abc";
  const configured = await (await routes.GET()).json();
  expect(configured).toMatchObject({ configured: true, provider: "pexels" });
  expect(configured.hint).toBeUndefined();
});

it("POST 打一次真实检索；成功返回样例信息", async () => {
  const routes = await import("@/app/api/stock/route");
  process.env.PEXELS_API_KEY = "abc";
  const fetchImpl = mockFetch(async () => jsonResponse({ videos: [{ id: 7, duration: 9, width: 1080, height: 1920, url: "https://page/7", user: {}, video_files: [] }] }));
  vi.stubGlobal("fetch", fetchImpl);

  const body = await (await routes.POST(new Request("http://test", { method: "POST", body: "{}" }))).json();
  expect(body).toMatchObject({ ok: true, provider: "pexels", count: 1, sample: { id: 7, durationSec: 9 } });
  expect((fetchImpl.mock.calls[0][0] as URL).searchParams.get("query")).toBe("nature");
  expect((fetchImpl.mock.calls[0][0] as URL).searchParams.get("per_page")).toBe("1");
});

it("POST 请求体可空：面板点「测试连接」时不用带任何参数", async () => {
  const routes = await import("@/app/api/stock/route");
  process.env.PEXELS_API_KEY = "abc";
  vi.stubGlobal("fetch", mockFetch(async () => jsonResponse({ videos: [{ id: 1, duration: 5, width: 1920, height: 1080, url: "https://page/1", user: {}, video_files: [] }] })));
  const response = await routes.POST(new Request("http://test", { method: "POST" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true });
});

it("POST 允许指定检索词", async () => {
  const routes = await import("@/app/api/stock/route");
  process.env.PEXELS_API_KEY = "abc";
  const fetchImpl = mockFetch(async () => jsonResponse({ videos: [] }));
  vi.stubGlobal("fetch", fetchImpl);
  await routes.POST(new Request("http://test", { method: "POST", body: JSON.stringify({ query: "city night" }) }));
  expect((fetchImpl.mock.calls[0][0] as URL).searchParams.get("query")).toBe("city night");
});

it("连接失败返回 200 + ok:false，让面板直接显示原因而不是弹 500", async () => {
  const routes = await import("@/app/api/stock/route");
  process.env.PEXELS_API_KEY = "abc";
  vi.stubGlobal("fetch", mockFetch(async () => new Response("", { status: 401 })));
  const response = await routes.POST(new Request("http://test", { method: "POST", body: "{}" }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(false);
  expect(body.message).toContain("Pexels API Key 无效");
});

it("没配 Key 时测试连接也走同一条错误出口", async () => {
  const routes = await import("@/app/api/stock/route");
  delete process.env.PEXELS_API_KEY;
  const response = await routes.POST(new Request("http://test", { method: "POST", body: "{}" }));
  const body = await response.json();
  expect(body.ok).toBe(false);
  expect(body.message).toContain("PEXELS_API_KEY");
});

it("请求体非法时返回参数错误", async () => {
  const routes = await import("@/app/api/stock/route");
  process.env.PEXELS_API_KEY = "abc";
  const response = await routes.POST(new Request("http://test", { method: "POST", body: JSON.stringify({ query: "" }) }));
  expect(response.status).toBe(400);
});
