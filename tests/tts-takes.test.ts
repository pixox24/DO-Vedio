import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job } from "@/lib/core/types";
import type { TtsResult } from "@/lib/core/keys";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-tts-takes-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const result = (assetId: string): TtsResult => ({ assetId, durationMs: 1000, speechStartMs: 0, speechEndMs: 1000, chars: [], aligned: false, spokenChars: 4 });
const context = (projectId: string): import("@/lib/pipeline/stage").StageContext => ({
  job: { id: "take-job", projectId } as Job,
  signal: new AbortController().signal,
  current: () => true,
  progress() {},
  spend: () => 0,
  log() {},
});

describe("配音重录归档", () => {
  it("只有 force 覆盖才归档，撤销后第二次不能继续回退", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { cacheGet, cachePut } = await import("@/lib/server/cache");
    const { commitCache, undoLastTake } = await import("@/lib/pipeline/tts-common");
    const project = createProject((await import("@/lib/core/types")).emptyDoc());
    const ctx = context(project.id);
    cachePut("tts:test", "tts", result("old"));

    commitCache(ctx, [["tts:test", result("automatic")]], "revoice", false);
    expect(cacheGet<TtsResult>("tts:test")?.assetId).toBe("automatic");
    expect(undoLastTake(project.id, ["tts:test"])).toBe(0);

    commitCache(ctx, [["tts:test", result("forced")]], "revoice", true);
    expect(cacheGet<TtsResult>("tts:test")?.assetId).toBe("forced");
    expect(undoLastTake(project.id, ["tts:test"])).toBe(1);
    expect(cacheGet<TtsResult>("tts:test")?.assetId).toBe("automatic");
    expect(undoLastTake(project.id, ["tts:test"])).toBe(0);
  });

  it("批量撤销是原子的，缺一条归档就不恢复任何 key", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { cacheGet, cachePut } = await import("@/lib/server/cache");
    const { commitCache, undoLastTake } = await import("@/lib/pipeline/tts-common");
    const project = createProject((await import("@/lib/core/types")).emptyDoc());
    const ctx = context(project.id);
    cachePut("tts:a", "tts", result("a-old"));
    cachePut("tts:b", "tts", result("b-old"));
    commitCache(ctx, [["tts:a", result("a-new")], ["tts:b", result("b-new")]], "revoice", true);
    expect(undoLastTake(project.id, ["tts:a", "tts:missing"])).toBe(0);
    expect(cacheGet<TtsResult>("tts:a")?.assetId).toBe("a-new");
    expect(undoLastTake(project.id, ["tts:a", "tts:b"])).toBe(2);
    expect(cacheGet<TtsResult>("tts:a")?.assetId).toBe("a-old");
    expect(cacheGet<TtsResult>("tts:b")?.assetId).toBe("b-old");
  });

  it("清理旧任务时同步清理过期归档", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { run, all } = await import("@/lib/server/db");
    const { pruneJobs } = await import("@/lib/server/jobs");
    const project = createProject((await import("@/lib/core/types")).emptyDoc());
    const old = Date.now() - 31 * 86400_000;
    run("INSERT INTO tts_takes (project_id, cache_key, result, archived_at, reason) VALUES (?, ?, ?, ?, ?)", project.id, "tts:old", JSON.stringify(result("old")), old, "revoice");
    run("INSERT INTO jobs (id, project_id, stage, key, target, status, priority, max_attempts, cost_estimate, input, run_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'succeeded', 5, 3, 0, '{}', 0, ?, ?)", "old-job", project.id, "tts", "old-key", "旧任务", old, old);
    pruneJobs(30 * 86400_000);
    expect(all("SELECT id FROM tts_takes WHERE project_id = ?", project.id)).toHaveLength(0);
  });
});
