import type { Job } from "../core/types";

/** 步骤定义：每个步骤声明名称、版本和执行函数，由 Worker 调度 */

export type StageContext = {
  job: Job;
  signal: AbortSignal;
  /** 当前执行仍持有任务租约，取消或重试后立即返回 false。 */
  current(): boolean;
  /** 上报进度（0–1）；同时续租约 */
  progress(p: number, message?: string): void;
  /** 记一笔账 */
  spend(e: { provider: string; model: string; unit: string; quantity: number; costYuan: number }): number;
  log(...args: unknown[]): void;
};

export type Stage<I = unknown, O = unknown> = {
  name: string;
  /** 并发上限，默认 1；可用 WORKER_CONCURRENCY_<NAME> 覆盖 */
  concurrency?: number;
  run(input: I, ctx: StageContext): Promise<O>;
};

/** 不值得重试的错误：参数错误、内容审核被拒、余额不足等 */
export class PermanentError extends Error {
  readonly permanent = true;
}

export function isRetryable(e: unknown) {
  if (e instanceof PermanentError) return false;
  if (e instanceof Error && e.name === "AbortError") return false;
  const status = (e as { status?: number; statusCode?: number })?.status ?? (e as { statusCode?: number })?.statusCode;
  if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
  return true;
}

export const defineStage = <I, O>(s: Stage<I, O>) => s;
