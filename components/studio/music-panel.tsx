"use client";

// 配乐面板：曲库筛选（情绪/能量/授权）、试听与配乐片段。

import { useEffect, useState } from "react";
import { AudioButton, RangeField, Select, Switch } from "@/components/ui";
import type { MusicCue } from "@/lib/core/types";
import type { ProjectStore } from "./shared";

type Track = {
  id: string;
  title: string;
  src: string;
  moods: string[];
  durationMs: number;
  license: string;
  source: string;
  author: string;
  rightsStatus: "pending" | "verified" | "rejected" | "quarantine";
  usable: boolean;
  energy: "low" | "medium" | "high" | null;
  bpm: number | null;
  disabledReason: string;
  sourcePage: string;
};

const trackRightsLabel: Record<Track["rightsStatus"], string> = { verified: "已核实", pending: "待核实", rejected: "已排除", quarantine: "隔离" };
const trackRightsClass: Record<Track["rightsStatus"], string> = {
  verified: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
  pending: "border-amber-300/25 bg-amber-300/10 text-amber-200",
  rejected: "border-red-300/25 bg-red-300/10 text-red-200",
  quarantine: "border-violet-300/25 bg-violet-300/10 text-violet-200",
};
const trackEnergyLabel: Record<"low" | "medium" | "high", string> = { low: "低能量", medium: "中能量", high: "高能量" };
const musicMoodOptions = ["悬疑", "紧张", "轻松", "温暖", "激昂", "史诗", "科技", "忧伤", "中性"] as const;

