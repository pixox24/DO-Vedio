import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDoc, visualStyleInputSchema } from "@/lib/core/types";
import { builtinVisualStyles } from "@/lib/visual-styles/builtin";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-visual-styles-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("风格库", () => {
  it("自定义风格可以增删改，内置风格不可修改", async () => {
    const store = await import("@/lib/visual-styles/store");
    const input = { ...visualStyleInputSchema.parse(builtinVisualStyles[0]), name: "我的风格" };
    const created = await store.createVisualStyle(input);
    expect((await store.listVisualStyles()).map((s) => s.id)).toContain(created.id);
    expect((await store.updateVisualStyle(created.id, { ...input, name: "改名" }))?.name).toBe("改名");
    expect(await store.updateVisualStyle(builtinVisualStyles[0].id, input)).toBeUndefined();
    expect(await store.deleteVisualStyle(builtinVisualStyles[0].id)).toBe(false);
    expect(await store.deleteVisualStyle(created.id)).toBe(true);
    expect(await store.getVisualStyle(created.id)).toBeUndefined();
  });

  it("生图前没选风格时写入推荐风格快照，已选的不动", async () => {
    const { createProject, mutateProject } = await import("@/lib/server/projects");
    const { ensureProjectVisualStyle } = await import("@/lib/visual-styles/store");
    const doc = emptyDoc();
    doc.brief = { ...doc.brief, title: "悬疑片", templateId: "suspense" };
    const project = createProject(doc);
    expect((await ensureProjectVisualStyle(project.id))?.doc.visualStyle?.id).toBe("noir-suspense");
    const chosen = builtinVisualStyles.find((s) => s.id === "anime")!;
    mutateProject(project.id, (d) => ({ ...d, visualStyle: { ...chosen, lighting: "项目微调" } }));
    const again = await ensureProjectVisualStyle(project.id);
    expect(again?.doc.visualStyle).toMatchObject({ id: "anime", lighting: "项目微调" });
  });
});
