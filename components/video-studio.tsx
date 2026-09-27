"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { JobStrip, WorkerBanner } from "@/components/job-strip";
import { ProjectBar } from "@/components/project-bar";
import { MusicPanel, SentencePanel, SettingsPanel, StoryboardPanel } from "@/components/video-controls";
import { VisualStylePanel } from "@/components/visual-style-panel";
import { CastPanel } from "@/components/cast-panel";
import { Icon, SegmentedControl, Spinner } from "@/components/ui";
import { postJson, useProject, useProjectEvents } from "@/lib/client";
import type { Timeline } from "@/lib/core/timeline";
import { mediaUrl, type Aspect } from "@/lib/core/types";
import { useFeedback } from "@/components/feedback";
import type { VideoPreviewHandle } from "@/components/video-preview";
import { useProjectShortcuts } from "@/lib/shortcuts";

/**
 * 制作页：一键成片、步骤进度、预览播放器、成片下载，以及句子、分镜、配乐和设置面板。
 */

const Preview = dynamic(() => import("@/components/video-preview").then((m) => m.VideoPreview), { ssr: false, loading: () => <div className="aspect-video animate-pulse rounded-2xl bg-white/[0.03]" /> });

const steps = [
  { stage: "annotate", label: "断句标注" },
  { stage: "tts", label: "配音" },
  { stage: "cast", label: "识别角色" },
  { stage: "storyboard", label: "分镜" },
  { stage: "music", label: "配乐" },
  { stage: "render", label: "渲染" },
];

type Render = { id: string; aspect: Aspect; quality: string; timelineHash: string; videoHash: string; srtHash: string | null; durationMs: number; loudness: number | null; createdAt: number };
type PlanInfo = { plan: { steps: { stage: string; key: string; target: string; cost: number }[]; currentKeys: string[]; waiting: string[]; costYuan: number; ready: { preview: boolean } }; goal: { blocked: string | null } | null; blocked?: string; spentYuan: number };
type Panel = "sentences" | "style" | "cast" | "storyboard" | "music" | "settings";

