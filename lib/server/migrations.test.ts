import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { openDb } from "./db";

describe("复创持久化迁移", () => {
  it("迁移可重入并保留已有项目；数据库拒绝同草稿的两个活动任务", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dovedio-viral-migration-"));
    const file = path.join(dir, "app.db");
    let database = openDb(file);
    try {
      database.prepare("INSERT INTO projects (id, title, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("existing", "原项目", "{}", 1, 1);
      database.prepare("INSERT INTO viral_drafts (id, revision, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("draft", 1, "{}", 1, 1);
      database.prepare("INSERT INTO viral_snapshots (id, draft_id, body, created_at) VALUES (?, ?, ?, ?)").run("snapshot", "draft", "{}", 1);
      const insert = database.prepare("INSERT INTO viral_tasks (id, draft_id, snapshot_id, generation, status, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      insert.run("first", "draft", "snapshot", 1, "queued", "{}", 1, 1);
      expect(() => insert.run("duplicate", "draft", "snapshot", 2, "running", "{}", 2, 2)).toThrow();
      database.prepare("UPDATE viral_tasks SET status = 'stopped' WHERE id = 'first'").run();
      insert.run("second", "draft", "snapshot", 2, "queued", "{}", 2, 2);
      database.close();
      database = openDb(file);
      expect(database.prepare("SELECT title FROM projects WHERE id = 'existing'").get()).toMatchObject({ title: "原项目" });
      expect(database.prepare("SELECT COUNT(*) AS count FROM viral_tasks").get()).toMatchObject({ count: 2 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id = 22").get()).toMatchObject({ count: 1 });
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
