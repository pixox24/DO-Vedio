import { beforeEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({ generateJson: vi.fn() }));

vi.mock("@/lib/llm", () => ({
  generateJson: llm.generateJson,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { POST } from "@/app/api/subtitle/translate/route";
import { primaryHash } from "@/lib/core/subtitle/secondary";

type RouteData = {
  items: { id: string; text: string; primaryHash: string }[];
  failed: { id: string; reason: string }[];
};

const press = (body: unknown) =>
  POST(new Request("http://test/api/subtitle/translate", { method: "POST", body: JSON.stringify(body) }));

const read = async (res: Response) => (await res.json()) as RouteData;

beforeEach(() => {
  llm.generateJson.mockReset();
});

describe("POST /api/subtitle/translate", () => {
  it("正常成功返回 items，primaryHash 为请求时源文哈希", async () => {
    llm.generateJson.mockResolvedValue({ items: [{ id: "a", text: "Hello world" }] });
    const res = await press({ modelId: "m", from: "zh", units: [{ id: "a", text: "你好世界" }] });

    expect(res.status).toBe(200);
    const data = await read(res);
    expect(data.items).toEqual([{ id: "a", text: "Hello world", primaryHash: primaryHash("你好世界") }]);
    expect(data.failed).toEqual([]);
  });

  it("缺 ID、未知 ID、重复 ID 的响应不写入（重复保留首次）", async () => {
    llm.generateJson.mockResolvedValue({
      items: [
        { id: "", text: "no id" },
        { id: "ghost", text: "ghost" },
        { id: "a", text: "Hello first" },
        { id: "a", text: "Hello second" },
      ],
    });
    const data = await read(await press({ modelId: "m", from: "zh", units: [{ id: "a", text: "你好世界" }] }));

    expect(data.items).toEqual([{ id: "a", text: "Hello first", primaryHash: primaryHash("你好世界") }]);
    expect(data.failed).toEqual([]);
  });

  it("方向、比例、长度不过关的译文被拒绝并进入 failed", async () => {
    llm.generateJson.mockResolvedValue({
      items: [
        { id: "bad-lang", text: "你好世界" },
        { id: "bad-ratio", text: "hello world this is a test" },
        { id: "bad-long", text: "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november" },
      ],
    });
    const units = [
      { id: "bad-lang", text: "你好世界" },
      { id: "bad-ratio", text: "你好" },
      { id: "bad-long", text: "你好世界，今天我们来聊一个非常重要的话题" },
    ];
    const data = await read(await press({ modelId: "m", from: "zh", units }));

    expect(data.items).toEqual([]);
    expect(data.failed.map((row) => row.id).sort()).toEqual(["bad-lang", "bad-long", "bad-ratio"]);
    expect(data.failed.every((row) => row.reason === "译文未通过质量校验")).toBe(true);
  });

  it("重试预算耗尽后不合格译文仍被拒绝", async () => {
    llm.generateJson.mockResolvedValue({ items: [{ id: "a", text: "你好世界" }] });
    const data = await read(await press({ modelId: "m", from: "zh", units: [{ id: "a", text: "你好世界" }] }));

    expect(data.items).toEqual([]);
    expect(data.failed).toEqual([{ id: "a", reason: "译文未通过质量校验" }]);
    expect(llm.generateJson.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(llm.generateJson.mock.calls.length).toBeLessThanOrEqual(18);
  });

  it("部分成功：只写入通过完整校验的行", async () => {
    llm.generateJson.mockResolvedValue({
      items: [
        { id: "ok", text: "Hello world" },
        { id: "bad", text: "你好世界" },
      ],
    });
    const units = [
      { id: "ok", text: "你好世界" },
      { id: "bad", text: "你好世界" },
    ];
    const data = await read(await press({ modelId: "m", from: "zh", units }));

    expect(data.items).toEqual([{ id: "ok", text: "Hello world", primaryHash: primaryHash("你好世界") }]);
    expect(data.failed).toEqual([{ id: "bad", reason: "译文未通过质量校验" }]);
  });

  it("中英混合 units 按各自方向校验", async () => {
    llm.generateJson.mockResolvedValue({
      items: [
        { id: "en-unit", text: "Hello world" },
        { id: "zh-unit", text: "你好世界" },
      ],
    });
    const units = [
      { id: "en-unit", text: "你好世界" },
      { id: "zh-unit", text: "hello world" },
    ];
    const data = await read(await press({ modelId: "m", units }));

    expect(data.items).toEqual([
      { id: "en-unit", text: "Hello world", primaryHash: primaryHash("你好世界") },
      { id: "zh-unit", text: "你好世界", primaryHash: primaryHash("hello world") },
    ]);
    expect(data.failed).toEqual([]);
    expect(llm.generateJson.mock.calls.length).toBe(2);
  });

  it("unit.from 优先于顶层 from", async () => {
    llm.generateJson.mockResolvedValue({ items: [{ id: "a", text: "你好世界" }] });
    const data = await read(await press({ modelId: "m", from: "zh", units: [{ id: "a", text: "hello world", from: "en" }] }));

    expect(data.items).toEqual([{ id: "a", text: "你好世界", primaryHash: primaryHash("hello world") }]);
    expect(data.failed).toEqual([]);
  });

  it("低置信度源文直接 failed 且不调用模型", async () => {
    llm.generateJson.mockResolvedValue({ items: [{ id: "a", text: "Hello world" }] });
    const units = [
      { id: "n", text: "2025-09-01" },
      { id: "a", text: "你好世界" },
    ];
    const data = await read(await press({ modelId: "m", units }));

    expect(data.failed).toEqual([{ id: "n", reason: "无法判断语言方向" }]);
    expect(data.items.map((row) => row.id)).toEqual(["a"]);
    expect(llm.generateJson.mock.calls.length).toBe(1);
    const options = llm.generateJson.mock.calls[0][2] as { prompt: string };
    expect(options.prompt).not.toContain("2025-09-01");
  });
});
