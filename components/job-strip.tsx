"use client";

import { useEffect, useRef, useState } from "react";

import { Icon, Spinner } from "@/components/ui";
import { jobAction } from "@/lib/client";
import { costSuffix, needsConfirm } from "@/lib/core/interaction";
import { renderEtaLabel } from "@/lib/core/job-eta";
import type { StepHint } from "@/lib/core/step-status";
import type { Job } from "@/lib/core/types";

/** stages：一栏汇总多个步骤（例如逐句配音与段落配音）。indeterminate：一次模型调用，进行中用流动细条。 */
export type StepDef = { stage: string; stages?: string[]; label: string; indeterminate?: boolean };

type StepTone = "idle" | "active" | "done" | "failed" | "hold";

type Summary = { total: number; done: number; running: number; failed: Job[]; queued: number; canceled: number; planned: number; progress: number; message: string };

export function summarize(jobs: Job[]): Summary {
  const done = jobs.filter((j) => j.status === "succeeded").length;
  const running = jobs.filter((j) => j.status === "running");
  const failed = jobs.filter((j) => j.status === "failed");
  const queued = jobs.filter((j) => j.status === "queued").length;
  const canceled = jobs.filter((j) => j.status === "canceled").length;
  /*
   * canceled 不再计入分母。它既不会成功也确实没在推进，留在分母里
   * 会让进度条永远到不了 100%——看起来像卡住了，实际是任务已经被取消。
   */
  const counted = jobs.filter((j) => j.status !== "canceled");
  const progress = counted.length ? counted.reduce((s, j) => s + (j.status === "succeeded" ? 1 : j.status === "running" ? j.progress : 0), 0) / counted.length : 0;
  const message = running[0] ? `${running[0].target}${running[0].message ? ` · ${running[0].message}` : ""}` : "";
  return { total: jobs.length, done, running: running.length, failed, queued, canceled, planned: counted.length, progress, message };
}