export function VideoStudio({ id }: { id: string }) {
  const store = useProject(id);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [timelineHashes, setTimelineHashes] = useState<Partial<Record<Aspect, string>>>({});
  const [renders, setRenders] = useState<Render[]>([]);
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [startQuality, setStartQuality] = useState<"draft" | "final" | null>(null);
  const [stopBusy, setStopBusy] = useState(false);
  const [setupConfirmed, setSetupConfirmed] = useState(false);
  const [panel, setPanel] = useState<Panel>("sentences");
  const previewRef = useRef<VideoPreviewHandle>(null);
  const { confirm } = useFeedback();
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

  const refresh = useCallback(async (preservePlayback = false) => {
    const playback = preservePlayback && previewRef.current ? {
      currentMs: previewRef.current.currentMs(),
      playing: previewRef.current.isPlaying(),
    } : null;
    const [t, tOther, r, p] = await Promise.all([
      fetch(`/api/projects/${id}/timeline?aspect=${encodeURIComponent(aspect)}`, { cache: "no-store" }).then((x) => x.json()),
      fetch(`/api/projects/${id}/timeline?aspect=${encodeURIComponent(aspect === "16:9" ? "9:16" : "16:9")}`, { cache: "no-store" }).then((x) => x.json()),
      fetch(`/api/projects/${id}/renders`).then((x) => x.json()),
      fetch(`/api/projects/${id}/produce`).then((x) => x.json()),
    ]);
    setTimeline(t.timeline ?? null);
    setTimelineHashes({ [aspect]: t.hash, [aspect === "16:9" ? "9:16" : "16:9"]: tOther.hash });
    setRenders(Array.isArray(r) ? r : []);
    setPlan(p);
    if (playback) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          previewRef.current?.seekToMs(playback.currentMs);
          if (playback.playing && !previewRef.current?.isPlaying()) previewRef.current?.togglePlayPause();
        });
      });
    }
  }, [id, aspect]);

  const { reload } = store;
  const { jobs, online, spend } = useProjectEvents(id, (rev) => {
    reload(rev);
  });
  const ttsJobRevision = ["queued", "running", "succeeded", "failed"].map((status) => [...jobs.values()].filter((job) => job.stage === "tts" && job.status === status).length).join(":");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (store.doc) refresh(true);
  }, [store.doc, refresh]);
  useEffect(() => {
    if (ttsJobRevision !== "0:0:0:0") refresh(true);
  }, [ttsJobRevision, refresh]);
  useEffect(() => {
    try {
      setSetupConfirmed(sessionStorage.getItem(`do-vedio:setup-confirmed:${id}`) === "1");
    } catch {}
  }, [id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 渲染任务完成时刷新成片列表
  const doneRenders = [...jobs.values()].filter((j) => j.stage === "render" && j.status === "succeeded").length;
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (doneRenders) refresh();
  }, [doneRenders]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  async function start(quality: "draft" | "final", confirmBudget = false) {
    if (!store.doc) return;
    setBusy(true);
    setStartQuality(quality);
    setError("");
    try {
      await store.flush();
      const r = await postJson<PlanInfo>(`/api/projects/${id}/produce`, { action: "start", confirmBudget, goal: { until: quality === "draft" ? "render" : store.doc.settings.pauseAfterPreview ? "preview" : "render", aspects: store.doc.settings.aspects, quality } });
      if (r.blocked) {
        const allowed = await confirm({ title: "预计会超出项目预算", message: r.blocked, confirmLabel: "仍要继续", tone: "danger" });
        if (allowed) await start(quality, true);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!(await confirm({ title: "停止当前制作？", message: "已完成的部分会保留，排队中的任务会取消，下次可以从未完成的步骤继续。", confirmLabel: "停止制作", tone: "danger" }))) return;
    setStopBusy(true);
    try {
      await postJson(`/api/projects/${id}/produce`, { action: "stop" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStopBusy(false);
    }
  }

  function confirmSetup() {
    setSetupConfirmed(true);
    try { sessionStorage.setItem(`do-vedio:setup-confirmed:${id}`, "1"); } catch {}
  }

  function toggleOutputAspect(value: Aspect) {
    if (!store.doc) return;
    store.setDoc((doc) => {
      const next = doc.settings.aspects.includes(value) ? doc.settings.aspects.filter((item) => item !== value) : [...doc.settings.aspects, value];
      return { ...doc, settings: { ...doc.settings, aspects: next.length ? next : [value] } };
    });
  }

  function seekLine(lineId: string) {
    const line = timeline?.lines.find((item) => item.id === lineId);
    if (line) previewRef.current?.seekToMs(line.startMs);
  }

  if (store.loadError) return <p className="pt-16 text-center text-sm text-red-300/80">{store.loadError}</p>;
  if (!store.doc) return <p className="flex justify-center pt-24 text-white/40"><Spinner /></p>;
  const doc = store.doc;
  const hasScript = doc.segments.some((s) => s.text.trim());
  const jobList = [...jobs.values()];
  const currentKeys = new Set(plan?.plan.currentKeys ?? []);
  const currentJobs = plan ? jobList.filter((job) => currentKeys.has(job.key)) : jobList;
  const running = currentJobs.some((j) => j.status === "queued" || j.status === "running");
  const blocked = plan?.goal?.blocked;
  return (
    <div className="min-w-0 space-y-6 pt-8">
      <ProjectBar id={id} store={store} title={doc.brief.title} active="video" />
      <WorkerBanner online={online} />
      {error && <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.05] px-5 py-3 text-sm text-red-200/90">{error}</div>}
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
                  <p className="text-xs text-white/40">输出画幅</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["16:9", "9:16"] as const).map((value) => <button key={value} className={`chip h-8 px-3 ${doc.settings.aspects.includes(value) ? "chip-on" : ""}`} onClick={() => toggleOutputAspect(value)}>{value}</button>)}
                  </div>
                </div>
                <SetupItem label="预算" value={doc.settings.budgetYuan == null ? "不设上限" : `¥${doc.settings.budgetYuan.toFixed(2)}`} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button className="btn btn-ghost btn-sm" onClick={() => setPanel("settings")}>编辑制作设置</button>
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
                <span>预览画幅</span>
                <SegmentedControl value={aspect} options={[{ value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }]} onChange={setAspect} label="预览画幅" />
                <span>输出：{doc.settings.aspects.join(" · ")}</span>
              </div>
            </div>
          )}

          <JobStrip steps={steps} jobs={currentJobs} />
          {blocked && <p className="text-sm text-amber-200/80">已暂停：{blocked}</p>}
          {!running && !blocked && plan && plan.plan.waiting.length > 0 && <p className="text-xs text-white/50">{plan.plan.waiting.join(" · ")}</p>}

          <div className={`grid min-w-0 gap-6 lg:items-start ${panel === "storyboard" || panel === "style" || panel === "cast" ? "lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]"}`}>
            <div className="min-w-0 space-y-3 lg:sticky lg:top-24">
              <div className={aspect === "9:16" ? "mx-auto w-full max-w-[420px]" : "w-full"}>
                {timeline ? <Preview ref={previewRef} timeline={timeline} /> : <div className="grid aspect-video place-items-center rounded-2xl bg-white/[0.03] text-sm text-white/35">正在加载预览…</div>}
                {timeline?.issues.map((item, index) => <p key={index} className="mt-2 text-xs text-white/50">{item.level === "warn" ? "⚠ " : ""}{item.message}</p>)}
              </div>
              {timeline && <TimelineStrip timeline={timeline} onSeek={(ms) => previewRef.current?.seekToMs(ms)} />}
            </div>
            <div className="min-w-0">
              <div className="flex overflow-x-auto border-b border-white/[0.08]" role="tablist" aria-label="制作面板">
                {(["sentences", "style", "cast", "storyboard", "music", "settings"] as const).map((key) => <button key={key} role="tab" aria-selected={panel === key} className={`shrink-0 border-b-2 px-4 py-3 text-sm transition ${panel === key ? "border-white text-white" : "border-transparent text-white/45 hover:text-white"}`} onClick={() => setPanel(key)}>{panelLabels[key]}</button>)}
              </div>
              <div className="pt-4">
                {panel === "sentences" && <SentencePanel id={id} store={store} jobs={jobs} onChanged={refresh} onSeek={seekLine} />}
                {panel === "style" && <VisualStylePanel store={store} />}
                {panel === "cast" && <CastPanel id={id} store={store} jobs={jobs} />}
                {panel === "storyboard" && <StoryboardPanel id={id} store={store} timeline={timeline} jobs={jobs} onSeek={(ms) => previewRef.current?.seekToMs(ms)} />}
                {panel === "music" && <MusicPanel id={id} store={store} />}
                {panel === "settings" && <SettingsPanel id={id} store={store} />}
              </div>
            </div>
          </div>

          <RenderList renders={renders} timelineHashes={timelineHashes} title={doc.brief.title} />
        </>
      )}
    </div>
  );
}

