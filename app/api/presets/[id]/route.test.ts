import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { presetPayloadSchema } from "@/lib/core/preset";

const dir = mkdtempSync(path.join(tmpdir(), "dovedio-preset-id-"));
beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const payload = (aspect: "16:9" | "9:16" = "9:16") =>
  presetPayloadSchema.parse({
    settings: { aspects: [aspect], subtitle: { preset: "neon-cyan" }, budgetYuan: 88 },
    visualStyle: null,
  });

const json = (url: string, method: string, body?: unknown) =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

const url = (id: string) => `http://localhost/api/presets/${id}`;

async function create(name: string, aspect: "16:9" | "9:16" = "9:16") {
  const { POST } = await import("@/app/api/presets/route");
  const res = await POST(json("http://localhost/api/presets", "POST", { name, payload: payload(aspect) }));
  expect(res.status).toBe(201);
  return (await res.json()).preset as { id: string; name: string };
}

describe("制作预设详情 API", () => {
  it("PATCH 改名与更新 payload", async () => {
    const { PATCH } = await import("./route");
    const preset = await create("旧名字");
    const res = await PATCH(json(url(preset.id), "PATCH", { name: "新名字", description: "说明", payload: payload("16:9") }), {
      params: Promise.resolve({ id: preset.id }),
    });
    expect(res.status).toBe(200);
    const { preset: updated } = await res.json();
    expect(updated.name).toBe("新名字");
    expect(updated.description).toBe("说明");
    expect(updated.payload.settings.aspects).toEqual(["16:9"]);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(updated.createdAt);
  });

  it("PATCH 不存在的预设返回 404", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(json(url("missing"), "PATCH", { name: "x" }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("DELETE 删除预设，重复删除返回 404", async () => {
    const { DELETE } = await import("./route");
    const preset = await create("待删除");
    const res = await DELETE(json(url(preset.id), "DELETE"), { params: Promise.resolve({ id: preset.id }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const again = await DELETE(json(url(preset.id), "DELETE"), { params: Promise.resolve({ id: preset.id }) });
    expect(again.status).toBe(404);
  });

  it("删除默认预设后默认指针清空", async () => {
    const { DELETE } = await import("./route");
    const { getDefaultPresetId, setDefaultPreset } = await import("@/lib/server/presets");
    const preset = await create("默认预设");
    setDefaultPreset(preset.id);
    expect(getDefaultPresetId()).toBe(preset.id);
    await DELETE(json(url(preset.id), "DELETE"), { params: Promise.resolve({ id: preset.id }) });
    expect(getDefaultPresetId()).toBeNull();
  });

  it("设为默认、清除默认且清除操作幂等", async () => {
    const { POST, DELETE } = await import("./default/route");
    const { getDefaultPresetId } = await import("@/lib/server/presets");
    const preset = await create("要设为默认");
    const set = await POST(json(`${url(preset.id)}/default`, "POST"), { params: Promise.resolve({ id: preset.id }) });
    expect(set.status).toBe(200);
    expect((await set.json()).defaultId).toBe(preset.id);
    expect(getDefaultPresetId()).toBe(preset.id);

    const clear = await DELETE(json(`${url(preset.id)}/default`, "DELETE"), { params: Promise.resolve({ id: preset.id }) });
    expect(clear.status).toBe(200);
    expect((await clear.json()).defaultId).toBeNull();
    expect(getDefaultPresetId()).toBeNull();

    const idempotent = await DELETE(json(`${url(preset.id)}/default`, "DELETE"), { params: Promise.resolve({ id: preset.id }) });
    expect(idempotent.status).toBe(200);
    expect((await idempotent.json()).defaultId).toBeNull();
  });

  it("设为默认时预设不存在返回 404", async () => {
    const { POST } = await import("./default/route");
    const res = await POST(json(url("missing") + "/default", "POST"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });
});