/** 步骤条：每个步骤的进度、失败原因、重试和取消 */
export function JobStrip({ steps, jobs, extra, hints, currentKeys, confirm }: { steps: StepDef[]; jobs: Job[]; extra?: Record<string, string>; hints?: Record<string, StepHint | null>; currentKeys?: ReadonlySet<string>; confirm?: (options: { title: string; message?: string; confirmLabel?: string; bullets?: string[]; tone?: "default" | "danger" }) => Promise<boolean> }) {
  const [retryingStage, setRetryingStage] = useState<string | null>(null);
  const [cancelingStage, setCancelingStage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<Record<string, string>>({});
  /**
   * 重试与首次生成适用同一套成本规则：首次要确认的规模，重试也要确认。
   * 否则「重试」会成为绕过确认的后门——它同样调用服务商、同样计费。
   */
  const retryAll = async (failed: Job[], stage: string) => {
    if (retryingStage || cancelingStage) return;
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
    setRetryingStage(stage);
    try {
      const results = await Promise.allSettled(failed.map((j) => jobAction(j.id, "retry")));
      const failedCount = results.filter((result) => result.status === "rejected").length;
      setActionMessage((current) => ({ ...current, [stage]: failedCount ? `${failed.length - failedCount} 个任务已重试，${failedCount} 个提交失败` : `已提交 ${failed.length} 个任务重试，等待队列更新` }));
    } finally {
      setRetryingStage(null);
    }
  };
  const cancelActive = async (active: Job[], stage: string, label: string) => {
    if (retryingStage || cancelingStage) return;
    if (confirm) {
      const ok = await confirm({
        title: `取消${label}？`,
        message: `将停止 ${active.length} 个排队或运行中的任务。已提交给服务商的请求仍可能计费。`,
        confirmLabel: "取消任务",
        tone: "danger",
      });
      if (!ok) return;
    }
    setCancelingStage(stage);
    try {
      const results = await Promise.allSettled(active.map((j) => jobAction(j.id, "cancel")));
      const failedCount = results.filter((result) => result.status === "rejected").length;
      setActionMessage((current) => ({ ...current, [stage]: failedCount ? `${active.length - failedCount} 个任务已请求停止，${failedCount} 个操作失败` : `已请求停止 ${active.length} 个任务，等待服务确认` }));
    } finally {
      setCancelingStage(null);
    }
  };
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-3 lg:grid-cols-[repeat(var(--steps),minmax(0,1fr))]" style={{ "--steps": steps.length } as React.CSSProperties}>
      {steps.map((s) => {
        const list = jobs.filter((j) => (s.stages ?? [s.stage]).includes(j.stage));
        const sum = summarize(list);
        const actionable = currentKeys ? list.filter((job) => currentKeys.has(job.key)) : list;
        const actionableSummary = summarize(actionable);
        const active = actionableSummary.running > 0 || actionableSummary.queued > 0;
        const oldActive = currentKeys ? list.filter((job) => !currentKeys.has(job.key) && (job.status === "queued" || job.status === "running")) : [];
        const oldFailed = currentKeys ? list.filter((job) => !currentKeys.has(job.key) && job.status === "failed") : [];
        /* planned 而非 total：被取消的任务不该挡住「这一步已完成」的判定 */
        const fromJobs: StepTone = sum.failed.length ? "failed" : active ? "active" : sum.planned > 0 && sum.done === sum.planned ? "done" : "idle";
        const hint = hints?.[s.stage];
        // 任务正在跑或失败时，以任务为准。停下来之后才采用口吻、缺图这类补充状态。
        const tone: StepTone = fromJobs === "failed" || fromJobs === "active" ? fromJobs : hint?.tone ?? fromJobs;
        const flowing = tone === "active" && s.indeterminate === true;
        const width = tone === "done" || tone === "hold" ? 100 : tone === "active" ? Math.max(12, Math.round(sum.progress * 100)) : 0;
        const fill = tone === "failed" ? "bg-red-400/70" : tone === "done" ? "bg-accent" : tone === "hold" ? "bg-hold" : tone === "active" ? "bg-accent/70" : "bg-transparent";
        const renderJob = s.stage === "render" ? list.find((job) => job.status === "running") ?? list.find((job) => job.status === "queued") : undefined;
        const jobMessage = s.stage === "render" && active && renderJob
          ? `${renderEtaLabel(renderJob)}${sum.message ? ` · ${sum.message}` : ""}`
          : sum.message || (active ? "排队中" : "");
        const statusMessage = sum.failed.length ? sum.failed[0].error : actionMessage[s.stage] || (tone === "active" ? jobMessage : hint?.message || jobMessage);
        return (
          <div key={s.stage} className="relative bg-ink/95 px-4 pb-3.5 pt-3.5">
            {/* 顶部细条：空着时只留轨道。进行中按任务填充；一次模型调用则在轨道里流动。 */}
            <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-white/[0.05]">
              <div
                className={`h-full ${flowing ? "step-indeterminate" : "transition-[width] duration-500 ease-out"} ${fill} ${tone === "hold" && hint?.pulse ? "step-hold" : ""}`}
                style={flowing ? undefined : { width: `${width}%` }}
              />
            </div>
            <StepFlash tone={tone} />
            <div className="relative flex items-center justify-between gap-2">
              <span className={`flex items-center gap-1.5 text-xs font-medium ${tone === "done" || tone === "hold" ? "text-white" : tone === "failed" ? "text-red-300" : tone === "active" ? "text-white/90" : "text-white/60"}`}>
                {tone === "done" ? (
                  <span className="animate-check-in inline-flex text-accent"><Icon name="check" className="size-3" /></span>
                ) : (
                  <span className={`size-1.5 shrink-0 rounded-full ${tone === "active" ? "animate-live-dot bg-accent" : tone === "failed" ? "bg-red-400" : tone === "hold" ? "bg-hold" : "bg-white/20"}`} />
                )}
                {s.label}
              </span>
              <span className="flex items-center gap-1.5 text-2xs tabular-nums text-white/35">
                {active && <Spinner className="size-3" />}
                {sum.total > 0 ? `${sum.done}/${sum.planned}` : (extra?.[s.stage] ?? "")}
              </span>
            </div>
            <p role={sum.failed.length ? "alert" : undefined} className={`relative mt-1 h-4 truncate text-2xs ${sum.failed.length ? "text-red-300/90" : tone === "hold" ? "text-hold" : tone === "active" ? "text-white/50" : "text-white/35"}`}>{statusMessage}</p>
            {sum.canceled > 0 && <p className="relative mt-1 text-3xs text-white/30">已取消 {sum.canceled} 个任务</p>}
            {oldActive.length > 0 && <p className="relative mt-1 text-3xs text-amber-200/65">含 {oldActive.length} 个旧版本任务</p>}
            {actionableSummary.failed.length > 0 && (
              <div className="relative mt-1.5 flex gap-1.5">
                <button className="chip h-6 px-2.5 text-2xs" disabled={retryingStage !== null || cancelingStage !== null} onClick={() => void retryAll(actionableSummary.failed, s.stage)}>
                  {retryingStage === s.stage ? <Spinner className="size-3" /> : null}重试 · {costSuffix({ units: actionableSummary.failed.length, unit: "个任务", costYuan: actionableSummary.failed.reduce((total, job) => total + (Number.isFinite(job.costEstimate) ? job.costEstimate : 0), 0) || null })}
                </button>
              </div>
            )}
            {oldFailed.length > 0 && (
              <div className="relative mt-1.5 flex items-center gap-2">
                <span className="text-3xs text-amber-200/65">旧任务失败 {oldFailed.length} 个</span>
                <button className="chip h-6 px-2.5 text-2xs" disabled={retryingStage !== null || cancelingStage !== null} onClick={() => void retryAll(oldFailed, `${s.stage}:old`)}>
                  {retryingStage === `${s.stage}:old` ? <Spinner className="size-3" /> : null}重试旧任务
                </button>
              </div>
            )}
            {active && (
              <button
                className="relative mt-1 text-2xs text-white/30 transition hover:text-white"
                disabled={retryingStage !== null || cancelingStage !== null}
                onClick={() => void cancelActive(actionable.filter((j) => j.status === "queued" || j.status === "running"), s.stage, s.label)}
              >
                {cancelingStage === s.stage ? <><Spinner className="mr-1 inline size-3" />正在停止…</> : "取消"}
              </button>
            )}
            {oldActive.length > 0 && (
              <button
                className="relative mt-1 text-2xs text-amber-200/60 transition hover:text-amber-100"
                disabled={retryingStage !== null || cancelingStage !== null}
                onClick={() => void cancelActive(oldActive, `${s.stage}:old`, `旧版${s.label}`)}
              >
                {cancelingStage === `${s.stage}:old` ? <><Spinner className="mr-1 inline size-3" />正在停止旧任务…</> : "取消旧任务"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 只在这一格从别的状态变成完成时闪一下。打开页面时已经完成的格子不闪。 */
function StepFlash({ tone }: { tone: StepTone }) {
  const seen = useRef<StepTone | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const previous = seen.current;
    seen.current = tone;
    if (previous !== null && previous !== "done" && tone === "done") setOn(true);
  }, [tone]);
  useEffect(() => {
    if (!on) return;
    const timer = window.setTimeout(() => setOn(false), 850);
    return () => window.clearTimeout(timer);
  }, [on]);
  if (!on) return null;
  return <span aria-hidden className="animate-step-flash pointer-events-none absolute inset-0" />;
}

export function WorkerBanner({ online, onRetry }: { online: boolean | null; onRetry?: () => void }) {
  if (online !== false) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.05] px-5 py-3 text-sm leading-relaxed text-amber-100/85">
      <span>生成服务暂时离线，任务已保留；服务恢复后会自动继续。</span>
      {onRetry && <button className="btn btn-ghost btn-sm border-amber-200/25 text-amber-100 hover:bg-amber-200/10" onClick={onRetry}>重新检查</button>}
    </div>
  );
}
