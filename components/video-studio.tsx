"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JobStrip, WorkerBanner } from "@/components/job-strip";
import { ProjectBar } from "@/components/project-bar";
import { SentencePanel } from "@/components/studio/sentence-panel";
import { StoryboardPanel } from "@/components/studio/storyboard-panel";
import { MusicPanel } from "@/components/studio/music-panel";
import { SettingsPanel } from "@/components/studio/settings-panel";
import { VoicePanel } from "@/components/studio/voice-panel";
import { SubtitlePanel } from "@/components/subtitle-panel";
import { StudioStatusBar } from "@/components/studio-status-bar";
import { VisualStylePanel } from "@/components/visual-style-panel";
import { CastPanel } from "@/components/cast-panel";
import { ScenePanel } from "@/components/scene-panel";
import { Icon, SegmentedControl, Spinner } from "@/components/ui";
import { useFinalCatchUp, type CatchUpResponse } from "@/components/studio/use-final-catch-up";
import { postJson, useProject, useProjectEvents, useVoiceChange } from "@/lib/client";
import { isCatchUpInput } from "@/lib/core/catch-up";
import { applyLiveTimeline, presentationSignature, timelineStructureKey } from "@/lib/core/live-timeline";
import { subtitleTranslateUnits } from "@/lib/core/subtitle/translate-plan";
import type { MusicSource, Timeline } from "@/lib/core/timeline";
import { isTtsStage } from "@/lib/core/keys";
import { outputReadiness, renderBadge, visibleRenders, type ExportFile } from "@/lib/core/output-flow";
import { storyboardImageHint, voiceDirectionHint, type StepHint } from "@/lib/core/step-status";
import { mediaUrl, type Aspect, type ProjectDoc, type VoiceSettings } from "@/lib/core/types";
import { sourceImageConfirmed, videoAssetStale } from "@/lib/core/video";
import { shotReferenceStatus } from "@/lib/core/reference-status";
import { outputSpecsFor } from "@/lib/core/output-spec";
import { subtitlePresetMeta } from "@/lib/core/subtitle/presets";
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
  { stage: "voice-direction", label: "配音口吻", indeterminate: true },
  { stage: "tts", stages: ["tts", "tts-block"], label: "配音" },
  { stage: "cast", label: "识别角色和场景", indeterminate: true },
  { stage: "storyboard", label: "分镜", indeterminate: true },
  { stage: "render", label: "渲染" },
];

function produceSteps(bilingual: boolean, video = false) {
  const renderAt = steps.findIndex((step) => step.stage === "render");
  return [...steps.slice(0, renderAt), ...(video ? [{ stage: "shot-reference", label: "参考图" }, { stage: "shot-generate", label: "视频" }] : []), ...(bilingual ? [{ stage: "subtitle-translate", label: "翻译" }] : []), ...steps.slice(renderAt)];
}

function stepHints(doc: ProjectDoc, jobs: { stage: string; status: string }[], storyboardPending: boolean, timeline: Timeline | null): Record<string, StepHint> {
  const hints: Record<string, StepHint> = {};
  const voice = voiceDirectionHint(doc.settings.voice, jobs.some((job) => job.stage === "voice-direction" && job.status === "succeeded"));
  if (voice) hints["voice-direction"] = voice;
  if (doc.settings.visualPipeline === "video" && storyboardPending) {
    hints["shot-reference"] = { tone: "hold", message: "等待视频分镜" };
    hints["shot-generate"] = { tone: "hold", message: "等待视频分镜" };
  } else if (doc.settings.visualPipeline === "video" && doc.shots.length) {
    const frame = outputSpecsFor(doc.settings)[0];
    const videoShots = doc.shots.filter((shot) => shot.kind === "video" && !!shot.videoPlan);
    const pending = videoShots.filter((shot) => !shot.locked && !sourceImageConfirmed(doc, shot, frame));
    if (pending.length && !doc.settings.video.autoContinue) hints["shot-reference"] = { tone: "hold", message: `待生成或确认参考图 · ${pending.length} 镜` };
    else if (!pending.length) hints["shot-reference"] = { tone: "done" };
    const missing = videoShots.filter((shot) => !shot.locked && (!shot.assetId || !timeline || videoAssetStale(doc, shot, timeline, frame)));
    hints["shot-generate"] = missing.length ? { tone: "hold", message: `待生成视频 · ${missing.length} 镜` } : { tone: "done" };
  }
  if (!storyboardPending && doc.settings.visualPipeline !== "video") {
    const generating = jobs.some((job) => job.stage === "shot-generate" && (job.status === "queued" || job.status === "running"));
    const image = storyboardImageHint(doc, generating);
    if (image) hints.storyboard = image;
  }
  if (doc.settings.subtitle.bilingual && subtitleTranslateUnits(doc.lines).length === 0) hints["subtitle-translate"] = { tone: "done", message: "已齐" };
  return hints;
}

type Render = { id: string; aspect: Aspect; quality: string; timelineHash: string; contentHash?: string; animationHash?: string; videoHash: string; srtHash: string | null; durationMs: number; loudness: number | null; createdAt: number; outputVersion?: number; origin?: "manual" | "catch-up" };
type TimelineHashes = { contentHash: string; animationHash: string; timelineHash: string };
type PlanInfo = { plan: { steps: { stage: string; key: string; target: string; cost: number }[]; currentKeys: string[]; waiting: string[]; costYuan: number; ready: { preview: boolean } }; goal: { goal: { goalId?: string }; blocked: string | null } | null; blocked?: string; spentYuan: number; setupFingerprint?: string };
type Panel = "sentences" | "style" | "cast" | "storyboard" | "subtitle" | "music" | "settings" | "voice";

