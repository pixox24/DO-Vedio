import { all, get, json, parseJson, run } from "./db";

/** 步骤产物缓存：key = hash(步骤版本 + 输入 + 参数)，内容不可变 */

export function cacheGet<T>(key: string): T | undefined {
  const r = get<{ result: string }>("SELECT result FROM cache WHERE key = ?", key);
  return r ? parseJson<T>(r.result, undefined as T) : undefined;
}

export function cacheHas(key: string) {
  return !!get<{ k: number }>("SELECT 1 AS k FROM cache WHERE key = ?", key);
}

export function cachePut(key: string, stage: string, result: unknown) {
  run("INSERT OR REPLACE INTO cache (key, stage, result, created_at) VALUES (?, ?, ?, ?)", key, stage, json(result), Date.now());
}

/** 批量读取，返回 key → 结果 */
export function cacheMany<T>(keys: string[]): Map<string, T> {
  const out = new Map<string, T>();
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    if (chunk.length === 0) continue;
    for (const r of all<{ key: string; result: string }>(`SELECT key, result FROM cache WHERE key IN (${chunk.map(() => "?").join(",")})`, ...chunk)) {
      out.set(r.key, parseJson<T>(r.result, undefined as T));
    }
  }
  return out;
}

// ---------- 账本 ----------

export type LedgerEntry = { projectId: string | null; jobId: string | null; provider: string; model: string; unit: string; quantity: number; costYuan: number };

export function ledger(e: LedgerEntry) {
  const result = run(
    "INSERT INTO ledger (project_id, job_id, provider, model, unit, quantity, cost_yuan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    e.projectId,
    e.jobId,
    e.provider,
    e.model,
    e.unit,
    e.quantity,
    e.costYuan,
    Date.now(),
  );
  return Number(result.lastInsertRowid);
}

export function projectSpend(projectId: string) {
  const r = get<{ cost: number | null; calls: number }>("SELECT SUM(cost_yuan) AS cost, COUNT(*) AS calls FROM ledger WHERE project_id = ?", projectId);
  return { costYuan: r?.cost ?? 0, calls: r?.calls ?? 0 };
}
