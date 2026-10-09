"use client";

// 配乐面板：从 bgm/ 扫到的曲目里选一首，铺满全片。

import { useEffect, useState } from "react";
import { Alert, AudioButton, Button, RangeField, Switch } from "@/components/ui";
import { coverWithTrack } from "@/lib/core/music";
import type { ProjectStore } from "./shared";

type Track = { id: string; title: string; src: string; durationMs: number };

function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function MusicPanel({ id, store }: { id: string; store: ProjectStore }) {
  const doc = store.doc;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/library/music", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`曲库扫描失败（${response.status}）`);
        return response.json() as Promise<{ tracks?: Track[]; problems?: string[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setTracks(data.tracks ?? []);
        setProblems(data.problems ?? []);
        setError("");
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "曲库扫描失败");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, reloadToken]);

  if (!doc) return null;
  const selectedId = doc.music[0]?.trackId ?? "";
  const selected = tracks.find((track) => track.id === selectedId);
  const missing = Boolean(selectedId) && !loading && !error && !selected;
  const hasLines = doc.lines.length > 0;
  const needle = query.trim().toLowerCase();
  const shown = tracks.filter((track) => !needle || `${track.title} ${track.id}`.toLowerCase().includes(needle));

  const choose = (trackId: string) => {
    store.setDoc((current) => ({ ...current, music: coverWithTrack(current.lines, trackId, current.music.find((cue) => cue.trackId === trackId)?.offsetMs ?? 0) }));
  };

  return <section className="panel p-5">
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="label">配乐</p>
        <h2 className="mt-1 text-base font-medium">背景音乐</h2>
      </div>
      <div className="flex items-center gap-3">
        <button className="chip h-8 px-2.5" type="button" onClick={() => { setLoading(true); setError(""); setReloadToken((n) => n + 1); }} disabled={loading}>{loading ? "扫描中" : "刷新"}</button>
        <label className="flex items-center gap-2 text-sm text-text-muted">启用 <Switch checked={doc.settings.music.enabled} label="启用配乐" onChange={(checked) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, music: { ...current.settings.music, enabled: checked } } }))} /></label>
      </div>
    </div>
    <p className="mt-2 text-xs leading-5 text-white/40">把 mp3、m4a、wav、aac、ogg、flac、opus 放进 bgm 文件夹。选中的一首会铺满全片，短于成片时自动循环。</p>
    {error && <Alert tone="danger" size="sm" className="mt-3">{error}</Alert>}
    {problems.length > 0 && <Alert tone="warn" size="sm" className="mt-3">{problems.join("；")}</Alert>}
    {missing && <Alert tone="warn" size="sm" className="mt-3" actions={<Button variant="ghost" size="sm" onClick={() => store.setDoc((current) => ({ ...current, music: [] }))}>清除选择</Button>}>已选的「{selectedId}」不在 bgm 文件夹里了，成片里不会播放这首。</Alert>}
    {doc.music.length > 1 && <Alert tone="info" size="sm" className="mt-3">这份稿子里还有按段落配的旧配乐。点选一首后，全片只使用这一首。</Alert>}
    {!hasLines && <p className="mt-3 text-xs text-white/40">还没有句子，试听可以，选曲要等句子生成之后。</p>}
    {tracks.length === 0 && !loading ? <p className="py-8 text-center text-sm text-white/35">bgm 文件夹里还没有音频。</p> : tracks.length > 0 && <>
      <input className="input mt-4 h-9 text-xs" placeholder="搜索曲名" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索曲名" />
      <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
        {shown.map((track) => {
          const on = track.id === selectedId && doc.music.length === 1;
          return <div key={track.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${on ? "border-accent/40 bg-accent/10" : "border-white/[0.05]"}`}>
            <button type="button" className="min-w-0 flex-1 truncate text-left" disabled={!hasLines} title={hasLines ? track.id : "还没有句子"} onClick={() => choose(track.id)} aria-pressed={on}>
              <span className="block truncate text-sm text-white/85">{track.title}</span>
              {track.id.includes("/") && <span className="block truncate text-[11px] text-white/35">{track.id}</span>}
            </button>
            <span className="shrink-0 text-white/40">{formatDuration(track.durationMs)}</span>
            {track.src ? <AudioButton src={track.src} label="试听" ariaLabel={`试听 ${track.title}`} channel="bgm" /> : <span className="text-white/25">无音频</span>}
            <button type="button" className={`chip h-7 px-2.5 ${on ? "chip-on" : ""}`} disabled={!hasLines} onClick={() => choose(track.id)}>{on ? "使用中" : "使用"}</button>
          </div>;
        })}
        {shown.length === 0 && <p className="py-4 text-center text-white/35">没有符合的曲目</p>}
      </div>
    </>}
    <div className="mt-4 min-w-[220px] max-w-md"><RangeField label="音量" value={doc.settings.music.gainDb} min={-24} max={6} step={1} suffix=" dB" onChange={(value) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, music: { ...current.settings.music, gainDb: value } } }))} /></div>
  </section>;
}
