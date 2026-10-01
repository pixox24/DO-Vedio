import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { presetPayloadSchema } from "@/lib/core/preset";
import { emptyDoc, visualStyleSchema } from "@/lib/core/types";

const dir = mkdtempSync(path.join(tmpdir(), "dovedio-project-presets-"));
beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const json = (url: string, method: string, body?: unknown) =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

function style(name: string) {
  return visualStyleSchema.parse({
    id: `style-${name}`,
    name,
    medium: "cinematic",
    palette: { schemes: [["#000000", "#111111", "#222222"]], accent: "#22d3ee" },
  });
}

function payload(overrides: { aspect?: "16:9" | "9:16"; subtitle?: "neon-cyan" | "classic-contrast"; voiceId?: string; styleName?: string; budget?: number } = {}) {
  const { aspect = "9:16", subtitle = "neon-cyan", voiceId = "Kore", styleName = "霓虹夜城", budget = 200 } = overrides;
  return presetPayloadSchema.parse({
    settings: {
      aspects: [aspect],
      outputSpecIds: [aspect === "9:16" ? "portrait-1080p" : "landscape-1080p"],
      previewAspect: aspect,
      assetFraming: "shared",
      voice: { provider: "google-gemini", model: "gemini-tts", voiceId, rate: 1.2, granularity: "paragraph" },
      subtitle: { preset: subtitle, fontSize: 34, bilingual: true },
      music: { enabled: false, gainDb: -6 },
      sfx: { enabled: false },
      aiLabel: { enabled: false, position: "top-left" },
      budgetYuan: budget,
      pauseAfterPreview: true,
      modelId: "claude",
    },
    visualStyle: style(styleName),
  });
}

let defaultPresetId = "";
let otherPresetId = "";

beforeAll(async () => {
  const { POST: createPreset } = await import("@/app/api/presets/route");
  const { POST: setDefault } = await import("@/app/api/presets/[id]/default/route");

  const first = await (await createPreset(json("http://localhost/api/presets", "POST", { name: "竖屏叙事", payload: payload() }))).json();
  defaultPresetId = first.preset.id;
  const set = await setDefault(json(`http://localhost/api/presets/${defaultPresetId}/default`, "POST"), { params: Promise.resolve({ id: defaultPresetId }) });
  expect(set.status).toBe(200);

  const second = await (await createPreset(json("http://localhost/api/presets", "POST", { name: "横屏极简", payload: payload({ aspect: "16:9", subtitle: "classic-contrast", voiceId: "longanyang", styleName: "极简白", budget: 50 }) }))).json();
  otherPresetId = second.preset.id;
});

async function createProject(body: unknown) {
  const { POST } = await import("./route");
  return POST(json("http://localhost/api/projects", "POST", body));
}

describe("新建项目应用制作预设", () => {
  it("不传 presetId 时应用默认预设（含预算）", async () => {
    const res = await createProject({});
    expect(res.status).toBe(200);
    const project = await res.json();
    expect(project.doc.settings.aspects).toEqual(["9:16"]);
    expect(project.doc.settings.subtitle.preset).toBe("neon-cyan");
    expect(project.doc.settings.voice.voiceId).toBe("Kore");
    expect(project.doc.visualStyle.name).toBe("霓虹夜城");
    expect(project.doc.settings.budgetYuan).toBe(200);
  });

  it("presetId 传 null 时不应用预设", async () => {
    const res = await createProject({ presetId: null });
    expect(res.status).toBe(200);
    const project = await res.json();
    expect(project.doc.settings.aspects).toEqual(["16:9"]);
    expect(project.doc.settings.subtitle.preset).toBe("viral-yellow");
    expect(project.doc.settings.voice.voiceId).toBe("longanyang");
    expect(project.doc.visualStyle).toBeNull();
    expect(project.doc.settings.budgetYuan).toBeNull();
  });

  it("presetId 不存在返回 404", async () => {
    const res = await createProject({ presetId: "missing-preset" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("预设不存在");
  });

  it("传指定 presetId 时应用该预设而不是默认预设", async () => {
    const res = await createProject({ presetId: otherPresetId });
    expect(res.status).toBe(200);
    const project = await res.json();
    expect(project.doc.settings.aspects).toEqual(["16:9"]);
    expect(project.doc.settings.subtitle.preset).toBe("classic-contrast");
    expect(project.doc.settings.voice.voiceId).toBe("longanyang");
    expect(project.doc.visualStyle.name).toBe("极简白");
    expect(project.doc.settings.budgetYuan).toBe(50);
  });

  it("传 doc + presetId 时预设覆盖设置但保留 brief 与内容", async () => {
    const doc = emptyDoc();
    doc.brief.title = "我的草稿";
    doc.brief.summary = "已写好的概要";
    doc.modelId = "local-model";
    const res = await createProject({ doc, presetId: defaultPresetId });
    expect(res.status).toBe(200);
    const project = await res.json();
    expect(project.doc.brief.title).toBe("我的草稿");
    expect(project.doc.brief.summary).toBe("已写好的概要");
    expect(project.doc.settings.aspects).toEqual(["9:16"]);
    expect(project.doc.modelId).toBe("claude");
  });
});
