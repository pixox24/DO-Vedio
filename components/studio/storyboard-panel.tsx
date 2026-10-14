"use client";

// 分镜面板：镜头网格、候选切换、批量生图与失败恢复。

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { AutoTextarea, Icon, Select, Spinner } from "@/components/ui";
import { jobAction } from "@/lib/client";
import { mediaUrl, shotKindLabels, shotSizeLabels, shotSizes, type Job, type Motion, type Shot, type TransitionIn } from "@/lib/core/types";
import { newId } from "@/lib/core/sync";
import { outputSpecsFor, previewSpecFor } from "@/lib/core/output-spec";
import { selectShotCandidate } from "@/lib/core/shot-asset";
import { stampShots } from "@/lib/core/shots";
import { assetStale, compileShotPrompt, MAX_SHOT_CHARACTERS, needsGeneratedImage, type CompiledPrompt } from "@/lib/core/prompt-compiler";
import { needsConfirm } from "@/lib/core/interaction";
import { focusPresetLabels, focusTextFromLegacy, focusVisualWidth } from "@/lib/core/focus";
import { cameraById, cameraCatalog, transitionCatalog } from "@/lib/core/motion-library";
import type { Timeline, TimelineShot } from "@/lib/core/timeline";
import { useFeedback } from "@/components/feedback";
import { MotionPaletteEditor } from "@/components/motion-palette-editor";
import { MotionPresetPicker } from "@/components/motion-preset-picker";
import { ShelfPicker } from "@/components/shelf-picker";
import { jobBatchId, type ProjectStore } from "./shared";
import { columnCount, shotRows, shotState, shotTime, type ShotServerStatus } from "./shot-view";

import { VideoStoryboardPanel } from "./video-storyboard-panel";

const ShotThumbnail = dynamic(() => import("../shot-thumbnail").then((m) => m.ShotThumbnail), { ssr: false, loading: () => <div className="grid h-full place-items-center bg-stage text-xs text-white/40">正在加载预览</div> });

function shotUpdate(store: ProjectStore, id: string, fn: (shot: Shot) => Shot) {
  store.setDoc((doc) => ({ ...doc, shots: stampShots(doc.shots.map((s) => (s.id === id ? fn(s) : s)), doc.lines) }));
}

/** 一张镜头在三种形态之间共用的全部属性与回调 */
type ShotCommon = {
  shot: Shot; timed?: TimelineShot; timeline: Timeline | null; index: number; active: boolean;
  lineIndex: number; lineIds: string[]; estimated: boolean; store: ProjectStore; error?: string; job?: Job;
  serverStatus?: ShotServerStatus;
  uploading: boolean; generating: boolean; imageReady: boolean; canMerge: boolean; candidateCount: number;
  confirm: (options: { title: string; message?: string; confirmLabel?: string; tone?: "default" | "danger"; bullets?: string[] }) => Promise<boolean>;
  toast: (message: string, kind?: "info" | "success" | "error") => void;
  onSelect: () => void; onUpload: (file: File) => void; onGenerate: () => void; onCandidate: (id: string) => void; onSplit: () => void; onMerge: () => void;
};

export function StoryboardPanel(props: Parameters<typeof ImageStoryboardPanel>[0]) {
  return props.store.doc?.settings.visualPipeline === "video" ? <VideoStoryboardPanel {...props} /> : <ImageStoryboardPanel {...props} />;
}

