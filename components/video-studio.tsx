"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JobStrip, WorkerBanner } from "@/components/job-strip";
import { ProjectBar } from "@/components/project-bar";
import { SentencePanel } from "@/components/studio/sentence-panel";
import { StoryboardPanel } from "@/components/studio/storyboard-panel";
import { MusicPanel } from "@/components/studio/music-panel";
import { SettingsPanel } from "@/components/studio/settings-panel";
import { SubtitlePanel } from "@/components/subtitle-panel";
import { StudioStatusBar } from "@/components/studio-status-bar";
import { VisualStylePanel } from "@/components/visual-style-panel";
import { CastPanel } from "@/components/cast-panel";
import { Icon, SegmentedControl, Spinner } from "@/components/ui";
import { postJson, useProject, useProjectEvents, useVoiceChange } from "@/lib/client";
import type { Timeline } from "@/lib/core/timeline";
import { isTtsStage } from "@/lib/core/keys";
import { mediaUrl, type Aspect, type ProjectDoc, type VoiceSettings } from "@/lib/core/types";
import { outputSpecIdForAspect, outputSpecsFor } from "@/lib/core/output-spec";
import { quickHash } from "@/lib/core/hash";
import { jobBelongsToGoal, setupConfirmationMatches, setupFingerprintForDoc } from "@/lib/core/production";
import { useFeedback } from "@/components/feedback";
import type { VideoPreviewHandle } from "@/components/video-preview";
import { useProjectShortcuts } from "@/lib/shortcuts";

/**
 * 制作页：一键成片、步骤进度、预览播放器、成片下载，以及句子、分镜、配乐和设置面板。
 */

const Preview = dynamic(() => import("@/components/video-preview").then((m) => m.VideoPreview), { ssr: false, loading: () => <div className="aspect-[16/9] animate-pulse rounded-2xl bg-white/[0.03]" /> });

const steps = [
  { stage: "annotate", label: "断句标注" },
  { stage: "tts", stages: ["tts", "tts-block"], label: "配音" },
  { stage: "cast", label: "识别角色" },
  { stage: "storyboard", label: "分镜" },
  { stage: "music", label: "配乐" },
  { stage: "render", label: "渲染" },
];

type Render = { id: string; aspect: Aspect; quality: string; timelineHash: string; contentHash?: string; animationHash?: string; videoHash: string; srtHash: string | null; durationMs: number; loudness: number | null; createdAt: number };
type TimelineHashes = { contentHash: string; animationHash: string; timelineHash: string };
type PlanInfo = { plan: { steps: { stage: string; key: string; target: string; cost: number }[]; currentKeys: string[]; waiting: string[]; costYuan: number; ready: { preview: boolean } }; goal: { goal: { goalId?: string }; blocked: string | null } | null; blocked?: string; spentYuan: number };
type Panel = "sentences" | "style" | "cast" | "storyboard" | "subtitle" | "music" | "settings";

const panelGroups: { label: string; items: Panel[] }[] = [
  { label: "内容", items: ["sentences", "cast", "storyboard"] },
  { label: "画面", items: ["style", "subtitle", "music"] },
  { label: "输出", items: ["settings"] },
];
const allPanels = panelGroups.flatMap((group) => group.items);

/**
 * 内容签名：只包含真正影响 timeline / renders / produce 的字段。
 *
 * 这里必须排除打字高频字段（shots[].description / prompt / seed / onScreenText），
 * 否则每次按键都会改变签名、触发整页刷新——那正是「输入发涩、预览跳帧」的根因。
 * 被排除的字段由 SSE 的 revision 事件驱动最终一致性。
 *
 * 性能优化：
 * - 使用字符串拼接而非对象序列化，减少内存分配
 * - 避免 Object.keys() 和 map() 的嵌套调用
 * - 提取热路径中的重复计算
 */
