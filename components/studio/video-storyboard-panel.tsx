"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AutoTextarea, Icon, Select, Spinner } from "@/components/ui";
import { jobAction } from "@/lib/client";
import { useFeedback } from "@/components/feedback";
import { mediaUrl, type Job, type Shot, type VideoPlan } from "@/lib/core/types";
import type { Timeline } from "@/lib/core/timeline";
import { isStock, sourceImageConfirmed, sourceImageStale, videoShotTiming } from "@/lib/core/video";
import { snapshotFor } from "@/lib/core/stock";
import { outputSpecsFor, previewSpecFor } from "@/lib/core/output-spec";
import { videoDescriptionHash, videoPlanNeedsSync } from "@/lib/core/video-plan";
import { groupReferenceStatuses, shotReferenceStatus } from "@/lib/core/reference-status";
import type { ProjectStore } from "./shared";
import { columnCount, shotRows, shotTime } from "./shot-view";
import { stopShotPreview, VideoShotPreview } from "./video-shot-preview";
import { VideoShotCard, type ShotCardStatus } from "./video-shot-card";
import { GenerationError, ReferenceFeedback } from "./reference-feedback";
import styles from "./video-storyboard.module.css";

type VideoState = "ready-to-generate" | "waiting-plan" | "waiting-tts" | "waiting-reference" | "waiting-confirmation" | "queued" | "submitting" | "submission-unknown" | "polling" | "downloading" | "ready" | "stale" | "failed" | "canceled";
type VideoStatus = { state?: VideoState; status?: string; progress?: number; message?: string; error?: string | null; snapshotHash?: string; attemptId?: string; providerTaskId?: string; sourceImageAssetId?: string; costStatus?: "unknown" | "estimated" | "verified"; targetDurationMs?: number; requestDurationSeconds?: number };
const labels: Record<VideoState, string> = { "ready-to-generate": "参考已确认 · 可以生成视频", "waiting-plan": "镜头要求待同步", "waiting-tts": "等待真实配音", "waiting-reference": "等待参考图", "waiting-confirmation": "待确认画面", queued: "视频等待生成", submitting: "正在提交视频", "submission-unknown": "提交结果未决 · 展开核实", polling: "视频生成中", downloading: "正在保存视频", ready: "视频已就绪", stale: "视频需要更新", failed: "生成失败 · 展开处理", canceled: "本地等待已停止" };
/**
 * 素材管线复用同一套 `VideoState` 词表，但每个词的含义不同：
 * 没有参考图要确认，也没有「提交给服务商」这一步，只有检索与下载。
 */
const stockLabels: Record<VideoState, string> = { ...labels, "ready-to-generate": "待检索素材", "waiting-plan": "等待素材检索词", "waiting-confirmation": "待检索素材", queued: "素材等待检索", submitting: "正在检索素材", polling: "正在检索素材", downloading: "正在检索素材", ready: "素材已就绪", stale: "素材需要更新", failed: "检索失败 · 展开处理", canceled: "检索已停止" };
const activeStates = new Set<VideoState>(["queued", "submitting", "polling", "downloading"]);
const planFields: [keyof VideoPlan, string][] = [["startState", "起始画面（英文）"], ["action", "人物与环境动作（英文）"], ["camera", "镜头运动（英文）"], ["endState", "结束画面（英文）"]];