function ImageStoryboardPanel({ id, store, timeline, jobs, onSeek, wide = false, onToggleWide }: { id: string; store: ProjectStore; timeline: Timeline | null; jobs: Map<string, Job>; onSeek: (ms: number) => void; wide?: boolean; onToggleWide?: () => void }) {
  const doc = store.doc;
  const { confirm, toast } = useFeedback();
  /** 卡片（扫读+展开）还是表格（原先把所有内容铺在单列里） */
  const [view, setView] = useState<"cards" | "table">("cards");
  /**
   * 行分组要按容器实际宽度算，不能只看视口：分镜板活在制作页右栏里，
   * 同一个视口宽度下，全宽模式和常规模式能排的列数差一档。
   *
   * 用回调 ref 而不是 useEffect：网格只在「卡片形态 + 有镜头」时才存在，
   * 分镜可能是在面板已经打开之后才生成的，effect 依赖不变就不会重跑。
   * 回调 ref 由 React 在挂载/卸载时调用，这些情况都能覆盖到。
   */
  const gridObserver = useRef<ResizeObserver | null>(null);
  const gridRef = useCallback((node: HTMLDivElement | null) => {
    gridObserver.current?.disconnect();
    gridObserver.current = null;
    if (!node) return;
    const measure = () => setColumns(columnCount(node.clientWidth, wide));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    gridObserver.current = observer;
  }, [wide]);
  const [columns, setColumns] = useState(3);
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
  /** 手风琴：同时只展开一个镜头，展开区插在这一行下方，卡片本身不移动 */
  const [expanded, setExpanded] = useState<string | null>(null);
  const [jumpSegment, setJumpSegment] = useState("");
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
  const lineIds = doc.lines.map((l) => l.id);
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
    // 定位是「让我看到这一镜」，不是「替我打开编辑」，所以顺手收起展开区
    setExpanded(null);
    setActive(shotId);
    const timed = timeline?.shots.find((item) => item.shotId === shotId);
    if (timed) onSeek(timed.startMs);
    window.requestAnimationFrame(() => document.getElementById(`shot-card-${shotId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  function jumpToSegment(segment: string) {
    setJumpSegment(segment);
    if (segment === "") return;
    const first = ordered.find((shot) => doc?.lines.find((l) => l.id === shot.at.lineId)?.segmentIndex === Number(segment));
    if (first) jumpToShot(first.id);
  }

  function toggleExpanded(shotId: string) {
    setExpanded((current) => (current === shotId ? null : shotId));
    setActive(shotId);
    const timed = timeline?.shots.find((item) => item.shotId === shotId);
    if (timed) onSeek(timed.startMs);
  }

  /**
   * 三种形态（扫读卡片 / 展开区 / 表格行）共用同一份镜头属性。
   * 这里只是把原来内联在 map 里的构造原样提出来，没有新增派生逻辑。
   */
  function shotCommon(shot: Shot): ShotCommon {
    const index = ordered.findIndex((item) => item.id === shot.id);
    const timed = timeline?.shots.find((item) => item.shotId === shot.id);
    // 状态以服务端裁决为准（见 /shots/status）。客户端这份 job 只用于「重试」拿到 id。
    const job = [...jobs.values()].findLast((item) => item.stage === "shot-generate" && item.target === `镜头 ${shot.id}`);
    return {
      shot, timed, timeline, index, active: active === shot.id,
      lineIndex: lineIndex.get(shot.at.lineId) ?? 0,
      lineIds,
      estimated: timeline?.lines.some((l) => l.estimated) ?? true,
      store,
      error: errors[shot.id],
      job,
      serverStatus: shotStatus[shot.id],
      uploading: uploading === shot.id,
      generating: generating === shot.id,
      imageReady: !!imageModelId,
      canMerge: index < ordered.length - 1 && !ordered[index + 1]?.locked,
      candidateCount,
      confirm, toast,
      onSelect: () => { setActive(shot.id); if (timed) onSeek(timed.startMs); },
      onUpload: (file: File) => upload(shot, file),
      onGenerate: () => generate(shot),
      onCandidate: (candidateId: string) => selectCandidate(shot, candidateId),
      onSplit: () => split(shot),
      onMerge: () => merge(shot),
    };
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
    const currentDoc = store.doc;
    if (!currentDoc) return;
    const aspect = timeline?.aspect ?? previewSpecFor(currentDoc.settings).aspect;
    const aspects = outputSpecsFor(currentDoc.settings).map((spec) => spec.aspect);
    let missing = false;
    store.setDoc((current) => {
      const target = current.shots.find((item) => item.id === shot.id);
      if (!target) return current;
      const next = selectShotCandidate(target, candidateId, { aspect, framing: current.settings.assetFraming, aspects });
      if (!next) {
        missing = true;
        return current;
      }
      return { ...current, shots: current.shots.map((item) => (item.id === shot.id ? next : item)) };
    });
    if (missing) {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/${encodeURIComponent(shot.id)}/generate`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId, aspect }) });
        if (!response.ok) {
          const data = await response.json() as { error?: string };
          throw new Error(data.error || "切换候选失败");
        }
        await store.reload();
        setErrors((old) => ({ ...old, [shot.id]: "" }));
      } catch (e) { setErrors((old) => ({ ...old, [shot.id]: e instanceof Error ? e.message : String(e) })); }
      return;
    }
    try {
      await store.flush();
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
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-white/45">
          <span className="text-white/60">{ordered.length} 镜头</span>
          {missing > 0 && <span className="text-amber-200/80">{missing} 待补图</span>}
          {stale > 0 && <span className="text-amber-200/80">{stale} 已过期</span>}
          {imageJobs.length > 0 && <span>完成 {completedImages} · 生成中 {activeImages} · 排队 {queuedImages}{failedImages ? ` · 失败 ${failedImages}` : ""}</span>}
        </div>
      </div>
      {/*
        形态切换：常规是「卡片扫读 + 点击展开」，表格是原先把所有内容铺满一列的旧视图。
        快速跳转只服务长列表，所以只在卡片形态下出现。
      */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="segmented" role="group" aria-label="分镜视图">
            {(["cards", "table"] as const).map((key) => (
              <button key={key} type="button" className={`segmented-item ${view === key ? "segmented-item-active" : ""}`} aria-pressed={view === key} onClick={() => setView(key)}>{key === "cards" ? "卡片" : "表格"}</button>
            ))}
          </span>
          {doc.segments.length > 1 && view === "cards" && (
            <Select className="h-8 w-40 text-xs" value={jumpSegment} aria-label="快速跳转到章节" onChange={(value) => jumpToSegment(value)}>
              <option value="">跳到章节…</option>
              {doc.segments.map((segment, index) => <option key={index} value={String(index)}>第 {index + 1} 章 · {segment.title || doc.lines.filter((l) => l.segmentIndex === index).length + " 句"}</option>)}
            </Select>
          )}
        </div>
        {onToggleWide && <button type="button" className={`chip h-8 px-2.5 text-xs ${wide ? "chip-on" : ""}`} aria-pressed={wide} title={wide ? "退出全宽，恢复左侧预览" : "让分镜板临时占满制作区"} onClick={onToggleWide}><Icon name="expand" className="size-3.5" />{wide ? "退出全宽" : "全宽"}</button>}
      </div>
      {/*
        操作条：全量生成是这一屏唯一的批量动作，紧邻的「生图模型 / 每镜候选数」就是它的参数——
        这三个是一组。原来「本片动画」横在这一组和标题之间，把这个主按钮推到了折叠块下面；
        它是全局设置而不是每镜动作，所以移到操作条之后（默认收起）。
      */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        {/* 标题栏里已经有「N 镜头 / 待补图 / 已过期」，这里只补主按钮要用的那条：这次动作会花掉几张 */}
        <p className="text-xs text-white/45">
          {remaining > 0 ? <>待生成 <span className="text-amber-200/80">{remaining}</span> 个镜头</> : <span className="text-white/35">所有镜头都已有最新画面</span>}
        </p>
        <Select className="w-full min-w-0 flex-1 basis-full text-xs sm:basis-auto" value={imageModelId} aria-label="生图模型" onChange={setImageModelId}><option value="">{imageModels.length ? "选择生图模型" : "暂无可用生图模型"}</option>{imageModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</Select>
        <Select className="w-auto min-w-32 text-xs" value={String(candidateCount)} aria-label="每镜候选数" onChange={(value) => setCandidateCount(Number(value))}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} 张/镜</option>)}</Select>
        {bulkActive ? <button className="btn btn-ghost btn-sm" disabled={stoppingSelectedBatch} onClick={() => void stopBulkGeneration()}>{stoppingSelectedBatch ? <Spinner className="size-3.5" /> : <Icon name="stop" className="size-3.5" />}{stoppingSelectedBatch ? "正在停止…" : "停止本次生成"}</button> : <button className="btn btn-primary btn-sm" disabled={!imageModelId || !remaining || bulkBusy || activeImages > 0} onClick={() => void generateAll()}>{bulkBusy ? <Spinner className="size-3.5" /> : <Icon name="sparkle" className="size-3.5" />}{bulkStopped ? "继续生成图片" : `全量生成图片 · ${remaining * candidateCount} 张`}</button>}
      </div>
      {doc && <MotionPaletteEditor palette={doc.motionPalette} onChange={(motionPalette) => store.setDoc((current) => ({ ...current, motionPalette }))} />}
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
        {shownShots.length === 0 ? <p className="py-8 text-center text-sm text-white/35">没有符合条件的镜头</p> : view === "table" ? (
          <div className="mt-3 divide-y divide-white/[0.06] overflow-hidden rounded-surface border border-white/[0.08]">
            {shownShots.map((shot) => (
              <Fragment key={shot.id}>
                <ShotRow {...shotCommon(shot)} expanded={expanded === shot.id} onToggle={() => toggleExpanded(shot.id)} />
                {expanded === shot.id && <ShotDetail {...shotCommon(shot)} spanClass="" onCollapse={() => setExpanded(null)} />}
              </Fragment>
            ))}
          </div>
        ) : (
          <div ref={gridRef} className="mt-3 grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {/*
              按行分组渲染而不是靠 col-span 自动排布。展开区要占满整行，如果交给自动排布，
              当被展开的卡不在这一行末尾时，会在这行余下的格子里留一片空格。
              分组之后被展开的那一行只放它前面的卡片，展开区紧跟其后，下一行从新的一行开始。
            */}
            {shotRows(shownShots, columns, expanded).map(({ row, expandedInRow }) => (
              <Fragment key={row[0].id}>
                {row.map((shot) => <ShotTile key={shot.id} {...shotCommon(shot)} expanded={expanded === shot.id} onToggle={() => toggleExpanded(shot.id)} />)}
                {expandedInRow && <ShotDetail {...shotCommon(expandedInRow)} spanClass="col-span-full" onCollapse={() => setExpanded(null)} />}
              </Fragment>
            ))}
          </div>
        )}
      </>}
    </section>
  );
}

