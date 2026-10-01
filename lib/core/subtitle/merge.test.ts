import { afterEach, describe, expect, it, vi } from "vitest";
import type { Line } from "../types";
import { primaryHash, secondaryStatus, translateLinesSecondary } from "./secondary";
import { mergeSecondaryResults } from "./merge";

const line = (id: string, text: string, extra: Partial<Line> = {}): Line => ({
  id,
  segmentIndex: 0,
  text,
  spans: [],
  keywords: [],
  locked: false,
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mergeSecondaryResults", () => {
  it("请求期间源文被改：不写入旧译文，保留新文本并保持待翻译", () => {
    const requested = [line("a", "你好世界")];
    const results = [{ id: "a", text: "Hello world", primaryHash: primaryHash(requested[0].text) }];
    const edited = [{ ...requested[0], text: "你好世界，改过的句子" }];

    const merged = mergeSecondaryResults(edited, results);

    expect(merged[0].text).toBe("你好世界，改过的句子");
    expect(merged[0].secondaryText).toBeUndefined();
    expect(merged[0].secondaryHash).toBeUndefined();
    expect(secondaryStatus(merged[0])).toBe("missing");
  });

  it("请求期间修改 locked/voiceTag/pauseAfterMs/ttsIsolated/spans/keywords/mood：合并只改译文", () => {
    const requested = [line("a", "你好世界", { segmentIndex: 3, spans: [{ text: "你好世界" }], keywords: ["旧"] })];
    const results = [{ id: "a", text: "Hello world", primaryHash: primaryHash(requested[0].text) }];
    const edited = [
      line("a", "你好世界", {
        segmentIndex: 3,
        spans: [{ text: "你好世界", say: "你好" }],
        keywords: ["新"],
        mood: "紧张",
        locked: true,
        voiceTag: "sad",
        pauseAfterMs: 420,
        ttsIsolated: true,
      }),
    ];

    const merged = mergeSecondaryResults(edited, results);

    expect(merged[0]).toMatchObject({
      segmentIndex: 3,
      spans: [{ text: "你好世界", say: "你好" }],
      keywords: ["新"],
      mood: "紧张",
      locked: true,
      voiceTag: "sad",
      pauseAfterMs: 420,
      ttsIsolated: true,
      secondaryText: "Hello world",
      secondaryHash: primaryHash("你好世界"),
    });
  });

  it("请求期间新增/删除/重排：新增句保留、删除句不复活、重排顺序不变", () => {
    const results = [
      { id: "a", text: "Hello", primaryHash: primaryHash("你好") },
      { id: "b", text: "World", primaryHash: primaryHash("世界") },
      { id: "gone", text: "Deleted", primaryHash: primaryHash("删除") },
    ];
    const current = [line("b", "世界"), line("new", "新增句子"), line("a", "你好")];

    const merged = mergeSecondaryResults(current, results);

    expect(merged.map((item) => item.id)).toEqual(["b", "new", "a"]);
    expect(merged[0].secondaryText).toBe("World");
    expect(merged[0].secondaryHash).toBe(primaryHash("世界"));
    expect(merged[1].secondaryText).toBeUndefined();
    expect(merged[2].secondaryText).toBe("Hello");
    expect(merged.some((item) => item.id === "gone")).toBe(false);
  });

  it("未变化句子正常写入 secondaryText 与匹配的 secondaryHash，未涉及行保持原引用", () => {
    const untouched = line("x", "不动");
    const target = line("a", "你好");
    const source = [untouched, target];
    const merged = mergeSecondaryResults(source, [{ id: "a", text: "Hello", primaryHash: primaryHash("你好") }]);

    expect(merged).not.toBe(source);
    expect(merged[0]).toBe(untouched);
    expect(merged[1]).not.toBe(target);
    expect(merged[1].secondaryText).toBe("Hello");
    expect(merged[1].secondaryHash).toBe(primaryHash("你好"));
  });

  it("哈希不匹配时保留该句现有译文与哈希不变", () => {
    const existing = line("a", "你好世界", { secondaryText: "Old translation", secondaryHash: primaryHash("你好世界") });
    const merged = mergeSecondaryResults(
      [existing],
      [{ id: "a", text: "New translation", primaryHash: primaryHash("改过的句子") }],
    );

    expect(merged[0]).toBe(existing);
    expect(merged[0].secondaryText).toBe("Old translation");
    expect(merged[0].secondaryHash).toBe(primaryHash("你好世界"));
  });

  it("空 results、未知 id、重复 id（保留首次）不破坏数据", () => {
    const source = [line("a", "你好")];

    const empty = mergeSecondaryResults(source, []);
    expect(empty).toEqual(source);
    expect(empty).not.toBe(source);
    expect(empty[0]).toBe(source[0]);

    const unknown = mergeSecondaryResults(source, [{ id: "nope", text: "X", primaryHash: primaryHash("你好") }]);
    expect(unknown[0]).toBe(source[0]);
    expect(unknown[0].secondaryText).toBeUndefined();

    const dup = mergeSecondaryResults(source, [
      { id: "a", text: "First", primaryHash: primaryHash("你好") },
      { id: "a", text: "Second", primaryHash: primaryHash("你好") },
    ]);
    expect(dup[0].secondaryText).toBe("First");
    expect(dup[0].secondaryHash).toBe(primaryHash("你好"));
  });
});

describe("translateLinesSecondary + mergeSecondaryResults 集成", () => {
  it("翻译 promise 未完成期间编辑源文/锁定：完成后合并不回滚编辑，新句保持待翻译", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { to: string; units: { id: string; text: string }[] };
        await gate;
        return new Response(
          JSON.stringify({
            items: body.units.map((unit) => ({
              id: unit.id,
              text: body.to === "en" ? "Hello world" : "你好",
              primaryHash: primaryHash(unit.text),
            })),
            failed: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const requested = [line("a", "你好世界")];
    const pending = translateLinesSecondary(requested, { modelId: "m" });
    const edited = [line("a", "你好世界，改过的句子", { locked: true }), line("new", "新加的句子")];
    release();
    const result = await pending;

    const merged = mergeSecondaryResults(edited, result.results);

    expect(result.translated).toBe(1);
    expect(merged[0].text).toBe("你好世界，改过的句子");
    expect(merged[0].locked).toBe(true);
    expect(merged[0].secondaryText).toBeUndefined();
    expect(merged[1].secondaryText).toBeUndefined();
    expect(secondaryStatus(merged[1])).toBe("missing");
  });
});
