"use client";

import { useState } from "react";

import { Icon, Spinner } from "@/components/ui";
import { jobAction } from "@/lib/client";
import { costSuffix, needsConfirm } from "@/lib/core/interaction";
import { renderEtaLabel } from "@/lib/core/job-eta";
import type { Job } from "@/lib/core/types";

/** stages：一栏汇总多个步骤（例如逐句配音与段落配音） */
export type StepDef = { stage: string; stages?: string[]; label: string };

type Summary = { total: number; done: number; running: number; failed: Job[]; queued: number; progress: number; message: string };

export function summarize(jobs: Job[]): Summary {
  const done = jobs.filter((j) => j.status === "succeeded").length;
  const running = jobs.filter((j) => j.status === "running");
  const failed = jobs.filter((j) => j.status === "failed");
  const queued = jobs.filter((j) => j.status === "queued").length;
  const progress = jobs.length ? jobs.reduce((s, j) => s + (j.status === "succeeded" ? 1 : j.status === "running" ? j.progress : 0), 0) / jobs.length : 0;
  const message = running[0] ? `${running[0].target}${running[0].message ? ` · ${running[0].message}` : ""}` : "";
  return { total: jobs.length, done, running: running.length, failed, queued, progress, message };
}

/** 步骤条：每个步骤的进度、失败原因、重试和取消 */
export function JobStrip({ steps, jobs, extra, confirm }: { steps: StepDef[]; jobs: Job[]; extra?: Record<string, string>; confirm?: (options: { title: string; message?: string; confirmLabel?: string; bullets?: string[]; tone?: "default" | "danger" }) => Promise<boolean> }) {
  const [retryBusy, setRetryBusy] = useState(false);
  /**
   * 重试与首次生成适用同一套成本规则：首次要确认的规模，重试也要确认。
   * 否则「重试」会成为绕过确认的后门——它同样调用服务商、同样计费。
   */
  const retryAll = async (failed: Job[]) => {
    if (retryBusy) return;
    const estimated = failed.reduce((sum, job) => sum + (Number.isFinite(job.costEstimate) ? job.costEstimate : 0), 0);
    const costYuan = failed.some((job) => Number.isFinite(job.costEstimate) && job.costEstimate > 0) ? estimated : null;
    const suffix = costSuffix({ units: failed.length, unit: "个任务", costYuan });
    if (confirm && needsConfirm({ units: failed.length, costYuan })) {
      const ok = await confirm({
        title: `重试 ${failed.length} 个失败任务？`,
        message: `将重新提交 ${suffix}，费用由对应服务商收取。`,
        bullets: [
          `预计费用：${costYuan == null ? "暂无法准确估算，以服务商账单为准" : suffix}.`,
          "影响范围：只重试当前失败的任务，已经成功的结果不受影响。",
          "可撤回：任务重新排队后可以单独取消；服务商已接单的请求仍可能计费。",
        ],
        confirmLabel: "重试",
        tone: "danger",
      });
      if (!ok) return;
    }
    setRetryBusy(true);
    try {
      await Promise.all(failed.map((j) => jobAction(j.id, "retry")));
    } finally {
      setRetryBusy(false);
    }
  };
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-3 lg:grid-cols-[repeat(var(--steps),minmax(0,1fr))]" style={{ "--steps": steps.length } as React.CSSProperties}>
      {steps.map((s) => {
        const list = jobs.filter((j) => (s.stages ?? [s.stage]).includes(j.stage));
        const sum = summarize(list);
        const active = sum.running > 0 || sum.queued > 0;
        const state = sum.failed.length ? "failed" : active ? "active" : sum.total > 0 && sum.done === sum.total ? "done" : "idle";
        const renderJob = s.stage === "render" ? list.find((job) => job.status === "running") ?? list.find((job) => job.status === "queued") : undefined;
        const statusMessage = s.stage === "render" && active && renderJob
          ? `${renderEtaLabel(renderJob)}${sum.message ? ` · ${sum.message}` : ""}`
          : sum.message || (active ? "排队中" : "");
        return (
          <div key={s.stage} className="relative bg-ink/95 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs font-medium ${state === "done" ? "text-white" : state === "failed" ? "text-red-300" : "text-white/70"}`}>
                {state === "done" && <Icon name="check" className="mr-1 inline size-3" />}
                {s.label}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-white/35">
                {active && <Spinner className="size-3" />}
                {sum.total > 0 ? `${sum.done}/${sum.total}` : (extra?.[s.stage] ?? "")}
              </span>
            </div>
            <p className="mt-1 h-4 truncate text-[11px] text-white/35">{sum.failed.length ? sum.failed[0].error : statusMessage}</p>
            {sum.failed.length > 0 && (
              <div className="mt-1.5 flex gap-1.5">
                <button className="chip h-6 px-2.5 text-[11px]" disabled={retryBusy} onClick={() => void retryAll(sum.failed)}>
                  {retryBusy ? <Spinner className="size-3" /> : null}重试 · {costSuffix({ units: sum.failed.length, unit: "个任务", costYuan: sum.failed.reduce((total, job) => total + (Number.isFinite(job.costEstimate) ? job.costEstimate : 0), 0) || null })}
                </button>
              </div>
            )}
            {active && (
              <button
                className="mt-1 text-[11px] text-white/30 hover:text-white"
                onClick={() => list.filter((j) => j.status === "queued" || j.status === "running").forEach((j) => jobAction(j.id, "cancel"))}
              >
                取消
              </button>
            )}
            <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/[0.04]">
              <div className={`h-full transition-all ${state === "failed" ? "bg-red-400/70" : "bg-white/70"}`} style={{ width: `${Math.round(sum.progress * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function WorkerBanner({ online }: { online: boolean | null }) {
  if (online !== false) return null;
  return (
    <div className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.05] px-5 py-3 text-sm leading-relaxed text-amber-100/85">
      生成服务未运行，配音、生图和渲染会一直排队。<strong className="font-medium text-amber-100">任务不会丢失</strong>，服务恢复后会自动继续。
      <span className="text-amber-100/60">管理员请在项目目录执行</span> <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">npm run worker</code>
      <span className="text-amber-100/60">；本地开发可用</span> <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">npm run dev:all</code>
      <span className="text-amber-100/60">同时启动网页和生成服务。</span>
    </div>
  );
}