/** 缩略图/大图共用的画面渲染。顺序与原来一致：视频 → 图片 → Remotion 预览 → 占位 */
function ShotMedia({ shot, timed, timeline, status, sizes = "(max-width: 640px) 100vw, 320px" }: { shot: Shot; timed?: TimelineShot; timeline: Timeline | null; status: string; sizes?: string }) {
  if (shot.assetId && shot.kind === "video") return <video key={shot.assetId} muted playsInline preload="metadata" src={mediaUrl(shot.assetId)} className={`h-full w-full object-cover ${status === "done" ? "generation-image-complete" : ""}`} />;
  if (shot.assetId) return <Image key={shot.assetId} src={mediaUrl(shot.assetId)} alt="" fill sizes={sizes} unoptimized className={`object-cover ${status === "done" ? "generation-image-complete" : ""}`} />;
  if (timed && timeline) return <ShotThumbnail shot={timed} width={timeline.width} height={timeline.height} fps={timeline.fps} theme={timeline.theme} />;
  return <span className="grid h-full place-items-center text-2xs text-white/35">正在加载预览</span>;
}

/**
 * 扫读态卡片：只有三层——画面、身份、内容。整张卡是一个按钮，点了就展开。
 * 编辑控件全部搬进 ShotDetail，是为了让这里的高度完全由画面决定，
 * 同一行的卡片才会一样高（原来候选图 4 张的卡和 0 张的卡能差一倍高度）。
 */
