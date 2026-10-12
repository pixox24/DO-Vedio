import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "dovedio-motions-"));

beforeAll(() => {
  process.env.DATA_DIR = dir;
});

beforeEach(async () => {
  const { run } = await import("@/lib/server/db");
  run("DELETE FROM motion_notes");
});

afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("待做成", () => {
  it("新的在前，删掉的不能再删", async () => {
    const { createMotionNote, deleteMotionNote, listMotionNotes } = await import("@/lib/server/motion-notes");
    const first = createMotionNote({ name: "推近", summary: "镜头慢慢靠近主体。", link: "", shelf: "camera", energy: "low" });
    const second = createMotionNote({ name: "墨线", summary: "想收成文字动画。", link: "https://example.com", shelf: "text", energy: "mid" });
    expect(listMotionNotes().map((note) => note.id)).toEqual([second.id, first.id]);
    expect(second.link).toBe("https://example.com");
    expect(deleteMotionNote(first.id)).toBe(true);
    expect(deleteMotionNote(first.id)).toBe(false);
    expect(listMotionNotes().map((note) => note.name)).toEqual(["墨线"]);
  });

  it("接口拒绝空名称，并列出已保存的参考", async () => {
    const { POST, GET } = await import("@/app/api/motions/notes/route");
    const rejected = await POST(new Request("http://localhost/api/motions/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "  ", summary: "一句", shelf: "text", energy: "low" }),
    }));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ error: "请填写名称" });

    const created = await POST(new Request("http://localhost/api/motions/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "转场参考", summary: "两镜之间轻轻叠化。", link: "", shelf: "transition", energy: "high" }),
    }));
    expect(created.status).toBe(200);
    const body = await GET();
    const notes = await body.json();
    expect(notes.map((note: { name: string }) => note.name)).toEqual(["转场参考"]);
  });
});
