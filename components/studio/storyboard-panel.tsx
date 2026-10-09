"use client";

// 分镜面板：镜头网格、候选切换、批量生图与失败恢复。

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { AutoTextarea, Icon, Select, Spinner } from "@/components/ui";
import { jobAction } from "@/lib/client";
import { mediaUrl, focusPresetIds, shotKindLabels, shotSizeLabels, shotSizes, type Job, type Shot } from "@/lib/core/types";
import { newId } from "@/lib/core/sync";
import { stampShots } from "@/lib/core/shots";
import { assetStale, compileShotPrompt, MAX_SHOT_CHARACTERS, needsGeneratedImage, type CompiledPrompt } from "@/lib/core/prompt-compiler";
import { needsConfirm } from "@/lib/core/interaction";
import { focusPresetLabels, focusTextFromLegacy, focusVisualWidth } from "@/lib/core/focus";
import type { Timeline, TimelineShot } from "@/lib/core/timeline";
import { useFeedback } from "@/components/feedback";
import { jobBatchId, type ProjectStore } from "./shared";

const ShotThumbnail = dynamic(() => import("../shot-thumbnail").then((m) => m.ShotThumbnail), { ssr: false, loading: () => <div className="grid h-full place-items-center bg-stage text-xs text-white/40">正在加载预览</div> });

function shotUpdate(store: ProjectStore, id: string, fn: (shot: Shot) => Shot) {
  store.setDoc((doc) => ({ ...doc, shots: stampShots(doc.shots.map((s) => (s.id === id ? fn(s) : s)), doc.lines) }));
}

