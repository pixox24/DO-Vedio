import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as FontsModule from "./fonts";

let fonts: typeof FontsModule;

async function importFreshFonts(): Promise<typeof FontsModule> {
  vi.resetModules();
  return import("./fonts");
}

function stubFontEnvironment(load: () => Promise<unknown>) {
  class FakeFontFace {
    load() {
      return load();
    }
  }
  vi.stubGlobal("FontFace", FakeFontFace as unknown as typeof FontFace);
  vi.stubGlobal("document", {
    fonts: {
      add: vi.fn(),
      load: vi.fn(async () => []),
    },
  });
  return FakeFontFace;
}

describe("字体加载状态", () => {
  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fonts = await importFreshFonts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("系统字体与回退到系统字体的未知 id 状态为 ready，内置字体初始为 unloaded", () => {
    expect(fonts.studioFontState("system-cjk")).toBe("ready");
    expect(fonts.studioFontState("system-latin")).toBe("ready");
    expect(fonts.studioFontState("not-a-font")).toBe("ready");
    expect(fonts.studioFontState("nanxi-youmo-song")).toBe("ready");
    expect(fonts.studioFontState("lemi-shigu-song")).toBe("unloaded");
  });

  it("加载流程为 unloaded → loading → ready，并通知订阅者", async () => {
    let release!: (face: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    stubFontEnvironment(() => gate);

    const seen: string[] = [];
    fonts.subscribeStudioFonts(() => seen.push(fonts.studioFontState("wuhan-yingxiong")));

    expect(fonts.studioFontState("wuhan-yingxiong")).toBe("unloaded");
    const loading = fonts.loadStudioFont("wuhan-yingxiong");
    expect(fonts.studioFontState("wuhan-yingxiong")).toBe("loading");

    release({});
    await expect(loading).resolves.toBe(true);
    expect(fonts.studioFontState("wuhan-yingxiong")).toBe("ready");
    expect(fonts.isStudioFontReady("wuhan-yingxiong")).toBe(true);
    expect(seen).toContain("loading");
    expect(seen).toContain("ready");
  });

  it("FontFace.load 拒绝时进入 error，isStudioFontReady 为 false，再次 load 可重试", async () => {
    let attempt = 0;
    stubFontEnvironment(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error("404")) : Promise.resolve({});
    });

    const seen: string[] = [];
    fonts.subscribeStudioFonts(() => seen.push(fonts.studioFontState("wuhan-yingxiong")));

    await expect(fonts.loadStudioFont("wuhan-yingxiong")).resolves.toBe(false);
    expect(fonts.studioFontState("wuhan-yingxiong")).toBe("error");
    expect(fonts.isStudioFontReady("wuhan-yingxiong")).toBe(false);
    expect(seen).toContain("error");

    await expect(fonts.loadStudioFont("wuhan-yingxiong")).resolves.toBe(true);
    expect(fonts.studioFontState("wuhan-yingxiong")).toBe("ready");
    expect(fonts.isStudioFontReady("wuhan-yingxiong")).toBe(true);
    expect(attempt).toBe(2);
  });

  it("retryStudioFont 在失败后重新加载并恢复 ready", async () => {
    let attempt = 0;
    stubFontEnvironment(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error("network error")) : Promise.resolve({});
    });

    await expect(fonts.loadStudioFont("yaoxing-qingnian-hei")).resolves.toBe(false);
    expect(fonts.studioFontState("yaoxing-qingnian-hei")).toBe("error");

    await expect(fonts.retryStudioFont("yaoxing-qingnian-hei")).resolves.toBe(true);
    expect(fonts.studioFontState("yaoxing-qingnian-hei")).toBe("ready");
    expect(fonts.isStudioFontReady("yaoxing-qingnian-hei")).toBe(true);
    expect(attempt).toBe(2);
  });

  it("retryStudioFont 对系统字体直接返回 ready", async () => {
    await expect(fonts.retryStudioFont("system-cjk")).resolves.toBe(true);
    expect(fonts.studioFontState("system-cjk")).toBe("ready");
  });
});
