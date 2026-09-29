"use client";

import type React from "react";

import { Icon, Spinner } from "@/components/ui";
import { jobAction } from "@/lib/client";
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
export function JobStrip({ steps, jobs, extra }: { steps: StepDef[]; jobs: Job[]; extra?: Record<string, string> }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-3 lg:grid-cols-[repeat(var(--steps),minmax(0,1fr))]" style={{ "--steps": steps.length } as React.CSSProperties}>
      {steps.map((s) => {
        const list = jobs.filter((j) => (s.stages ?? [s.stage]).includes(j.stage));
        const sum = summarize(list);
        const active = sum.running > 0 || sum.queued > 0;
        const state = sum.failed.length ? "failed" : active ? "active" : sum.total > 0 && sum.done === sum.total ? "done" : "idle";
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
            <p className="mt-1 h-4 truncate text-[11px] text-white/35">{sum.failed.length ? sum.failed[0].error : sum.message || (active ? "排队中" : "")}</p>
            {sum.failed.length > 0 && (
              <div className="mt-1.5 flex gap-1.5">
                <button className="chip h-6 px-2.5 text-[11px]" onClick={() => sum.failed.forEach((j) => jobAction(j.id, "retry"))}>
                  重试 {sum.failed.length > 1 ? `${sum.failed.length} 个` : ""}
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
      后台任务进程（Worker）没有运行，配音、分镜和渲染会一直排队。请在项目目录另开一个终端执行 <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">npm run worker</code>
      ，或者用 <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">npm run dev:all</code> 同时启动网页和 Worker。
    </div>
  );
}
