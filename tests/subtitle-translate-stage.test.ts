import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDoc, type Job } from "@/lib/core/types";

const llm = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/llm", () => ({ generateJson: llm.generateJson }));

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-subtitle-stage-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  llm.generateJson.mockReset();
});

function ctx() {
  return {
    job: { id: "job-1", key: "subtitle-translate:test" } as Job,
    signal: new AbortController().signal,
    current: () => true,
    progress() {},
    spend: () => 1,
    log() {},
  };
}

describe("字幕翻译步骤", () => {
  it("双语关着时不调用模型", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { subtitleTranslateStage } = await import("@/lib/pipeline/stages/subtitle-translate");
    const doc = emptyDoc();
    doc.lines = [{ id: "a", segmentIndex: 0, text: "你好世界", spans: [], keywords: [], locked: true }];
    const project = createProject(doc);
    const result = await subtitleTranslateStage.run({ projectId: project.id, modelId: "deepseek" }, ctx());
    expect(result).toEqual({ translated: 0 });
    expect(llm.generateJson).not.toHaveBeenCalled();
  });

  it("译完后写回副行", async () => {
    const { createProject, getProject } = await import("@/lib/server/projects");
    const { subtitleTranslateStage } = await import("@/lib/pipeline/stages/subtitle-translate");
    const { primaryHash } = await import("@/lib/core/subtitle/secondary");
    llm.generateJson.mockResolvedValue({ items: [{ id: "a", text: "Hello world" }] });
    const doc = emptyDoc();
    doc.settings.subtitle.bilingual = true;
    doc.lines = [{ id: "a", segmentIndex: 0, text: "你好世界", spans: [], keywords: [], locked: true }];
    const project = createProject(doc);
    const result = await subtitleTranslateStage.run({ projectId: project.id, modelId: "deepseek" }, ctx());
    expect(result).toEqual({ translated: 1 });
    expect(getProject(project.id)?.doc.lines[0]).toMatchObject({ secondaryText: "Hello world", secondaryHash: primaryHash("你好世界") });
  });

  it("有句子没译出时保留已成功的句子并失败", async () => {
    const { createProject, getProject } = await import("@/lib/server/projects");
    const { subtitleTranslateStage } = await import("@/lib/pipeline/stages/subtitle-translate");
    llm.generateJson.mockImplementation(async (_model: string, _schema: unknown, prompt: { prompt: string }) => {
      if (prompt.prompt.includes("id=a")) return { items: [{ id: "a", text: "Hello world" }] };
      return { items: [{ id: "b", text: "还是中文" }] };
    });
    const doc = emptyDoc();
    doc.settings.subtitle.bilingual = true;
    doc.lines = [
      { id: "a", segmentIndex: 0, text: "你好世界", spans: [], keywords: [], locked: true },
      { id: "b", segmentIndex: 0, text: "第二句口播", spans: [], keywords: [], locked: true },
    ];
    const project = createProject(doc);
    await expect(subtitleTranslateStage.run({ projectId: project.id, modelId: "deepseek" }, ctx())).rejects.toThrow(/还有 1 句没有翻译/);
    const lines = getProject(project.id)?.doc.lines ?? [];
    expect(lines[0].secondaryText).toBe("Hello world");
    expect(lines[1].secondaryText).toBeUndefined();
  });
});
