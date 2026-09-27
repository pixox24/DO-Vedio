import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-custom-provider-"));
  process.env.DATA_DIR = dir;
  process.env.PROVIDER_ENCRYPTION_KEY = "test-provider-secret";
});
afterAll(async () => {
  (await import("../server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PROVIDER_ENCRYPTION_KEY;
});

describe("自定义服务商", () => {
  it("Key 加密后可解密，原文不等于存储值", async () => {
    const { encryptApiKey, decryptApiKey } = await import("./custom");
    const encrypted = encryptApiKey("sk-secret-value");
    expect(encrypted).not.toContain("sk-secret-value");
    expect(decryptApiKey(encrypted)).toBe("sk-secret-value");
  });

  it("解析 OpenAI Compatible /models 响应并同步模型", async () => {
    const { createCustomProvider, fetchRemoteModels, syncCustomModels } = await import("./custom");
    const { listProviderProfiles } = await import("./registry");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b", name: "Model B" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { name: "本地网关", interfaceType: "openai-compatible" as const, baseUrl: "http://localhost:8000/v1", apiKey: "secret" };
    const id = createCustomProvider(input);
    const models = await fetchRemoteModels(input);
    syncCustomModels(id, models);
    const profiles = listProviderProfiles().filter((p) => p.providerId === `custom-${id}`);
    expect(profiles.map((p) => p.modelId)).toEqual(["model-a", "model-b"]);
    expect(profiles.every((p) => p.configured && !p.enabled)).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer secret" } });
    vi.unstubAllGlobals();
  });

  it("标准模型目录返回 404 时自动回退到另一种路径", async () => {
    const { fetchRemoteModels } = await import("./custom");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "fallback-model" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const models = await fetchRemoteModels({ interfaceType: "openai-compatible", baseUrl: "https://gateway.example.com", apiKey: "secret" });
    expect(models).toEqual([{ id: "fallback-model", label: "fallback-model" }]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["https://gateway.example.com/v1/models", "https://gateway.example.com/models"]);
    vi.unstubAllGlobals();
  });
});
