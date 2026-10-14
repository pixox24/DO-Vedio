"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AutoTextarea, Select, Spinner, Switch } from "@/components/ui";
import { jobAction } from "@/lib/client";
import { useFeedback } from "@/components/feedback";
import { mediaUrl, type Job, type Shot, type VideoPlan } from "@/lib/core/types";
import type { Timeline } from "@/lib/core/timeline";
import { sourceImageConfirmed, sourceImageStale, videoShotTiming } from "@/lib/core/video";
import { outputSpecsFor, previewSpecFor } from "@/lib/core/output-spec";
import { MAX_SHOT_CHARACTERS } from "@/lib/core/prompt-compiler";
import type { ProjectStore } from "./shared";

type VideoState = "ready-to-generate" | "waiting-tts" | "waiting-reference" | "waiting-confirmation" | "queued" | "submitting" | "submission-unknown" | "polling" | "downloading" | "ready" | "stale" | "failed" | "canceled";
type VideoStatus = { state?: VideoState; status?: string; progress?: number; message?: string; error?: string | null; snapshotHash?: string; attemptId?: string; providerTaskId?: string; sourceImageAssetId?: string; costStatus?: "unknown" | "estimated" | "verified"; targetDurationMs?: number; requestDurationSeconds?: number };
const labels: Record<VideoState, string> = { "ready-to-generate": "参考已确认 · 可以生成视频", "waiting-tts": "等待真实配音", "waiting-reference": "等待参考图", "waiting-confirmation": "待确认参考图", queued: "排队中", submitting: "提交中", "submission-unknown": "提交结果未决", polling: "云端生成中", downloading: "下载中", ready: "视频已就绪", stale: "视频已过期", failed: "生成失败", canceled: "本地等待已停止" };
const activeStates = new Set<VideoState>(["queued", "submitting", "polling", "downloading"]);
const planFields: [keyof VideoPlan, string][] = [["startState", "起始画面（英文）"], ["action", "人物与环境动作（英文）"], ["camera", "镜头运动（英文）"], ["endState", "结束画面（英文）"]];