function signatureOf(doc: ProjectDoc) {
  // 构建紧凑的字符串签名，避免大对象序列化
  const parts: string[] = ["v2"];

  // 句子签名：只包含影响配音和时间轴的字段
  parts.push("L:");
  for (const l of doc.lines) {
    parts.push(
      l.id,
      "|",
      l.text,
      "|",
      l.mood || "",
      "|",
      l.voiceTag || "",
      "|",
      l.ttsIsolated ? "1" : "0",
      "|",
      l.locked ? "1" : "0",
      "|",
      l.secondaryText || "",
      "|",
      l.secondaryHash || "",
      ";"
    );
  }

  // 镜头签名：只包含影响渲染的字段，排除 description/prompt/seed
  parts.push("S:");
  for (const s of doc.shots) {
    parts.push(s.id, "|", s.assetId || "", "|");

    // 变体签名：只记录 assetId 和 promptHash，避免深度遍历
    if (s.assetVariants) {
      const variants = s.assetVariants;
      const aspects = Object.keys(variants).sort();
      for (const aspect of aspects) {
        const v = variants[aspect as keyof typeof variants];
        if (v) {
          parts.push(aspect, ":", v.assetId || "", ":", v.promptHash || "", ",");
        }
      }
    }

    parts.push(
      "|",
      s.kind,
      "|",
      s.mode || "",
      "|",
      s.shotSize || "",
      "|",
      s.motion || "",
      "|",
      s.animation ? quickHash(s.animation) : "",
      "|",
      s.transitionIn || "",
      "|",
      s.locked ? "1" : "0",
      "|",
      s.sourceHash || "",
      ";"
    );
  }

  // 配乐签名
  parts.push("M:");
  for (const m of doc.music) {
    parts.push(
      m.trackId || "",
      "|",
      m.fromLineId || "",
      "|",
      m.toLineId || "",
      "|",
      String(m.offsetMs || 0),
      "|",
      m.locked ? "1" : "0",
      ";"
    );
  }

  // 角色签名
  parts.push("C:");
  for (const c of doc.characters) {
    parts.push(c.id, "|", c.name, ";");
  }

  // 设置签名：只哈希会变化的配置
  parts.push(
    "CFG:",
    quickHash(doc.settings.subtitle),
    "|",
    doc.settings.music.enabled ? "1" : "0",
    "|",
    String(doc.settings.music.gainDb),
    "|",
    doc.settings.sfx.enabled ? "1" : "0",
    "|",
    doc.settings.aiLabel.enabled ? "1" : "0",
    "|",
    doc.settings.aiLabel.position || "",
    "|",
    doc.settings.aspects.join(","),
    "|",
    quickHash(doc.settings.voice),
    "|",
    String(doc.settings.budgetYuan || 0),
    "|",
    doc.settings.outputSpecIds?.join(",") || "",
    "|",
    doc.settings.previewAspect || "",
    "|",
    doc.settings.assetFraming || ""
  );

  // 最终哈希：将拼接的字符串进行哈希，避免暴露内部结构
  return quickHash(parts.join(""));
}

