import { afterEach, describe, expect, it, vi } from "vitest";
import type { Line } from "../types";
import { detectSourceLanguage } from "./language";
import {
  assessSecondaryQuality,
  isSecondaryFresh,
  isSecondaryUsable,
  pendingTranslateUnits,
  primaryHash,
  secondaryCoverage,
  secondaryStatus,
  translateLinesSecondary,
} from "./secondary";

const line = (id: string, text: string, extra: Partial<Line> = {}): Line => ({
  id,
  segmentIndex: 0,
  text,
  spans: [],
  keywords: [],
  locked: false,
  ...extra,
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

interface FetchCall {
  from: string;
  to: string;
  units: { id: string; text: string }[];
}

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as FetchCall;
    const call: FetchCall = { from: body.from, to: body.to, units: body.units };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const reply = (call: FetchCall) =>
  jsonResponse({
    items: call.units.map((unit) => ({
      id: unit.id,
      text: call.to === "en" ? "Hello world" : "你好",
      primaryHash: primaryHash(unit.text),
    })),
    failed: [],
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("secondaryStatus 五态", () => {
  it("覆盖率与待翻译队列共用判定：无哈希旧译文不计 fresh 但进队列", () => {
    const fresh = line("fresh", "你好世界", { secondaryText: "Hello world", secondaryHash: primaryHash("你好世界") });
    const stale = line("stale", "你好世界", { secondaryText: "Hello world", secondaryHash: primaryHash("旧文本") });
    const unverified = line("unverified", "你好世界", { secondaryText: "Hello world" });
    const missing = line("missing", "你好世界");
    const invalid = line("invalid", "你好世界", { secondaryText: "你好世界", secondaryHash: primaryHash("你好世界") });
    const lines = [fresh, stale, unverified, missing, invalid];

    expect(lines.map((item) => secondaryStatus(item))).toEqual(["fresh", "stale", "unverified", "missing", "invalid"]);
    expect(isSecondaryFresh(fresh)).toBe(true);
    expect(lines.slice(1).map((item) => isSecondaryFresh(item))).toEqual([false, false, false, false]);
    expect(isSecondaryUsable(fresh)).toBe(true);
    expect(isSecondaryUsable(unverified)).toBe(true);
    expect(isSecondaryUsable(stale)).toBe(false);
    expect(isSecondaryUsable(missing)).toBe(false);
    expect(isSecondaryUsable(invalid)).toBe(false);
    expect(pendingTranslateUnits(lines).map((unit) => unit.id)).toEqual(["stale", "unverified", "missing", "invalid"]);
    expect(secondaryCoverage(lines)).toEqual({ total: 5, fresh: 1, stale: 4 });
  });

  it("语言不对算 invalid，哈希不匹配算 stale", () => {
    expect(secondaryStatus(line("a", "hello world", { secondaryText: "Hello world", secondaryHash: primaryHash("hello world") }))).toBe("invalid");
    expect(secondaryStatus(line("b", "hello world", { secondaryText: "你好世界", secondaryHash: "deadbeef" }))).toBe("stale");
    expect(secondaryStatus(line("c", "hello world", { secondaryText: "你好世界" }))).toBe("unverified");
    expect(secondaryStatus(line("d", "hello world", { secondaryText: "你好世界", secondaryHash: primaryHash("hello world") }))).toBe("fresh");
  });
});

describe("detectSourceLanguage", () => {
  it("至少 2 个汉字或 3 个拉丁字母才确定，数字符号返回 null", () => {
    expect(detectSourceLanguage("你好世界")).toBe("zh");
    expect(detectSourceLanguage("hello world")).toBe("en");
    expect(detectSourceLanguage("你好 2025")).toBe("zh");
    expect(detectSourceLanguage("ab")).toBeNull();
    expect(detectSourceLanguage("好")).toBeNull();
    expect(detectSourceLanguage("2025-09-01")).toBeNull();
    expect(detectSourceLanguage("...")).toBeNull();
    expect(detectSourceLanguage("   ")).toBeNull();
  });
});

describe("assessSecondaryQuality", () => {
  it("目标语言、长度比例、长度上限三道门", () => {
    expect(assessSecondaryQuality("你好世界", "Hello world", "zh", "en")).toEqual({ ok: true });
    expect(assessSecondaryQuality("hello world", "你好世界", "en", "zh")).toEqual({ ok: true });
    expect(assessSecondaryQuality("你好世界", "你好世界", "zh", "en")).toMatchObject({ ok: false, reason: "译文语言不符" });
    expect(assessSecondaryQuality("你好", "hello world this is a test", "zh", "en")).toMatchObject({ ok: false, reason: "长度比例异常" });
    expect(
      assessSecondaryQuality(
        "你好世界，今天我们来聊一个非常重要的话题",
        "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november",
        "zh",
        "en",
      ),
    ).toMatchObject({ ok: false, reason: "译文过长" });
  });
});

describe("translateLinesSecondary", () => {
  it("中英交错逐句识别方向，各自请求自己的 from/to", async () => {
    const { calls, fetchMock } = mockFetch(reply);
    const lines = [line("a", "你好世界"), line("b", "hello world")];
    const result = await translateLinesSecondary(lines, { modelId: "m" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[0]).toMatchObject({ from: "zh", to: "en" });
    expect(calls[0].units.map((unit) => unit.id)).toEqual(["a"]);
    expect(calls[1]).toMatchObject({ from: "en", to: "zh" });
    expect(calls[1].units.map((unit) => unit.id)).toEqual(["b"]);
    expect(result.results.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.skipped).toEqual([]);
    expect(result.translated).toBe(2);
    expect(result.aborted).toBe(false);
    expect(result.lines.find((item) => item.id === "a")?.secondaryText).toBe("Hello world");
    expect(result.lines.find((item) => item.id === "b")?.secondaryText).toBe("你好");
    expect(result.lines.find((item) => item.id === "b")?.secondaryHash).toBe(primaryHash("hello world"));
  });

  it("按 24 条分片，进度单调且最终 done=total", async () => {
    const { calls } = mockFetch(reply);
    const lines = Array.from({ length: 25 }, (_, i) => line(`e${i}`, `hello world number ${i}`));
    const progress: { done: number; total: number }[] = [];
    const result = await translateLinesSecondary(lines, { modelId: "m", onProgress: (p) => progress.push(p) });

    expect(calls).toHaveLength(2);
    expect(calls[0].units).toHaveLength(24);
    expect(calls[1].units).toHaveLength(1);
    expect(progress).toEqual([
      { done: 24, total: 25 },
      { done: 25, total: 25 },
    ]);
    expect(result.translated).toBe(25);
  });

  it("只提交非 fresh 的句子，不覆盖已有有效翻译", async () => {
    const { calls } = mockFetch(reply);
    const lines = [
      line("done", "你好世界", { secondaryText: "Hello world", secondaryHash: primaryHash("你好世界") }),
      line("todo", "hello world"),
    ];
    const result = await translateLinesSecondary(lines, { modelId: "m" });

    expect(calls).toHaveLength(1);
    expect(calls[0].units.map((unit) => unit.id)).toEqual(["todo"]);
    expect(result.results.map((item) => item.id)).toEqual(["todo"]);
    expect(result.lines.find((item) => item.id === "done")?.secondaryText).toBe("Hello world");
  });

  it("数字、符号等低置信度源文被 skipped，不发请求", async () => {
    const { calls, fetchMock } = mockFetch(reply);
    const lines = [line("a", "你好世界"), line("n", "2025-09-01")];
    const result = await translateLinesSecondary(lines, { modelId: "m" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls[0].units.map((unit) => unit.id)).toEqual(["a"]);
    expect(result.skipped).toEqual([{ id: "n", reason: "无法判断语言方向" }]);
    expect(result.lines.find((item) => item.id === "n")?.secondaryText).toBeUndefined();
  });

  it("mode zh/en 覆盖逐句识别", async () => {
    const lines = [line("a", "你好世界"), line("b", "hello world")];

    const zh = mockFetch(reply);
    const zhResult = await translateLinesSecondary(lines, { modelId: "m", mode: "zh" });
    expect(zh.calls).toHaveLength(1);
    expect(zh.calls[0]).toMatchObject({ from: "zh", to: "en" });
    expect(zh.calls[0].units.map((unit) => unit.id)).toEqual(["a", "b"]);
    expect(zhResult.skipped).toEqual([]);

    const en = mockFetch(reply);
    const enResult = await translateLinesSecondary(lines, { modelId: "m", mode: "en" });
    expect(en.calls).toHaveLength(1);
    expect(en.calls[0]).toMatchObject({ from: "en", to: "zh" });
    expect(en.calls[0].units.map((unit) => unit.id)).toEqual(["a", "b"]);
    expect(enResult.skipped).toEqual([]);
  });

  it("取消后不再发新批次，保留已成功结果且 aborted=true", async () => {
    const controller = new AbortController();
    let first = true;
    const { calls, fetchMock } = mockFetch((call) => {
      if (first) {
        first = false;
        controller.abort();
      }
      return reply(call);
    });
    const lines = [line("a", "你好世界"), line("b", "hello world")];
    const result = await translateLinesSecondary(lines, { modelId: "m", signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(result.aborted).toBe(true);
    expect(result.results.map((item) => item.id)).toEqual(["a"]);
    expect(result.translated).toBe(1);
  });

  it("有失败时进度仍按已处理句子推进", async () => {
    const progress: { done: number; total: number }[] = [];
    mockFetch(() =>
      jsonResponse({
        items: [{ id: "b", text: "Hello world", primaryHash: primaryHash("你好世界二号") }],
        failed: [{ id: "a", reason: "模型未返回该句" }],
      }),
    );
    const result = await translateLinesSecondary([line("a", "你好世界"), line("b", "你好世界二号")], {
      modelId: "m",
      onProgress: (p) => progress.push(p),
    });

    expect(progress).toEqual([{ done: 2, total: 2 }]);
    expect(result.translated).toBe(1);
    expect(result.failed).toEqual([{ id: "a", reason: "模型未返回该句" }]);
  });

  it.each([
    { title: "语言方向不符", source: "你好世界", translated: "你好世界", reason: "译文语言不符" },
    { title: "长度比例异常", source: "你好", translated: "hello world this is a test", reason: "长度比例异常" },
    {
      title: "译文过长",
      source: "你好世界，今天我们来聊一个非常重要的话题",
      translated: "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november",
      reason: "译文过长",
    },
  ])("客户端拒绝$title的响应并计入 failed", async ({ source, translated, reason }) => {
    mockFetch(() => jsonResponse({ items: [{ id: "a", text: translated, primaryHash: primaryHash(source) }], failed: [] }));
    const result = await translateLinesSecondary([line("a", source)], { modelId: "m" });

    expect(result.results).toEqual([]);
    expect(result.failed).toEqual([{ id: "a", reason }]);
  });

  it("客户端拒绝哈希不匹配的响应", async () => {
    mockFetch(() => jsonResponse({ items: [{ id: "a", text: "Hello world", primaryHash: "wrong" }], failed: [] }));
    const result = await translateLinesSecondary([line("a", "你好世界")], { modelId: "m" });

    expect(result.results).toEqual([]);
    expect(result.failed).toEqual([{ id: "a", reason: "译文与当前文稿不匹配" }]);
  });
});