const panelGroups: { label: string; items: Panel[] }[] = [
  { label: "", items: ["settings", "voice", "style"] },
  { label: "内容", items: ["sentences", "cast", "storyboard"] },
  { label: "画面", items: ["subtitle", "music"] },
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
  const [stopBusy, setStopBusy] = useState(false);
  const [setupConfirmed, setSetupConfirmed] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [panel, setPanel] = useState<Panel>("sentences");
  const panelFocus = useRef<string | null>(null);
  const [panelNavigation, setPanelNavigation] = useState(0);
  const [castTab, setCastTab] = useState<"characters" | "scenes">("characters");
  /** 分镜板的临时全宽：右栏窄是卡片拥挤的结构性原因，密集编辑时给一条出路。刷新即复位。 */
  const [wide, setWide] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [musicTracks, setMusicTracks] = useState<MusicSource[]>([]);
  const previewRef = useRef<VideoPreviewHandle>(null);
  const onPreviewPlaying = useCallback((playing: boolean) => setPreviewPlaying(playing), []);
  const { confirm } = useFeedback();
  const changePanel = useCallback((next: Panel) => {
    setPanel(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("panel", next);
      window.history.replaceState({}, "", url);
    }
  }, []);
  const openReferencePanel = (next: Panel, target: string) => {
    panelFocus.current = target;
    changePanel(next);
    setPanelNavigation((current) => current + 1);
  };
  useEffect(() => {
    const requested = panelFocus.current;
    if (!requested) return;
    const target = document.getElementById(requested) ?? document.getElementById(`panel-${panel}`);
    if (!target) return;
    let ancestor = target.parentElement;
    while (ancestor) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; ancestor = ancestor.parentElement; }
    if (requested === "reference-feedback") target.querySelector<HTMLDetailsElement>("details")?.setAttribute("open", "");
    target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    target.querySelector<HTMLElement>("button, select, summary")?.focus({ preventScroll: true });
    panelFocus.current = null;
  }, [panel, panelNavigation]);
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
  /** 旁白和镜头没变时，字幕或配乐刷新不能把播放头拽回去 */
  const structureRef = useRef<Partial<Record<Aspect, string>>>({});
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
    if (t.hashes && typeof t.hashes === "object") setTimelineHashes(t.hashes);
    else setTimelineHashes((current) => ({ ...current, [requestAspect]: nextHashes }));
    setRenders(Array.isArray(r) ? r : []);
    setPlan(p);
    setRefreshError("");
    // 只有时间轴内容真的变了才做 seek 补偿。无条件补偿是预览跳帧的来源之一：
    // 每次刷新都会把播放位置跳回去，用户感觉像卡了一下。
    const changed = lastHashRef.current[requestAspect] !== nextHashes.timelineHash;
    const nextStructure = t.timeline ? timelineStructureKey(t.timeline) : "";
    const structureChanged = structureRef.current[requestAspect] !== nextStructure;
    lastHashRef.current = { ...lastHashRef.current, [requestAspect]: nextHashes.timelineHash };
    structureRef.current = { ...structureRef.current, [requestAspect]: nextStructure };
    if (playback && changed && structureChanged) {
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
  // 分镜失败不会修改文档，因此仅靠文档 revision 无法刷新目标的暂停状态。
  // 同目标内的旧键也纳入终态刷新，避免修复/输入变化切键后漏掉完成事件。
  const settledStoryboardRevision = [...jobs.values()]
    .filter((job) => job.stage === "storyboard" && ["succeeded", "failed", "canceled"].includes(job.status)
      && (plan?.plan.currentKeys.includes(job.key) || !!plan?.goal?.goal.goalId && jobBelongsToGoal(job, plan.goal.goal.goalId)))
    .map((job) => `${job.id}:${job.status}:${job.updatedAt}`).sort().join("|");
  /** 粗粒度内容签名：打字高频字段不进签名，所以编辑画面描述不会触发刷新 */
  const docSig = useMemo(() => (store.doc ? signatureOf(store.doc) : ""), [store.doc]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void runRefresh();
  }, [runRefresh]);
  const docSigSeen = useRef(false);
  const flushDoc = store.flush;
  useEffect(() => {
    if (!docSig) return;
    if (!docSigSeen.current) {
      docSigSeen.current = true;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        await flushDoc();
        if (!cancelled) await runRefreshRef.current?.(true);
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [docSig, flushDoc]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/library/music", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ tracks?: MusicSource[] }> : { tracks: [] })
      .then((data) => { if (!cancelled) setMusicTracks(data.tracks ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id]);
  useEffect(() => {
    if (!store.doc) return;
    const targets = outputSpecsFor(store.doc.settings).map((spec) => spec.aspect);
    setAspect((current) => targets.includes(current) ? current : (store.doc?.settings.previewAspect && targets.includes(store.doc.settings.previewAspect) ? store.doc.settings.previewAspect : targets[0]));
  }, [docSig, store.doc]);
  useEffect(() => {
    if (ttsJobRevision !== "0:0:0:0") scheduleRefresh(true);
  }, [ttsJobRevision, scheduleRefresh]);
  useEffect(() => {
    if (settledStoryboardRevision) scheduleRefresh(true);
  }, [settledStoryboardRevision, scheduleRefresh]);
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

  // 渲染任务完成时刷新成片列表。走节流刷新，避免在 effect 里同步改状态。
  const doneRenders = [...jobs.values()].filter((j) => j.stage === "render" && j.status === "succeeded").length;
  useEffect(() => {
    if (doneRenders) scheduleRefresh(true);
  }, [doneRenders, scheduleRefresh]);

  async function start(options: { force?: boolean; confirmBudget?: boolean; until?: "compose" | "render" } = {}) {
    if (!store.doc) return;
    const legacyActive = jobList.filter((job) => !isCatchUpInput(job.input) && !currentKeys.has(job.key) && (job.status === "queued" || job.status === "running"));
    if (legacyActive.length > 0 && !options.confirmBudget) {
      const allowed = await confirm({
        title: "上一轮还有任务在运行",
        message: `检测到 ${legacyActive.length} 个旧版本或独立任务仍在排队。继续制作会开启新的目标，旧任务不会被自动取消。`,
        confirmLabel: "继续制作",
        bullets: ["影响范围：本次制作只管理新目标提交的任务。", "费用提示：旧任务仍可能产生服务商费用。", "可恢复：旧任务仍可在对应面板单独取消。"],
      });
      if (!allowed) return;
    }
    setBusy(true);
    setError("");
    try {
      if ((await store.flush()) == null) throw new Error("项目设置保存失败，请重试");
      const until = options.until ?? "render";
      const r = await postJson<PlanInfo>(`/api/projects/${id}/produce`, { action: "start", confirmBudget: options.confirmBudget, goal: { until, aspects: outputSpecsFor(store.doc.settings).map((spec) => spec.aspect), quality: "final", ...(options.force && until === "render" ? { forceRender: true } : {}) } });
      // Automatic reference-model selection is part of this submitted setup.
      // Preserve its confirmation without approving unrelated concurrent edits.
      try {
        if (r.setupFingerprint && setupConfirmationMatches(sessionStorage.getItem(`do-vedio:setup-confirmed:${id}`), store.doc.settings)) {
          sessionStorage.setItem(`do-vedio:setup-confirmed:${id}`, r.setupFingerprint);
        }
      } catch {}
      if (r.blocked) {
        const allowed = await confirm({ title: "预计会超出项目预算", message: r.blocked, confirmLabel: "仍要继续", tone: "danger", bullets: ["预计费用：本次计划可能超过项目预算。", "影响范围：会继续提交当前制作目标中的待处理任务。", "可恢复：排队中的任务仍可停止，已接单请求可能计费。"] });
        if (allowed) await start({ ...options, confirmBudget: true });
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
    void start({ until: store.doc?.settings.visualPipeline === "video" ? "render" : "compose" });
  }

  function selectPreview(value: Aspect) {
    setAspect(value);
    store.setDoc((doc) => ({ ...doc, settings: { ...doc.settings, previewAspect: value } }));
  }

  function seekLine(lineId: string) {
    const line = timeline?.lines.find((item) => item.id === lineId);
    if (line) previewRef.current?.seekToMs(line.startMs);
  }

  const presentationSig = useMemo(() => store.doc ? presentationSignature(store.doc) : "", [store.doc]);
  const hasFinal = renders.some((render) => render.quality === "final");
  const catchUp = useFinalCatchUp({ id, enabled: setupConfirmed && hasFinal, signature: presentationSig, playing: previewPlaying, flush: store.flush });
  const previewTimeline = useMemo(() => (timeline && store.doc ? applyLiveTimeline(timeline, store.doc, musicTracks) : null), [timeline, store.doc, musicTracks]);

  if (store.loadError) return <p className="pt-16 text-center text-sm text-red-300/80">{store.loadError}</p>;
  if (!store.doc) return <p className="flex justify-center pt-24 text-white/40"><Spinner /></p>;
  const doc = store.doc;
  const outputSpecs = outputSpecsFor(doc.settings);
  const hasScript = doc.segments.some((s) => s.text.trim());
  const jobList = [...jobs.values()].filter((job) => job.projectId === id);
  const currentKeys = new Set(plan?.plan.currentKeys ?? []);
  const currentGoalId = plan?.goal?.goal.goalId;
  // 后台追成片不进制作进度，也不当成上一轮还在跑的旧任务。
  const studioJobs = jobList.filter((job) => !isCatchUpInput(job.input));
  const currentJobs = plan
    ? studioJobs.filter((job) => currentKeys.has(job.key) || job.status === "queued" || job.status === "running" || job.status === "failed")
    : studioJobs;
  const legacyActiveJobs = currentJobs.filter((job) => !currentKeys.has(job.key) && (job.status === "queued" || job.status === "running"));
  const catchUpActive = jobList.some((job) => isCatchUpInput(job.input) && (job.status === "queued" || job.status === "running"));
  const running = currentJobs.some((j) => !isCatchUpInput(j.input) && currentKeys.has(j.key) && (j.status === "queued" || j.status === "running") && (!currentGoalId || jobBelongsToGoal(j, currentGoalId) || ["shot-reference", "shot-generate"].includes(j.stage) || j.key.startsWith("video-plan:")));
  const blocked = plan?.goal?.blocked;
  const blockedMessage = doc.settings.visualPipeline !== "video" ? blocked : blocked?.startsWith("有任务失败") ? "请处理对应模块中的问题后继续制作。" : blocked?.startsWith("镜头 ") ? "部分镜头尚未完成，请在分镜模块查看处理。" : blocked;
  const referenceShots = doc.shots.filter((shot) => shot.kind === "video" && !!shot.videoPlan);
  const references = referenceShots.map((shot) => shotReferenceStatus(doc, shot, outputSpecs[0], studioJobs));
  const referenceDone = references.filter((reference) => reference.usable).length;
  const referenceFailed = references.some((reference) => reference.kind === "failed");
  const referenceActive = references.some((reference) => ["queued", "running", "standard"].includes(reference.kind));
  const pendingConfirmation = referenceShots.filter((shot, index) => references[index].usable && !shot.locked && !sourceImageConfirmed(doc, shot, outputSpecs[0])).length;
  const outputAspects = outputSpecs.map((spec) => spec.aspect);
  const listedRenders = visibleRenders(renders, timelineHashes);
  const readiness = outputReadiness(outputAspects, listedRenders, timelineHashes);
  const finalsByAspect = outputAspects.filter((outputAspect) => renders.some((render) => render.aspect === outputAspect && render.quality === "final"));
  const renderStale: Partial<Record<Aspect, boolean>> | undefined = readiness.phase === "fresh" || readiness.phase === "stale"
    ? Object.fromEntries(finalsByAspect.map((outputAspect) => [outputAspect, readiness.phase === "stale" && readiness.staleAspects.includes(outputAspect)]))
    : undefined;
  const produceLabel = doc.settings.visualPipeline === "video" ? "继续制作" : readiness.phase === "fresh" ? "再次生成" : readiness.phase === "stale" || renders.some((render) => render.quality === "final") ? "更新成片" : "生成成片";
  const produceCost = (plan?.plan.costYuan ?? 0).toFixed(2);
  async function requestProduce() {
    if (readiness.phase === "fresh") {
      const cost = plan?.plan.costYuan ?? 0;
      const again = await confirm({
        title: "当前成片已是最新",
        message: "没有需要重新渲染的改动。",
        confirmLabel: "仍然重新渲染",
        cancelLabel: "取消",
        bullets: [
          cost > 0 ? `预计费用：重新渲染不另计渲染费；当前计划里还有约 ¥${cost.toFixed(2)} 的未完成步骤。` : "预计费用：重新渲染不产生服务商费用。",
          "影响范围：再生成一份成片，上一版仍可下载。",
          "可恢复：旧文件不会被删除。",
        ],
      });
      if (!again) return;
      await start({ force: true });
      return;
    }
    await start();
  }
  async function exportChosen(files: ExportFile[]) {
    if (files.length === 0) return;
    const aspects = files.map((file) => file.aspect);
    if (!files.some((file) => file.stale)) {
      downloadExport(files, doc.brief.title);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await catchUp.startNow();
      if (result.action === "canceled") return;
      if (result.action === "skipped") {
        const allowed = await confirm({
          title: "导出上一版成片？",
          message: result.reason === "制作进行中" ? "制作还在进行，现在只能导出上一版文件。" : "画面还有别的改动，现在只能导出上一版文件。要新的成片，请点「更新成片」。",
          confirmLabel: "仍要导出上一版",
          cancelLabel: "取消",
          bullets: ["预计费用：导出不产生服务商费用。", "影响范围：下载已有文件，不会开始渲染。", "可恢复：不改变项目和成片列表。"],
        });
        if (allowed) downloadExport(files, doc.brief.title);
        return;
      }
      await waitForRenderJobs(result);
      await runRefresh();
      const fresh = await fetchExportFiles(id, aspect, outputAspects, aspects);
      if (fresh.some((file) => file.stale) || fresh.length === 0) throw new Error("成片还没跟上当前画面");
      downloadExport(fresh, doc.brief.title);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }
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
          {!setupConfirmed && <SetupConfirm doc={doc} costYuan={plan ? plan.plan.costYuan : null} onOpen={changePanel} onConfirm={confirmSetup} />}

          {setupConfirmed && (
            <div id="production-actions" className="panel relative">
              {running && <span aria-hidden className="action-shimmer pointer-events-none absolute inset-0 overflow-hidden" />}
              <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  {readiness.phase === "fresh" ? (
                    <>
                      <ExportControl files={readiness.files} primary disabled={busy || running} onExport={(files) => void exportChosen(files)} />
                      <button className="btn btn-ghost" disabled={busy || running} onClick={() => void requestProduce()}>
                        {busy ? <Spinner className="size-3.5" /> : <Icon name="sparkle" className="size-4" />} 再次生成
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-primary" disabled={busy || running} onClick={() => void requestProduce()}>
                        {busy ? <Spinner className="size-3.5" /> : <Icon name="sparkle" className="size-4" />} {produceLabel}{doc.settings.visualPipeline !== "video" && ` · 约 ¥${produceCost}`}
                      </button>
                      <ExportControl files={readiness.files} disabled={busy || running || readiness.files.length === 0} title={readiness.files.length === 0 ? "先生成成片" : undefined} onExport={(files) => void exportChosen(files)} />
                    </>
                  )}
                  {running && <button className="btn btn-ghost animate-stop-in border-danger-border text-danger hover:text-red-100" disabled={stopBusy} onClick={stop}>{stopBusy ? <Spinner className="size-3.5" /> : <Icon name="stop" className="size-3.5" />} 停止</button>}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/50">
                  <span>{catchUpActive ? "成片在跟上" : readiness.phase === "fresh" ? "成片已跟上" : readiness.status}</span>
                  {catchUp.error && <span className="text-amber-200/85">{catchUp.error}</span>}
                  <span className="text-text-muted">已花费 <span className="tabular-nums text-text-secondary">¥{spend.toFixed(2)}</span></span>
                </div>
              </div>
              <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline bg-white/[0.015] px-4 py-2.5 text-xs sm:px-5">
                <span className="flex items-center gap-2 text-text-faint">
                  当前预览
                  <SegmentedControl value={aspect} options={outputSpecs.map((spec) => ({ value: spec.aspect, label: spec.aspect }))} onChange={selectPreview} label="当前预览" />
                </span>
                <span className="text-white/45">输出：{outputSpecs.map((spec) => `${spec.label} · ${spec.fps}fps`).join(" · ")} · 素材：{doc.settings.assetFraming === "smart-dual" ? "智能双版" : doc.settings.assetFraming === "per-output" ? "分别生成" : "共享素材"}</span>
              </div>
            </div>
          )}

          <StudioStatusBar
            voice={voiceChange && voiceChange.status === "pending" ? { ready: voiceChange.ready, total: voiceChange.total, failed: voiceChange.failed, onOpen: () => changePanel("voice") } : null}
            renderStale={renderStale}
            renderFollow={catchUpActive ? "running" : readiness.phase === "fresh" ? "fresh" : null}
            spend={spend}
            online={online}
          />
          {legacyActiveJobs.length > 0 && <p className="rounded-xl border border-amber-300/20 bg-amber-300/[0.04] px-4 py-2 text-xs text-amber-100/75">仍有 {legacyActiveJobs.length} 个旧版本或独立任务在运行；停止当前制作不会取消它们。</p>}
          <JobStrip
            steps={produceSteps(doc.settings.subtitle.bilingual, doc.settings.visualPipeline === "video")}
            jobs={currentJobs}
            hints={stepHints(doc, studioJobs, plan?.plan.steps.some((step) => step.stage === "storyboard" && !step.key.startsWith("video-plan:")) ?? false, timeline)}
            currentKeys={currentKeys}
            confirm={confirm}
            stageViews={doc.settings.visualPipeline === "video" && referenceShots.length ? { "shot-reference": { done: referenceDone, total: referenceShots.length, tone: referenceFailed ? "failed" : referenceActive ? "active" : referenceDone < referenceShots.length || pendingConfirmation > 0 ? "hold" : "done", message: referenceFailed ? "需处理 · 查看分镜" : referenceActive ? "生成中" : pendingConfirmation && !doc.settings.video.autoContinue ? `待确认 ${pendingConfirmation} 镜` : referenceDone < referenceShots.length ? "待生成 · 查看分镜" : "参考图已齐" } } : undefined}
            onOpenStage={doc.settings.visualPipeline === "video" ? () => openReferencePanel("storyboard", "reference-feedback") : undefined}
          />
          {blocked && <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary"><p>已暂停：{blockedMessage}</p>{doc.settings.visualPipeline === "video" && panel !== "storyboard" && <button className="btn btn-text btn-sm" onClick={() => openReferencePanel("storyboard", "reference-feedback")}>查看待处理镜头</button>}</div>}
          {!running && !blocked && plan && <p className="text-xs text-text-muted">{[...new Set(plan.plan.waiting.filter((message) => doc.settings.visualPipeline !== "video" || !message.startsWith("镜头 ")))].slice(0, 2).join(" · ")}</p>}

          {/*
            分镜全宽：预览缩到 300px 并吸顶，右栏拿走其余全部宽度。
            只在「镜头」面板生效——全宽是为密集改分镜准备的，切走就该还回去。
          */}
          <div className={`grid min-w-0 gap-6 lg:items-start ${wide && panel === "storyboard" ? "lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]"}`}>
            <div className="min-w-0 space-y-3 lg:sticky lg:top-24">
              <div className={aspect === "9:16" ? "mx-auto w-full max-w-[420px]" : "w-full"}>
                {previewTimeline ? <Preview ref={previewRef} timeline={previewTimeline} onPlayingChange={onPreviewPlaying} /> : <div className={`grid ${aspect === "9:16" ? "aspect-[9/16] max-h-[70vh]" : "aspect-[16/9]"} place-items-center rounded-2xl bg-white/[0.03] text-sm text-white/35`}>正在加载预览…</div>}
                {previewTimeline?.issues.filter((item) => item.level === "warn" || !item.message.includes("使用共享素材")).map((item, index) => <p key={index} role={item.level === "warn" ? "alert" : undefined} className={`mt-2 text-xs ${item.level === "warn" ? "text-amber-200/85" : "text-white/50"}`}>{item.level === "warn" ? "⚠ " : ""}{item.message}</p>)}
              </div>
              {previewTimeline && <TimelineStrip timeline={previewTimeline} onSeek={(ms) => previewRef.current?.seekToMs(ms)} />}
            </div>
            <div className="min-w-0">
              {/*
                面板选项卡。
                - 选中态用白色药丸（与 .segmented-item-active / .chip-on 同一套语言）。原来的下划线
                  在一排文字下面很难一眼看出当前在哪，尤其这排还是窄栏里的溢出行。
                - 每个页签带图标，可以扫读，不必逐个念完。
                - 分组之间用一条细竖线分隔。原来的整列 border-l 会连分组标题一起切开，看着像断裂的表格。
              */}
              <div className="sticky top-0 z-10 border-b border-hairline bg-ink/95 backdrop-blur-xl">
                <div className="flex items-stretch gap-1 overflow-x-auto px-2 py-2" role="tablist" aria-label="制作面板">
                  {panelGroups.map((group, groupIndex) => (
                    <div key={group.items[0]} className={`flex shrink-0 items-stretch gap-1 ${groupIndex > 0 ? "ml-1.5 border-l border-hairline pl-2.5" : ""}`}>
                      {group.items.map((key) => (
                        <button
                          key={key}
                          id={`tab-${key}`}
                          role="tab"
                          aria-selected={panel === key}
                          aria-controls={`panel-${key}`}
                          tabIndex={panel === key ? 0 : -1}
                          className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-control px-2.5 py-2 text-xs transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${panel === key ? "bg-white/[0.09] text-white" : "text-white/45 hover:bg-white/[0.04] hover:text-white/75"}`}
                          onClick={() => changePanel(key)}
                          onKeyDown={(event) => { const index = allPanels.indexOf(key); const next = event.key === "ArrowRight" ? allPanels[(index + 1) % allPanels.length] : event.key === "ArrowLeft" ? allPanels[(index - 1 + allPanels.length) % allPanels.length] : event.key === "Home" ? allPanels[0] : event.key === "End" ? allPanels.at(-1)! : null; if (next) { event.preventDefault(); changePanel(next); document.getElementById(`tab-${next}`)?.focus(); } }}
                        >
                          <Icon name={panelIcons[key]} className={`size-3.5 shrink-0 ${panel === key ? "text-accent" : ""}`} />
                          <span className="whitespace-nowrap">{panelLabels[key]}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div id={`panel-${panel}`} role="tabpanel" aria-labelledby={`tab-${panel}`} className="min-w-0 pt-4">
                {panel === "sentences" && <SentencePanel id={id} store={store} jobs={jobs} onChanged={() => { void runRefresh(); }} onSeek={seekLine} />}
                {panel === "style" && <VisualStylePanel store={store} />}
                {panel === "cast" && <div className="space-y-5">
                  <SegmentedControl value={castTab} options={[{ value: "characters", label: "角色" }, { value: "scenes", label: "场景" }]} onChange={setCastTab} label="角色和场景" />
                  {castTab === "characters" ? <CastPanel id={id} store={store} jobs={jobs} /> : <ScenePanel id={id} store={store} jobs={jobs} />}
                </div>}
                {panel === "storyboard" && <StoryboardPanel id={id} store={store} timeline={timeline} jobs={jobs} onSeek={(ms) => previewRef.current?.seekToMs(ms)} wide={wide} onToggleWide={() => setWide((current) => !current)} productionConfirmed={setupConfirmed} onContinue={() => start()} onSettings={() => openReferencePanel("settings", "reference-image-model-settings")} onStandards={() => changePanel("cast")} />}
                {panel === "subtitle" && <SubtitlePanel doc={doc} setDoc={store.setDoc} />}
                {panel === "music" && <MusicPanel id={id} store={store} />}
                {panel === "settings" && <SettingsPanel store={store} />}
                {panel === "voice" && <VoicePanel id={id} store={store} draft={voiceDraft} setDraft={setVoiceDraft} onChanged={() => { void runRefresh(); }} change={voiceChange} setChange={setVoiceChange} refreshChange={refreshVoiceChange} />}
              </div>
            </div>
          </div>

          <RenderList renders={listedRenders} timelineHashes={timelineHashes} title={doc.brief.title} onRegenerate={setupConfirmed ? (render) => { selectPreview(render.aspect); void requestProduce(); } : undefined} />
        </>
      )}
    </div>
  );
}

async function fetchExportFiles(id: string, previewAspect: Aspect, outputAspects: readonly Aspect[], wanted: readonly Aspect[]): Promise<ExportFile[]> {
  const [timelineBody, renderBody] = await Promise.all([
    fetch(`/api/projects/${id}/timeline?aspect=${encodeURIComponent(previewAspect)}`, { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error("成片状态刷新失败"); return response.json() as Promise<{ hashes?: Partial<Record<Aspect, TimelineHashes>> }>; }),
    fetch(`/api/projects/${id}/renders`, { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error("成片状态刷新失败"); return response.json() as Promise<Render[]>; }),
  ]);
  const hashes = timelineBody.hashes ?? {};
  const files = outputReadiness(outputAspects, visibleRenders(renderBody, hashes), hashes).files;
  return wanted.length ? files.filter((file) => wanted.includes(file.aspect)) : files;
}

async function waitForRenderJobs(result: CatchUpResponse) {
  const ids = result.jobs?.map((job) => job.id) ?? [];
  if (result.action !== "started" && result.action !== "running") return;
  if (ids.length === 0) return;
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const jobs = await Promise.all(ids.map(async (jobId) => {
      const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("成片更新状态读取失败");
      return response.json() as Promise<{ status: string; error?: string | null }>;
    }));
    if (jobs.some((job) => job.status === "failed")) throw new Error(jobs.find((job) => job.status === "failed")?.error || "成片没有跟上");
    if (jobs.every((job) => job.status === "succeeded" || job.status === "canceled")) {
      if (jobs.some((job) => job.status === "canceled")) throw new Error("成片更新已取消");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("成片更新超时");
}

const panelLabels: Record<Panel, string> = { sentences: "句子", style: "画面风格", cast: "角色和场景", storyboard: "镜头", subtitle: "字幕", music: "配乐", settings: "设置", voice: "语音" };

/** 图标让页签可以扫读，不必逐个念完标签 */
const panelIcons: Record<Panel, string> = {
  sentences: "text",
  style: "palette",
  cast: "user",
  storyboard: "frames",
  subtitle: "captions",
  music: "music",
  settings: "sliders",
  voice: "mic",
};

const assetFramingLabels: Record<ProjectDoc["settings"]["assetFraming"], string> = {
  "smart-dual": "智能双版",
  "per-output": "分别生成",
  shared: "共享素材",
};

type SetupFact = { label: string; value: string; panel: Panel };

function setupFacts(doc: ProjectDoc, voiceName: string): SetupFact[] {
  const voice = doc.settings.voice;
  const rate = `${voice.rate}x`;
  const voiceValue = voice.granularity === "paragraph" ? `${voiceName} · ${rate} · 段落` : `${voiceName} · ${rate}`;
  const aspects = (["16:9", "9:16"] as const).filter((aspect) => doc.settings.aspects.includes(aspect));
  const subtitle = doc.settings.subtitle;
  const facts: SetupFact[] = [
    { label: "配音", value: voiceValue, panel: "voice" },
    { label: "画幅", value: aspects.join("、") || "16:9", panel: "settings" },
    { label: "素材策略", value: doc.settings.visualPipeline === "video" && doc.settings.assetFraming !== "per-output" ? "共享主画幅视频" : assetFramingLabels[doc.settings.assetFraming], panel: "settings" },
    { label: "预算", value: doc.settings.budgetYuan == null ? "不设上限" : `¥${doc.settings.budgetYuan.toFixed(2)}`, panel: "settings" },
    { label: "画面风格", value: doc.visualStyle?.name.trim() || "推荐", panel: "style" },
    { label: "角色和场景标准图", value: doc.settings.autoPortrait ? "自动生成" : "手动", panel: "settings" },
    { label: "字幕", value: subtitle.enabled ? subtitlePresetMeta(subtitle.preset).name : "关闭", panel: "subtitle" },
    { label: "配乐", value: doc.settings.music.enabled ? "开启" : "关闭", panel: "music" },
  ];
  if (doc.settings.visualPipeline === "video") facts.splice(3, 0,
    { label: "画面驱动", value: `AI 视频 · ${doc.settings.video.resolution}`, panel: "settings" },
    { label: "制作方式", value: doc.settings.video.autoContinue ? "自动制作" : "整批审图后继续", panel: "settings" },
  );
  return facts;
}

function useVoiceLabel(voice: VoiceSettings) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/voices")
      .then((response) => response.json())
      .then((catalog: { providers?: { id: string; models?: { id: string; voices?: { id: string; name: string }[] }[] }[] }) => {
        if (!alive) return;
        const provider = catalog.providers?.find((item) => item.id === voice.provider);
        const model = provider?.models?.find((item) => item.id === voice.model);
        setName(model?.voices?.find((item) => item.id === voice.voiceId)?.name ?? null);
      })
      .catch(() => { if (alive) setName(null); });
    return () => { alive = false; };
  }, [voice.provider, voice.model, voice.voiceId]);
  return name ?? voice.voiceId;
}

function SetupConfirm({ doc, costYuan, onOpen, onConfirm }: { doc: ProjectDoc; costYuan: number | null; onOpen: (panel: Panel) => void; onConfirm: () => void }) {
  const voiceName = useVoiceLabel(doc.settings.voice);
  const facts = setupFacts(doc, voiceName);
  const [sealed, setSealed] = useState(false);
  const sealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (sealTimer.current) clearTimeout(sealTimer.current); }, []);

  /**
   * 涟漪播完再收起面板。直接调 onConfirm 会让父级立刻卸载本组件，
   * 动画被掐断——那是「点了没反应」的观感来源。
   */
  function seal() {
    if (sealed) return;
    setSealed(true);
    sealTimer.current = setTimeout(onConfirm, 430);
  }

  return (
    <section className="panel relative overflow-hidden px-5 py-4 sm:px-6" aria-labelledby="setup-confirm-title">
      {/* 顶部一线强调光，给面板一个明确的「这是决策点」的视觉重量 */}
      <span aria-hidden className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-accent/45 to-transparent" />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="setup-confirm-title" className="text-sm font-medium text-text">开工确认</h2>
          <p className="mt-1 text-2xs text-text-faint">
            {doc.settings.visualPipeline === "video" ? "确认一次后自动完成配音、分镜、参考图、视频和合成；整批审图模式会在参考图完成后等待一次确认。" : "确认后开始断句、配音和分镜。成片需要再点生成。"}任一项设置变动都会让确认失效，需要重新确认。
            {doc.settings.autoPortrait && " 已开启自动标准图：识别后会为每个需要立绘的角色、每个缺少标准图的场景各生成一张，图片费用以服务商账单为准，不计入上面的预估。"}
            {doc.settings.visualPipeline === "video" && " 预估仅包含已知费用；镜头参考图与视频另由服务商收费，当前价格未知。"}
            {doc.settings.visualPipeline === "video" && doc.settings.video.autoContinue && " 自动连续已开启：参考图成功后会继续提交视频请求，停止本地等待不能撤销云端接单。"}
          </p>
        </div>
        <div className="relative shrink-0">
          {sealed && <span aria-hidden className="pointer-events-none absolute inset-0 animate-seal-ring rounded-full border border-accent" />}
          <button className="btn btn-primary btn-sm" disabled={sealed} onClick={seal}>
            {sealed ? <Spinner className="size-3.5" /> : <Icon name="check" className="size-3.5" />}
            {sealed ? "已确认" : doc.settings.visualPipeline === "video" ? "开始制作" : costYuan == null ? "确认开工" : `确认开工 · 约 ¥${costYuan.toFixed(2)}`}
          </button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-hairline pt-4 md:grid-cols-4 xl:grid-cols-8">
        {facts.map((fact, index) => (
          <button
            key={fact.label}
            type="button"
            /* 依次浮现：把「有 7 项要核对」拆成可读的节奏，而不是一堵墙 */
            style={{ animationDelay: `${index * 45}ms` }}
            className="animate-fact-in group min-w-0 rounded-control px-2 py-1.5 text-left transition hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={() => onOpen(fact.panel)}
            aria-label={`${fact.label}：${fact.value}，点击修改`}
          >
            <span className="flex items-center gap-1 text-2xs text-text-faint transition group-hover:text-text-muted">
              {fact.label}
              <Icon name="arrow" className="size-2.5 opacity-0 transition group-hover:opacity-70" />
            </span>
            <span className="mt-1 block truncate text-sm text-text" title={fact.value}>{fact.value}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function TimelineStrip({ timeline, onSeek }: { timeline: Timeline; onSeek: (ms: number) => void }) {
  const duration = Math.max(1, timeline.durationMs);
  const width = (start: number, end: number) => ({ left: `${(start / duration) * 100}%`, width: `${Math.max(0.7, ((end - start) / duration) * 100)}%` });
  return <div className="panel space-y-2 p-3" aria-label="时间轴"><p className="label">时间轴</p><TimelineRow label="句子" color="bg-white/55">{timeline.lines.map((line) => <button key={line.id} title="跳转到句子" aria-label="跳转到句子" className="absolute top-0 h-full min-w-[3px] rounded-sm bg-white/55 transition hover:bg-accent" style={width(line.startMs, line.endMs)} onClick={() => onSeek(line.startMs)} />)}</TimelineRow><TimelineRow label="镜头" color="bg-accent/65">{timeline.shots.map((shot) => <button key={shot.shotId} title={shot.description || "跳转到镜头"} aria-label="跳转到镜头" className="absolute top-0 h-full min-w-[3px] rounded-sm bg-accent/65 transition hover:bg-accent" style={width(shot.startMs, shot.endMs)} onClick={() => onSeek(shot.startMs)} />)}</TimelineRow><TimelineRow label="配乐" color="bg-sky-300/55">{timeline.music.map((cue) => <button key={`${cue.trackId}-${cue.startMs}`} title="跳转到配乐" aria-label="跳转到配乐" className="absolute top-0 h-full min-w-[3px] rounded-sm bg-sky-300/55 transition hover:bg-sky-200" style={width(cue.startMs, cue.endMs)} onClick={() => onSeek(cue.startMs)} />)}</TimelineRow></div>;
}

function TimelineRow({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span className="w-10 shrink-0 text-[10px] text-white/40">{label}</span><div className="relative h-3 min-w-0 flex-1 rounded-sm bg-white/[0.05]">{children}</div><span className={`size-1.5 shrink-0 rounded-full ${color}`} /></div>;
}

function downloadAsset(hash: string, filename: string) {
  const link = document.createElement("a");
  link.href = `${mediaUrl(hash)}?download=${encodeURIComponent(filename)}`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadExport(files: readonly ExportFile[], title: string) {
  const safe = (title || "成片").replace(/[\\/:*?"<>|]/g, " ").trim() || "成片";
  for (const file of files) {
    const aspect = file.aspect.replace(":", "x");
    downloadAsset(file.videoHash, `${safe}-${aspect}.mp4`);
  }
}

function ExportControl({ files, primary = false, disabled = false, title, onExport }: { files: ExportFile[]; primary?: boolean; disabled?: boolean; title?: string; onExport: (files: ExportFile[]) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const buttonClass = primary ? "btn btn-primary" : "btn btn-ghost";
  if (files.length <= 1) {
    return <button className={buttonClass} disabled={disabled || files.length === 0} title={title ?? (files.length === 0 ? "先生成成片" : undefined)} onClick={() => onExport(files)}><Icon name="download" className="size-3.5" /> 导出</button>;
  }
  return (
    <div className="relative" ref={rootRef}>
      <button className={buttonClass} disabled={disabled} aria-expanded={open} aria-haspopup="menu" title={title} onClick={() => setOpen((current) => !current)}><Icon name="download" className="size-3.5" /> 导出</button>
      {open && (
        <div role="menu" aria-label="选择导出的画幅" className="absolute left-0 z-30 mt-2 min-w-40 rounded-xl border border-white/10 bg-[#161616] p-1 shadow-xl">
          {files.map((file) => (
            <button key={file.aspect} type="button" role="menuitem" className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/[0.06]" onClick={() => { setOpen(false); onExport([file]); }}>
              {file.aspect}
            </button>
          ))}
          <button type="button" role="menuitem" className="block w-full rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/[0.06]" onClick={() => { setOpen(false); onExport(files); }}>全部</button>
        </div>
      )}
    </div>
  );
}

function RenderList({ renders, timelineHashes, title, onRegenerate }: { renders: Render[]; timelineHashes: Partial<Record<Aspect, TimelineHashes>>; title: string; onRegenerate?: (render: Render) => void }) {
  const [aspectFilter, setAspectFilter] = useState<"all" | Aspect>("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const filtered = renders.filter((render) => aspectFilter === "all" || render.aspect === aspectFilter);
  const badgeClass = { 最新: "bg-accent/15 text-accent", 上一版: "bg-white/[0.07] text-white/50", 已过期: "bg-amber-300/10 text-amber-200/85" };
  return <section className="panel space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="label">成片</p><p className="mt-1 text-xs text-white/40">新生成的都是成片。改字幕或配乐后会自动更新，中间试出来的自动版本不保留。上一版和更早的样片仍可下载。</p></div><span className="text-xs text-white/35">{filtered.length}/{renders.length} 个版本</span></div>
    <div className="flex flex-wrap gap-2" aria-label="成片筛选">
      <select className="input h-8 w-auto min-w-24 py-1.5 text-xs" value={aspectFilter} onChange={(event) => setAspectFilter(event.target.value as typeof aspectFilter)}><option value="all">全部画幅</option><option value="16:9">16:9</option><option value="9:16">9:16</option></select>
    </div>
    {renders.length === 0 ? <p className="text-sm text-white/45">还没有成片</p> : filtered.length === 0 ? <p className="text-sm text-white/45">没有符合筛选条件的版本</p> : filtered.map((render) => {
      const badge = renderBadge(render, renders, timelineHashes);
      return <div key={render.id} className="space-y-2 border-t border-white/[0.05] pt-3 text-sm first:border-0 first:pt-0">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 truncate">{render.aspect} · {render.quality === "final" ? "成片" : "样片"}<span className="ml-2 text-xs text-white/40">{Math.round(render.durationMs / 1000)}s</span>{badge && <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${badgeClass[badge]}`}>{badge}</span>}</span>
          <span className="flex shrink-0 flex-wrap gap-1.5"><button className="chip" onClick={() => setPreviewId((current) => current === render.id ? null : render.id)}>{previewId === render.id ? "收起预览" : "预览"}</button>{onRegenerate && <button className="chip" onClick={() => onRegenerate(render)}>重新生成</button>}<a className="chip" href={`${mediaUrl(render.videoHash)}?download=${encodeURIComponent(`${title || "成片"}-${render.aspect.replace(":", "x")}.mp4`)}`}>下载 MP4</a>{render.srtHash && <a className="chip" href={`${mediaUrl(render.srtHash)}?download=${encodeURIComponent(`${title || "字幕"}-${render.aspect.replace(":", "x")}.srt`)}`}>SRT</a>}</span>
        </div>
        {previewId === render.id && <video className="aspect-video w-full rounded-xl border border-white/[0.08] bg-black object-contain" controls preload="metadata" src={mediaUrl(render.videoHash)} aria-label={`${render.aspect} ${render.quality === "final" ? "成片" : "样片"}预览`} />}
      </div>;
    })}
  </section>;
}