function ShotTile({ shot, timed, timeline, index, active, expanded, onToggle, generating, job, serverStatus }: ShotCommon & { expanded: boolean; onToggle: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (active) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [active]);
  const { status, running, progress, label } = shotState({ shot, job, serverStatus });
  const busy = running || generating;
  return (
    <div
      id={`shot-card-${shot.id}`}
      ref={cardRef}
      className={`min-w-0 overflow-hidden rounded-surface border bg-white/[0.02] transition-colors ${active || expanded ? "border-white" : status === "running" ? "border-accent/60 generation-card-running" : status === "queued" ? "border-amber-200/30" : status === "failed" ? "border-red-400/35" : status === "done" ? "border-accent/20" : "border-white/[0.07]"}`}
    >
      <button type="button" className="block w-full text-left" aria-expanded={expanded} aria-label={`镜头 ${index + 1}，${label}，${expanded ? "收起" : "展开"}编辑`} onClick={onToggle}>
        {/* 一级：画面。整卡最大的元素，也是唯一需要「看」的东西 */}
        <span className="relative block w-full overflow-hidden bg-stage" style={{ aspectRatio: timeline ? `${timeline.width} / ${timeline.height}` : "16 / 9" }}>
          <span className="absolute inset-0 block"><ShotMedia shot={shot} timed={timed} timeline={timeline} status={status} /></span>
          {busy && <span className="pointer-events-none absolute inset-0 bg-black/25" />}
          {/* 状态收敛成唯一一条，不再叠四层标签 */}
          {(status === "queued" || status === "running" || status === "failed") && (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 block h-1.5 bg-black/45">
              <span className={`block h-full transition-[width] duration-500 ${status === "failed" ? "w-full bg-red-400/70" : status === "queued" ? "w-full bg-amber-200/45" : "bg-accent"}`} style={{ width: status === "running" ? `${Math.round(progress * 100)}%` : "100%" }} />
            </span>
          )}
        </span>
        {/* 二级：身份。序号与时间码 */}
        <span className="mt-2 flex items-center gap-1.5 px-2.5">
          <span className="truncate text-xs font-medium text-white/80">镜头 {index + 1}</span>
          {shot.locked && <Icon name="lock" className="size-3 shrink-0 text-accent/70" />}
          <span className="ml-auto shrink-0 text-2xs tabular-nums text-white/45">{timed ? `${shotTime(timed.startMs)}–${shotTime(timed.endMs)}` : "计算中"}</span>
        </span>
        {/* 三级：内容。一行字幕，扫读时用来认这是哪一镜 */}
        <span className="mt-0.5 block truncate px-2.5 pb-2.5 text-xs text-white/45">{timed?.caption || "暂无覆盖句子"}</span>
      </button>
    </div>
  );
}

/**
 * 展开区：插在被点卡片的下一行、占满整行（col-span 由父级按列数给出）。
 * 卡片本身不移动，后面的卡片也不重排，所以滚动位置不会跳。
 */