export function MusicPanel({ id, store }: { id: string; store: ProjectStore }) {
  const doc = store.doc;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [filters, setFilters] = useState({ mood: "all", energy: "all", status: "all", q: "" });
  useEffect(() => {
    fetch("/api/library/music", { cache: "no-store" }).then((r) => r.json()).then((d) => { setTracks(d.tracks ?? []); setProblems(d.problems ?? []); });
  }, [id]);
  if (!doc) return null;
  const usable = tracks.filter((t) => t.usable);
  const shown = tracks.filter(
    (t) =>
      (filters.mood === "all" || t.moods.includes(filters.mood)) &&
      (filters.energy === "all" || t.energy === filters.energy) &&
      (filters.status === "all" || t.rightsStatus === filters.status) &&
      (!filters.q || [t.title, t.author, t.source].join(" ").toLowerCase().includes(filters.q.toLowerCase())),
  );
  const first = doc.lines[0]?.id;
  const last = doc.lines.at(-1)?.id;
  const ensureCue = () => {
    if (!first || !last || usable.length === 0) return;
    store.setDoc((d) => ({ ...d, music: d.music.length ? d.music : [{ trackId: usable[0].id, fromLineId: first, toLineId: last, mood: "中性", offsetMs: 0, locked: false }] }));
  };
  const updateCue = (index: number, patch: Partial<MusicCue>) => store.setDoc((d) => ({ ...d, music: d.music.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  return <section className="panel p-5">
    <div className="flex items-center justify-between gap-3"><div><p className="label">配乐</p><h2 className="mt-1 text-base font-medium">配乐</h2></div><label className="flex items-center gap-2 text-sm text-text-muted">启用 <Switch checked={doc.settings.music.enabled} label="启用配乐" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, music: { ...d.settings.music, enabled: checked } } }))} /></label></div>
    {problems.length > 0 && <p className="mt-3 text-xs leading-5 text-amber-200/65">{problems.join("；")}</p>}
    {tracks.length === 0 ? <p className="py-8 text-center text-sm text-white/35">曲库尚未导入。运行 npm run library:ingest。</p> : <>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={filters.mood} onChange={(v) => setFilters((f) => ({ ...f, mood: v }))} aria-label="按情绪筛选">
          <option value="all">全部情绪</option>
          {musicMoodOptions.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Select value={filters.energy} onChange={(v) => setFilters((f) => ({ ...f, energy: v }))} aria-label="按能量筛选">
          <option value="all">全部能量</option>
          <option value="low">低能量</option>
          <option value="medium">中能量</option>
          <option value="high">高能量</option>
        </Select>
        <Select value={filters.status} onChange={(v) => setFilters((f) => ({ ...f, status: v }))} aria-label="按授权状态筛选">
          <option value="all">全部授权状态</option>
          <option value="verified">已核实</option>
          <option value="pending">待核实</option>
          <option value="rejected">已排除</option>
          <option value="quarantine">隔离</option>
        </Select>
        <input className="input h-9 text-xs" placeholder="搜索标题 / 作者 / 来源" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} aria-label="搜索曲目" />
      </div>
      <p className="mt-2 text-xs text-white/40">共 {tracks.length} 首 · 可选 {usable.length} 首（自动选曲只使用已核实授权且未禁用的曲目）</p>
      <details className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3" open={usable.length === 0}>
        <summary className="cursor-pointer text-sm text-white/70">浏览曲库（{shown.length}）</summary>
        <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
          {shown.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-white/[0.05] px-2.5 py-2 text-xs">
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${trackRightsClass[t.rightsStatus]}`}>{trackRightsLabel[t.rightsStatus]}</span>
              <span className="min-w-0 flex-1 truncate" title={`${t.title}${t.author ? ` · ${t.author}` : ""}`}>{t.title}{t.author ? ` · ${t.author}` : ""}</span>
              <span className="hidden shrink-0 text-white/40 sm:inline">{t.moods.join("、")}</span>
              {t.energy && <span className="hidden shrink-0 text-white/40 md:inline">{trackEnergyLabel[t.energy]}{t.bpm ? ` · ${t.bpm}BPM` : ""}</span>}
              <span className="shrink-0 text-white/40">{Math.round(t.durationMs / 1000)}s</span>
              {t.src ? <AudioButton src={t.src} label="试听" /> : <span className="text-white/25">无音频</span>}
            </div>
          ))}
          {shown.length === 0 && <p className="py-4 text-center text-white/35">没有符合筛选条件的曲目</p>}
        </div>
        {shown.some((t) => !t.usable && t.disabledReason) && <p className="mt-2 text-[11px] leading-4 text-amber-200/60">待核实/隔离原因：{[...new Set(shown.filter((t) => t.disabledReason).map((t) => t.disabledReason))].slice(0, 3).join("；")}</p>}
      </details>
      <div className="mt-4 space-y-3">
        {doc.music.map((cue, index) => { const track = tracks.find((t) => t.id === cue.trackId); const current = track && !track.usable ? track : null; const options = current ? [current, ...usable] : usable; return <div key={`${cue.fromLineId}-${index}`} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="flex items-center gap-2"><Select value={cue.trackId} onChange={(v) => updateCue(index, { trackId: v })} className="min-w-0 flex-1">{options.map((t) => <option key={t.id} value={t.id}>{t.title} · {t.moods.join("、")}{t.usable ? "" : `（${trackRightsLabel[t.rightsStatus]}，不参与自动选曲）`}</option>)}</Select><button className={`chip h-8 px-2.5 ${cue.locked ? "chip-on" : ""}`} onClick={() => updateCue(index, { locked: !cue.locked })}>{cue.locked ? "已锁定" : "锁定"}</button><button className="chip h-8 px-2.5" onClick={() => store.setDoc((d) => ({ ...d, music: d.music.filter((_, i) => i !== index) }))}>移除</button></div>
          {track && <div className="mt-2 flex items-center gap-3"><AudioButton src={track.src} label="试听配乐" /><span className="text-sm text-text-muted">{Math.round(track.durationMs / 1000)}s</span>{!track.usable && <span className={`rounded-full border px-2 py-0.5 text-[11px] ${trackRightsClass[track.rightsStatus]}`}>{trackRightsLabel[track.rightsStatus]}</span>}</div>}
          {cue.reason && <p className="mt-1 text-[11px] leading-4 text-white/35">{cue.reason}</p>}
        </div>; })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4"><button className="btn btn-ghost btn-sm" disabled={!first || !last || usable.length === 0} title={usable.length === 0 ? "没有已核实授权的可用曲目" : undefined} onClick={ensureCue}>添加配乐片段</button><div className="min-w-[220px] flex-1"><RangeField label="音量" value={doc.settings.music.gainDb} min={-24} max={6} step={1} suffix=" dB" onChange={(value) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, music: { ...d.settings.music, gainDb: value } } }))} /></div></div>
    </>}
  </section>;
}