export function VideoStoryboardPanel({ id, store, timeline, jobs, onSeek, wide, onToggleWide, onContinue, onSettings, onStandards, productionConfirmed = false }: { id: string; store: ProjectStore; timeline: Timeline | null; jobs: Map<string, Job>; onSeek: (ms: number) => void; wide?: boolean; onToggleWide?: () => void; onContinue?: () => Promise<void>; onSettings?: () => void; onStandards?: () => void; productionConfirmed?: boolean }) {
  const { confirm, toast } = useFeedback();
  const [selectedSpecId, setSelectedSpecId] = useState("");
  const [loadedSpecId, setLoadedSpecId] = useState("");
  const [receivedStatuses, setStatuses] = useState<Record<string, VideoStatus>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [closingDetail, setClosingDetail] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [referenceView, setReferenceView] = useState(false);
  const [columns, setColumns] = useState(1);
  const playback = useRef<HTMLVideoElement | null>(null);
  const gridObserver = useRef<ResizeObserver | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const gridRef = useCallback((node: HTMLDivElement | null) => {
    gridObserver.current?.disconnect();
    gridObserver.current = null;
    if (!node) return;
    const measure = () => setColumns(columnCount(node.clientWidth, !!wide));
    measure();
    gridObserver.current = new ResizeObserver(measure);
    gridObserver.current.observe(node);
  }, [wide]);
  const closeDetail = useCallback(() => {
    stopShotPreview(playback);
    setClosingDetail(expanded);
    setExpanded(null);
    setHovered(null);
    if (expanded) document.getElementById(`shot-card-${expanded}`)?.querySelector<HTMLButtonElement>("[data-shot-toggle]")?.focus({ preventScroll: true });
  }, [expanded]);
  useEffect(() => {
    if (!closingDetail) return;
    const timer = window.setTimeout(() => setClosingDetail(null), 240);
    return () => window.clearTimeout(timer);
  }, [closingDetail]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="listbox"], [role="dialog"]')) closeDetail();
    };
    const visibility = () => {
      if (panelRef.current) panelRef.current.dataset.pageActive = String(!document.hidden);
      if (document.hidden) stopShotPreview(playback);
    };
    visibility();
    document.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("visibilitychange", visibility); stopShotPreview(playback); };
  }, [closeDetail]);
  const doc = store.doc;
  const stock = isStock(doc?.settings.visualPipeline);
  const specs = doc ? outputSpecsFor(doc.settings) : [];
  const sourceFrame = specs[0];
  const perOutput = doc?.settings.assetFraming === "per-output";
  const outputFrame = perOutput ? specs.find((spec) => spec.id === selectedSpecId) ?? (doc ? previewSpecFor(doc.settings) : undefined) : sourceFrame;
  const outputSpecId = outputFrame?.id ?? "";
  const statuses = loadedSpecId === outputSpecId ? receivedStatuses : {};
  const docSignature = JSON.stringify(doc && [doc.settings.video, doc.settings.assetFraming, doc.settings.outputSpecIds, doc.settings.aspects, doc.shots, doc.lines, doc.characters, doc.scenes, doc.visualStyle]);
  const jobSignature = [...jobs.values()].filter((j) => ["shot-generate", "shot-reference", "character-sheet", "scene-reference", "storyboard", "tts", "tts-block"].includes(j.stage)).map((j) => `${j.id}:${j.status}:${j.progress}`).join("|");
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/status?outputSpecId=${encodeURIComponent(outputSpecId)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("镜头状态暂不可用");
        const data = await response.json() as Record<string, VideoStatus>;
        if (alive) { setLoadedSpecId(outputSpecId); setStatuses(data); setErrors((old) => ({ ...old, status: "" })); }
      } catch (cause) { if (alive) setErrors((old) => ({ ...old, status: cause instanceof Error ? cause.message : String(cause) })); }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 4000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [id, outputSpecId, docSignature, jobSignature, revision]);
  if (!doc || !sourceFrame || !outputFrame) return null;
  const ordered = [...doc.shots].sort((a, b) => doc.lines.findIndex((l) => l.id === a.at.lineId) - doc.lines.findIndex((l) => l.id === b.at.lineId) || a.at.char - b.at.char);
  const groups = new Map<string, Shot[]>();
  for (const shot of ordered) { const key = shot.groupId || shot.id; groups.set(key, [...(groups.get(key) ?? []), shot]); }
  const pendingReview = ordered.filter((shot) => shot.kind === "video" && !shot.locked && !excluded.includes(shot.id) && !sourceImageConfirmed(doc, shot, sourceFrame));
  const jobList = [...jobs.values()];
  const referenceStatuses = new Map(ordered.map((shot) => [shot.id, shotReferenceStatus(doc, shot, sourceFrame, jobList)]));
  const referenceGroups = groupReferenceStatuses(ordered.filter((shot) => shot.kind === "video").map((shot) => ({ shot, status: referenceStatuses.get(shot.id)! })));
  const reviewShots = pendingReview.filter((shot) => !referenceBlocker(shot));
  const blockedReview = pendingReview.filter((shot) => !!referenceBlocker(shot));
  const marked = ordered.filter((shot) => excluded.includes(shot.id) && canGenerateReference(shot));
  function canGenerateReference(shot: Shot) {
    return !shot.locked && !["plan", "standard", "queued", "running"].includes(referenceStatuses.get(shot.id)!.kind);
  }
  function referenceBlocker(shot: Shot) {
    const reference = referenceStatuses.get(shot.id)!;
    if (!reference.usable) return reference.label;
    if (!statuses[shot.id]?.snapshotHash) return "正在读取参考图状态";
  }
  function generationBlocker(shot: Shot, operation: "generate" | "resume" | "regenerate") {
    if (!doc || !sourceFrame) return "正在读取项目，请稍后重试。";
    if (shot.locked) return "请先解锁这个镜头。";
    if (shot.kind !== "video" || !shot.videoPlan) return "这个镜头仍是图片分镜，请先重新导演生成视频分镜。";
    if (videoPlanNeedsSync(shot)) return "正在将中文镜头要求同步到执行计划，完成后继续制作。";
    if (referenceStatuses.get(shot.id)?.kind === "standard") return "请先在角色和场景中补齐并采用有效标准图。";
    if (!timeline) return "等待真实配音完成后才能生成视频。";
    const timing = videoShotTiming(doc, shot, timeline);
    if (!timing.ready) return timing.reason === "duration-out-of-range" ? "镜头时长超过 15 秒或无效，请先重新导演。" : "等待这个镜头的真实配音完成后才能生成视频。";
    if (!statuses[shot.id]?.state) return "正在读取镜头状态，请稍后重试。";
    if (!shot.sourceImageAssetId) return "请先生成镜头参考图。";
    if (sourceImageStale(doc, shot, sourceFrame)) return "参考图已过期，请先重新生成镜头参考图。";
    if (statuses[shot.id]?.state === "waiting-reference") return "等待关联角色、场景标准图或镜头参考图完成。";
    if ([...jobs.values()].some((job) => job.stage === "shot-reference" && matchesActiveJob(job, shot))) return "参考图正在重做，请等待完成。";
    if (excluded.includes(shot.id)) return "此镜头已标记重做，请先重做参考图，或取消重做标记。";
    if (!doc.settings.video.autoContinue && !sourceImageConfirmed(doc, shot, sourceFrame) && !statuses[shot.id]?.snapshotHash) return "正在读取参考图状态，请稍后重试。";
    if (operation === "generate" && statuses[shot.id]?.attemptId && ["failed", "canceled", "submission-unknown"].includes(statuses[shot.id]?.state ?? "")) return "请点击「恢复原任务」；需要新尝试时选择「付费重新生成」。";
  }
  function update(shotId: string, patch: Partial<Shot>) { store.setDoc((current) => ({ ...current, shots: current.shots.map((s) => s.id === shotId ? { ...s, ...patch } : s) })); }
  async function request(key: string, path: string, body: unknown, method = "POST") {
    setBusy((old) => ({ ...old, [key]: true })); setErrors((old) => ({ ...old, [key]: "" }));
    try {
      if ((await store.flush()) == null) throw new Error("设置保存失败，请重试");
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { error?: string; count?: number; skipped?: number; job?: Job; reused?: boolean; continuing?: boolean };
      if (!response.ok) throw new Error(data.error || "镜头操作失败");
      if (method === "POST" && path.endsWith("/generate") && data.job) toast(data.reused ? "已找到原视频任务，正在更新状态。" : "视频生成任务已排队。", "success");
      await store.reload(); setRevision((r) => r + 1);
      return data;
    } catch (cause) { setErrors((old) => ({ ...old, [key]: cause instanceof Error ? cause.message : String(cause) })); return false; }
    finally { setBusy((old) => ({ ...old, [key]: false })); }
  }
  async function generate(shot: Shot, operation: "generate" | "resume" | "regenerate") {
    const blocker = generationBlocker(shot, operation);
    if (blocker) { toast(blocker); return; }
    const state = statuses[shot.id];
    const confirmReference = !doc!.settings.video.autoContinue && !sourceImageConfirmed(doc!, shot, sourceFrame!);
    if (operation === "resume" && !state?.attemptId) return;
    if ((operation !== "resume" || confirmReference) && !(await confirm({ title: confirmReference ? "确认此图并生成这个镜头？" : operation === "regenerate" ? "重新生成这个视频？" : "生成这个视频？", message: `${confirmReference ? "将确认当前镜头参考图，仅提交这个镜头的视频请求。" : "将提交一个独立视频生成请求。"}费用暂未知，以服务商账单为准；已接单请求不能通过停止本地等待撤销。`, confirmLabel: operation === "resume" ? "确认并恢复原任务" : operation === "regenerate" ? "付费重新生成" : confirmReference ? "确认并生成" : "提交生成", tone: "danger" }))) return;
    await request(shot.id, `${encodeURIComponent(shot.id)}/generate`, { kind: "video", operation, modelId: doc!.settings.video.modelId, candidateCount: 1, outputSpecId: outputFrame!.id, ...(confirmReference ? { confirmHash: state!.snapshotHash } : {}), ...(operation === "resume" ? { resumeAttemptId: state!.attemptId } : {}) });
  }
  async function approveBatch() {
    if (!reviewShots.length || !(await confirm({ title: `确认已就绪的 ${reviewShots.length} 张参考图并继续？`, message: `将确认未标记重做且已就绪的参考图，继续视频生成与后续制作。${blockedReview.length ? `另有 ${blockedReview.length} 镜暂不能确认，保留待处理。` : ""}参考图与视频费用以服务商账单为准。`, confirmLabel: "确认并继续", tone: "danger" }))) return;
    const ok = await request("review", "reference", { references: reviewShots.map((shot) => ({ shotId: shot.id, confirmHash: statuses[shot.id]?.snapshotHash })) }, "PATCH");
    if (ok && !ok.continuing) await onContinue?.();
  }
  async function redoMarked() {
    if (await request("review", "reference", { shotIds: marked.map((shot) => shot.id) })) setExcluded([]);
  }
  /**
   * 单镜重搜。服务端会带上「已试素材」游标，所以一定换一条新的；
   * 游标只走任务 input、不进快照哈希，因此重搜前后这一镜的指纹不变。
   */
  async function research(shot: Shot) {
    if (!(await confirm({ title: "重新搜索这个镜头的素材？", message: "会跳过这个镜头已经试过的素材，重新检索并采用一条新的。不产生服务商费用，但会占用 Pexels 免费额度（200 请求/小时）。", confirmLabel: "重新搜索" }))) return;
    const result = await request(shot.id, `${encodeURIComponent(shot.id)}/stock`, {});
    if (result) toast(result.reused ? "已有正在进行的检索，继续等待即可。" : "已开始重新搜索素材。", "success");
  }
  async function generateReferences(shots: Shot[], retry: boolean) {
    shots = shots.filter(canGenerateReference);
    if (!shots.length || busy.references) return;
    if (!(await confirm({ title: `${retry ? "重试" : "生成"}这 ${shots.length} 张参考图？`, message: "按当前项目图片模型提交所选镜头，保留其他已就绪结果。图片费用以服务商账单为准。", confirmLabel: retry ? "重试失败参考图" : "生成参考图", tone: "danger" }))) return;
    const result = await request("references", "reference", { shotIds: shots.map((shot) => shot.id), operation: retry ? "retry" : "generate" });
    if (result) toast(result.count ? `${result.count} 张参考图已排队。${result.skipped ? `已跳过 ${result.skipped} 镜（已就绪或前置标准图待补齐）。` : ""}` : "这些参考图已经就绪，无需重试。", "success");
  }
  function revealShot(shotId: string) {
    if (expanded !== shotId) toggleDetail(shotId);
    window.requestAnimationFrame(() => {
      document.getElementById(`video-detail-${shotId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      document.getElementById(`shot-card-${shotId}`)?.querySelector<HTMLButtonElement>("[data-shot-toggle]")?.focus({ preventScroll: true });
    });
  }
  function matchesActiveJob(job: Job, shot: Shot) {
    if (!["shot-generate", "shot-reference", "shot-stock", "storyboard"].includes(job.stage) || !["queued", "running"].includes(job.status) || typeof job.input !== "object" || job.input === null) return false;
    const input = job.input as { shotId?: string; outputSpecId?: string; frame?: { aspect?: string } };
    return input.shotId === shot.id && (job.stage !== "shot-generate" || (input.outputSpecId ? input.outputSpecId === outputSpecId : input.frame?.aspect ? input.frame.aspect === outputFrame?.aspect : outputFrame?.id === sourceFrame?.id));
  }
  async function stop(shot: Shot) {
    const active = [...jobs.values()].filter((job) => matchesActiveJob(job, shot));
    setBusy((old) => ({ ...old, [shot.id]: true }));
    try {
      for (const job of active) await jobAction(job.id, "cancel");
      setRevision((r) => r + 1);
    } catch (cause) { setErrors((old) => ({ ...old, [shot.id]: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setBusy((old) => ({ ...old, [shot.id]: false })); }
  }
  function view(shot: Shot) {
    const status = statuses[shot.id];
    const pendingPlan = videoPlanNeedsSync(shot);
    const state = pendingPlan ? "waiting-plan" : status?.state;
    const timed = timeline?.shots.find((item) => item.shotId === shot.id);
    const activeJob = [...jobs.values()].find((job) => matchesActiveJob(job, shot));
    const running = (!!state && activeStates.has(state)) || !!activeJob;
    const outputAssetId = shot.kind !== "video" ? undefined : perOutput ? shot.assetVariants[outputFrame!.aspect]?.assetId : shot.assetVariants[sourceFrame!.aspect]?.assetId ?? shot.assetId;
    const outputHash = shot.assetVariants[outputFrame!.aspect]?.promptHash ?? shot.assetPromptHash;
    // 指纹按管线分发：素材比的是检索输入，AI 视频比的是生成输入。
    const outputSnapshotHash = timeline ? snapshotFor(doc!, shot, timeline, outputFrame!).hash : undefined;
    const staleVideo = !!outputAssetId && (pendingPlan || (!!outputSnapshotHash && outputHash !== outputSnapshotHash));
    const refStale = stock ? false : sourceImageStale(doc!, shot, sourceFrame!);
    const reference = referenceStatuses.get(shot.id)!;
    const label = errors[shot.id] ? "操作失败 · 展开处理" : activeJob?.stage === "storyboard" ? activeJob.status === "queued" ? "镜头要求等待同步" : "正在同步镜头要求"
      : activeJob?.stage === "shot-stock" ? activeJob.status === "queued" ? "素材等待检索" : "正在检索素材"
      : activeJob?.stage === "shot-reference" ? activeJob.status === "queued" ? "参考图等待生成" : "参考图生成中" : pendingPlan ? labels["waiting-plan"]
        : stock ? (state === "ready" && running ? "正在检索素材" : state === "ready" && staleVideo ? "素材需要更新" : state ? stockLabels[state as VideoState] : "正在读取状态")
        : !reference.usable ? reference.label : state === "failed" ? "视频生成失败 · 展开处理" : state === "ready" && running ? "正在保存视频" : state === "ready" && staleVideo ? "视频需要更新" : state ? labels[state] : "正在读取状态";
    const needsReview = !stock && !doc!.settings.video.autoContinue && reference.usable && !shot.locked && !sourceImageConfirmed(doc!, shot, sourceFrame!);
    const activity: ShotCardStatus["activity"] = activeJob?.status === "queued" || (!activeJob && state === "queued") ? undefined
      : activeJob?.stage === "storyboard" ? "plan" : activeJob?.stage === "shot-reference" ? "image"
        : running ? "video" : undefined;
    return { status, state, timed, activeJob, running, outputAssetId, staleVideo, refStale, needsReview, label, activity };
  }
  function toggleDetail(shotId: string) {
    if (expanded === shotId) { closeDetail(); return; }
    stopShotPreview(playback);
    setHovered(null);
    setReferenceView(false);
    setClosingDetail(null);
    setExpanded(shotId);
  }
  function renderTile(shot: Shot) {
    const { timed, state, activeJob, outputAssetId, staleVideo, refStale, needsReview, label, activity } = view(shot);
    const index = ordered.indexOf(shot) + 1;
    const isOpen = expanded === shot.id;
    const failed = !!errors[shot.id] || referenceStatuses.get(shot.id)?.kind === "failed" || state === "failed";
    const warning = staleVideo || refStale || ["stale", "submission-unknown", "canceled", "waiting-plan"].includes(state ?? "");
    const mediaLabel = stock
      ? outputAssetId ? (staleVideo ? "上次素材" : "素材") : undefined
      : outputAssetId ? (staleVideo ? "上次视频" : "视频") : shot.sourceImageAssetId ? (refStale ? "上次参考图" : "参考图") : undefined;
    const ready = state === "ready" && !staleVideo && !!outputAssetId && !activeJob;
    const cardStatus: ShotCardStatus = { label, activity, ready, tone: failed ? "danger" : activity ? "working" : warning ? "warning" : ready ? "success" : "neutral" };
    return <VideoShotCard key={`${outputSpecId}:${shot.id}`} shot={shot} index={index} frame={outputFrame!} timeline={timeline} timed={timed} caption={timed?.caption || doc!.lines.find((line) => line.id === shot.at.lineId)?.text || "暂无覆盖句子"} assetId={outputAssetId} mediaLabel={mediaLabel} status={cardStatus} isOpen={isOpen} hovered={hovered === shot.id} ownerRef={playback}
      onToggle={() => toggleDetail(shot.id)} onHover={(value) => setHovered((current) => value ? shot.id : current === shot.id ? null : current)} redo={excluded.includes(shot.id)}
      onRedo={needsReview && !activeJob ? (value) => setExcluded((old) => value ? [...old.filter((entry) => entry !== shot.id), shot.id] : old.filter((entry) => entry !== shot.id)) : undefined} />;
  }
  function renderDetail(shot: Shot) {
    const { timed, status, state, activeJob, running, outputAssetId, label } = view(shot);
    const index = ordered.indexOf(shot) + 1;
    const disabled = !!busy[shot.id] || !!busy.references || running || shot.locked;
    const canResume = !!status?.attemptId && ["failed", "canceled", "submission-unknown"].includes(state ?? "");
    const operation = outputAssetId ? "regenerate" : "generate";
    const blocker = generationBlocker(shot, canResume ? "resume" : operation);
    const endpoint = encodeURIComponent(shot.id);
    const candidates = shot.candidates.filter((candidate) => !candidate.frame?.aspect || candidate.frame.aspect === outputFrame!.aspect);
    const isOpen = expanded === shot.id;
    return <div id={`video-detail-${shot.id}`} data-open={isOpen} className={`col-span-full ${styles.detail}`} role="region" aria-label={`镜头 ${index}编辑区`} inert={!isOpen} aria-hidden={!isOpen}><div className={styles.detailInner}><div className={`${styles.detailSurface} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-text-secondary">镜头 {index} · {timed ? `${shotTime(timed.startMs)}–${shotTime(timed.endMs)}` : "计算中"}</p><button type="button" className="chip" onClick={closeDetail}><Icon name="chevron" className="size-3 rotate-180" />收起</button></div>
      <div className="mt-4 grid items-start gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <div className="relative overflow-hidden rounded-control bg-stage" style={{ aspectRatio: `${outputFrame!.width} / ${outputFrame!.height}` }}>
            <VideoShotPreview key={`${outputSpecId}:${referenceView ? "reference" : outputAssetId ?? "image"}`} assetId={referenceView ? undefined : outputAssetId} referenceAssetId={shot.sourceImageAssetId} timed={timed} timeline={timeline} ownerRef={playback} label={`镜头 ${index}输出视频`} />
          </div>
          <div className="flex flex-wrap items-center gap-2">{outputAssetId && shot.sourceImageAssetId && <button type="button" className="chip" aria-pressed={referenceView} onClick={() => { stopShotPreview(playback); setReferenceView((current) => !current); }}>{referenceView ? "查看视频" : "查看参考图"}</button>}<button type="button" className="btn btn-text btn-sm" disabled={!timed} onClick={() => timed && onSeek(timed.startMs)}>定位到时间轴</button></div>
        </div>
        <div className="min-w-0 space-y-3">
          <p className="text-xs text-text-secondary">{label}</p>
          <label className="block space-y-1.5 text-xs"><span>镜头要求（中文）</span><AutoTextarea className="input min-h-24 text-xs" disabled={shot.locked || busy[shot.id] || (running && activeJob?.stage !== "storyboard")} value={shot.description} onChange={(event) => update(shot.id, { description: event.target.value, videoPlanDescriptionHash: shot.videoPlanDescriptionHash ?? videoDescriptionHash(shot.description), sourceImageConfirmedHash: undefined })} onBlur={() => void store.flush()} placeholder="描述希望看到的构图和动作" /></label>
          <p className="text-2xs text-text-muted">{videoPlanNeedsSync(shot) ? "镜头要求已修改，等待执行计划同步后更新画面。" : "修改后自动保存并同步执行计划。"}</p>
          {stock && <>
            <label className="block space-y-1.5 text-xs"><span>素材检索词（英文，2–4 个词）</span>
              <input className="input h-9 text-xs" disabled={shot.locked || busy[shot.id] || running} value={shot.stockQuery ?? ""} placeholder="例如：woman standing by window" onChange={(event) => update(shot.id, { stockQuery: event.target.value })} onBlur={() => { const normalized = (shot.stockQuery ?? "").trim().toLowerCase(); if (normalized !== shot.stockQuery) update(shot.id, { stockQuery: normalized }); void store.flush(); }} />
            </label>
            <p className="text-2xs text-text-muted">{shot.stockQuery ? "小写英文、必须含画面主体。改了词，这一镜的素材就会过期，点「重新搜索素材」立刻换一条。" : "缺少检索词，这一镜排不出检索任务；请补一个或重做分镜。"}</p>
          </>}
          <div className="flex flex-wrap gap-2">
            {stock ? <button type="button" className="chip" disabled={disabled || !shot.stockQuery} onClick={() => void research(shot)}>{busy[shot.id] && <Spinner className="size-3" />}重新搜索素材</button> : <>
              <button type="button" className="chip" disabled={disabled || !canGenerateReference(shot)} onClick={() => void generateReferences([shot], referenceStatuses.get(shot.id)?.kind === "failed")}>{referenceStatuses.get(shot.id)?.kind === "failed" ? "重试参考图" : shot.sourceImageAssetId ? "重做参考图" : "生成参考图"}</button>
              {referenceStatuses.get(shot.id)?.kind === "standard" && <button type="button" className="btn btn-text btn-sm" onClick={() => onStandards?.()}>查看角色和场景</button>}
              {canResume ? <><button type="button" className="chip" disabled={disabled || !!blocker} onClick={() => void generate(shot, "resume")}>恢复原任务</button><button type="button" className="chip" disabled={disabled || !!blocker} onClick={() => void generate(shot, "regenerate")}>付费重新生成</button></> : <button type="button" className="chip" disabled={disabled || !!blocker} onClick={() => void generate(shot, operation)}>{busy[shot.id] && <Spinner className="size-3" />}{!doc!.settings.video.autoContinue && !sourceImageConfirmed(doc!, shot, sourceFrame!) ? "确认此图并生成视频" : outputAssetId ? "重新生成视频" : "生成视频"}</button>}
            </>}
            {running && <button type="button" className="chip" disabled={busy[shot.id]} onClick={() => void stop(shot)}>停止本地等待</button>}
            <button type="button" className={`chip ${shot.locked ? "chip-on" : ""}`} disabled={busy[shot.id]} onClick={() => update(shot.id, { locked: !shot.locked })}>{shot.locked ? "已锁定 · 解锁" : "锁定镜头"}</button>
          </div>
          {!running && !stock && blocker && <p className="text-xs leading-5 text-warn">{blocker}</p>}
          {state === "submission-unknown" && <p className="text-xs leading-5 text-warn">提交可能已被服务商接收。恢复只核对原尝试，不会重新提交；重新生成可能再次收费。</p>}
          {state === "canceled" && <p className="text-xs text-text-muted">已停止本地等待，云端任务可能继续并计费。</p>}
          {(errors[shot.id] || referenceStatuses.get(shot.id)?.error || status?.error) && <GenerationError error={errors[shot.id] || referenceStatuses.get(shot.id)?.error || status!.error!} video={!errors[shot.id] && !referenceStatuses.get(shot.id)?.error} />}
        </div>
      </div>
      <details className="mt-4 border-t border-line pt-3 text-xs"><summary className="cursor-pointer text-text-muted">历史与执行详情{candidates.length ? ` · ${candidates.length} 个候选` : ""}</summary><div className="mt-3 space-y-4">
        {candidates.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{candidates.map((candidate) => <div key={candidate.id} className="min-w-0 space-y-1.5"><div className="relative aspect-video overflow-hidden rounded-control bg-stage">{(candidate.kind ?? shot.kind) === "video" ? <VideoShotPreview assetId={candidate.assetId} timeline={null} ownerRef={playback} label={`镜头 ${index}历史视频`} /> : <Image src={mediaUrl(candidate.assetId)} alt="图片候选" fill unoptimized sizes="200px" className="object-contain" />}</div><p className="text-2xs text-text-muted">{candidate.frame?.aspect ?? "画幅未知"}{perOutput && !candidate.frame?.aspect ? " · 无法用于独立画幅" : ""}</p><button type="button" className="chip" disabled={disabled || candidate.assetId === outputAssetId || (perOutput && !candidate.frame?.aspect)} onClick={() => void request(shot.id, `${endpoint}/generate`, { candidateId: candidate.id, aspect: outputFrame!.aspect }, "PATCH")}>{candidate.assetId === outputAssetId ? "已采用" : "采用候选"}</button></div>)}</div>}
        <p className="text-text-muted">场景：{doc!.scenes.find((scene) => scene.id === shot.sceneId)?.name ?? "自动安排"} · 角色：{doc!.characters.filter((card) => shot.characterIds.includes(card.id)).map((card) => card.name).join("、") || "无"}</p>
        {planFields.map(([field, name]) => <div key={field} className="space-y-1"><p className="text-text-muted">{name}</p><p className="whitespace-pre-wrap break-words">{shot.videoPlan?.[field] ?? "待生成"}</p></div>)}
        <label className="block space-y-1"><span>后期重点文字</span><AutoTextarea className="input min-h-12 text-xs" disabled={disabled} value={shot.focusText?.text ?? ""} onChange={(event) => update(shot.id, { focusText: event.target.value ? { ...shot.focusText, text: event.target.value, layoutMode: shot.focusText?.layoutMode ?? "auto" } : undefined })} /></label>
        <p className="text-text-muted">{status?.targetDurationMs != null && `目标 ${(status.targetDurationMs / 1000).toFixed(2)} 秒 · 请求 ${status.requestDurationSeconds ?? "—"} 秒 · `}{status?.costStatus === "estimated" ? "费用为估算" : status?.costStatus === "verified" ? "费用已核验，见用量记录" : "费用未知，以服务商账单为准"}</p>
        {status?.message && <p className="break-words text-text-muted">{status.message}</p>}
      </div></details>
    </div></div></div>;
  }
  return <section ref={panelRef} className={`panel space-y-4 p-5 ${styles.panel}`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="label">分镜 · {stock ? "视频素材" : "AI 视频"}</p><h2 className="mt-1 text-base font-medium">{groups.size} 组 · {ordered.length} 个镜头</h2></div>{onToggleWide && <button type="button" className="chip" aria-pressed={wide} onClick={onToggleWide}>{wide ? "退出全宽" : "全宽"}</button>}</div>
    <p className="text-xs text-text-muted">{stock
      ? "点击卡片编辑，悬停静音预览素材。每个镜头按自己的英文检索词找一条够长、能填满画幅的真实视频；不产生服务商费用，但受 Pexels 免费额度限制（200 请求/小时）。"
      : <>点击卡片编辑，悬停静音预览视频。{doc.settings.video.autoContinue ? "参考图完成后自动继续制作。" : "只标记不满意的参考图，其余一次确认。"}</>}</p>
    {!stock && !doc.settings.video.autoContinue && ordered.length > 0 && <div className="space-y-2 border-y border-line py-3">
      <div className="flex flex-wrap items-center gap-2"><button type="button" className="btn btn-primary btn-sm" disabled={busy.review || !reviewShots.length} onClick={() => void approveBatch()}>确认已就绪参考图并继续 · {reviewShots.length} 镜</button>{marked.length > 0 && <button type="button" className="chip" disabled={busy.review} onClick={() => void redoMarked()}>重做标记的参考图 · {marked.length} 镜</button>}</div>
      <p className="text-2xs text-text-muted">{reviewShots.length ? `${reviewShots.length} 镜可确认${blockedReview.length ? ` · ${blockedReview.length} 镜待完成` : ""}。${!productionConfirmed ? "点击后确认当前设置并继续制作。" : ""}` : pendingReview.length ? "当前没有可确认的参考图。" : marked.length ? "已标记的镜头需重做，或取消标记后确认。" : "当前没有待确认参考图；已确认镜头可单独生成或从顶部继续制作。"}</p>
      {errors.review && <p role="alert" className="text-xs text-danger">{errors.review}</p>}
    </div>}
    {!stock && <ReferenceFeedback groups={referenceGroups} ordered={ordered} busy={!!busy.references} onShot={revealShot} onSettings={() => onSettings?.()} onStandards={() => onStandards?.()} onGenerate={(shots, retry) => void generateReferences(shots, retry)} />}
    {errors.references && <GenerationError error={errors.references} />}
    {perOutput ? <div className="space-y-2"><label className="block space-y-1 text-xs"><span>独立输出画幅 · 各画幅分别生成和计费</span><Select aria-label="视频独立输出画幅" value={outputFrame.id} onChange={(value) => { closeDetail(); setSelectedSpecId(value); }}>{specs.map((spec) => <option key={spec.id} value={spec.id}>{spec.aspect} · {spec.width}×{spec.height}</option>)}</Select></label><details className="text-2xs text-text-muted"><summary className="cursor-pointer">查看生成范围与费用说明</summary><p className="mt-2">{ordered.filter((shot) => !shot.locked).length} 个未锁镜头 × {specs.length} 个画幅，首次最多 {ordered.filter((shot) => !shot.locked).length * specs.length} 次独立{stock ? "素材检索（方向不同，横竖素材不通用）" : "视频请求"}。本页仅操作当前 {outputFrame.aspect}{stock ? "" : `，参考图共用 ${sourceFrame.aspect}`}。</p></details></div> : <p className="text-2xs text-text-muted">共享 {sourceFrame.aspect} {stock ? "素材源，其他导出画幅复用" : "视频源，其他导出画幅复用"}。</p>}
    {errors.status && <p role="alert" className="text-xs text-warn">{errors.status}，正在重试。</p>}
    {!ordered.length && <p className="py-8 text-center text-sm text-text-muted">真实配音完成后生成视频分镜。</p>}
    <div ref={gridRef} className="space-y-5">{[...groups].map(([groupId, shots], groupIndex) => <section key={groupId} aria-label={`镜头组 ${groupIndex + 1}`}>
      <div className="mb-2 flex items-center gap-2 text-2xs text-text-muted"><span>镜头组 {groupIndex + 1}</span><span>· {shots.length} 镜</span><span className="ml-auto">{shots.filter((shot) => view(shot).state === "ready" && !view(shot).staleVideo).length}/{shots.length} 完成</span></div>
      <div className="grid items-stretch gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>{shotRows(shots, columns, expanded ?? closingDetail).map(({ row, expandedInRow }) => <Fragment key={row[0].id}>{row.map(renderTile)}{expandedInRow && renderDetail(expandedInRow)}</Fragment>)}</div>
    </section>)}</div>
  </section>;
}
