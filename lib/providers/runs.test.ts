import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-runs-"));
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  (await import("../server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("GenerationRun", () => {
  it("记录成功、失败和取消，并返回脱敏参数", async () => {
    const { beginGenerationRun, failGenerationRun, finishGenerationRun, listGenerationRuns } = await import("./runs");
    const input = { projectId: "project-1", jobId: "job-1", providerId: "deepseek", modelId: "deepseek-chat", kind: "text" as const, inputHash: "hash-1", params: { stage: "annotate", lineCount: 2 } };
    const success = beginGenerationRun(input);
    finishGenerationRun(success.id, { status: "succeeded", latencyMs: 12, costYuan: 0.01, ledgerId: 7 });
    const failed = beginGenerationRun({ ...input, inputHash: "hash-2" });
    failGenerationRun(failed, new Error("限流"));
    const canceled = beginGenerationRun({ ...input, inputHash: "hash-3" });
    failGenerationRun(canceled, new DOMException("已取消", "AbortError"), true);

    const runs = listGenerationRuns("project-1");
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.status).sort()).toEqual(["canceled", "failed", "succeeded"]);
    expect(runs.find((r) => r.inputHash === "hash-1")?.params).toEqual({ stage: "annotate", lineCount: 2 });
    expect(runs.find((r) => r.inputHash === "hash-1")?.ledgerId).toBe(7);
  });
});