function ShotDetail({ shot, timed, timeline, index, lineIndex, lineIds, estimated, store, error, job, serverStatus, uploading, generating, imageReady, canMerge, candidateCount, confirm, toast, onUpload, onGenerate, onCandidate, onSplit, onMerge, onCollapse, spanClass }: ShotCommon & { onCollapse: () => void; spanClass: string }) {
  const descriptionRef = useRef(shot.description);
  // Esc 收起；但下拉/货架菜单打开时先把 Esc 让给它们（它们也监听 document 上的 Escape）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector('[role="listbox"]')) return;
      onCollapse();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCollapse]);
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
  const wantsImage = needsGeneratedImage(shot);
  const compiled = wantsImage && store.doc ? compileShotPrompt(store.doc, shot) : null;
  const stale = !!store.doc && assetStale(store.doc, shot);
  const isTextShot = shot.mode === "motion" || shot.kind === "title" || shot.kind === "quote";
  const focus = shot.focusText ?? timed?.focusText ?? focusTextFromLegacy(shot, timed?.keywords, timed?.caption);
  const focusWidth = focusVisualWidth(focus?.text ?? "");
  const updateFocus = (patch: Partial<NonNullable<Shot["focusText"]>>) => shotUpdate(store, shot.id, (s) => ({
    ...s, kind: "placeholder", mode: "motion", card: undefined, onScreenText: undefined,
    animation: s.animation ? { ...s.animation, templateId: undefined } : undefined,
    focusText: { text: focus?.text ?? "重点", layoutMode: focus?.layoutMode ?? "auto", support: focus?.support, emphasis: focus?.emphasis, presetId: focus?.presetId, ...patch },
  }));
  const { status, running, label, error: effectiveError, message } = shotState({ shot, job, serverStatus });
  return (
    <div className={`animate-accordion-in border-t border-white/10 bg-white/[0.04] p-4 ${spanClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-white/70">
          镜头 {index + 1} · {timed ? `${shotTime(timed.startMs)}–${shotTime(timed.endMs)}` : "计算中"} · {covered.length ? `第 ${covered[0]}${covered.length > 1 ? `–${covered.at(-1)}` : ""} 句` : `第 ${lineIndex + 1} 句`}{estimated ? " · 估算" : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button className={`chip h-7 px-2.5 ${shot.locked ? "chip-on" : ""}`} onClick={() => shotUpdate(store, shot.id, (s) => ({ ...s, locked: !s.locked }))}>{shot.locked ? "已锁定" : "锁定"}</button>
          <button className="chip h-7 px-2.5" onClick={onSplit}>拆分</button>
          <button className="chip h-7 px-2.5" disabled={!canMerge} onClick={onMerge}>合并下一镜</button>
          <button className="chip h-7 px-2.5" title="收起这个镜头的编辑区" onClick={onCollapse}><Icon name="chevron" className="size-3.5 rotate-180" />收起</button>
        </div>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* 左：大图与候选。候选比较要的是尺寸，这正是卡片放不下的部分 */}
        <div className="min-w-0 space-y-3">
          <div className="relative w-full overflow-hidden rounded-control border border-white/10 bg-stage" style={{ aspectRatio: timeline ? `${timeline.width} / ${timeline.height}` : "16 / 9" }}>
            <span className="absolute inset-0 block"><ShotMedia shot={shot} timed={timed} timeline={timeline} status={status} sizes="720px" /></span>
            {(running || generating) && <span className="pointer-events-none absolute inset-0 bg-black/25" />}
            {(running || generating) && <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-accent/35 bg-black/65 px-2 py-1 text-3xs text-accent backdrop-blur"><span className="generation-live-dot size-1.5 rounded-full bg-accent" />{generating ? "正在提交…" : label}</span>}
            {status === "failed" && <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded bg-red-950/80 px-2 py-1 text-3xs text-red-100 backdrop-blur">生成失败 · 可重试</span>}
          </div>
          {(status === "queued" || status === "running") && (
            <p className="flex items-center gap-1.5 text-xs text-accent"><span className="generation-live-dot size-1.5 rounded-full bg-accent" />{label}{message ? ` · ${message}` : ""}{status === "queued" ? "（等待空闲并发）" : ""}</p>
          )}
          {status === "failed" && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs"><p className="text-red-300">{effectiveError || "生成失败"}</p>{job && <button className="chip h-6 px-2.5 text-2xs" title={`重新提交这个镜头的生成请求（${candidateCount} 张）`} onClick={() => void retryJobWithCost()}>重试 · {candidateCount} 张</button>}</div>}
          {status === "canceled" && <p className="text-xs text-white/45">任务已取消，可重新生成</p>}
          {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
          {stale && <p className="text-xs text-amber-200/80">画面描述、风格或场景已改，图片已过期</p>}
          {wantsImage && !shot.assetId && !generating && <p className="text-xs text-amber-200/70">暂无素材，使用占位画面</p>}
          {shot.intent && <p className="text-xs leading-5 text-white/70"><span className="text-white/40">意图 · </span>{shot.intent}</p>}
          {shot.characterIds.length > 0 && store.doc && <p className="flex flex-wrap gap-1">{shot.characterIds.map((cid) => store.doc!.characters.find((c) => c.id === cid)).filter(Boolean).map((c) => <span key={c!.id} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-3xs text-white/60">{c!.name}</span>)}</p>}
          {(shot.kind === "image" || shot.kind === "video") && shot.candidates.length > 0 && (
            <div aria-label="候选素材历史">
              <div className="mb-1.5 flex items-center justify-between text-2xs text-white/40">
                <span>候选历史</span>
                <span>{shot.candidates.length} / 8 · {shot.candidates.find((candidate) => candidate.selected) ? "已选择" : "待选择"}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{shot.candidates.map((candidate, candidateIndex) => {
                const candidateLabel = `${candidate.selected ? "当前使用" : "使用"}第 ${candidateIndex + 1} 个候选素材`;
                return <button
                  key={candidate.id}
                  className={`group relative aspect-video overflow-hidden rounded-control border-2 transition-all duration-200 active:scale-[0.98] ${candidate.selected ? "border-accent shadow-[0_0_12px_rgba(125,211,252,0.3)] ring-1 ring-accent/20" : "border-white/10 hover:border-white/30 hover:shadow-[0_0_8px_rgba(255,255,255,0.1)]"}`}
                  title={candidateLabel}
                  aria-label={candidateLabel}
                  aria-pressed={candidate.selected}
                  onClick={() => onCandidate(candidate.id)}
                >
                  {(candidate.kind ?? shot.kind) === "video" ? <video muted playsInline preload="metadata" src={mediaUrl(candidate.assetId)} className="h-full w-full object-cover" /> : <Image src={mediaUrl(candidate.assetId)} alt="" fill sizes="200px" unoptimized className="object-cover" />}
                  {candidate.selected && <span className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-accent px-1.5 py-0.5 text-3xs font-medium text-ink shadow-lg"><Icon name="check" className="size-2.5" />当前</span>}
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1 py-1 text-left text-3xs text-white">候选 {candidateIndex + 1}</span>
                </button>;
              })}</div>
              {shot.candidates.length >= 6 && <p className="mt-1.5 text-3xs text-white/35">提示：候选已接近上限（8个），重新生成时会自动移除最旧的候选</p>}
            </div>
          )}
        </div>
        {/* 右：按操作频次分组的控件。主操作在最上，低频设置收进「高级」 */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {wantsImage && <button className="btn btn-primary btn-sm" disabled={generating || shot.locked || !imageReady || running} title={`${shot.assetId ? "重新生成" : "生成"} ${candidateCount} 张候选图`} onClick={onGenerate}>{generating ? <Spinner className="size-3" /> : <Icon name="sparkle" className="size-3.5" />}{shot.assetId ? "重新生成图片" : "生成图片"} · {candidateCount} 张</button>}
            <label className="chip h-7 cursor-pointer px-2.5">{uploading ? <Spinner className="size-3" /> : "上传图片"}<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} /></label>
          </div>
          <p className="text-2xs text-white/40">{shotExpression(shot, timed)}</p>
          {!isTextShot && <AutoTextarea value={shot.description} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, description: e.target.value }))} onBlur={() => { if (descriptionRef.current !== shot.description) { descriptionRef.current = shot.description; toast("已修改画面描述，现有成片需要重新渲染", "info"); } }} className="input min-h-16 text-xs" placeholder="画面描述" />}
          {wantsImage && store.doc && <div className="space-y-1">
            <p className="text-2xs text-white/50">场景</p>
            <Select value={shot.sceneId ?? ""} onChange={(sceneId) => shotUpdate(store, shot.id, (s) => ({ ...s, sceneId: sceneId || undefined }))} aria-label="镜头场景">
              <option value="">不关联场景</option>
              {store.doc.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name || "未命名场景"}</option>)}
            </Select>
            {!store.doc.scenes.length && <p className="text-2xs text-white/40">先在「场景」面板创建场景卡。</p>}
          </div>}
          {isTextShot && <div className="space-y-2">
            <div className="flex items-center justify-between text-2xs text-white/50"><span>重点文字</span><span className={focusWidth > 8 ? "text-amber-200" : ""}>{focusWidth.toFixed(1)} / 8 字宽</span></div>
            <input className="input h-9 w-full text-sm" value={focus?.text ?? ""} onChange={(e) => updateFocus({ text: e.target.value })} placeholder="核心关键词或短句" aria-label="核心文字" />
            {focusWidth > 8 && <p className="text-2xs text-amber-200">请概括为 8 字以内；预览会按空间收缩字号。</p>}
            <div className="grid grid-cols-2 gap-2"><input className="input h-8 min-w-0 text-xs" value={focus?.support ?? ""} onChange={(e) => updateFocus({ support: e.target.value || undefined })} placeholder="辅助小字（可选）" aria-label="辅助文字" /><input className="input h-8 min-w-0 text-xs" value={focus?.emphasis ?? ""} onChange={(e) => updateFocus({ emphasis: e.target.value || undefined })} placeholder="强调片段（可选）" aria-label="强调片段" /></div>
            {focusVisualWidth(focus?.support ?? "") > 8 && <p className="text-2xs text-amber-200">辅助字也请压缩到 8 字以内，原文会完整保留。</p>}
            <div className="grid grid-cols-2 gap-2"><Select value={focus?.layoutMode ?? "auto"} onChange={(v) => updateFocus({ layoutMode: v as NonNullable<Shot["focusText"]>["layoutMode"], presetId: v === "manual" ? (focus?.presetId ?? timed?.focusText?.presetId ?? "focus") : undefined })} aria-label="排版模式"><option value="auto">智能匹配</option><option value="shuffle">探索变化</option><option value="manual">手动锁定</option></Select><MotionPresetPicker text={focus?.text ?? ""} value={focus?.layoutMode === "manual" ? focus.presetId ?? "focus" : timed?.focusText?.presetId ?? "focus"} onChange={(presetId) => updateFocus({ layoutMode: "manual", presetId })} /></div>
            {focus?.layoutMode === "shuffle" && <button className="chip h-7 px-2.5 text-xs" type="button" onClick={() => shotUpdate(store, shot.id, (s) => ({ ...s, seed: (s.seed ?? timed?.seed ?? 0) + 1 }))}>换一个排版</button>}
          </div>}
          <div className={`grid gap-2 ${isTextShot ? "" : "grid-cols-2"}`}>
            {!isTextShot && <ShelfPicker label="运镜" value={shot.motion} locked={!!shot.motionLocked} options={cameraCatalog} onAuto={() => shotUpdate(store, shot.id, (s) => ({ ...s, motionLocked: undefined }))} onChange={(motion) => shotUpdate(store, shot.id, (s) => ({ ...s, motion: motion as Motion, motionLocked: true }))} />}
            <ShelfPicker label="转场" value={timed?.transitionIn ?? shot.transitionIn ?? "cut"} locked={!!shot.transitionLocked} options={transitionCatalog} onAuto={() => shotUpdate(store, shot.id, (s) => ({ ...s, transitionIn: undefined, transitionLocked: undefined }))} onChange={(transitionIn) => shotUpdate(store, shot.id, (s) => ({ ...s, transitionIn: transitionIn as TransitionIn, transitionLocked: true }))} />
          </div>
          <details className="border-t border-white/10 pt-2 text-xs text-white/50">
            <summary className="cursor-pointer">高级</summary>
            <div className="mt-2 grid gap-2">
              <p className="text-2xs leading-4 text-white/45">修改会自动保存并刷新预览。已有成片需要重新渲染。</p>
              <Select value={isTextShot ? "placeholder" : shot.kind} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, kind: v as Shot["kind"], focusText: v === "placeholder" ? s.focusText : undefined }))} aria-label="镜头类型">
                {(["placeholder", "upload", "image", "video", "stock", "chart"] as Shot["kind"][]).map((kind) => <option key={kind} value={kind}>{shotKindLabels[kind]}</option>)}
              </Select>
              <Select value={shot.mode === "motion" ? "motion" : shot.mode === "composite" ? "composite" : shot.mode === "real" ? "real" : "generate"} onChange={(v) => shotUpdate(store, shot.id, (s) => ({
                ...s, kind: "placeholder", mode: v as Shot["mode"], shotSize: v === "generate" ? (s.shotSize ?? "medium") : s.shotSize,
                focusText: v === "motion" ? (focus ?? { text: timed?.keywords[0] ?? "重点", layoutMode: "auto" }) : undefined,
                card: v === "motion" ? undefined : s.card, onScreenText: v === "motion" ? undefined : s.onScreenText,
              }))} aria-label="表达方式"><option value="generate">生成画面</option><option value="motion">重点文字</option><option value="composite">画面 + 动画层</option><option value="real">真实素材</option></Select>
              {!isTextShot && <Select value={shot.shotSize ?? "medium"} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, shotSize: v as Shot["shotSize"] }))} aria-label="景别">{shotSizes.map((size) => <option key={size} value={size}>{shotSizeLabels[size]}</option>)}</Select>}
              {wantsImage && <><AutoTextarea value={shot.prompt ?? ""} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, prompt: e.target.value || undefined }))} className="input min-h-12 text-xs" placeholder="自定义画面内容" /><input className="input h-8 py-1.5 text-xs" type="number" min={0} value={shot.seed ?? ""} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, seed: e.target.value === "" ? undefined : Number(e.target.value) }))} placeholder="seed" />{store.doc && store.doc.characters.some((c) => !c.absent) && <div className="space-y-1"><p className="text-2xs text-white/40">画面里的角色（最多 {MAX_SHOT_CHARACTERS} 个）</p><div className="flex flex-wrap gap-1.5">{store.doc.characters.filter((c) => !c.absent || shot.characterIds.includes(c.id)).map((c) => { const on = shot.characterIds.includes(c.id); return <button key={c.id} type="button" className={`chip h-7 px-2.5 ${on ? "chip-on" : ""}`} disabled={!on && shot.characterIds.length >= MAX_SHOT_CHARACTERS} onClick={() => shotUpdate(store, shot.id, (s) => ({ ...s, characterIds: on ? s.characterIds.filter((x) => x !== c.id) : [...s.characterIds, c.id] }))}>{c.name}</button>; })}</div></div>}{compiled && <PromptSlots compiled={compiled} />}</>}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

/** 表格形态的一行：一屏能扫完更多镜头，展开能力与卡片形态共用同一套状态 */
function ShotRow({ shot, timed, timeline, index, active, expanded, onToggle, job, serverStatus }: ShotCommon & { expanded: boolean; onToggle: () => void }) {
  const { status, label } = shotState({ shot, job, serverStatus });
  return (
    <div id={`shot-card-${shot.id}`} className={`transition-colors ${active || expanded ? "bg-white/[0.05]" : "hover:bg-white/[0.025]"}`}>
      <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left" aria-expanded={expanded} aria-label={`镜头 ${index + 1}，${label}，${expanded ? "收起" : "展开"}编辑`} onClick={onToggle}>
        <span className="w-10 shrink-0 text-xs font-medium tabular-nums text-white/70">{index + 1}</span>
        <span className="relative h-10 w-[71px] shrink-0 overflow-hidden rounded border border-white/10 bg-stage">
          <span className="absolute inset-0 block"><ShotMedia shot={shot} timed={timed} timeline={timeline} status={status} sizes="80px" /></span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-white/70">{timed?.caption || "暂无覆盖句子"}</span>
          <span className="mt-0.5 block truncate text-2xs text-white/40">{shot.description || shotExpression(shot, timed)}</span>
        </span>
        {shot.locked && <Icon name="lock" className="size-3 shrink-0 text-accent/70" />}
        <span className={`shrink-0 text-2xs ${status === "failed" ? "text-red-300" : status === "running" || status === "queued" ? "text-accent" : "text-white/40"}`}>{status === "idle" ? "" : label}</span>
        <span className="w-20 shrink-0 text-right text-2xs tabular-nums text-white/40">{timed ? `${shotTime(timed.startMs)}–${shotTime(timed.endMs)}` : "计算中"}</span>
        <Icon name="chevron" className={`size-3.5 shrink-0 text-white/35 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
    </div>
  );
}


