import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDoc, visualStyleInputSchema } from "@/lib/core/types";
import { aixFixture } from "@/lib/aix/test-fixture";

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
  it("自定义风格可以增删改，系统 Aix 风格不可修改", async () => {
    const store = await import("@/lib/visual-styles/store");
    const input = { ...visualStyleInputSchema.parse(aixFixture()), name: "我的风格" };
    const created = await store.createVisualStyle(input);
    expect((await store.listVisualStyles()).map((s) => s.id)).toContain(created.id);
    expect((await store.updateVisualStyle(created.id, { ...input, name: "改名" }))?.name).toBe("改名");
    expect(await store.updateVisualStyle("Aix0001", input)).toBeUndefined();
    expect(await store.deleteVisualStyle("Aix0001")).toBe(false);
    expect(await store.deleteVisualStyle(created.id)).toBe(true);
    expect(await store.getVisualStyle(created.id)).toBeUndefined();
  });

  it("生图前没选风格时写入推荐风格快照，已选的不动", async () => {
    const { createProject, mutateProject } = await import("@/lib/server/projects");
    const { ensureProjectVisualStyle } = await import("@/lib/visual-styles/store");
    const doc = emptyDoc();
    doc.brief = { ...doc.brief, title: "悬疑片", templateId: "suspense" };
    const project = createProject(doc);
    // 悬疑按 template-map 推荐暗调霓虹，而不是目录里排序最前的那张
    expect((await ensureProjectVisualStyle(project.id))?.doc.visualStyle?.id).toBe("Aix0008");
    expect((await ensureProjectVisualStyle(project.id))?.doc.visualStyle?.motion.preset).toBe("neon-hud");
    const chosen = aixFixture({ id: "Aix0002", name: "另一个 Aix 风格" });
    mutateProject(project.id, (d) => ({ ...d, visualStyle: { ...chosen, lighting: "项目微调" } }));
    const again = await ensureProjectVisualStyle(project.id);
    expect(again?.doc.visualStyle).toMatchObject({ id: "Aix0002", lighting: "项目微调" });
  });
});
