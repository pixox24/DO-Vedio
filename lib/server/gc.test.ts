import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "dovedio-gc-"));
beforeAll(() => {
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("./db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

const touch = (target: string, ageMs: number) => {
  const t = (Date.now() - ageMs) / 1000;
  utimesSync(target, t, t);
};

it("回收无引用素材，保留被项目和版本引用的素材，并失效指向孤儿的缓存", async () => {
  const { createProject, saveProject } = await import("./projects");
  const { getAsset, mediaPath, putBuffer } = await import("./media");
  const { cacheGet, cachePut } = await import("./cache");
  const { gcOrphanAssets, reachableHashes } = await import("./gc");
  const { emptyDoc } = await import("../core/types");
  const { run } = await import("./db");

  const kept = await putBuffer(Buffer.from("kept"), { ext: "txt", mime: "text/plain", probe: false });
  const orphan = await putBuffer(Buffer.from("orphan"), { ext: "txt", mime: "text/plain", probe: false });
  const project = createProject(emptyDoc());
  saveProject(project.id, { ...project.doc, brief: { ...project.doc.brief, summary: `引用 ${kept.hash}` } }, null);
  cachePut("tts:orphan", "tts", { assetId: orphan.hash });
  run("UPDATE assets SET created_at = 0");

  const reachable = reachableHashes();
  expect(reachable.has(kept.hash)).toBe(true);
  expect(reachable.has(orphan.hash)).toBe(false);

  const result = await gcOrphanAssets({ graceMs: 0 });
  expect(result.removed).toBe(1);
  expect(result.cacheRows).toBe(1);
  expect(getAsset(kept.hash)).toBeTruthy();
  expect(getAsset(orphan.hash)).toBeUndefined();
  expect(existsSync(mediaPath(kept.hash, "txt"))).toBe(true);
  expect(existsSync(mediaPath(orphan.hash, "txt"))).toBe(false);
  expect(cacheGet("tts:orphan")).toBeUndefined();
});

it("宽限期内不回收刚生成的素材", async () => {
  const { getAsset, putBuffer } = await import("./media");
  const { gcOrphanAssets } = await import("./gc");
  const fresh = await putBuffer(Buffer.from("fresh"), { ext: "txt", mime: "text/plain", probe: false });
  const result = await gcOrphanAssets();
  expect(result.removed).toBe(0);
  expect(getAsset(fresh.hash)).toBeTruthy();
});

it("彻底删除只处理回收站项目，恢复后不再可彻底删除", async () => {
  const { createProject, deleteProject, restoreProject } = await import("./projects");
  const { purgeProjects } = await import("./gc");
  const { emptyDoc } = await import("../core/types");
  const { all, run } = await import("./db");
  const { putBuffer } = await import("./media");

  const project = createProject(emptyDoc());
  run(
    "INSERT INTO jobs (id, project_id, stage, key, target, status, priority, max_attempts, cost_estimate, input, run_after, created_at, updated_at) VALUES ('gc-job', ?, 'tts', 'k', '', 'succeeded', 5, 3, 0, ?, 0, 0, 0)",
    project.id,
    JSON.stringify({ assetId: (await putBuffer(Buffer.from("job-audio"), { ext: "txt", mime: "text/plain", probe: false })).hash }),
  );

  expect(purgeProjects([project.id]).projects).toBe(0);
  expect(deleteProject(project.id)).toBe(true);
  expect(restoreProject(project.id)).toBe(true);
  expect(purgeProjects([project.id]).projects).toBe(0);
  expect(deleteProject(project.id)).toBe(true);
  const purged = purgeProjects([project.id]);
  expect(purged.projects).toBe(1);
  expect(purged.rows.jobs).toBe(1);
  expect(all("SELECT id FROM projects WHERE id = ?", project.id)).toHaveLength(0);
});

it("打包缓存保留最新目录并保护正在使用的签名", async () => {
  const { pruneBundles } = await import("./gc");
  const root = path.join(dir, "bundles");
  const mk = (name: string, ageMs: number) => {
    mkdirSync(path.join(root, name), { recursive: true });
    writeFileSync(path.join(root, name, "index.html"), "x".repeat(1000));
    touch(path.join(root, name), ageMs);
  };
  mk("11111111111111111111111111111111", 4 * 86400_000);
  mk("22222222222222222222222222222222", 3 * 86400_000);
  mk("33333333333333333333333333333333", 2 * 86400_000);
  mk("44444444444444444444444444444444", 1 * 86400_000 + 60_000);

  const result = await pruneBundles({ keep: 1, minAgeMs: 0, keepSigs: ["11111111111111111111111111111111"] });
  expect(result.removed).toBe(2);
  expect(result.freedBytes).toBeGreaterThan(0);
  expect(existsSync(path.join(root, "11111111111111111111111111111111"))).toBe(true);
  expect(existsSync(path.join(root, "22222222222222222222222222222222"))).toBe(false);
  expect(existsSync(path.join(root, "33333333333333333333333333333333"))).toBe(false);
  expect(existsSync(path.join(root, "44444444444444444444444444444444"))).toBe(true);
});

it("临时文件只清理超过保留期的", async () => {
  const { pruneTemp } = await import("./gc");
  const tmp = path.join(dir, "tmp");
  mkdirSync(tmp, { recursive: true });
  writeFileSync(path.join(tmp, "old.mp4"), Buffer.alloc(100));
  writeFileSync(path.join(tmp, "new.mp4"), Buffer.alloc(50));
  touch(path.join(tmp, "old.mp4"), 2 * 86400_000);

  const result = await pruneTemp();
  expect(result.removed).toBe(1);
  expect(result.freedBytes).toBe(100);
  expect(existsSync(path.join(tmp, "old.mp4"))).toBe(false);
  expect(existsSync(path.join(tmp, "new.mp4"))).toBe(true);
});
