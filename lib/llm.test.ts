import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateJson } from "./llm";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), model: { modelId: "mock-model" } }));

vi.mock("ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("ai")>(),
  generateText: mocks.generateText,
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: () => () => mocks.model,
}));
vi.mock("./providers/registry", () => ({
  customTextModel: () => ({ providerId: "mock", modelId: "mock-model", apiKey: "mock-key", baseUrl: "https://mock.invalid", interfaceType: "openai-compatible" }),
  listProviderProfiles: vi.fn(),
  listTextModels: vi.fn(),
}));

const schema = z.object({ title: z.string() });
const prompt = { instructions: "生成标题", prompt: "测试" };
const output = { title: "标题" };

beforeEach(() => {
  mocks.generateText.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("generateJson output budget", () => {
  it("keeps existing calls compatible without adding an output token limit", async () => {
    mocks.generateText.mockResolvedValue({ output });
    const controller = new AbortController();

    await expect(generateJson("mock", schema, prompt, controller.signal)).resolves.toEqual(output);

    expect(mocks.generateText).toHaveBeenCalledOnce();
    expect(mocks.generateText.mock.calls[0][0]).toMatchObject({
      model: mocks.model,
      prompt: prompt.prompt,
      abortSignal: controller.signal,
    });
    expect(mocks.generateText.mock.calls[0][0]).not.toHaveProperty("maxOutputTokens");
  });

  it("passes an explicitly requested 8192-token limit to generateText", async () => {
    mocks.generateText.mockResolvedValue({ output });

    await expect(generateJson("mock", schema, prompt, undefined, 0, { maxOutputTokens: 8192 })).resolves.toEqual(output);

    expect(mocks.generateText).toHaveBeenCalledOnce();
    expect(mocks.generateText.mock.calls[0][0]).toHaveProperty("maxOutputTokens", 8192);
  });

  it("preserves the default two retries for existing calls", async () => {
    vi.useFakeTimers();
    mocks.generateText
      .mockRejectedValueOnce(new SyntaxError("Unexpected end of JSON input"))
      .mockRejectedValueOnce(new SyntaxError("Unexpected end of JSON input"))
      .mockResolvedValueOnce({ output });
    const result = generateJson("mock", schema, prompt);

    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual(output);
    expect(mocks.generateText).toHaveBeenCalledTimes(3);
  });

  it("makes one call on a parsing error when maxRetries is zero", async () => {
    const error = new SyntaxError("Unexpected end of JSON input");
    mocks.generateText.mockRejectedValue(error);

    await expect(generateJson("mock", schema, prompt, undefined, 0, { maxOutputTokens: 8192 })).rejects.toBe(error);

    expect(mocks.generateText).toHaveBeenCalledOnce();
  });

  it("does not retry after the caller aborts", async () => {
    const controller = new AbortController();
    const error = new DOMException("The operation was aborted", "AbortError");
    mocks.generateText.mockImplementation(async () => {
      controller.abort();
      throw error;
    });

    await expect(generateJson("mock", schema, prompt, controller.signal)).rejects.toBe(error);

    expect(mocks.generateText).toHaveBeenCalledOnce();
  });
});
