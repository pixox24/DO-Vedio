import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("任务队列", () => {
  it("同 key 不重复提交，领取是原子的", async () => {
    const { enqueue, claim } = await import("@/lib/server/jobs");
    const a = enqueue({ projectId: "p", stage: "echo", key: "k1", input: {} });
    const b = enqueue({ projectId: "p", stage: "echo", key: "k1", input: {} });
    expect(b.id).toBe(a.id);
    const c1 = claim("w1", ["echo"]);
    const c2 = claim("w2", ["echo"]);
    expect(c1?.id).toBe(a.id);
    expect(c2).toBeUndefined();
  });

  it("同一配音键在不同项目中分别排队", async () => {
    const { enqueue, latestJobByKey } = await import("@/lib/server/jobs");
    const a = enqueue({ projectId: "tts-project-a", stage: "tts", key: "tts:shared", input: {} });
    const b = enqueue({ projectId: "tts-project-b", stage: "tts", key: "tts:shared", input: {} });
    expect(b.id).not.toBe(a.id);
    expect(latestJobByKey("tts:shared", "tts-project-a")?.id).toBe(a.id);
    expect(latestJobByKey("tts:shared", "tts-project-b")?.id).toBe(b.id);
  });

  it("按自动制作目标取消时不会误伤同项目独立任务", async () => {
    const { enqueue, cancelProjectJobsByGoal, getJob } = await import("@/lib/server/jobs");
    const goalJob = enqueue({ projectId: "goal-project", stage: "goal-echo", key: "goal-job", input: { goalId: "goal-a" } });
    const otherJob = enqueue({ projectId: "goal-project", stage: "goal-echo", key: "other-job", input: { batchId: "panel-batch" } });
    const result = cancelProjectJobsByGoal("goal-project", "goal-a");
    expect(result.ids).toContain(goalJob.id);
    expect(getJob(goalJob.id)?.status).toBe("canceled");
    expect(getJob(otherJob.id)?.status).toBe("queued");
  });

  it("租约过期的任务回到队列（Worker 崩溃恢复）", async () => {
    const { enqueue, claim, recoverExpired, getJob } = await import("@/lib/server/jobs");
    const { run } = await import("@/lib/server/db");
    const j = enqueue({ projectId: "p", stage: "echo", key: "k2", input: {} });
    claim("dead-worker", ["echo"]);
    run("UPDATE jobs SET lease_until = ? WHERE id = ?", Date.now() - 1, j.id);
    expect(recoverExpired()).toBeGreaterThanOrEqual(1);
    expect(getJob(j.id)?.status).toBe("queued");
    const again = claim("w3", ["echo"]);
    expect(again?.id).toBe(j.id);
    expect(again?.attempts).toBe(2);
  });

  it("取消后重试会使旧执行代次失效", async () => {
    const { enqueue, claim, cancelJob, retryJob, succeed, getJob } = await import("@/lib/server/jobs");
    const job = enqueue({ projectId: "p", stage: "echo", key: "generation-token", input: {} });
    const old = claim("old-worker", ["echo"]);
    expect(old?.lockToken).toBeTruthy();
    expect(cancelJob(job.id)).toBe(true);
    expect(retryJob(job.id)).toBe(true);
    const next = claim("new-worker", ["echo"]);
    expect(next?.lockToken).toBeTruthy();
    expect(next?.lockToken).not.toBe(old?.lockToken);
    expect(succeed(job.id, "old-worker", { stale: true }, 0, old?.lockToken)).toBe(false);
    expect(getJob(job.id)?.status).toBe("running");
    expect(succeed(job.id, "new-worker", { fresh: true }, 0, next?.lockToken)).toBe(true);
    expect(getJob(job.id)?.result).toEqual({ fresh: true });
  });

  it("可重试错误退避后重新排队，永久错误直接失败", async () => {
    const { enqueue, claim, failJob, getJob } = await import("@/lib/server/jobs");
    const { run } = await import("@/lib/server/db");
    run("UPDATE jobs SET status = 'succeeded'");
    const j = enqueue({ projectId: "p", stage: "echo", key: "k3", input: {}, maxAttempts: 2 });
    claim("w", ["echo"]);
    failJob(j.id, "w", "网络错误", true);
    expect(getJob(j.id)?.status).toBe("queued");
    expect(getJob(j.id)!.runAfter).toBeGreaterThan(Date.now());
    run("UPDATE jobs SET run_after = 0 WHERE id = ?", j.id);
    claim("w", ["echo"]);
    failJob(j.id, "w", "网络错误", true);
    expect(getJob(j.id)?.status).toBe("failed");

    const k = enqueue({ projectId: "p", stage: "echo", key: "k4", input: {} });
    claim("w", ["echo"]);
    failJob(k.id, "w", "审核不通过", false);
    expect(getJob(k.id)?.status).toBe("failed");
  });

  it("队列不会早于上游建议时间重试", async () => {
    const { enqueue, claim, failJob, getJob } = await import("@/lib/server/jobs");
    const job = enqueue({ projectId: "p", stage: "echo", key: "retry-after", input: {} });
    claim("w", ["echo"]);
    const now = Date.now();
    failJob(job.id, "w", "配额限制", true, 21_850);
    expect(getJob(job.id)?.status).toBe("queued");
    expect(getJob(job.id)!.runAfter).toBeGreaterThanOrEqual(now + 21_850);
  });

  it("Worker 端到端：执行、重试、取消", async () => {
    const { enqueue, getJob, cancelJob } = await import("@/lib/server/jobs");
    const { run } = await import("@/lib/server/db");
    const { startLoop } = await import("@/worker/loop");
    const { echoStage } = await import("@/lib/pipeline/stages/echo");
    run("UPDATE jobs SET status = 'succeeded'");
    const settled: string[] = [];
    const w = startLoop({ stages: [echoStage as never], pollMs: 20, log: () => {}, onSettled: (j) => void settled.push(j.id) });
    const ok = enqueue({ projectId: "p", stage: "echo", key: "e1", input: { ms: 100, value: 42 } });
    const flaky = enqueue({ projectId: "p", stage: "echo", key: "e2", input: { ms: 50, failTimes: 1 } });
    const slow = enqueue({ projectId: "p", stage: "echo", key: "e3", input: { ms: 5000 } });
    const until = async (fn: () => boolean, ms = 8000) => {
      const end = Date.now() + ms;
      while (!fn()) {
        if (Date.now() > end) throw new Error("超时");
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    await until(() => getJob(ok.id)?.status === "succeeded");
    expect(getJob(ok.id)?.result).toEqual({ echoed: 42 });
    // 第一次失败后退避 2 秒再重试
    run("UPDATE jobs SET run_after = 0 WHERE id = ? AND status = 'queued'", flaky.id);
    await until(() => getJob(flaky.id)?.status === "succeeded" || (run("UPDATE jobs SET run_after = 0 WHERE id = ? AND status = 'queued'", flaky.id), false));
    expect(getJob(flaky.id)?.attempts).toBe(2);
    await until(() => getJob(slow.id)?.status === "running");
    cancelJob(slow.id);
    // 取消在下一次上报进度时生效
    await until(() => !w.active.has(slow.id));
    expect(getJob(slow.id)?.status).toBe("canceled");
    await w.stop();
    expect(settled).toContain(ok.id);
  }, 20000);
});
