import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplicateMediaAdapter } from "./replicate";

afterEach(() => vi.unstubAllGlobals());

describe("Replicate media adapter", () => {
  it("创建 prediction、轮询并返回输出 URL", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pred-1", status: "starting" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "pred-1", status: "succeeded", output: ["https://cdn.example/image.png"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ReplicateMediaAdapter("image", { token: "token", version: "version", baseUrl: "https://replicate.test/v1" });
    const result = await adapter.generate({ prompt: "雨夜城市", seed: 12 });
    expect(result).toEqual({ predictionId: "pred-1", outputUrls: ["https://cdn.example/image.png"] });
    expect(fetchMock.mock.calls[0][0]).toBe("https://replicate.test/v1/predictions");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { Authorization: "Token token" } });
  });

  it("缺少 token 或模型版本时不发起请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ReplicateMediaAdapter("video");
    await expect(adapter.generate({ prompt: "test" })).rejects.toThrow("REPLICATE_API_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
