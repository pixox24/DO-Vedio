import { randomUUID } from "crypto";
import type { Job, JobStatus } from "../core/types";
import { all, get, json, parseJson, run, tx, type Param } from "./db";

/**
 * 任务队列：jobs 表 + Worker 轮询 + 租约。
 * - 同一个 key 在排队或运行中时不重复提交
 * - Worker 崩溃后租约过期，任务自动回到队列
 */

export const LEASE_MS = 60_000;

type Row = {
  id: string;
  project_id: string | null;
  stage: string;
  key: string;
  target: string;
  status: JobStatus;
  progress: number;
  message: string;
  attempts: number;
  max_attempts: number;
  priority: number;
  run_after: number;
  locked_by: string | null;
  lease_until: number | null;
  cost_estimate: number;
  cost_actual: number;
  error: string | null;
  input: string;
  result: string | null;
  created_at: number;
  updated_at: number;
};

const toJob = (r: Row): Job => ({
  id: r.id,
  projectId: r.project_id,
  stage: r.stage,
  key: r.key,
  target: r.target,
  status: r.status,
  progress: r.progress,
  message: r.message,
  attempts: r.attempts,
  maxAttempts: r.max_attempts,
  priority: r.priority,
  runAfter: r.run_after,
  costEstimate: r.cost_estimate,
  costActual: r.cost_actual,
  error: r.error,
  input: parseJson(r.input, null),
  result: parseJson(r.result, null),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export type EnqueueInput = {
  projectId: string | null;
  stage: string;
  key: string;
  input: unknown;
  target?: string;
  priority?: number;
  maxAttempts?: number;
  costEstimate?: number;
};

/** 提交任务；同 key 已在排队或运行时返回已有任务 */
export function enqueue(e: EnqueueInput): Job {
  return tx(() => {
    const existing = get<Row>("SELECT * FROM jobs WHERE key = ? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1", e.key);
    if (existing) return toJob(existing);
    const now = Date.now();
    const id = randomUUID();
    run(
      `INSERT INTO jobs (id, project_id, stage, key, target, status, priority, max_attempts, cost_estimate, input, run_after, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, 0, ?, ?)`,
      id,
      e.projectId,
      e.stage,
      e.key,
      e.target ?? "",
      e.priority ?? 5,
      e.maxAttempts ?? 3,
      e.costEstimate ?? 0,
      json(e.input),
      now,
      now,
    );
    return getJob(id)!;
  });
}

export function getJob(id: string) {
  const r = get<Row>("SELECT * FROM jobs WHERE id = ?", id);
  return r && toJob(r);
}

/** 原子领取一个可执行的任务 */
export function claim(workerId: string, stages: string[]): Job | undefined {
  if (stages.length === 0) return undefined;
  const now = Date.now();
  const r = get<Row>(
    `UPDATE jobs SET status = 'running', locked_by = ?, lease_until = ?, attempts = attempts + 1, error = NULL, updated_at = ?
     WHERE id = (
       SELECT id FROM jobs WHERE status = 'queued' AND run_after <= ? AND stage IN (${stages.map(() => "?").join(",")})
       ORDER BY priority, created_at LIMIT 1
     )
     RETURNING *`,
    workerId,
    now + LEASE_MS,
    now,
    now,
    ...stages,
  );
  return r && toJob(r);
}

/** 续租约并上报进度；任务已被取消或被别的 Worker 接走时返回 false */
export function heartbeat(id: string, workerId: string, progress?: number, message?: string): boolean {
  const now = Date.now();
  const sets = ["lease_until = ?", "updated_at = ?"];
  const params: Param[] = [now + LEASE_MS, now];
  if (progress !== undefined) {
    sets.push("progress = ?");
    params.push(Math.max(0, Math.min(1, progress)));
  }
  if (message !== undefined) {
    sets.push("message = ?");
    params.push(message);
  }
  return run(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ? AND locked_by = ? AND status = 'running'`, ...params, id, workerId).changes > 0;
}

export function succeed(id: string, workerId: string, result: unknown, costActual = 0) {
  run(
    `UPDATE jobs SET status = 'succeeded', progress = 1, result = ?, cost_actual = ?, locked_by = NULL, lease_until = NULL, message = '', updated_at = ?
     WHERE id = ? AND locked_by = ?`,
    json(result),
    costActual,
    Date.now(),
    id,
    workerId,
  );
}

/** 失败：可重试时按 2s / 8s / 30s 退避后重新排队 */
export function failJob(id: string, workerId: string, error: string, retryable: boolean) {
  const j = getJob(id);
  if (!j) return;
  const again = retryable && j.attempts < j.maxAttempts;
  const delay = [2_000, 8_000, 30_000][Math.min(j.attempts - 1, 2)] ?? 30_000;
  run(
    `UPDATE jobs SET status = ?, error = ?, run_after = ?, locked_by = NULL, lease_until = NULL, message = ?, updated_at = ?
     WHERE id = ? AND locked_by = ?`,
    again ? "queued" : "failed",
    error,
    again ? Date.now() + delay : 0,
    again ? `第 ${j.attempts} 次失败，${delay / 1000} 秒后重试` : "",
    Date.now(),
    id,
    workerId,
  );
}

export function cancelJob(id: string) {
  return run("UPDATE jobs SET status = 'canceled', locked_by = NULL, lease_until = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')", Date.now(), id).changes > 0;
}

export function cancelProjectJobs(projectId: string, stages?: string[]) {
  const filter = stages?.length ? ` AND stage IN (${stages.map(() => "?").join(",")})` : "";
  return run(
    `UPDATE jobs SET status = 'canceled', locked_by = NULL, lease_until = NULL, updated_at = ? WHERE project_id = ? AND status IN ('queued', 'running')${filter}`,
    Date.now(),
    projectId,
    ...(stages ?? []),
  ).changes;
}

/** 失败或取消的任务重新排队 */
export function retryJob(id: string) {
  return (
    run(
      "UPDATE jobs SET status = 'queued', attempts = 0, error = NULL, run_after = 0, progress = 0, message = '', updated_at = ? WHERE id = ? AND status IN ('failed', 'canceled')",
      Date.now(),
      id,
    ).changes > 0
  );
}

/** 把租约过期的运行中任务放回队列（Worker 崩溃恢复） */
export function recoverExpired() {
  const now = Date.now();
  return run(
    "UPDATE jobs SET status = 'queued', locked_by = NULL, lease_until = NULL, message = '上次执行中断，已重新排队', updated_at = ? WHERE status = 'running' AND lease_until < ?",
    now,
    now,
  ).changes;
}

/** 运行中任务数（按步骤），用于并发限流 */
export function runningCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of all<{ stage: string; n: number }>("SELECT stage, COUNT(*) AS n FROM jobs WHERE status = 'running' GROUP BY stage")) out[r.stage] = r.n;
  return out;
}

/** 项目最近的任务：每个 key 只取最新一条 */
export function projectJobs(projectId: string, since = 0): Job[] {
  return all<Row>(
    `SELECT j.* FROM jobs j
     JOIN (SELECT key, MAX(created_at) AS c FROM jobs WHERE project_id = ? GROUP BY key) last ON last.key = j.key AND last.c = j.created_at
     WHERE j.project_id = ? AND j.updated_at > ?
     ORDER BY j.created_at`,
    projectId,
    projectId,
    since,
  ).map(toJob);
}

export function latestJobByKey(key: string) {
  const r = get<Row>("SELECT * FROM jobs WHERE key = ? ORDER BY created_at DESC LIMIT 1", key);
  return r && toJob(r);
}

/** 清理 30 天前已结束的任务 */
export function pruneJobs(olderThanMs = 30 * 86400_000) {
  return run("DELETE FROM jobs WHERE status IN ('succeeded', 'failed', 'canceled') AND updated_at < ?", Date.now() - olderThanMs).changes;
}

// ---------- Worker 心跳 ----------

export function registerWorker(id: string, pid: number, host: string) {
  const now = Date.now();
  run("INSERT OR REPLACE INTO workers (id, pid, host, started_at, heartbeat_at) VALUES (?, ?, ?, ?, ?)", id, pid, host, now, now);
  run("DELETE FROM workers WHERE heartbeat_at < ?", now - 3600_000);
}

export function workerHeartbeat(id: string) {
  run("UPDATE workers SET heartbeat_at = ? WHERE id = ?", Date.now(), id);
}

export function unregisterWorker(id: string) {
  run("DELETE FROM workers WHERE id = ?", id);
}

/** 30 秒内有心跳就算在线 */
export function workerOnline() {
  return (get<{ n: number }>("SELECT COUNT(*) AS n FROM workers WHERE heartbeat_at > ?", Date.now() - 30_000)?.n ?? 0) > 0;
}
