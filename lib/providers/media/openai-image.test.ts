import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "dovedio-image-model-"));
beforeAll(() => {
  process.env.DATA_DIR = dir;
  process.env.PROVIDER_ENCRYPTION_KEY = "test-image-provider-secret";
});
afterAll(async () => {
  vi.unstubAllGlobals();
  (await import("../../server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.PROVIDER_ENCRYPTION_KEY;
});

it("第三方图片模型使用 OpenAI 图片接口并接收 base64 图片", async () => {
  const { createCustomProvider, syncCustomModels, setCustomModelKind, setCustomModelEnabled } = await import("../custom");
  const { generateCustomImage } = await import("./openai-image");
  const providerId = createCustomProvider({ name: "图片服务商", interfaceType: "openai-compatible", baseUrl: "https://images.example.com/v1", apiKey: "secret" });
  syncCustomModels(providerId, [{ id: "image-model" }]);
  setCustomModelKind(providerId, "image-model", "image");
  setCustomModelEnabled(providerId, "image-model", true);
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const result = await generateCustomImage(`custom-${providerId}::image-model`, "一张城市图片");
  expect(result.bytes).toEqual(bytes);
  expect(fetchMock).toHaveBeenCalledWith("https://images.example.com/v1/images/generations", expect.objectContaining({
    method: "POST",
    headers: expect.objectContaining({ Authorization: "Bearer secret" }),
    body: JSON.stringify({ model: "image-model", prompt: "一张城市图片", n: 1 }),
  }));
});

it("有参考图时走 /images/edits，多张参考图作为 image[] 上传", async () => {
  const { createCustomProvider, syncCustomModels, setCustomModelKind, setCustomModelEnabled } = await import("../custom");
  const { generateCustomImage } = await import("./openai-image");
  const providerId = createCustomProvider({ name: "参考图服务商", interfaceType: "openai-compatible", baseUrl: "https://edits.example.com/v1", apiKey: "k" });
  syncCustomModels(providerId, [{ id: "gpt-image" }]);
  setCustomModelKind(providerId, "gpt-image", "image");
  setCustomModelEnabled(providerId, "gpt-image", true);
  const out = Buffer.from([1, 2, 3]);
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: out.toString("base64") }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const refs = [{ bytes: new Uint8Array([9]), mime: "image/png" }, { bytes: new Uint8Array([8]), mime: "image/jpeg" }];
  const result = await generateCustomImage(`custom-${providerId}::gpt-image`, "林夏坐在窗边", undefined, refs);
  expect(result.bytes).toEqual(out);
  expect(result.referenceFallback).toBeUndefined();
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://edits.example.com/v1/images/edits");
  const form = init.body as FormData;
  expect(form.get("model")).toBe("gpt-image");
  expect(form.get("prompt")).toBe("林夏坐在窗边");
  expect(form.getAll("image[]")).toHaveLength(2);
  expect((form.getAll("image[]")[1] as File).type).toBe("image/jpeg");
});

it("接口不支持参考图时退回文生图并说明原因；其他错误照常抛出", async () => {
  const { createCustomProvider, syncCustomModels, setCustomModelKind, setCustomModelEnabled } = await import("../custom");
  const { generateCustomImage } = await import("./openai-image");
  const providerId = createCustomProvider({ name: "只支持文生图", interfaceType: "openai-compatible", baseUrl: "https://gen.example.com/v1", apiKey: "k" });
  syncCustomModels(providerId, [{ id: "flux" }]);
  setCustomModelKind(providerId, "flux", "image");
  setCustomModelEnabled(providerId, "flux", true);
  const refs = [{ bytes: new Uint8Array([9]), mime: "image/png" }];
  const ok = new Response(JSON.stringify({ data: [{ b64_json: Buffer.from([7]).toString("base64") }] }), { status: 200 });
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 })).mockResolvedValueOnce(ok);
  vi.stubGlobal("fetch", fetchMock);
  const result = await generateCustomImage(`custom-${providerId}::flux`, "港口", undefined, refs);
  expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["https://gen.example.com/v1/images/edits", "https://gen.example.com/v1/images/generations"]);
  expect(result.referenceFallback).toContain("HTTP 404");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "余额不足" } }), { status: 402 })));
  await expect(generateCustomImage(`custom-${providerId}::flux`, "港口", undefined, refs)).rejects.toThrow("余额不足");
});