export function VideoStudio({ id }: { id: string }) {
  const store = useProject(id);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [timelineHashes, setTimelineHashes] = useState<Partial<Record<Aspect, TimelineHashes>>>({});
  const [renders, setRenders] = useState<Render[]>([]);
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [voiceDraft, setVoiceDraft] = useState<VoiceSettings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [startQuality, setStartQuality] = useState<"draft" | "final" | null>(null);
  const [stopBusy, setStopBusy] = useState(false);
  const [setupConfirmed, setSetupConfirmed] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [panel, setPanel] = useState<Panel>("sentences");
  const previewRef = useRef<VideoPreviewHandle>(null);
  const { confirm } = useFeedback();
  const changePanel = useCallback((next: Panel) => {
    setPanel(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("panel", next);
      window.history.replaceState({}, "", url);
    }
  }, []);
  useProjectShortcuts({
    save: () => { void store.flush(); }, undo: store.undo,
    togglePlay: () => previewRef.current?.togglePlayPause(),
    previous: () => {
      const current = previewRef.current?.currentMs() ?? 0;
      const line = timeline?.lines.findLast((item) => item.startMs < current - 100);
      if (line) previewRef.current?.seekToMs(line.startMs);
    },
    next: () => {
      const current = previewRef.current?.currentMs() ?? 0;
      const line = timeline?.lines.find((item) => item.startMs > current + 100);
      if (line) previewRef.current?.seekToMs(line.startMs);
    },
  });

  /** 上一次的 timeline hash，用于判断「内容真的变了」才做播放补偿 */
  const lastHashRef = useRef<Partial<Record<Aspect, string>>>({});
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInflight = useRef(false);
  const refreshRequestId = useRef(0);
  const pendingRefresh = useRef<{ preservePlayback: boolean } | null>(null);
  const runRefreshRef = useRef<((preservePlayback?: boolean) => Promise<void>) | undefined>(undefined);

  const refresh = useCallback(async (preservePlayback = false) => {
    const requestId = ++refreshRequestId.current;
    const requestAspect = aspect;
    const playback = preservePlayback && previewRef.current ? {
      currentMs: previewRef.current.currentMs(),
      playing: previewRef.current.isPlaying(),
    } : null;
    const readJson = async (url: string, init?: RequestInit) => {
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`刷新失败（${response.status}）`);
      return response.json();
    };
    const [t, r, p] = await Promise.all([
      readJson(`/api/projects/${id}/timeline?aspect=${encodeURIComponent(requestAspect)}`, { cache: "no-store" }),
      readJson(`/api/projects/${id}/renders`),
      readJson(`/api/projects/${id}/produce`),
    ]);
    // A slower response for a previous aspect/request must never overwrite the current preview.
    if (requestId !== refreshRequestId.current) return;
    setTimeline(t.timeline ?? null);
    const nextHashes: TimelineHashes = {
      contentHash: t.contentHash ?? t.hash ?? "",
      animationHash: t.animationHash ?? "",
      timelineHash: t.timelineHash ?? t.hash ?? "",
    };
    setTimelineHashes((current) => ({ ...current, [requestAspect]: nextHashes }));
    setRenders(Array.isArray(r) ? r : []);
    setPlan(p);
    setRefreshError("");
    // 只有时间轴内容真的变了才做 seek 补偿。无条件补偿是预览跳帧的来源之一：
    // 每次刷新都会把播放位置跳回去，用户感觉像卡了一下。
    const changed = lastHashRef.current[requestAspect] !== nextHashes.timelineHash;
    lastHashRef.current = { ...lastHashRef.current, [requestAspect]: nextHashes.timelineHash };
    if (playback && changed) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          previewRef.current?.seekToMs(playback.currentMs);
          if (playback.playing && !previewRef.current?.isPlaying()) previewRef.current?.togglePlayPause();
        });
      });
    }
  }, [id, aspect]);

  const runRefresh = useCallback(async (preservePlayback = false) => {
    if (refreshInflight.current) {
      pendingRefresh.current = { preservePlayback: pendingRefresh.current?.preservePlayback || preservePlayback };
      return;
    }
    refreshInflight.current = true;
    const requestId = refreshRequestId.current + 1;
    try {
      await refresh(preservePlayback);
    } catch (e) {
      if (refreshRequestId.current === requestId) setRefreshError(e instanceof Error ? e.message : "刷新失败，请重试");
    } finally {
      refreshInflight.current = false;
      const pending = pendingRefresh.current;
      pendingRefresh.current = null;
      if (pending) window.setTimeout(() => { void runRefreshRef.current?.(pending.preservePlayback); }, 0);
    }
  }, [refresh]);
  useEffect(() => {
    runRefreshRef.current = runRefresh;
  }, [runRefresh]);

  /**
   * 合并短时间内的多次刷新请求。
   * 用户编辑和 SSE 推送都走这里，避免两条路径互相打架、也避免每个按键打 4 个接口。
   */
  const scheduleRefresh = useCallback((preservePlayback = false) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void runRefreshRef.current?.(preservePlayback);
    }, 300);
  }, []);

  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  const { reload } = store;
  const { jobs, online, spend, eventsError, refreshWorker } = useProjectEvents(id, (rev) => {
    reload(rev);
  });
  // 配音切换状态由制作页独占持有，顶栏状态区和设置面板共用同一份，不再各自轮询
  const { change: voiceChange, setChange: setVoiceChange, refresh: refreshVoiceChange } = useVoiceChange(id, () => {
    void store.reload();
    void runRefresh();
  });
  const ttsJobRevision = ["queued", "running", "succeeded", "failed"].map((status) => [...jobs.values()].filter((job) => isTtsStage(job.stage) && job.status === status).length).join(":");
  /** 粗粒度内容签名：打字高频字段不进签名，所以编辑画面描述不会触发刷新 */
  const docSig = useMemo(() => (store.doc ? signatureOf(store.doc) : ""), [store.doc]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void runRefresh();
  }, [runRefresh]);
  useEffect(() => {
    if (docSig) scheduleRefresh(true);
  }, [docSig, scheduleRefresh]);
  useEffect(() => {
    if (!store.doc) return;
    const targets = outputSpecsFor(store.doc.settings).map((spec) => spec.aspect);
    setAspect((current) => targets.includes(current) ? current : (store.doc?.settings.previewAspect && targets.includes(store.doc.settings.previewAspect) ? store.doc.settings.previewAspect : targets[0]));
  }, [docSig, store.doc]);
  useEffect(() => {
    if (ttsJobRevision !== "0:0:0:0") scheduleRefresh(true);
  }, [ttsJobRevision, scheduleRefresh]);
  useEffect(() => {
    if (!store.doc) return;
    try {
      setSetupConfirmed(setupConfirmationMatches(sessionStorage.getItem(`do-vedio:setup-confirmed:${id}`), store.doc.settings));
    } catch {}
  }, [id, store.doc]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("panel") as Panel | null;
    if (requested && allPanels.includes(requested)) setPanel(requested);
  }, [id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 渲染任务完成时刷新成片列表
  const doneRenders = [...jobs.values()].filter((j) => j.stage === "render" && j.status === "succeeded").length;
  useEffect(() => {
    if (doneRenders) void runRefresh();
  }, [doneRenders, runRefresh]);

  async function start(quality: "draft" | "final", confirmBudget = false) {
    if (!store.doc) return;
    const legacyActive = jobList.filter((job) => !currentKeys.has(job.key) && (job.status === "queued" || job.status === "running"));
    if (legacyActive.length > 0 && !confirmBudget) {
      const allowed = await confirm({
        title: "上一轮还有任务在运行",
        message: `检测到 ${legacyActive.length} 个旧版本或独立任务仍在排队。继续制作会开启新的目标，旧任务不会被自动取消。`,
        confirmLabel: "继续制作",
        bullets: ["影响范围：本次制作只管理新目标提交的任务。", "费用提示：旧任务仍可能产生服务商费用。", "可恢复：旧任务仍可在对应面板单独取消。"],
      });
      if (!allowed) return;
    }
    setBusy(true);
    setStartQuality(quality);
    setError("");
    try {
      if ((await store.flush()) == null) throw new Error("项目设置保存失败，请重试");
      const r = await postJson<PlanInfo>(`/api/projects/${id}/produce`, { action: "start", confirmBudget, goal: { until: quality === "draft" ? "render" : store.doc.settings.pauseAfterPreview ? "preview" : "render", aspects: outputSpecsFor(store.doc.settings).map((spec) => spec.aspect), quality } });
      if (r.blocked) {
        const allowed = await confirm({ title: "预计会超出项目预算", message: r.blocked, confirmLabel: "仍要继续", tone: "danger", bullets: ["预计费用：本次计划可能超过项目预算。", "影响范围：会继续提交当前制作目标中的待处理任务。", "可恢复：排队中的任务仍可停止，已接单请求可能计费。"] });
        if (allowed) await start(quality, true);
      }
      await runRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!(await confirm({ title: "停止当前制作？", message: "已完成的部分会保留，排队中的任务会取消，下次可以从未完成的步骤继续。", confirmLabel: "停止制作", tone: "danger", bullets: ["预计费用：已接单的服务商请求仍可能计费。", "影响范围：只取消当前项目尚未完成的排队任务，已完成结果保留。", "可恢复：下次可以从未完成的步骤继续制作。"] }))) return;
    setStopBusy(true);
    try {
      await postJson(`/api/projects/${id}/produce`, { action: "stop" });
      await runRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStopBusy(false);
    }
  }

  function confirmSetup() {
    setSetupConfirmed(true);
    try {
      if (store.doc) sessionStorage.setItem(`do-vedio:setup-confirmed:${id}`, setupFingerprintForDoc(store.doc));
    } catch {}
  }

  function toggleOutputAspect(value: Aspect) {
    if (!store.doc) return;
    store.setDoc((doc) => {
      const next = doc.settings.aspects.includes(value) ? doc.settings.aspects.filter((item) => item !== value) : [...doc.settings.aspects, value];
      const aspects = next.length ? next : [value];
      return { ...doc, settings: { ...doc.settings, aspects, outputSpecIds: aspects.map(outputSpecIdForAspect), previewAspect: aspects.includes(doc.settings.previewAspect ?? "16:9") ? doc.settings.previewAspect : aspects[0] } };
    });
  }

  function selectPreview(value: Aspect) {
    setAspect(value);
    store.setDoc((doc) => ({ ...doc, settings: { ...doc.settings, previewAspect: value } }));
  }

  function seekLine(lineId: string) {
    const line = timeline?.lines.find((item) => item.id === lineId);
    if (line) previewRef.current?.seekToMs(line.startMs);
  }

  if (store.loadError) return <p className="pt-16 text-center text-sm text-red-300/80">{store.loadError}</p>;
  if (!store.doc) return <p className="flex justify-center pt-24 text-white/40"><Spinner /></p>;
  const doc = store.doc;
  const outputSpecs = outputSpecsFor(doc.settings);
  const hasScript = doc.segments.some((s) => s.text.trim());
  const jobList = [...jobs.values()].filter((job) => job.projectId === id);
  const currentKeys = new Set(plan?.plan.currentKeys ?? []);
  const currentGoalId = plan?.goal?.goal.goalId;
  const currentJobs = plan
    ? jobList.filter((job) => currentKeys.has(job.key) || job.status === "queued" || job.status === "running" || job.status === "failed")
    : jobList;
  const legacyActiveJobs = currentJobs.filter((job) => !currentKeys.has(job.key) && (job.status === "queued" || job.status === "running"));
  const running = currentJobs.some((j) => currentKeys.has(j.key) && (j.status === "queued" || j.status === "running") && (!currentGoalId || jobBelongsToGoal(j, currentGoalId)));
  const blocked = plan?.goal?.blocked;
  /**
   * 有成片、但没有任何一条与当前时间轴一致 → 内容或动画改动过，成片已过期。
   * 原来这个信息只藏在成片列表的徽章里，用户不会联想到是自己刚才改了描述或镜头。
   */
  const staleRender = (Object.fromEntries((Object.keys(timelineHashes) as Aspect[]).map((outputAspect) => [outputAspect, renders.filter((render) => render.aspect === outputAspect).length > 0 && !renders.some((render) => render.aspect === outputAspect && isRenderFresh(render, timelineHashes[outputAspect]))])) as Partial<Record<Aspect, boolean>>);
  return (
    <div className="min-w-0 space-y-6 pt-8">
      <ProjectBar id={id} store={store} title={doc.brief.title} active="video" />
      <WorkerBanner online={online} onRetry={() => { void refreshWorker(); }} />
      {eventsError && <div role="status" className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.05] px-5 py-3 text-sm text-amber-100/85">实时进度连接中断，任务仍在后台执行；页面会自动重连，期间显示的进度可能暂时不是最新。</div>}
      {error && <div role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/[0.05] px-5 py-3 text-sm text-red-200/90">{error}</div>}
      {refreshError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.05] px-5 py-3 text-sm text-amber-100/85">
          <span>{refreshError} 当前画面可能还是上一版状态。</span>
          <button className="btn btn-ghost btn-sm" onClick={() => void runRefresh()}>重试刷新</button>
        </div>
      )}
      {!hasScript && <div className="panel px-6 py-10 text-center text-sm text-white/45">还没有文案。先到「01 文案」写好稿子，再回来一键成片。</div>}

      {hasScript && (
        <>
          {!setupConfirmed && (
            <section className="panel space-y-5 border-accent/20 bg-accent/[0.035] p-5 sm:p-6">
              <div>
                <p className="label text-accent/70">开工确认</p>
                <h2 className="mt-1 text-xl font-semibold">先确认制作设置，再开始花费</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/55">音色、输出画幅和预算会影响后续配音与渲染。确认后才会显示生成按钮。</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <SetupItem label="音色" value={`${doc.settings.voice.model} · ${doc.settings.voice.voiceId}`} />
                <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
                  <p className="text-xs text-white/40">输出规格</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["16:9", "9:16"] as const).map((value) => <button key={value} className={`chip h-8 px-3 ${doc.settings.aspects.includes(value) ? "chip-on" : ""}`} onClick={() => toggleOutputAspect(value)}>{value} · 1080p</button>)}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
                  <p className="text-xs text-white/40">素材策略</p>
                  <select className="input mt-2 h-8 py-1.5 text-xs" value={doc.settings.assetFraming} onChange={(event) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, assetFraming: event.target.value as ProjectDoc["settings"]["assetFraming"] } }))}>
                    <option value="smart-dual">智能双版</option><option value="per-output">全部分别生成</option><option value="shared">全部共享素材</option>
                  </select>
                </div>
                <SetupItem label="预算" value={doc.settings.budgetYuan == null ? "不设上限" : `¥${doc.settings.budgetYuan.toFixed(2)}`} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button className="btn btn-ghost btn-sm" onClick={() => changePanel("settings")}>编辑制作设置</button>
                <button className="btn btn-primary" onClick={confirmSetup}><Icon name="check" className="size-4" />确认开工</button>
              </div>
            </section>
          )}

          {setupConfirmed && (
            <div className="panel space-y-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn btn-primary" disabled={busy || running} onClick={() => start("final")}>
                    {startQuality === "final" && (busy || running) ? <Spinner className="size-3.5" /> : <Icon name="sparkle" className="size-4" />} 生成成片 · 约 ¥{(plan?.plan.costYuan ?? 0).toFixed(2)}
                  </button>
                  <button className="btn btn-ghost" disabled={busy || running} onClick={() => start("draft")}>
                    {startQuality === "draft" && (busy || running) ? <Spinner className="size-3.5" /> : <Icon name="wand" className="size-3.5" />} 生成样片
                  </button>
                  {running && <button className="btn btn-ghost" disabled={stopBusy} onClick={stop}>{stopBusy ? <Spinner className="size-3.5" /> : <Icon name="stop" className="size-3.5" />} 停止</button>}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-white/50">
                  <span>样片：低清，用来确认节奏</span>
                  <span>已花费 ¥{spend.toFixed(2)}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/45">
                <span>当前预览</span>
                <SegmentedControl value={aspect} options={outputSpecs.map((spec) => ({ value: spec.aspect, label: spec.aspect }))} onChange={selectPreview} label="当前预览" />
                <span>输出：{outputSpecs.map((spec) => `${spec.label} · ${spec.fps}fps`).join(" · ")} · 素材：{doc.settings.assetFraming === "smart-dual" ? "智能双版" : doc.settings.assetFraming === "per-output" ? "分别生成" : "共享素材"}</span>
              </div>
            </div>
          )}

          <StudioStatusBar
            voice={voiceChange && voiceChange.status === "pending" ? { ready: voiceChange.ready, total: voiceChange.total, failed: voiceChange.failed, onOpen: () => changePanel("settings") } : null}
            renderStale={staleRender}
            spend={spend}
            online={online}
          />
          {legacyActiveJobs.length > 0 && <p className="rounded-xl border border-amber-300/20 bg-amber-300/[0.04] px-4 py-2 text-xs text-amber-100/75">仍有 {legacyActiveJobs.length} 个旧版本或独立任务在运行；停止当前制作不会取消它们。</p>}
          <JobStrip steps={steps} jobs={currentJobs} currentKeys={currentKeys} confirm={confirm} />
          {blocked && <p className="text-sm text-amber-200/80">已暂停：{blocked}</p>}
          {!running && !blocked && plan && plan.plan.waiting.length > 0 && <p className="text-xs text-white/50">{plan.plan.waiting.join(" · ")}</p>}

          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] lg:items-start">
            <div className="min-w-0 space-y-3 lg:sticky lg:top-24">
              <div className={aspect === "9:16" ? "mx-auto w-full max-w-[420px]" : "w-full"}>
                {timeline ? <Preview ref={previewRef} timeline={timeline} /> : <div className={`grid ${aspect === "9:16" ? "aspect-[9/16] max-h-[70vh]" : "aspect-[16/9]"} place-items-center rounded-2xl bg-white/[0.03] text-sm text-white/35`}>正在加载预览…</div>}
                {timeline?.issues.filter((item) => item.level === "warn" || !item.message.includes("使用共享素材")).map((item, index) => <p key={index} role={item.level === "warn" ? "alert" : undefined} className={`mt-2 text-xs ${item.level === "warn" ? "text-amber-200/85" : "text-white/50"}`}>{item.level === "warn" ? "⚠ " : ""}{item.message}</p>)}
              </div>
              {timeline && <TimelineStrip timeline={timeline} onSeek={(ms) => previewRef.current?.seekToMs(ms)} />}
            </div>
            <div className="min-w-0">
              <div className="sticky top-0 z-10 border-b border-white/[0.08] bg-ink/95 backdrop-blur-xl" role="tablist" aria-label="制作面板">
                <div className="flex gap-1 border-b border-white/[0.06] px-1 pt-1">
                  {panelGroups.map((group) => <span key={group.label} className="px-3 pb-1 text-[10px] font-medium tracking-wide text-white/30">{group.label}</span>)}
                </div>
                <div className="flex overflow-x-auto" role="presentation">
                  {panelGroups.flatMap((group) => group.items).map((key) => <button key={key} id={`tab-${key}`} role="tab" aria-selected={panel === key} aria-controls={`panel-${key}`} tabIndex={panel === key ? 0 : -1} className={`shrink-0 border-b-2 px-3.5 py-3 text-sm transition ${panel === key ? "border-white text-white" : "border-transparent text-white/45 hover:text-white"}`} onClick={() => changePanel(key)} onKeyDown={(event) => { const index = allPanels.indexOf(key); const next = event.key === "ArrowRight" ? allPanels[(index + 1) % allPanels.length] : event.key === "ArrowLeft" ? allPanels[(index - 1 + allPanels.length) % allPanels.length] : event.key === "Home" ? allPanels[0] : event.key === "End" ? allPanels.at(-1)! : null; if (next) { event.preventDefault(); changePanel(next); document.getElementById(`tab-${next}`)?.focus(); } }}>{panelLabels[key]}</button>)}
                </div>
              </div>
              <div id={`panel-${panel}`} role="tabpanel" aria-labelledby={`tab-${panel}`} className="min-w-0 pt-4">
                {panel === "sentences" && <SentencePanel id={id} store={store} jobs={jobs} onChanged={() => { void runRefresh(); }} onSeek={seekLine} />}
                {panel === "style" && <VisualStylePanel store={store} />}
                {panel === "cast" && <CastPanel id={id} store={store} jobs={jobs} />}
                {panel === "storyboard" && <StoryboardPanel id={id} store={store} timeline={timeline} jobs={jobs} onSeek={(ms) => previewRef.current?.seekToMs(ms)} />}
                {panel === "subtitle" && <SubtitlePanel doc={doc} setDoc={store.setDoc} />}
                {panel === "music" && <MusicPanel id={id} store={store} />}
                {panel === "settings" && <SettingsPanel id={id} store={store} draft={voiceDraft} setDraft={setVoiceDraft} onChanged={() => { void runRefresh(); }} change={voiceChange} setChange={setVoiceChange} refreshChange={refreshVoiceChange} />}
              </div>
            </div>
          </div>

          <RenderList renders={renders} timelineHashes={timelineHashes} title={doc.brief.title} onRegenerate={setupConfirmed ? (render) => { selectPreview(render.aspect); void start(render.quality === "final" ? "final" : "draft"); } : undefined} />
        </>
      )}
    </div>
  );
}

