import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultStockSource, searchStock, stockConfigured, stockSource, stockSourceLabel } from "./index";

const original = process.env.PEXELS_API_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.PEXELS_API_KEY;
  else process.env.PEXELS_API_KEY = original;
});

describe("素材来源注册表", () => {
  it("默认来源是 Pexels，可显式按 id 取", () => {
    expect(defaultStockSource.id).toBe("pexels");
    expect(stockSource()).toBe(defaultStockSource);
    expect(stockSource("pexels")).toBe(defaultStockSource);
    expect(stockSource("nope")).toBeUndefined();
    expect(stockSourceLabel()).toBe("Pexels");
  });

  it("Key 没配时来源不可用：编排层据此给出可读提示，而不是排一堆注定失败的任务", () => {
    delete process.env.PEXELS_API_KEY;
    expect(stockConfigured()).toBe(false);
    process.env.PEXELS_API_KEY = "  ";
    expect(stockConfigured()).toBe(false);
    process.env.PEXELS_API_KEY = "abc";
    expect(stockConfigured()).toBe(true);
    expect(stockConfigured("nope")).toBe(false);
  });

  it("searchStock 只认注册过的来源，未注册直接报错", async () => {
    await expect(searchStock("nature", {}, new AbortController().signal, "nope")).rejects.toThrow("未注册的素材来源");
  });

  it("searchStock 转发到具体来源", async () => {
    process.env.PEXELS_API_KEY = "abc";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ videos: [] }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await expect(searchStock("nature", { perPage: 3 }, new AbortController().signal)).resolves.toEqual([]);
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
