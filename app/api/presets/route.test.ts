import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { presetPayloadSchema } from "@/lib/core/preset";

const dir = mkdtempSync(path.join(tmpdir(), "dovedio-presets-"));
beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const URL = "http://localhost/api/presets";
const json = (method: string, body?: unknown) =>
  new Request(URL, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

const payload = () =>
  presetPayloadSchema.parse({
    settings: { aspects: ["9:16"], subtitle: { preset: "neon-cyan" } },
    visualStyle: null,
  });

describe("制作预设列表 API", () => {
  it("创建后列表可见，默认 id 为空", async () => {
    const { GET, POST } = await import("./route");
    const res = await POST(json("POST", { name: "  竖屏叙事  ", payload: payload() }));
    expect(res.status).toBe(201);
    const { preset } = await res.json();
    expect(preset.id).toEqual(expect.any(String));
    expect(preset.name).toBe("竖屏叙事");
    expect(preset.description).toBe("");
    expect(preset.payload.settings.aspects).toEqual(["9:16"]);

    const list = await (await GET()).json();
    expect(list.presets.map((p: { id: string }) => p.id)).toContain(preset.id);
    expect(list.defaultId).toBeNull();
  });

  it("GET 返回当前默认预设 id", async () => {
    const { setDefaultPreset } = await import("@/lib/server/presets");
    const { GET, POST } = await import("./route");
    const created = await (await POST(json("POST", { name: "默认预设", payload: payload() }))).json();
    setDefaultPreset(created.preset.id);
    const data = await (await GET()).json();
    expect(data.defaultId).toBe(created.preset.id);
  });

  it("payload 缺字段返回 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(json("POST", { name: "坏预设", payload: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual(expect.any(String));
  });

  it("名称为空或只有空格返回 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(json("POST", { name: "   ", payload: payload() }));
    expect(res.status).toBe(400);
  });
});
