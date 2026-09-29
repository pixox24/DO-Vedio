import { hostname } from "os";
import { randomUUID } from "crypto";
import { db } from "../lib/server/db";
import { claim, failJob, heartbeat, recoverExpired, registerWorker, runningCounts, succeed, unregisterWorker, workerHeartbeat, pruneJobs } from "../lib/server/jobs";
import { ledger } from "../lib/server/cache";
import { errorMessage } from "../lib/llm";
import { isRetryable, type Stage } from "../lib/pipeline/stage";
import type { Job } from "../lib/core/types";

/**
 * 任务执行进程主循环：领取任务、并发限流、续租约、崩溃恢复、优雅退出。
 * 步骤完成后调用 onSettled，由编排层决定下一步（见 lib/pipeline/plan.ts）。
 */

export type LoopOptions = {
  stages: Stage<never, unknown>[];
  pollMs?: number;
  onSettled?: (job: Job, ok: boolean) => void | Promise<void>;
  log?: (...a: unknown[]) => void;
};

export function startLoop(opts: LoopOptions) {
  const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 6)}`;
  const log = opts.log ?? ((...a: unknown[]) => console.log(new Date().toLocaleTimeString("zh-CN"), ...a));
  const stages = new Map(opts.stages.map((s) => [s.name, s]));
  const limit = (s: Stage<never, unknown>) => Number(process.env[`WORKER_CONCURRENCY_${s.name.toUpperCase()}`]) || s.concurrency || 1;
  const active = new Map<string, { job: Job; ctrl: AbortController }>();
  let stopping = false;
  let wake: (() => void) | null = null;

  db();
  registerWorker(workerId, process.pid, hostname());
  const recovered = recoverExpired();
  if (recovered) log(`恢复了 ${recovered} 个中断的任务`);
  pruneJobs();

  const beat = setInterval(() => {
    workerHeartbeat(workerId);
    recoverExpired();
    for (const [id, a] of active) {
      // 续租约；返回 false 说明任务已被取消
      if (!heartbeat(id, workerId)) a.ctrl.abort(new DOMException("任务已取消", "AbortError"));
    }
  }, 10_000);

  async function execute(job: Job, stage: Stage<never, unknown>) {
    const ctrl = new AbortController();
    active.set(job.id, { job, ctrl });
    let lastBeat = 0;
    let spent = 0;
    const started = Date.now();
    log(`▶ ${job.stage}${job.target ? ` · ${job.target}` : ""}（第 ${job.attempts} 次）`);
    let ok = false;
    try {
      const result = await stage.run(job.input as never, {
        job,
        signal: ctrl.signal,
        progress(p, message) {
          const now = Date.now();
          if (now - lastBeat < 400 && p < 1) return;
          lastBeat = now;
          if (!heartbeat(job.id, workerId, p, message)) ctrl.abort(new DOMException("任务已取消", "AbortError"));
        },
        spend(e) {
          spent += e.costYuan;
          return ledger({ ...e, projectId: job.projectId, jobId: job.id });
        },
        log: (...a) => log(`  [${job.stage}]`, ...a),
      });
      if (ctrl.signal.aborted) throw ctrl.signal.reason;
      succeed(job.id, workerId, result, spent);
      ok = true;
      log(`✓ ${job.stage}${job.target ? ` · ${job.target}` : ""} ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (e) {
      const canceled = ctrl.signal.aborted;
      if (canceled) log(`■ ${job.stage} 已取消`);
      else {
        log(`✗ ${job.stage}${job.target ? ` · ${job.target}` : ""}：${errorMessage(e)}`);
        failJob(job.id, workerId, errorMessage(e), isRetryable(e), (e as { retryAfterMs?: number })?.retryAfterMs);
      }
    } finally {
      active.delete(job.id);
      wake?.();
    }
    try {
      await opts.onSettled?.(job, ok);
    } catch (e) {
      log("编排出错：", errorMessage(e));
    }
  }

  async function loop() {
    while (!stopping) {
      const running = runningCounts();
      // 只领取还有空闲并发的步骤；运行中计数来自数据库，多个 Worker 也能共同限流
      const free = [...stages.values()].filter((s) => (running[s.name] ?? 0) < limit(s)).map((s) => s.name);
      const job = free.length ? claim(workerId, free) : undefined;
      if (job) {
        const stage = stages.get(job.stage)!;
        void execute(job, stage);
        continue;
      }
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, opts.pollMs ?? 500);
      });
      wake = null;
    }
  }

  const done = loop();

  async function stop() {
    if (stopping) return;
    stopping = true;
    wake?.();
    log(`正在退出，等待 ${active.size} 个任务结束…`);
    const deadline = Date.now() + 30_000;
    while (active.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    // 超时仍未结束的任务：中止，租约到期后会被重新排队
    for (const a of active.values()) a.ctrl.abort(new DOMException("Worker 退出", "AbortError"));
    clearInterval(beat);
    await done;
    unregisterWorker(workerId);
  }

  return { workerId, stop, active };
}