export function VideoStoryboardPanel({ id, store, timeline, jobs, onSeek, wide, onToggleWide }: { id: string; store: ProjectStore; timeline: Timeline | null; jobs: Map<string, Job>; onSeek: (ms: number) => void; wide?: boolean; onToggleWide?: () => void }) {
  const { confirm, toast } = useFeedback();
  const [selectedSpecId, setSelectedSpecId] = useState("");
  const [loadedSpecId, setLoadedSpecId] = useState("");
  const [receivedStatuses, setStatuses] = useState<Record<string, VideoStatus>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const doc = store.doc;
  const specs = doc ? outputSpecsFor(doc.settings) : [];
  const sourceFrame = specs[0];
  const perOutput = doc?.settings.assetFraming === "per-output";
  const outputFrame = perOutput ? specs.find((spec) => spec.id === selectedSpecId) ?? (doc ? previewSpecFor(doc.settings) : undefined) : sourceFrame;
  const outputSpecId = outputFrame?.id ?? "";
  const statuses = loadedSpecId === outputSpecId ? receivedStatuses : {};
  const docSignature = JSON.stringify(doc && [doc.settings.video, doc.settings.assetFraming, doc.settings.outputSpecIds, doc.settings.aspects, doc.shots, doc.lines]);
  const jobSignature = [...jobs.values()].filter((j) => ["shot-generate", "shot-reference", "tts", "tts-block"].includes(j.stage)).map((j) => `${j.id}:${j.status}:${j.progress}`).join("|");
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
  const batchEligible = (shot: Shot) => ["ready-to-generate", "stale"].includes(statuses[shot.id]?.state ?? "") && !shot.locked && !!timeline && videoShotTiming(doc, shot, timeline).ready && !!shot.sourceImageAssetId && !sourceImageStale(doc, shot, sourceFrame) && (doc.settings.video.autoContinue || sourceImageConfirmed(doc, shot, sourceFrame)) && !["ready", "queued", "submitting", "polling", "downloading", "submission-unknown", "failed", "canceled"].includes(statuses[shot.id]?.state ?? "");
  const images = [...new Set([...doc.shots.flatMap((s) => [s.sourceImageAssetId, ...s.referenceAssetIds, ...s.candidates.filter((c) => c.kind === "image" || (!c.kind && s.kind !== "video")).map((c) => c.assetId), ...(s.kind !== "video" && s.assetId ? [s.assetId] : [])]), ...doc.scenes.flatMap((s) => s.referenceAssetIds), ...doc.characters.flatMap((c) => c.referenceAssetIds)].filter((hash): hash is string => !!hash))];
  function generationBlocker(shot: Shot, operation: "generate" | "resume" | "regenerate") {
    if (!doc || !sourceFrame) return "正在读取项目，请稍后重试。";
    if (shot.locked) return "请先解锁这个镜头。";
    if (shot.kind !== "video" || !shot.videoPlan) return "这个镜头仍是图片分镜，请先重新导演生成视频分镜。";
    if (!timeline) return "等待真实配音完成后才能生成视频。";
    const timing = videoShotTiming(doc, shot, timeline);
    if (!timing.ready) return timing.reason === "duration-out-of-range" ? "镜头时长超过 15 秒或无效，请先重新导演。" : "等待这个镜头的真实配音完成后才能生成视频。";
    if (!statuses[shot.id]?.state) return "正在读取镜头状态，请稍后重试。";
    if (!shot.sourceImageAssetId) return "请先生成、上传或选择镜头参考图。";
    if (sourceImageStale(doc, shot, sourceFrame)) return "参考图已过期，请先更新或重新选择参考图。";
    if (statuses[shot.id]?.state === "waiting-reference") return "等待关联角色、场景标准图或镜头参考图完成。";
    if (!doc.settings.video.autoContinue && !sourceImageConfirmed(doc, shot, sourceFrame)) return "请先点击「确认当前参考图」，再生成视频。";
    if (operation === "generate" && statuses[shot.id]?.attemptId && ["failed", "canceled", "submission-unknown"].includes(statuses[shot.id]?.state ?? "")) return "请点击「恢复原任务」；需要新尝试时选择「付费重新生成」。";
  }
  function update(shotId: string, patch: Partial<Shot>) { store.setDoc((current) => ({ ...current, shots: current.shots.map((s) => s.id === shotId ? { ...s, ...patch } : s) })); }
  async function request(key: string, path: string, body: unknown, method = "POST") {
    setBusy((old) => ({ ...old, [key]: true })); setErrors((old) => ({ ...old, [key]: "" }));
    try {
      if ((await store.flush()) == null) throw new Error("设置保存失败，请重试");
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { error?: string; count?: number; skipped?: number; job?: Job; reused?: boolean };
      if (!response.ok) throw new Error(data.error || "镜头操作失败");
      if (method === "POST" && path.endsWith("/generate") && data.job) toast(data.reused ? "已找到原视频任务，正在更新状态。" : "视频生成任务已排队。", "success");
      await store.reload(); setRevision((r) => r + 1);
    } catch (cause) { setErrors((old) => ({ ...old, [key]: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setBusy((old) => ({ ...old, [key]: false })); }
  }
  async function generate(shot: Shot, operation: "generate" | "resume" | "regenerate") {
    const blocker = generationBlocker(shot, operation);
    if (blocker) { toast(blocker); return; }
    const state = statuses[shot.id];
    if (operation === "resume" && !state?.attemptId) return;
    if (operation !== "resume" && !(await confirm({ title: operation === "regenerate" ? "重新生成这个视频？" : "生成这个视频？", message: "将提交一个独立视频生成请求。费用暂未知，以服务商账单为准；已接单请求不能通过停止本地等待撤销。", confirmLabel: operation === "regenerate" ? "付费重新生成" : "提交生成", tone: "danger" }))) return;
    await request(shot.id, `${encodeURIComponent(shot.id)}/generate`, { kind: "video", operation, modelId: doc!.settings.video.modelId, candidateCount: 1, outputSpecId: outputFrame!.id, ...(operation === "resume" ? { resumeAttemptId: state!.attemptId } : {}) });
  }
  async function batch(key: string, shots: Shot[]) {
    const wanted = shots.filter(batchEligible);
    if (!wanted.length) return;
    if (!(await confirm({ title: "生成本组缺失和过期的视频？", message: `将为 ${outputFrame!.aspect} 画幅的 ${wanted.length} 个镜头提交 ${wanted.length} 个独立视频请求。费用暂未知，以服务商账单为准。`, confirmLabel: "开始本组生成", tone: "danger" }))) return;
    await request(key, "generate", { kind: "video", shotIds: wanted.map((s) => s.id), modelId: doc!.settings.video.modelId, candidateCount: 1, outputSpecId: outputFrame!.id });
  }
  function matchesActiveJob(job: Job, shot: Shot) {
    if (!["shot-generate", "shot-reference"].includes(job.stage) || !["queued", "running"].includes(job.status) || typeof job.input !== "object" || job.input === null) return false;
    const input = job.input as { shotId?: string; outputSpecId?: string; frame?: { aspect?: string } };
    return input.shotId === shot.id && (job.stage === "shot-reference" || (input.outputSpecId ? input.outputSpecId === outputSpecId : input.frame?.aspect ? input.frame.aspect === outputFrame?.aspect : outputFrame?.id === sourceFrame?.id));
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
  async function upload(shot: Shot, file: File) {
    setBusy((old) => ({ ...old, [shot.id]: true }));
    try {
      const response = await fetch("/api/media", { method: "POST", headers: { "content-type": file.type, "x-file-name": encodeURIComponent(file.name) }, body: file });
      const asset = await response.json() as { hash?: string; kind?: string; error?: string };
      if (!response.ok || !asset.hash || asset.kind !== "image") throw new Error(asset.error || "请选择图片素材");
      await request(shot.id, `${encodeURIComponent(shot.id)}/reference`, { assetId: asset.hash, description: shot.sourceImageDescription });
    } catch (cause) { setErrors((old) => ({ ...old, [shot.id]: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setBusy((old) => ({ ...old, [shot.id]: false })); }
  }
  return <section className="panel space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="label">分镜 · AI 视频</p><h2 className="mt-1 text-base font-medium">{groups.size} 组 · {ordered.length} 个独立镜头</h2></div>{onToggleWide && <button type="button" className="chip" aria-pressed={wide} onClick={onToggleWide}>{wide ? "退出全宽" : "全宽"}</button>}</div>
    <p className="text-xs leading-5 text-text-faint">源视频 {doc.settings.video.resolution} · 成片导出 1080p · 服务商费用未知。{doc.settings.video.autoContinue ? "自动连续已开启，参考图完成后会自动提交视频。" : "参考图完成后先确认，再生成视频。"} 视频使用项目配音，原生音轨静音。</p>
    {perOutput ? <div className="space-y-2">
      <label className="block space-y-1 text-xs"><span>独立输出画幅</span><Select aria-label="视频独立输出画幅" value={outputFrame.id} onChange={setSelectedSpecId}>{specs.map((spec) => <option key={spec.id} value={spec.id}>{spec.aspect} · {spec.width}×{spec.height}</option>)}</Select></label>
      <p className="text-xs leading-5 text-amber-100/80">分别生成：{ordered.filter((shot) => !shot.locked).length} 个未锁镜头 × {specs.length} 个画幅，整片首次生成最多 {ordered.filter((shot) => !shot.locked).length * specs.length} 次独立视频请求（比共享素材增加 {ordered.filter((shot) => !shot.locked).length * Math.max(0, specs.length - 1)} 次）。每个画幅分别完成、分别计费；本页按钮仅提交当前 {outputFrame.aspect}。参考图共用 {sourceFrame.aspect}。</p>
    </div> : <p className="text-xs text-text-faint">共享视频源 {sourceFrame.aspect}；其他导出画幅复用该源，不另外生成视频。</p>}
    {errors.status && <p role="alert" className="text-xs text-amber-200">{errors.status}，正在重试。</p>}
    {!ordered.length && <p className="py-8 text-center text-sm text-text-faint">真实配音完成后生成视频分镜。</p>}
    {[...groups].map(([groupId, shots], groupIndex) => {
      const key = `group:${groupId}`;
      const wanting = shots.filter(batchEligible);
      const done = shots.filter((s) => statuses[s.id]?.state === "ready").length;
      return <details key={groupId} open className="rounded-xl border border-hairline p-3">
        <summary className="cursor-pointer text-sm font-medium">大卡 {groupIndex + 1} · {shots.length} 镜 · {done}/{shots.length} 已完成</summary>
        <div className="my-3 flex flex-wrap items-center gap-3"><button type="button" className="btn btn-primary btn-sm" disabled={busy[key] || !wanting.length} onClick={() => void batch(key, shots)}>{busy[key] && <Spinner className="size-3" />}生成本组 · {wanting.length} 个独立视频</button><span className="text-xs text-text-faint">当前输出 {outputFrame.aspect}；先逐镜生成并确认参考图，再批量生成视频。</span></div>
        {errors[key] && <p role="alert" className="mb-2 text-xs text-red-300">{errors[key]}</p>}
        <div className="grid items-start gap-3 xl:grid-cols-3">{shots.map((shot) => {
          const status = statuses[shot.id]; const state = status?.state;
          const timed = timeline?.shots.find((s) => s.shotId === shot.id);
          const activeJob = [...jobs.values()].find((job) => matchesActiveJob(job, shot));
          const running = (!!state && activeStates.has(state)) || !!activeJob;
          const disabled = busy[shot.id] || running || shot.locked;
          const canResume = !!status?.attemptId && ["failed", "canceled", "submission-unknown"].includes(state ?? "");
          const outputAssetId = perOutput ? shot.assetVariants?.[outputFrame.aspect]?.assetId : shot.assetVariants?.[sourceFrame.aspect]?.assetId ?? shot.assetId;
          const generateOperation = canResume ? "generate" : outputAssetId ? "regenerate" : "generate";
          const blocker = generationBlocker(shot, generateOperation);
          const candidates = shot.candidates.filter((candidate) => !candidate.frame?.aspect || candidate.frame.aspect === outputFrame.aspect);
          const endpoint = encodeURIComponent(shot.id);
          return <article key={shot.id} className="min-w-0 space-y-3 rounded-lg border border-hairline bg-white/[0.02] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="text-xs font-medium text-accent" disabled={!timed} onClick={() => timed && onSeek(timed.startMs)}>镜头 {ordered.indexOf(shot) + 1}{timed ? ` · ${(timed.startMs / 1000).toFixed(1)}s` : ""}</button><Switch label={`锁定镜头 ${ordered.indexOf(shot) + 1}`} checked={shot.locked} onChange={(locked) => update(shot.id, { locked })} /></div>
            <p role="status" className="text-xs text-amber-100/85">{activeJob?.stage === "shot-reference" ? "参考图生成中" : state ? labels[state] : "正在读取状态"}{running && typeof status?.progress === "number" ? ` · ${Math.round(status.progress * 100)}%` : ""}</p>
            {status?.targetDurationMs != null && <p className="text-2xs text-text-faint">目标 {(status.targetDurationMs / 1000).toFixed(2)} 秒 · 请求 {status.requestDurationSeconds ?? "—"} 秒 · {status.costStatus === "estimated" ? "费用为估算" : status.costStatus === "verified" ? "费用已核验，见用量记录" : "费用未知"}</p>}
            {state === "submission-unknown" && <p className="text-xs leading-5 text-amber-200">提交可能已被服务商接收，费用未知。恢复只核对原尝试，不会重新提交；重新生成可能再次收费。</p>}
            {state === "canceled" && <p className="text-xs text-text-faint">已停止本地等待，云端任务可能继续并计费。</p>}
            <div className="space-y-1"><p className="label">输入参考图</p><div className="relative aspect-video overflow-hidden rounded-lg bg-stage">{shot.sourceImageAssetId ? <Image src={mediaUrl(shot.sourceImageAssetId)} alt={`镜头 ${ordered.indexOf(shot) + 1} 参考图`} fill unoptimized sizes="400px" className="object-contain" /> : <span className="absolute inset-0 grid place-items-center text-xs text-text-faint">尚无参考图</span>}</div></div>
            <div className="flex flex-wrap gap-2"><button type="button" className="chip" disabled={disabled} onClick={() => void request(shot.id, `${endpoint}/reference`, { modelId: doc.settings.video.referenceImageModelId || undefined })}>生成参考图</button><label className={`chip cursor-pointer ${disabled ? "pointer-events-none opacity-40" : ""}`}>上传参考图<input type="file" className="sr-only" aria-label="上传镜头参考图" accept="image/*" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(shot, file); event.target.value = ""; }} /></label></div>
            <Select aria-label="选择已有参考图片" value="" disabled={disabled} onChange={(assetId) => { if (assetId) void request(shot.id, `${endpoint}/reference`, { assetId, description: shot.sourceImageDescription }); }}><option value="">选择已有图片…</option>{images.map((hash, index) => <option key={hash} value={hash}>图片 {index + 1} · {hash.slice(0, 8)}</option>)}</Select>
            <label className="block space-y-1 text-xs"><span>手选参考图说明</span><AutoTextarea className="input min-h-16 text-xs" disabled={disabled} value={shot.sourceImageDescription ?? ""} onChange={(e) => update(shot.id, { sourceImageDescription: e.target.value })} placeholder="描述人物、场景与起始状态；文本模型不会自动看图" /></label>
            {state === "waiting-confirmation" && <button type="button" className="btn btn-primary btn-sm" disabled={disabled || !status?.snapshotHash || store.save === "saving"} onClick={() => void request(shot.id, `${endpoint}/reference`, { confirmHash: status?.snapshotHash }, "PATCH")}>确认当前参考图</button>}
            <div className="space-y-1"><p className="label">输出视频 · {outputFrame.aspect}</p><div className="aspect-video overflow-hidden rounded-lg bg-stage">{outputAssetId && shot.kind === "video" ? <video key={outputAssetId} src={mediaUrl(outputAssetId)} muted playsInline controls preload="metadata" className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center text-xs text-text-faint">尚无输出视频</div>}</div></div>
            <div className="flex flex-wrap gap-2">{running && <button type="button" className="chip" disabled={busy[shot.id]} onClick={() => void stop(shot)}>停止本地等待</button>}{canResume && <button type="button" className="btn btn-primary btn-sm" disabled={disabled} onClick={() => void generate(shot, "resume")}>恢复原任务</button>}<button type="button" className="chip" disabled={disabled} title={blocker} aria-describedby={blocker ? `video-blocker-${shot.id}` : undefined} onClick={() => void generate(shot, generateOperation)}>{busy[shot.id] && <Spinner className="size-3" />}{busy[shot.id] ? "正在处理…" : outputAssetId ? "重新生成视频" : "生成视频"}</button>{(canResume || state === "submission-unknown") && <button type="button" className="chip" disabled={disabled} onClick={() => void generate(shot, "regenerate")}>付费重新生成</button>}</div>
            {!running && blocker && <p id={`video-blocker-${shot.id}`} className="text-xs leading-5 text-amber-200">{blocker}</p>}
            {status?.message && <p className="text-2xs text-text-faint">{status.message}</p>}{(errors[shot.id] || status?.error) && <p role="alert" className="text-xs text-red-300">{errors[shot.id] || status?.error}</p>}
            {candidates.length > 0 && <details><summary className="cursor-pointer text-xs">当前画幅候选 · {candidates.length}</summary><div className="mt-2 grid grid-cols-2 gap-2">{candidates.map((candidate) => <div key={candidate.id} className="space-y-1"><div className="relative aspect-video bg-stage">{(candidate.kind ?? shot.kind) === "video" ? <video src={mediaUrl(candidate.assetId)} muted playsInline controls preload="metadata" className="h-full w-full object-contain" /> : <Image src={mediaUrl(candidate.assetId)} alt="图片候选" fill unoptimized sizes="200px" className="object-contain" />}</div><p className="text-2xs text-text-faint">{candidate.frame?.aspect ?? "画幅未知"}{perOutput && !candidate.frame?.aspect ? " · 无法用于独立画幅" : ""}</p><button type="button" className="chip w-full" disabled={disabled || candidate.assetId === outputAssetId || (perOutput && !candidate.frame?.aspect)} onClick={() => void request(shot.id, `${endpoint}/generate`, { candidateId: candidate.id, aspect: outputFrame.aspect }, "PATCH")}>{candidate.assetId === outputAssetId ? "已采用" : "采用候选"}</button></div>)}</div></details>}
            <details><summary className="cursor-pointer text-xs">编辑镜头与动作</summary><fieldset disabled={disabled} className="mt-3 space-y-3">
              <label className="block space-y-1 text-xs"><span>画面描述</span><AutoTextarea className="input min-h-16 text-xs" value={shot.description} onChange={(e) => update(shot.id, { description: e.target.value })} /></label>
              {planFields.map(([field, label]) => <label key={field} className="block space-y-1 text-xs"><span>{label}</span><AutoTextarea className="input min-h-16 text-xs" value={shot.videoPlan?.[field] ?? ""} onChange={(e) => update(shot.id, { videoPlan: { startState: "", action: "", camera: "", endState: "", ...shot.videoPlan, [field]: e.target.value } })} /></label>)}
              <Select aria-label="镜头场景" value={shot.sceneId ?? ""} onChange={(sceneId) => update(shot.id, { sceneId: sceneId || undefined })}><option value="">不关联场景</option>{doc.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name}</option>)}</Select>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="镜头角色">{doc.characters.filter((c) => !c.absent || shot.characterIds.includes(c.id)).map((c) => { const selected = shot.characterIds.includes(c.id); return <button key={c.id} type="button" className={`chip ${selected ? "chip-on" : ""}`} aria-pressed={selected} disabled={!selected && shot.characterIds.length >= MAX_SHOT_CHARACTERS} onClick={() => update(shot.id, { characterIds: selected ? shot.characterIds.filter((cid) => cid !== c.id) : [...shot.characterIds, c.id] })}>{c.name}</button>; })}</div>
              <label className="block space-y-1 text-xs"><span>视频上叠加的重点文字</span><AutoTextarea className="input min-h-12 text-xs" value={shot.focusText?.text ?? ""} onChange={(e) => update(shot.id, { focusText: e.target.value ? { ...shot.focusText, text: e.target.value, layoutMode: shot.focusText?.layoutMode ?? "auto" } : undefined })} /></label>
            </fieldset></details>
          </article>;
        })}</div>
      </details>;
    })}
  </section>;
}