/** 镜头卡上的表达方式。 */
function shotExpression(shot: Shot, timed: TimelineShot | undefined) {
  if (shot.mode === "motion" || shot.kind === "title" || shot.kind === "quote") {
    const focus = timed?.focusText ?? shot.focusText;
    return `重点文字 · ${focus?.text ?? "待填写"} · ${focus?.presetId ? focusPresetLabels[focus.presetId] : "智能匹配"}`;
  }
  if (shot.mode === "composite") return `复合画面 · 两层视差${shot.shotSize ? ` · ${shotSizeLabels[shot.shotSize]}` : ""}`;
  const move = cameraById(shot.motion)?.name;
  return `生成画面${move ? ` · ${move}` : ""}${shot.shotSize ? ` · ${shotSizeLabels[shot.shotSize]}` : ""}`;
}

/** 编译后发给生图模型的提示词，按槽位展示 */
function PromptSlots({ compiled }: { compiled: CompiledPrompt }) {
  const rows: [string, string][] = [["内容", compiled.slots.content], ["人物", compiled.slots.characters], ["场景", compiled.slots.scene], ["镜头", compiled.slots.camera], ["风格", compiled.slots.style], ["情绪", compiled.slots.mood], ["负面", compiled.negative.join("、")]];
  return <div className="space-y-1 rounded-md border border-white/10 bg-black/20 p-2 text-[11px] leading-5">
    <p className="text-white/40">发给生图模型的提示词</p>
    {rows.filter(([, text]) => text).map(([label, text]) => <p key={label}><span className="text-white/35">{label} · </span><span className="text-white/70">{text}</span></p>)}
    {compiled.removed.length > 0 && <p className="text-amber-200/70">已从画面描述中去掉画风词：{compiled.removed.join("、")}（画风由画面风格统一决定）</p>}
    {compiled.moodConflict && <p className="text-amber-200/70">画面风格不承载「{compiled.moodConflict}」情绪，保持风格基调</p>}
  </div>;
}
