import type { Job } from "./types";

/** 超过这个时长后，精确剩余时间已经不值得继续猜。 */
export const MAX_RENDER_ETA_MS = 30 * 60 * 1000;

function clock(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * 渲染任务的时间提示。
 * startedAt 是本次 Worker 领取任务的时间，不能换成 updatedAt，因为心跳会刷新后者。
 */
export function renderEtaLabel(job: Pick<Job, "status" | "progress" | "startedAt">, now = Date.now()) {
  if (job.status !== "running" || job.startedAt == null || job.progress < 0.05) return "准备中";
  const elapsed = Math.max(0, now - job.startedAt);
  const remaining = (elapsed / job.progress) * (1 - job.progress);
  if (!Number.isFinite(remaining) || remaining > MAX_RENDER_ETA_MS) return `已进行 ${clock(elapsed)}`;
  return `预计还需 ${clock(remaining)}`;
}
