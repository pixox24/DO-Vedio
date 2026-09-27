import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir = "";
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "dovedio-versions-")); process.env.DATA_DIR = dir; });
afterAll(async () => { (await import("@/lib/server/db")).closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe("项目版本", () => {
  it("迁移、按项目列出、限制 50 条并可连续恢复", async () => {
    const { createProject, saveProject, RevisionConflict } = await import("@/lib/server/projects");
    const { createVersion, getVersion, listVersions, restoreVersion } = await import("@/lib/server/versions");
    const a = createProject();
    const b = createProject();
    const original = saveProject(a.id, { ...a.doc, brief: { ...a.doc.brief, title: "原稿" } }, a.revision)!;
    const first = createVersion(a.id, original.revision, "全文重写前")!;
    expect(getVersion(a.id, first)?.doc.brief.title).toBe("原稿");
    expect(listVersions(b.id)).toHaveLength(0);
    expect(() => createVersion(a.id, a.revision, "旧 revision")).toThrow(RevisionConflict);
    const changed = saveProject(a.id, { ...original.doc, brief: { ...original.doc.brief, title: "新稿" } }, original.revision)!;
    const restored = restoreVersion(a.id, first, changed.revision)!;
    expect(restored.doc.brief.title).toBe("原稿");
    const beforeRestore = listVersions(a.id).find((v) => v.label === "恢复版本前")!;
    expect(() => restoreVersion(a.id, beforeRestore.id, changed.revision)).toThrow(RevisionConflict);
    const again = restoreVersion(a.id, beforeRestore.id, restored.revision)!;
    expect(again.doc.brief.title).toBe("新稿");
    for (let i = 0; i < 55; i++) createVersion(a.id, again.revision, `留档 ${i}`);
    expect(listVersions(a.id)).toHaveLength(50);
    expect(listVersions(a.id)[0].label).toBe("留档 54");
  });
});