const panelLabels: Record<Panel, string> = { sentences: "句子", style: "画面风格", cast: "角色", storyboard: "镜头", music: "配乐", settings: "设置" };

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

function RenderList({ renders, timelineHashes, title }: { renders: Render[]; timelineHashes: Partial<Record<Aspect, string>>; title: string }) {
  return <section className="panel space-y-3 p-5"><div className="flex items-center justify-between"><p className="label">成片</p><span className="text-xs text-white/35">{renders.length} 个版本</span></div>{renders.length === 0 ? <p className="text-sm text-white/45">还没有成片</p> : renders.map((render) => { const fresh = Boolean(timelineHashes[render.aspect] && timelineHashes[render.aspect] === render.timelineHash); const latestFresh = fresh && !renders.some((other) => other.aspect === render.aspect && other.id !== render.id && other.createdAt > render.createdAt && timelineHashes[other.aspect] === other.timelineHash); return <div key={render.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-3 text-sm first:border-0 first:pt-0"><span className="min-w-0 truncate">{render.aspect} · {render.quality === "final" ? "成片" : "样片"}<span className="ml-2 text-xs text-white/40">{Math.round(render.durationMs / 1000)}s</span><span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${latestFresh ? "bg-accent/15 text-accent" : fresh ? "bg-white/[0.07] text-white/50" : "bg-amber-300/10 text-amber-200/85"}`}>{latestFresh ? "最新" : fresh ? "当前版本" : "已过期"}</span></span><span className="flex shrink-0 gap-1.5"><a className="chip" href={`${mediaUrl(render.videoHash)}?download=${encodeURIComponent(`${title || "成片"}-${render.aspect.replace(":", "x")}.mp4`)}`}>MP4</a>{render.srtHash && <a className="chip" href={`${mediaUrl(render.srtHash)}?download=${encodeURIComponent(`${title || "字幕"}-${render.aspect.replace(":", "x")}.srt`)}`}>SRT</a>}</span></div>; })}</section>;
}