const panelLabels: Record<Panel, string> = { sentences: "句子", style: "画面风格", cast: "角色", storyboard: "镜头", subtitle: "字幕", music: "配乐", settings: "设置" };

function SetupItem({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3"><p className="text-xs text-white/40">{label}</p><p className="mt-2 truncate text-sm text-white/85" title={value}>{value}</p></div>;
}

function TimelineStrip({ timeline, onSeek }: { timeline: Timeline; onSeek: (ms: number) => void }) {
  const duration = Math.max(1, timeline.durationMs);
  const width = (start: number, end: number) => ({ left: `${(start / duration) * 100}%`, width: `${Math.max(0.7, ((end - start) / duration) * 100)}%` });
  return <div className="panel space-y-2 p-3" aria-label="时间轴"><p className="label">时间轴</p><TimelineRow label="句子" color="bg-white/55">{timeline.lines.map((line) => <button key={line.id} title="跳转到句子" aria-label="跳转到句子" className="absolute top-0 h-full min-w-[3px] rounded-sm bg-white/55 transition hover:bg-accent" style={width(line.startMs, line.endMs)} onClick={() => onSeek(line.startMs)} />)}</TimelineRow><TimelineRow label="镜头" color="bg-accent/65">{timeline.shots.map((shot) => <button key={shot.shotId} title={shot.description || "跳转到镜头"} aria-label="跳转到镜头" className="absolute top-0 h-full min-w-[3px] rounded-sm bg-accent/65 transition hover:bg-accent" style={width(shot.startMs, shot.endMs)} onClick={() => onSeek(shot.startMs)} />)}</TimelineRow><TimelineRow label="配乐" color="bg-sky-300/55">{timeline.music.map((cue) => <button key={`${cue.trackId}-${cue.startMs}`} title="跳转到配乐" aria-label="跳转到配乐" className="absolute top-0 h-full min-w-[3px] rounded-sm bg-sky-300/55 transition hover:bg-sky-200" style={width(cue.startMs, cue.endMs)} onClick={() => onSeek(cue.startMs)} />)}</TimelineRow></div>;
}

function TimelineRow({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span className="w-10 shrink-0 text-[10px] text-white/40">{label}</span><div className="relative h-3 min-w-0 flex-1 rounded-sm bg-white/[0.05]">{children}</div><span className={`size-1.5 shrink-0 rounded-full ${color}`} /></div>;
}

function isRenderFresh(render: Render, current?: TimelineHashes) {
  if (!current) return false;
  if (render.animationHash) {
    return current.contentHash === (render.contentHash ?? render.timelineHash) && current.animationHash === render.animationHash;
  }
  return current.timelineHash === render.timelineHash;
}

function RenderList({ renders, timelineHashes, title, onRegenerate }: { renders: Render[]; timelineHashes: Partial<Record<Aspect, TimelineHashes>>; title: string; onRegenerate?: (render: Render) => void }) {
  const [aspectFilter, setAspectFilter] = useState<"all" | Aspect>("all");
  const [qualityFilter, setQualityFilter] = useState<"all" | "draft" | "final">("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const filtered = renders.filter((render) => (aspectFilter === "all" || render.aspect === aspectFilter) && (qualityFilter === "all" || render.quality === qualityFilter));
  return <section className="panel space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="label">成片</p><p className="mt-1 text-xs text-white/40">按画幅和质量检查当前版本，过期版本仍可下载。</p></div><span className="text-xs text-white/35">{filtered.length}/{renders.length} 个版本</span></div>
    <div className="flex flex-wrap gap-2" aria-label="成片筛选">
      <select className="input h-8 w-auto min-w-24 py-1.5 text-xs" value={aspectFilter} onChange={(event) => setAspectFilter(event.target.value as typeof aspectFilter)}><option value="all">全部画幅</option><option value="16:9">16:9</option><option value="9:16">9:16</option></select>
      <select className="input h-8 w-auto min-w-24 py-1.5 text-xs" value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value as typeof qualityFilter)}><option value="all">全部质量</option><option value="final">成片</option><option value="draft">样片</option></select>
    </div>
    {renders.length === 0 ? <p className="text-sm text-white/45">还没有成片</p> : filtered.length === 0 ? <p className="text-sm text-white/45">没有符合筛选条件的版本</p> : filtered.map((render) => {
      const fresh = isRenderFresh(render, timelineHashes[render.aspect]);
      const latestFresh = fresh && !renders.some((other) => other.aspect === render.aspect && other.id !== render.id && other.createdAt > render.createdAt && isRenderFresh(other, timelineHashes[other.aspect]));
      return <div key={render.id} className="space-y-2 border-t border-white/[0.05] pt-3 text-sm first:border-0 first:pt-0">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 truncate">{render.aspect} · {render.quality === "final" ? "成片" : "样片"}<span className="ml-2 text-xs text-white/40">{Math.round(render.durationMs / 1000)}s</span><span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${latestFresh ? "bg-accent/15 text-accent" : fresh ? "bg-white/[0.07] text-white/50" : "bg-amber-300/10 text-amber-200/85"}`}>{latestFresh ? "最新" : fresh ? "当前版本" : "已过期"}</span></span>
          <span className="flex shrink-0 flex-wrap gap-1.5"><button className="chip" onClick={() => setPreviewId((current) => current === render.id ? null : render.id)}>{previewId === render.id ? "收起预览" : "预览"}</button>{onRegenerate && <button className="chip" onClick={() => onRegenerate(render)}>重新生成</button>}<a className="chip" href={`${mediaUrl(render.videoHash)}?download=${encodeURIComponent(`${title || "成片"}-${render.aspect.replace(":", "x")}.mp4`)}`}>下载 MP4</a>{render.srtHash && <a className="chip" href={`${mediaUrl(render.srtHash)}?download=${encodeURIComponent(`${title || "字幕"}-${render.aspect.replace(":", "x")}.srt`)}`}>SRT</a>}</span>
        </div>
        {previewId === render.id && <video className="aspect-video w-full rounded-xl border border-white/[0.08] bg-black object-contain" controls preload="metadata" src={mediaUrl(render.videoHash)} aria-label={`${render.aspect} ${render.quality === "final" ? "成片" : "样片"}预览`} />}
      </div>;
    })}
  </section>;
}