export function StoryboardPanel({ id, store, timeline, jobs, onSeek }: { id: string; store: ProjectStore; timeline: Timeline | null; jobs: Map<string, Job>; onSeek: (ms: number) => void }) {
  const doc = store.doc;
  const { confirm, toast } = useFeedback();
  const [uploading, setUploading] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [candidateCount, setCandidateCount] = useState(1);
  const [imageModels, setImageModels] = useState<{ id: string; label: string }[]>([]);
  const [imageModelId, setImageModelId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkBatch, setBulkBatch] = useState<{ id: string; createdAt: number; jobs: Job[] } | null>(null);
  const [bulkStopping, setBulkStopping] = useState(false);
  const [bulkStopRequested, setBulkStopRequested] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);
  const [jumpShotId, setJumpShotId] = useState("");
  const [shotQuery, setShotQuery] = useState("");
  const [shotFilter, setShotFilter] = useState<"all" | "needs" | "failed" | "ready" | "locked">("all");
  /** 服务端裁决的镜头任务状态；客户端不再自己从 jobs Map 里猜（插入序不可靠） */
  const [shotStatus, setShotStatus] = useState<Record<string, { status: string; progress: number; message: string; error: string | null; total: number; done: number; failed: number; running: number }>>({});
  /** 任务有变化才重新裁决，避免每次渲染都打接口 */
  const shotJobSig = [...jobs.values()].filter((job) => job.stage === "shot-generate").map((job) => `${job.id}:${job.status}:${job.progress}`).sort().join("|");
  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${encodeURIComponent(id)}/shots/status`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => { if (alive) setShotStatus(data ?? {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id, shotJobSig]);
  useEffect(() => {
    fetch("/api/providers", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      const models = (data.providers ?? [] as { providerId: string; providerLabel: string; modelId: string; modelLabel: string; kind: string; configured: boolean; enabled: boolean }[])
        .filter((model: { kind: string; configured: boolean; enabled: boolean }) => model.kind === "image" && model.configured && model.enabled)
        .map((model: { providerId: string; providerLabel: string; modelId: string; modelLabel: string }) => ({ id: `${model.providerId}::${model.modelId}`, label: `${model.providerLabel} · ${model.modelLabel}` }));
      setImageModels(models);
      setImageModelId((current) => models.some((model: { id: string }) => model.id === current) ? current : models[0]?.id ?? "");
    }).catch(() => setImageModels([]));
  }, []);
  if (!doc) return null;
  const lines = doc.lines;
  const ordered = [...doc.shots].sort((a, b) => doc.lines.findIndex((l) => l.id === a.at.lineId) - doc.lines.findIndex((l) => l.id === b.at.lineId) || a.at.char - b.at.char);
  const lineIndex = new Map(doc.lines.map((l, i) => [l.id, i]));
  // 需要生成画面的镜头：缺图的 + 描述或风格改过导致过期的（信息卡、标题卡、金句卡不生图）
  const wanting = ordered.filter((shot) => !shot.locked && needsGeneratedImage(shot));
  const missing = wanting.filter((shot) => !shot.assetId).length;
  const stale = wanting.filter((shot) => assetStale(doc, shot)).length;
  const remaining = missing + stale;
  const imageJobs = [...jobs.values()].filter((job) => job.stage === "shot-generate" && job.projectId === id);
  const activeImages = imageJobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const completedImages = imageJobs.filter((job) => job.status === "succeeded").length;
  const failedImages = imageJobs.filter((job) => job.status === "failed").length;
  const queuedImages = imageJobs.filter((job) => job.status === "queued").length;
  const latestBatchJob = imageJobs.filter((job) => jobBatchId(job)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const latestBatchId = latestBatchJob ? jobBatchId(latestBatchJob) ?? null : null;
  const selectedBatchId = latestBatchJob && (!bulkBatch || latestBatchJob.createdAt > bulkBatch.createdAt) ? latestBatchId : bulkBatch?.id ?? latestBatchId;
  const streamedBulkJobs = selectedBatchId ? imageJobs.filter((job) => jobBatchId(job) === selectedBatchId) : [];
  const bulkJobs = streamedBulkJobs.length ? streamedBulkJobs : selectedBatchId === bulkBatch?.id ? bulkBatch.jobs : [];
  const bulkActive = bulkJobs.some((job) => job.status === "queued" || job.status === "running");
  const bulkStopped = !!selectedBatchId && bulkJobs.some((job) => job.status === "canceled") && !bulkActive;
  const stoppingSelectedBatch = bulkStopping || bulkStopRequested === selectedBatchId;
  const bulkDone = bulkJobs.filter((job) => job.status === "succeeded").length;
  const bulkFailed = bulkJobs.filter((job) => job.status === "failed").length;
  const bulkQueued = bulkJobs.filter((job) => job.status === "queued").length;
  const bulkRunning = bulkJobs.filter((job) => job.status === "running").length;
  const bulkCanceled = bulkJobs.filter((job) => job.status === "canceled").length;
  const bulkProgress = bulkJobs.length > 0
    ? Math.min(1, (bulkDone + bulkJobs.filter((job) => job.status === "running").reduce((sum, job) => sum + job.progress, 0)) / bulkJobs.length)
    : 0;
  const normalizedShotQuery = shotQuery.trim().toLocaleLowerCase();
  const shownShots = ordered.filter((shot) => {
    const timed = timeline?.shots.find((item) => item.shotId === shot.id);
    const job = [...jobs.values()].findLast((item) => item.stage === "shot-generate" && item.target === `镜头 ${shot.id}`);
    const serverStatus = shotStatus[shot.id];
    const status = serverStatus?.status ?? job?.status;
    const failed = status === "failed";
    const ready = !!shot.assetId && !assetStale(doc, shot);
    const needs = needsGeneratedImage(shot) && (!shot.assetId || assetStale(doc, shot));
    const text = `${shot.description} ${shot.intent ?? ""} ${timed?.caption ?? ""}`.toLocaleLowerCase();
    return (!normalizedShotQuery || text.includes(normalizedShotQuery))
      && (shotFilter === "all" || (shotFilter === "needs" && needs) || (shotFilter === "failed" && failed) || (shotFilter === "ready" && ready) || (shotFilter === "locked" && shot.locked));
  });

  function jumpToShot(shotId: string) {
    setJumpShotId(shotId);
    if (!shotId) return;
    setActive(shotId);
    const timed = timeline?.shots.find((item) => item.shotId === shotId);
    if (timed) onSeek(timed.startMs);
    window.requestAnimationFrame(() => document.getElementById(`shot-card-${shotId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  async function generateAll() {
    if (!imageModelId || remaining === 0) return;
    const detail = [missing && `缺图 ${missing} 个`, stale && `已过期 ${stale} 个`].filter(Boolean).join("、");
    const styleNote = doc?.visualStyle ? `画面风格：${doc.visualStyle.name}。` : "还没有选择画面风格，将自动采用推荐风格（可在「画面风格」里修改）。";
    const units = remaining * candidateCount;
    if (needsConfirm({ units, costYuan: null }) && !(await confirm({
      title: "生成缺失和过期的图片？",
      message: `将为 ${remaining} 个镜头（${detail}）提交 ${units} 张图片生成请求，费用由图片服务商收取。${styleNote}`,
      confirmLabel: "开始生成",
      tone: "danger",
      bullets: [
        `预计费用：图片单价暂无法估算，以服务商账单为准（${units} 张）。`,
        `影响范围：${remaining} 个缺图或已过期镜头；已有图片会保留，生成完成后才替换。`,
        "可撤销：排队中的请求可以停止；服务商已接单的请求仍可能计费。",
      ],
    }))) return;
    setBulkBusy(true);
    setErrors((current) => ({ ...current, bulk: "" }));
    try {
      if ((await store.flush()) == null) throw new Error("项目设置保存失败，请重试");
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId: imageModelId, candidateCount }) });
      const data = await response.json() as { batchId?: string; count?: number; jobs?: Job[]; error?: string };
      if (!response.ok) throw new Error(data.error || "提交批量任务失败");
      if (data.batchId && data.count) {
        setBulkBatch({ id: data.batchId, createdAt: data.jobs?.at(-1)?.createdAt ?? Date.now(), jobs: data.jobs ?? [] });
        setBulkStopRequested(null);
      }
    } catch (cause) { setErrors((current) => ({ ...current, bulk: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setBulkBusy(false); }
  }

  async function stopBulkGeneration() {
    if (!selectedBatchId || stoppingSelectedBatch || !bulkActive) return;
    if (!(await confirm({
      title: "停止本次全量生图？",
      message: "已完成的图片会保留，排队中的任务会取消；正在服务商处理的请求可能已经产生费用。停止后可以继续生成未完成的图片。",
      confirmLabel: "停止生成",
      tone: "danger",
      bullets: [
        "预计费用：已经提交给服务商的请求仍可能计费。",
        "影响范围：只停止本次批量任务，已完成的图片和单镜任务不受影响。",
        "可恢复：停止后可以继续生成未完成的镜头。",
      ],
    }))) return;
    setBulkStopping(true);
    setBulkStopRequested(selectedBatchId);
    setErrors((current) => ({ ...current, bulk: "" }));
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/generate/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: selectedBatchId }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "停止生成失败");
    } catch (cause) {
      setBulkStopRequested(null);
      setErrors((current) => ({ ...current, bulk: cause instanceof Error ? cause.message : String(cause) }));
    } finally { setBulkStopping(false); }
  }

  async function upload(shot: Shot, file: File) {
    setUploading(shot.id);
    try {
      const res = await fetch("/api/media", { method: "POST", headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }, body: file });
      const asset = (await res.json()) as { hash?: string; kind?: string; error?: string };
      if (!res.ok || !asset.hash) throw new Error(asset.error || "上传失败");
      shotUpdate(store, shot.id, (s) => ({ ...s, kind: "upload", assetId: asset.hash }));
    } catch (e) {
      setErrors((old) => ({ ...old, [shot.id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setUploading(null);
    }
  }

  async function generate(shot: Shot) {
    if (!imageModelId) return;
    setGenerating(shot.id);
    setErrors((old) => ({ ...old, [shot.id]: "" }));
    try {
      if ((await store.flush()) == null) throw new Error("镜头设置保存失败，请重试");
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/${encodeURIComponent(shot.id)}/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "image", modelId: imageModelId, candidateCount }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "提交生成任务失败");
    } catch (e) {
      setErrors((old) => ({ ...old, [shot.id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setGenerating(null);
    }
  }

  async function selectCandidate(shot: Shot, candidateId: string) {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/${encodeURIComponent(shot.id)}/generate`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId }) });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error || "切换候选失败");
      }
      setErrors((old) => ({ ...old, [shot.id]: "" }));
    } catch (e) { setErrors((old) => ({ ...old, [shot.id]: e instanceof Error ? e.message : String(e) })); }
  }

  function split(shot: Shot) {
    const index = lineIndex.get(shot.at.lineId) ?? 0;
    const next = lines[index + 1];
    if (!next || ordered.some((s) => s.at.lineId === next.id && s.at.char === 0)) return;
    store.setDoc((d) => ({ ...d, shots: stampShots([...d.shots, { ...shot, id: newId(), at: { lineId: next.id, char: 0 }, focusText: undefined, card: undefined, onScreenText: undefined, locked: false }], d.lines) }));
    toast("已拆分镜头，现有成片需要重新渲染", "info");
  }

  function merge(shot: Shot) {
    const index = ordered.findIndex((s) => s.id === shot.id);
    const next = ordered[index + 1];
    if (!next || next.locked) return;
    store.setDoc((d) => ({ ...d, shots: stampShots(d.shots.filter((s) => s.id !== next.id), d.lines) }));
    toast("已合并镜头，现有成片需要重新渲染", "info");
  }

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="label">分镜</p><h2 className="mt-1 text-base font-medium">分镜板</h2></div>
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-white/45">
          <span>{ordered.length} 镜头 · {missing} 待补图{stale > 0 ? ` · ${stale} 已过期` : ""}</span>
          {imageJobs.length > 0 && <span className="text-white/60">图片任务：完成 {completedImages} · 生成中 {activeImages} · 排队 {queuedImages}{failedImages ? ` · 失败 ${failedImages}` : ""}</span>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <Select className="w-full min-w-0 flex-1 basis-full text-xs sm:basis-auto" value={imageModelId} aria-label="生图模型" onChange={setImageModelId}><option value="">{imageModels.length ? "选择生图模型" : "暂无可用生图模型"}</option>{imageModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</Select>
        <Select className="w-auto min-w-32 text-xs" value={String(candidateCount)} aria-label="每镜候选数" onChange={(value) => setCandidateCount(Number(value))}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} 张/镜</option>)}</Select>
        {bulkActive ? <button className="btn btn-ghost btn-sm" disabled={stoppingSelectedBatch} onClick={() => void stopBulkGeneration()}>{stoppingSelectedBatch ? <Spinner className="size-3.5" /> : <Icon name="stop" className="size-3.5" />}{stoppingSelectedBatch ? "正在停止…" : "停止本次生成"}</button> : <button className="btn btn-primary btn-sm" disabled={!imageModelId || !remaining || bulkBusy || activeImages > 0} onClick={() => void generateAll()}>{bulkBusy ? <Spinner className="size-3.5" /> : <Icon name="sparkle" className="size-3.5" />}{bulkStopped ? "继续生成图片" : `全量生成图片 · ${remaining * candidateCount} 张`}</button>}
      </div>
      {bulkStopped && <p className="mt-2 text-xs text-amber-200/75">本次生成已停止，已完成图片保留。</p>}
      {errors.bulk && <p role="alert" className="mt-2 text-xs text-red-300">{errors.bulk}</p>}
      {bulkJobs.length > 0 && selectedBatchId && <div className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2.5" role="status" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium text-white/75">本次批量生成</span><span className="tabular-nums text-white/55">{bulkDone}/{bulkJobs.length} 完成 · {Math.round(bulkProgress * 100)}%</span></div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bulkProgress * 100)}><span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(bulkProgress * 100)}%` }} /></div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/45"><span>生成中 {bulkRunning}</span><span>排队 {bulkQueued}</span>{bulkFailed > 0 && <span className="text-red-300">失败 {bulkFailed}</span>}{bulkCanceled > 0 && <span>已取消 {bulkCanceled}</span>}</div>
        {bulkFailed > 0 && <details className="mt-2 text-[11px] text-red-200/80"><summary className="cursor-pointer">查看失败镜头</summary><ul className="mt-1.5 space-y-1 border-l border-red-300/25 pl-3">{bulkJobs.filter((job) => job.status === "failed").map((job) => <li key={job.id}><span>{job.target}：{job.error || job.message || "生成失败"}</span></li>)}</ul></details>}
      </div>}
      {ordered.length === 0 ? <p className="py-8 text-center text-sm text-white/35">配音完成后会自动生成分镜</p> : <>
        <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
          {/* 快速导航栏 */}
          {doc.segments.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-white/40">快速跳转到章节</p>
              <div className="flex flex-wrap gap-1.5">
                {doc.segments.map((segment, index) => {
                  const segmentShots = ordered.filter((s) => {
                    const lineIdx = doc.lines.findIndex((l) => l.id === s.at.lineId);
                    return lineIdx >= 0 && doc.lines[lineIdx].segmentIndex === index;
                  });
                  const hasIssues = segmentShots.some((s) => {
                    const serverStatus = shotStatus[s.id];
                    return serverStatus?.status === "failed" || (!s.assetId && needsGeneratedImage(s));
                  });
                  return (
                    <button
                      key={index}
                      className={`chip h-7 px-2.5 text-xs ${hasIssues ? "border-amber-200/25 bg-amber-200/10 text-amber-200" : ""}`}
                      onClick={() => {
                        const firstShot = segmentShots[0];
                        if (firstShot) jumpToShot(firstShot.id);
                      }}
                      title={`第 ${index + 1} 章：${segmentShots.length} 个镜头${hasIssues ? "（有待处理项）" : ""}`}
                    >
                      第 {index + 1} 章 · {segmentShots.length}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 搜索与筛选 */}
          <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_minmax(150px,auto)_auto]">
            <label className="relative block">
              <span className="sr-only">搜索分镜</span>
              <Icon name="search" className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/30" />
              <input
                className="input h-9 w-full pl-8 text-xs"
                value={shotQuery}
                onChange={(event) => setShotQuery(event.target.value)}
                placeholder="搜索画面描述、意图或字幕"
                aria-label="搜索分镜"
              />
              {shotQuery && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                  onClick={() => setShotQuery("")}
                  aria-label="清空搜索"
                >
                  <Icon name="x" className="size-3.5" />
                </button>
              )}
            </label>
            <Select className="h-9 text-xs" value={jumpShotId} onChange={jumpToShot} aria-label="定位镜头">
              <option value="">定位镜头…</option>
              {ordered.map((shot, index) => (
                <option key={shot.id} value={shot.id}>
                  镜头 {index + 1} · {shot.description.slice(0, 22) || "暂无描述"}
                </option>
              ))}
            </Select>
            <Select className="h-9 text-xs" value={shotFilter} onChange={(value) => setShotFilter(value as typeof shotFilter)} aria-label="筛选分镜">
              <option value="all">全部镜头</option>
              <option value="needs">待补图 / 已过期</option>
              <option value="failed">生成失败</option>
              <option value="ready">已有最新素材</option>
              <option value="locked">已锁定</option>
            </Select>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <p className="text-white/40">
            显示 {shownShots.length}/{ordered.length} 个镜头
            {shotQuery && <span className="ml-2 text-accent">· 搜索「{shotQuery}」</span>}
            {shotFilter !== "all" && <span className="ml-2 text-white/50">· 已筛选</span>}
          </p>
          {shownShots.length > 0 && active && (
            <button
              className="text-white/45 hover:text-white"
              onClick={() => {
                const currentIndex = shownShots.findIndex((s) => s.id === active);
                if (currentIndex >= 0 && currentIndex < shownShots.length - 1) {
                  const nextShot = shownShots[currentIndex + 1];
                  jumpToShot(nextShot.id);
                }
              }}
            >
              下一个 →
            </button>
          )}
        </div>
        {shownShots.length === 0 ? <p className="py-8 text-center text-sm text-white/35">没有符合条件的镜头</p> : <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shownShots.map((shot) => {
          const index = ordered.findIndex((item) => item.id === shot.id);
          const timed = timeline?.shots.find((item) => item.shotId === shot.id);
          const job = [...jobs.values()].findLast((item) => item.stage === "shot-generate" && item.target === `镜头 ${shot.id}`);
          // 状态以服务端裁决为准（见 /shots/status）。客户端这份 job 只用于「重试」拿到 id。
          const serverStatus = shotStatus[shot.id];
          return <ShotCard key={shot.id} shot={shot} timed={timed} timeline={timeline} index={index} active={active === shot.id} lineIndex={lineIndex.get(shot.at.lineId) ?? 0} lineIds={doc.lines.map((l) => l.id)} estimated={timeline?.lines.some((l) => l.estimated) ?? true} store={store} error={errors[shot.id]} job={job} serverStatus={serverStatus} uploading={uploading === shot.id} generating={generating === shot.id} imageReady={!!imageModelId} canMerge={index < ordered.length - 1 && !ordered[index + 1]?.locked} candidateCount={candidateCount} confirm={confirm} toast={toast} onSelect={() => { setActive(shot.id); if (timed) onSeek(timed.startMs); }} onUpload={(file) => upload(shot, file)} onGenerate={() => generate(shot)} onCandidate={(candidateId) => selectCandidate(shot, candidateId)} onSplit={() => split(shot)} onMerge={() => merge(shot)} />;
        })}
      </div>}
      </>}
    </section>
  );
}

function ShotCard({ shot, timed, timeline, index, lineIndex, lineIds, estimated, active, store, error, job, serverStatus, uploading, generating, imageReady, canMerge, candidateCount, confirm, toast, onSelect, onUpload, onGenerate, onCandidate, onSplit, onMerge }: {
  shot: Shot; timed?: TimelineShot; timeline: Timeline | null; index: number; lineIndex: number; lineIds: string[]; estimated: boolean; active: boolean; store: ProjectStore; error?: string; job?: Job; serverStatus?: { status: string; progress: number; message: string; error: string | null; total: number; done: number; failed: number; running: number }; uploading: boolean; generating: boolean; imageReady: boolean; canMerge: boolean; candidateCount: number;
  confirm: (options: { title: string; message?: string; confirmLabel?: string; tone?: "default" | "danger"; bullets?: string[] }) => Promise<boolean>;
  toast: (message: string, kind?: "info" | "success" | "error") => void;
  onSelect: () => void; onUpload: (file: File) => void; onGenerate: () => void; onCandidate: (id: string) => void; onSplit: () => void; onMerge: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef(shot.description);
  useEffect(() => { if (active) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [active]);
  /**
   * 重试与首次生成走同一套成本规则：首次要确认的，重试也要。
   * 否则用户会学会「靠重试绕过确认」——而重试同样调用服务商、同样计费。
   */
  const retryJobWithCost = async () => {
    if (!job) return;
    const units = candidateCount;
    if (needsConfirm({ units, costYuan: null })) {
      const ok = await confirm({
        title: "重试这次生成？",
        message: `将为这个镜头重新提交 ${units} 张图片生成请求，费用由图片服务商收取。上次失败可能已经产生费用。`,
        bullets: [
          `预计费用：图片单价暂无法估算，以服务商账单为准（${units} 张）。`,
          "影响范围：只重新提交这个镜头，已有图片会保留。",
          "可恢复：任务可以再次取消或重试；服务商已接单的请求仍可能计费。",
        ],
        confirmLabel: "重试",
        tone: "danger",
      });
      if (!ok) return;
    }
    await jobAction(job.id, "retry");
  };
  const covered = timed && timeline ? timeline.lines.filter((l) => l.endMs > timed.startMs && l.startMs < timed.endMs).map((l) => lineIds.indexOf(l.id) + 1).filter((i) => i > 0) : [];
  const time = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const wantsImage = needsGeneratedImage(shot);
  const compiled = wantsImage && store.doc ? compileShotPrompt(store.doc, shot) : null;
  const stale = !!store.doc && assetStale(store.doc, shot);
  const hasImage = !!shot.assetId;
  const isTextShot = shot.mode === "motion" || shot.kind === "title" || shot.kind === "quote";
  const focus = shot.focusText ?? timed?.focusText ?? focusTextFromLegacy(shot, timed?.keywords, timed?.caption);
  const focusWidth = focusVisualWidth(focus?.text ?? "");
  const updateFocus = (patch: Partial<NonNullable<Shot["focusText"]>>) => shotUpdate(store, shot.id, (s) => ({
    ...s, kind: "placeholder", mode: "motion", card: undefined, onScreenText: undefined,
    animation: s.animation ? { ...s.animation, templateId: undefined } : undefined,
    focusText: { text: focus?.text ?? "重点", layoutMode: focus?.layoutMode ?? "auto", support: focus?.support, emphasis: focus?.emphasis, presetId: focus?.presetId, ...patch },
  }));
  /**
   * 状态以服务端裁决为准：客户端按 target 字符串找任务在多任务并存时不可靠。
   * 服务端没返回（例如刚提交、还没来得及刷新）时退回本地 job，保证按钮立刻有反馈。
   */
  const serverJobStatus = serverStatus?.status;
  const effectiveStatus = serverJobStatus ?? job?.status;
  const runningJob = effectiveStatus === "queued" || effectiveStatus === "running";
  const status = effectiveStatus === "failed" ? "failed" : effectiveStatus === "canceled" ? "canceled" : runningJob ? (effectiveStatus === "queued" ? "queued" : "running") : effectiveStatus === "succeeded" && hasImage ? "done" : "idle";
  const effectiveProgress = serverStatus && serverStatus.total > 0 ? serverStatus.progress : (job?.progress ?? 0);
  const effectiveError = serverStatus?.error ?? job?.error;
  const statusLabel = { queued: "排队中", running: `生成中 · ${Math.round(effectiveProgress * 100)}%`, done: "已完成", failed: "生成失败", canceled: "已取消", idle: hasImage ? "已有图片" : "待生成" }[status];
  return <div id={`shot-card-${shot.id}`} ref={cardRef} className={`min-w-0 rounded-lg border bg-white/[0.02] p-3 transition-colors ${active ? "border-white" : status === "running" ? "border-accent/60 generation-card-running" : status === "queued" ? "border-amber-200/30" : status === "failed" ? "border-red-400/35" : status === "done" ? "border-accent/20" : "border-white/[0.07]"}`}>
    <div className="flex items-center justify-between gap-2"><button className="min-w-0 truncate text-left text-xs text-white/75 hover:text-white" onClick={onSelect}>镜头 {index + 1} · {timed ? `${time(timed.startMs)}–${time(timed.endMs)}` : "计算中"} · {covered.length ? `第 ${covered[0]}${covered.length > 1 ? `–${covered.at(-1)}` : ""} 句` : `第 ${lineIndex + 1} 句`}{estimated ? " · 估算" : ""}</button><button className={`chip h-7 px-2.5 ${shot.locked ? "chip-on" : ""}`} onClick={() => shotUpdate(store, shot.id, (s) => ({ ...s, locked: !s.locked }))}>{shot.locked ? "已锁定" : "锁定"}</button></div>
    <button className={`relative mt-2 block w-full overflow-hidden rounded-md border bg-[#17242c] text-left ${status === "running" ? "border-accent/50" : status === "queued" ? "border-amber-200/25" : status === "failed" ? "border-red-400/35" : "border-white/10"}`} style={{ aspectRatio: timeline ? `${timeline.width} / ${timeline.height}` : "16 / 9" }} onClick={onSelect} aria-label={`跳转到镜头 ${index + 1}`}>
      <span className="absolute inset-0 block">{shot.assetId && shot.kind === "video" ? <video key={shot.assetId} muted playsInline preload="metadata" src={mediaUrl(shot.assetId)} className={`h-full w-full object-cover ${status === "done" ? "generation-image-complete" : ""}`} /> : shot.assetId ? <Image key={shot.assetId} src={mediaUrl(shot.assetId)} alt="" fill sizes="(max-width: 640px) 100vw, 320px" unoptimized className={`object-cover ${status === "done" ? "generation-image-complete" : ""}`} /> : timed && timeline ? <ShotThumbnail shot={timed} width={timeline.width} height={timeline.height} fps={timeline.fps} theme={timeline.theme} /> : <span className="grid h-full place-items-center text-xs text-white/40">正在加载预览</span>}</span>
      {runningJob && <span className="pointer-events-none absolute inset-0 bg-black/25" />}
      {runningJob && <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-accent/35 bg-black/65 px-2 py-1 text-[10px] text-accent backdrop-blur"><span className="generation-live-dot size-1.5 rounded-full bg-accent" />{statusLabel}</span>}
      {status === "queued" && <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded bg-black/65 px-2 py-1 text-[10px] text-amber-100/85 backdrop-blur">等待空闲并发</span>}
      {status === "failed" && <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded bg-red-950/80 px-2 py-1 text-[10px] text-red-100 backdrop-blur">生成失败 · 可重试</span>}
      {runningJob && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/45"><span className="block h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(effectiveProgress * 100)}%` }} /></span>}
    </button>
    <p className="mt-2 line-clamp-2 min-h-9 text-xs leading-5 text-white/55">{timed?.caption || "暂无覆盖句子"}</p>
    <p className="mt-1.5 text-[11px] text-white/40">{shotExpression(shot, timed)}</p>
    {wantsImage && store.doc && shot.characterIds.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{shot.characterIds.map((cid) => store.doc!.characters.find((c) => c.id === cid)).filter(Boolean).map((c) => <span key={c!.id} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/60">{c!.name}</span>)}</p>}
    {shot.intent && <p className="mt-1 text-xs leading-5 text-white/70" title="导演意图：观众此刻应该看到或感受到什么"><span className="text-white/40">意图 · </span>{shot.intent}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    {generating && <p className="mt-2 flex items-center gap-1.5 text-xs text-accent"><span className="generation-live-dot size-1.5 rounded-full bg-accent" />正在提交生成任务…</p>}
    {runningJob && <p className="mt-2 flex items-center gap-1.5 text-xs text-accent"><span className="generation-live-dot size-1.5 rounded-full bg-accent" />{statusLabel}{serverStatus?.message ? ` · ${serverStatus.message}` : job?.message ? ` · ${job.message}` : ""}</p>}
    {status === "done" && shot.assetId && <p className="mt-2 text-xs text-accent/75">图片已就绪，可在预览区播放</p>}
    {status === "failed" && <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-xs"><p className="text-red-300">{effectiveError || "生成失败"}</p>{job && <button className="chip h-6 px-2.5 text-[11px]" title={`重新提交这个镜头的生成请求（${candidateCount} 张）`} onClick={() => void retryJobWithCost()}>重试 · {candidateCount} 张</button>}</div>}
    {status === "canceled" && <p className="mt-2 text-xs text-white/45">任务已取消，可重新生成</p>}
    {wantsImage && !shot.assetId && !generating && <p className="mt-2 text-xs text-amber-200/70">暂无素材，使用占位画面</p>}
    {stale && <p className="mt-2 text-xs text-amber-200/80">画面描述或风格已改，图片已过期</p>}
    {!isTextShot && <AutoTextarea value={shot.description} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, description: e.target.value }))} onBlur={() => { if (descriptionRef.current !== shot.description) { descriptionRef.current = shot.description; toast("已修改画面描述，现有成片需要重新渲染", "info"); } }} className="input mt-2 min-h-16 text-xs" placeholder="画面描述" />}
    {wantsImage && <button className="btn btn-ghost btn-sm mt-2" disabled={generating || shot.locked || !imageReady || runningJob} title={`${shot.assetId ? "重新生成" : "生成"} ${candidateCount} 张候选图`} onClick={onGenerate}>{generating ? <Spinner className="size-3" /> : <Icon name="sparkle" className="size-3.5" />}{shot.assetId ? "重新生成图片" : "生成图片"} · {candidateCount} 张</button>}
    {(shot.kind === "image" || shot.kind === "video") && <>
      {shot.candidates.length > 0 && <div className="mt-3" aria-label="候选素材历史">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-white/40">
          <span>候选历史</span>
          <span>{shot.candidates.length} / 8 · {shot.candidates.find((candidate) => candidate.selected) ? "已选择" : "待选择"}</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">{shot.candidates.map((candidate, candidateIndex) => {
          const label = `${candidate.selected ? "当前使用" : "使用"}第 ${candidateIndex + 1} 个候选素材`;
          return <button
            key={candidate.id}
            className={`group relative aspect-video overflow-hidden rounded border-2 transition-all duration-200 active:scale-[0.98] ${
              candidate.selected
                ? "border-accent shadow-[0_0_12px_rgba(125,211,252,0.3)] ring-1 ring-accent/20"
                : "border-white/10 hover:border-white/30 hover:shadow-[0_0_8px_rgba(255,255,255,0.1)]"
            }`}
            title={label}
            aria-label={label}
            aria-pressed={candidate.selected}
            onClick={() => onCandidate(candidate.id)}
          >
            {shot.kind === "video" ? (
              <video muted preload="metadata" src={mediaUrl(candidate.assetId)} className="h-full w-full object-cover" />
            ) : (
              <Image src={mediaUrl(candidate.assetId)} alt="" fill sizes="96px" unoptimized className="object-cover" />
            )}
            {candidate.selected && (
              <span className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-medium text-ink shadow-lg">
                <Icon name="check" className="size-2.5" />
                当前
              </span>
            )}
            <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1 py-1 text-left text-[10px] text-white">
              候选 {candidateIndex + 1}
            </span>
            {/* 悬停放大预览提示 */}
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/40 group-hover:opacity-100">
              <Icon name="maximize" className="size-4 text-white/80" />
            </span>
          </button>;
        })}</div>
        {shot.candidates.length >= 6 && (
          <p className="mt-1.5 text-[10px] text-white/35">
            提示：候选已接近上限（8个），重新生成时会自动移除最旧的候选
          </p>
        )}
      </div>}
    </>}
    <div className="mt-3 flex flex-wrap items-center gap-2"><label className="chip h-7 cursor-pointer px-2.5">{uploading ? <Spinner className="size-3" /> : "上传图片"}<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} /></label><button className="chip h-7 px-2.5" onClick={onSplit}>拆分</button><button className="chip h-7 px-2.5" disabled={!canMerge} onClick={onMerge}>合并下一镜</button></div>
    {isTextShot && <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
      <div className="flex items-center justify-between text-[11px] text-white/50"><span>重点文字</span><span className={focusWidth > 8 ? "text-amber-200" : ""}>{focusWidth.toFixed(1)} / 8 字宽</span></div>
      <input className="input h-9 w-full text-sm" value={focus?.text ?? ""} onChange={(e) => updateFocus({ text: e.target.value })} placeholder="核心关键词或短句" aria-label="核心文字" />
      {focusWidth > 8 && <p className="text-[11px] text-amber-200">请概括为 8 字以内；预览会按空间收缩字号。</p>}
      <div className="grid grid-cols-2 gap-2"><input className="input h-8 min-w-0 text-xs" value={focus?.support ?? ""} onChange={(e) => updateFocus({ support: e.target.value || undefined })} placeholder="辅助小字（可选）" aria-label="辅助文字" /><input className="input h-8 min-w-0 text-xs" value={focus?.emphasis ?? ""} onChange={(e) => updateFocus({ emphasis: e.target.value || undefined })} placeholder="强调片段（可选）" aria-label="强调片段" /></div>
      {focusVisualWidth(focus?.support ?? "") > 8 && <p className="text-[11px] text-amber-200">辅助字也请压缩到 8 字以内，原文会完整保留。</p>}
      <div className="grid grid-cols-2 gap-2"><Select value={focus?.layoutMode ?? "auto"} onChange={(v) => updateFocus({ layoutMode: v as NonNullable<Shot["focusText"]>["layoutMode"], presetId: v === "manual" ? (focus?.presetId ?? timed?.focusText?.presetId ?? "focus") : undefined })} aria-label="排版模式"><option value="auto">智能匹配</option><option value="shuffle">探索变化</option><option value="manual">手动锁定</option></Select><Select value={focus?.layoutMode === "manual" ? focus.presetId ?? "focus" : timed?.focusText?.presetId ?? "focus"} onChange={(v) => updateFocus({ layoutMode: "manual", presetId: v as NonNullable<Shot["focusText"]>["presetId"] })} aria-label="排版方案">{focusPresetIds.map((id) => <option key={id} value={id}>{focusPresetLabels[id]}</option>)}</Select></div>
      {focus?.layoutMode === "shuffle" && <button className="chip h-7 px-2.5 text-xs" type="button" onClick={() => shotUpdate(store, shot.id, (s) => ({ ...s, seed: (s.seed ?? timed?.seed ?? 0) + 1 }))}>换一个排版</button>}
    </div>}
    <details className="mt-3 border-t border-white/10 pt-2 text-xs text-white/50">
      <summary className="cursor-pointer">高级</summary>
      <div className="mt-2 grid gap-2">
        <p className="text-[11px] leading-4 text-white/45">修改会自动保存并刷新预览。已有成片需要重新渲染。</p>
        <Select value={isTextShot ? "placeholder" : shot.kind} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, kind: v as Shot["kind"], focusText: v === "placeholder" ? s.focusText : undefined }))} aria-label="镜头类型">
          {(["placeholder", "upload", "image", "video", "stock", "chart"] as Shot["kind"][]).map((kind) => <option key={kind} value={kind}>{shotKindLabels[kind]}</option>)}
        </Select>
        <Select value={shot.mode === "motion" ? "motion" : shot.mode === "composite" ? "composite" : shot.mode === "real" ? "real" : "generate"} onChange={(v) => shotUpdate(store, shot.id, (s) => ({
          ...s, kind: "placeholder", mode: v as Shot["mode"], shotSize: v === "generate" ? (s.shotSize ?? "medium") : s.shotSize,
          focusText: v === "motion" ? (focus ?? { text: timed?.keywords[0] ?? "重点", layoutMode: "auto" }) : undefined,
          card: v === "motion" ? undefined : s.card, onScreenText: v === "motion" ? undefined : s.onScreenText,
        }))} aria-label="表达方式"><option value="generate">生成画面</option><option value="motion">重点文字</option><option value="composite">画面 + 动画层</option><option value="real">真实素材</option></Select>
        {!isTextShot && <Select value={shot.motion} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, motion: v as Shot["motion"] }))} aria-label="运镜"><option value="zoom-in">推进</option><option value="zoom-out">拉远</option><option value="pan-left">左移</option><option value="pan-right">右移</option><option value="none">静止</option></Select>}
        <Select value={shot.transitionIn ?? "cut"} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, transitionIn: v as NonNullable<Shot["transitionIn"]> }))} aria-label="转场"><option value="cut">切镜</option><option value="fade">淡入</option><option value="wipe">擦除</option><option value="whip">甩镜</option><option value="push">推入</option><option value="dissolve">溶解</option></Select>
        {!isTextShot && <Select value={shot.shotSize ?? "medium"} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, shotSize: v as Shot["shotSize"] }))} aria-label="景别">{shotSizes.map((size) => <option key={size} value={size}>{shotSizeLabels[size]}</option>)}</Select>}
        {wantsImage && <><AutoTextarea value={shot.prompt ?? ""} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, prompt: e.target.value || undefined }))} className="input min-h-12 text-xs" placeholder="自定义画面内容" /><input className="input h-8 py-1.5 text-xs" type="number" min={0} value={shot.seed ?? ""} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, seed: e.target.value === "" ? undefined : Number(e.target.value) }))} placeholder="seed" />{store.doc && store.doc.characters.some((c) => !c.absent) && <div className="space-y-1"><p className="text-[11px] text-white/40">画面里的角色（最多 {MAX_SHOT_CHARACTERS} 个）</p><div className="flex flex-wrap gap-1.5">{store.doc.characters.filter((c) => !c.absent || shot.characterIds.includes(c.id)).map((c) => { const on = shot.characterIds.includes(c.id); return <button key={c.id} type="button" className={`chip h-7 px-2.5 ${on ? "chip-on" : ""}`} disabled={!on && shot.characterIds.length >= MAX_SHOT_CHARACTERS} onClick={() => shotUpdate(store, shot.id, (s) => ({ ...s, characterIds: on ? s.characterIds.filter((x) => x !== c.id) : [...s.characterIds, c.id] }))}>{c.name}</button>; })}</div></div>}{compiled && <PromptSlots compiled={compiled} />}</>}
      </div>
    </details>
  </div>;
}


/** 镜头卡上的表达方式。 */
function shotExpression(shot: Shot, timed: TimelineShot | undefined) {
  if (shot.mode === "motion" || shot.kind === "title" || shot.kind === "quote") {
    const focus = timed?.focusText ?? shot.focusText;
    return `重点文字 · ${focus?.text ?? "待填写"} · ${focus?.presetId ? focusPresetLabels[focus.presetId] : "智能匹配"}`;
  }
  if (shot.mode === "composite") return `复合画面 · 两层视差${shot.shotSize ? ` · ${shotSizeLabels[shot.shotSize]}` : ""}`;
  return `生成画面${shot.shotSize ? ` · ${shotSizeLabels[shot.shotSize]}` : ""}`;
}

/** 编译后发给生图模型的提示词，按槽位展示 */
function PromptSlots({ compiled }: { compiled: CompiledPrompt }) {
  const rows: [string, string][] = [["内容", compiled.slots.content], ["人物", compiled.slots.characters], ["镜头", compiled.slots.camera], ["风格", compiled.slots.style], ["情绪", compiled.slots.mood], ["负面", compiled.negative.join("、")]];
  return <div className="space-y-1 rounded-md border border-white/10 bg-black/20 p-2 text-[11px] leading-5">
    <p className="text-white/40">发给生图模型的提示词</p>
    {rows.filter(([, text]) => text).map(([label, text]) => <p key={label}><span className="text-white/35">{label} · </span><span className="text-white/70">{text}</span></p>)}
    {compiled.removed.length > 0 && <p className="text-amber-200/70">已从画面描述中去掉画风词：{compiled.removed.join("、")}（画风由画面风格统一决定）</p>}
    {compiled.moodConflict && <p className="text-amber-200/70">画面风格不承载「{compiled.moodConflict}」情绪，保持风格基调</p>}
  </div>;
}
