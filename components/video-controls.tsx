"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { AudioButton, AutoTextarea, Field, Icon, RangeField, Select, Spinner, Switch } from "@/components/ui";
import { jobAction, postJson, type SaveState } from "@/lib/client";
import { mediaUrl } from "@/lib/core/types";
import { p1ShotKinds, shotKindLabels, shotSizeLabels, shotSizes, voiceTagChoices, type CardVariant, type Job, type MusicCue, type ProjectDoc, type Shot, type VoiceSettings, type VoiceTag } from "@/lib/core/types";
import { newId } from "@/lib/core/sync";
import { stampShots } from "@/lib/core/shots";
import { assetStale, compileShotPrompt, MAX_SHOT_CHARACTERS, needsGeneratedImage, type CompiledPrompt } from "@/lib/core/prompt-compiler";
import { useFeedback } from "@/components/feedback";
import type { Timeline } from "@/lib/core/timeline";
import type { TimelineShot } from "@/lib/core/timeline";
import { lineSpeech, ttsRequestForLine } from "@/lib/core/keys";
import { cleanSelectedWord } from "@/lib/selection";

const ShotThumbnail = dynamic(() => import("./shot-thumbnail").then((m) => m.ShotThumbnail), { ssr: false, loading: () => <div className="grid h-full place-items-center bg-[#17242c] text-xs text-white/40">正在加载预览</div> });

type ProjectStore = {
  doc: ProjectDoc | null;
  setDoc: (fn: (doc: ProjectDoc) => ProjectDoc) => void;
  save: SaveState;
  flush: () => Promise<unknown>;
};

type LineInfo = {
  id: string;
  spoken: string;
  audio: { src: string; startMs: number; endMs: number; aligned: boolean } | null;
  job: { id: string; status: string; error: string | null } | null;
};

export function SentencePanel({ id, store, jobs, onChanged, onSeek }: { id: string; store: ProjectStore; jobs?: Map<string, Job>; onChanged?: () => void; onSeek?: (lineId: string) => void }) {
  const [lines, setLines] = useState<LineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [lexWord, setLexWord] = useState("");
  const [lexSay, setLexSay] = useState("");
  const [lexBusy, setLexBusy] = useState(false);
  const [error, setError] = useState("");
  const [lexOpen, setLexOpen] = useState(false);
  const [selectionPoint, setSelectionPoint] = useState({ x: 0, y: 0 });
  const [previewSrc, setPreviewSrc] = useState("");
  const [batchBusy, setBatchBusy] = useState<"all" | "missing" | null>(null);
  const { confirm, toast } = useFeedback();
  const ttsExpressionRevision = store.doc?.lines.map((line) => `${line.id}:${line.mood ?? ""}:${line.voiceTag ?? "auto"}`).join("|") ?? "";
  const voiceSettings = store.doc?.settings.voice;
  const supportsEmotionTags = voiceSettings?.model.startsWith("qwen-audio-") ?? false;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}/lines`, { cache: "no-store" });
      const data = (await res.json()) as { lines?: LineInfo[]; error?: string };
      if (!res.ok) throw new Error(data.error || "读取句子失败");
      setLines(data.lines ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  const ttsJobRevision = jobs ? [...jobs.values()].filter((job) => job.stage === "tts").map((job) => `${job.id}:${job.status}`).sort().join("|") : "";

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();
  }, [refresh, store.doc?.lines.length, ttsExpressionRevision, voiceSettings?.model, voiceSettings?.voiceId, voiceSettings?.rate, voiceSettings?.pitch, voiceSettings?.volume, voiceSettings?.instruction, ttsJobRevision]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggleLock = (lineId: string) => {
    store.setDoc((doc) => ({ ...doc, lines: doc.lines.map((l) => (l.id === lineId ? { ...l, locked: !l.locked } : l)) }));
  };

  const updateVoiceTag = (lineId: string, voiceTag: VoiceTag) => {
    store.setDoc((doc) => ({ ...doc, lines: doc.lines.map((line) => (line.id === lineId ? { ...line, voiceTag } : line)) }));
  };

  async function revoice(lineId: string) {
    setError("");
    try {
      if ((await store.flush()) == null) throw new Error("句子设置保存失败，请重试");
      await postJson(`/api/projects/${id}/lines/${lineId}`, {});
      onChanged?.();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function batchRevoice(mode: "all" | "missing") {
    const count = lines.length;
    if (!count) return;
    const label = mode === "all" ? "全部重录" : "补齐缺失配音";
    if (!(await confirm({ title: `${label}？`, message: mode === "all" ? `将按当前音色重新生成 ${count} 句配音。已有音频会在新音频成功后逐句替换，费用由配音服务商收取。` : "只会生成还没有配音的句子，已有音频不会重复计费。", confirmLabel: "开始生成", tone: mode === "all" ? "danger" : "default" }))) return;
    setBatchBusy(mode);
    setError("");
    try {
      if ((await store.flush()) == null) throw new Error("项目设置保存失败，请重试");
      const result = await postJson<{ count: number }>(`/api/projects/${id}/lines/tts`, { mode });
      toast(`已排队 ${result.count} 句配音`, "success");
      onChanged?.();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(null);
    }
  }

  async function addLexicon() {
    if (!selected || !lexWord.trim() || !lexSay.trim()) return;
    setLexBusy(true);
    setError("");
    try {
      await postJson("/api/lexicon", { scope: id, word: lexWord.trim(), say: lexSay.trim() });
      setLexOpen(false);
      setLexWord("");
      setLexSay("");
      setError("词典已保存，正在重新排队本句配音…");
      try {
        await postJson(`/api/projects/${id}/lines/${selected}`, {});
        onChanged?.();
        await refresh();
        setError("");
      } catch { setError("词典已保存，但本句重新配音排队失败。请点击本句“重录”重试。"); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLexBusy(false);
    }
  }

  function captureSelection(lineId: string, element: HTMLParagraphElement) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
    const word = cleanSelectedWord(selection.toString());
    if (!word) return;
    const rect = range.getBoundingClientRect();
    setSelected(lineId);
    setLexWord(word);
    setLexSay(word);
    setSelectionPoint({ x: Math.min(rect.left, window.innerWidth - 145), y: Math.min(rect.bottom + 8, window.innerHeight - 48) });
    setLexOpen(false);
  }

  async function previewLexicon() {
    const line = store.doc?.lines.find((l) => l.id === selected);
    if (!line || !lexWord.trim() || !lexSay.trim()) return;
    setLexBusy(true);
    try {
      const rows = await fetch(`/api/lexicon?projectId=${encodeURIComponent(id)}`).then((r) => r.json()) as { scope: string; word: string; say: string }[];
      const entries = new Map(rows.sort((a, b) => Number(a.scope === id) - Number(b.scope === id)).map((r) => [r.word, r.say]));
      entries.set(lexWord.trim(), lexSay.trim());
      const text = lineSpeech(line, [...entries].map(([word, say]) => ({ word, say }))).spoken;
      const preview = ttsRequestForLine(text, line, store.doc!.settings.voice.model);
      const { src } = await postJson<{ src: string }>("/api/voices/preview", { voice: store.doc!.settings.voice, text: preview.text, textType: preview.textType });
      setPreviewSrc(src);
      new Audio(src).play().catch(() => setError("试听播放失败"));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLexBusy(false); }
  }

  const lineById = new Map(store.doc?.lines.map((l) => [l.id, l]) ?? []);
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label">句子</p>
          <h2 className="mt-1 text-base font-medium">句子与配音</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-white/35">{lines.length} 句</span>
          <button className="btn btn-ghost btn-sm" disabled={!!batchBusy || !lines.length} onClick={() => batchRevoice("missing")}>{batchBusy === "missing" ? <Spinner className="size-3" /> : null}补齐缺失</button>
          <button className="btn btn-ghost btn-sm" disabled={!!batchBusy || !lines.length} onClick={() => batchRevoice("all")}>{batchBusy === "all" ? <Spinner className="size-3" /> : null}全部重录</button>
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-red-300/80">{error}</p>}
      {loading ? (
        <div className="flex justify-center py-8 text-white/40"><Spinner /></div>
      ) : lines.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/35">先在文案页生成稿件</p>
      ) : (
        <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {lines.map((item, index) => {
            const line = lineById.get(item.id);
            if (!line) return null;
            const open = selected === item.id;
            return (
              <div key={item.id} className={`rounded-xl border p-3 ${open ? "border-accent/30 bg-accent/[0.04]" : "border-white/[0.07] bg-white/[0.02]"}`}>
                <div className="flex items-start gap-3">
                  <span className="pt-0.5 text-[11px] tabular-nums text-white/30">{String(index + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1 text-left">
                    <p tabIndex={0} className="select-text text-sm leading-6 text-white/85" onMouseUp={(e) => captureSelection(item.id, e.currentTarget)} onTouchEnd={(e) => captureSelection(item.id, e.currentTarget)} onKeyUp={(e) => captureSelection(item.id, e.currentTarget)}>{line.text}</p>
                    <p className="mt-1 truncate text-xs text-white/35">朗读：{item.spoken}</p>
                    <button className="mt-1 text-xs text-white/45 hover:text-white" onClick={() => { setSelected(open ? null : item.id); onSeek?.(item.id); }}>定位句子</button>
                  </div>
                  <button className={`chip h-7 px-2.5 ${line.locked ? "chip-on" : ""}`} title={line.locked ? "解锁句子" : "锁定句子"} onClick={() => toggleLock(line.id)}>
                    {line.locked ? "已锁定" : "锁定"}
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 pl-7">
                  {item.audio ? <AudioButton src={item.audio.src} startMs={item.audio.startMs} endMs={item.audio.endMs} /> : <span className="text-sm text-amber-200/80">未配音</span>}
                  {item.job && <span className="text-xs text-white/35">{item.job.status === "running" ? "合成中" : item.job.status === "queued" ? "排队中" : item.job.error || item.job.status}</span>}
                  <button className="chip h-7 px-2.5" onClick={() => revoice(item.id)}>重录</button>
                </div>
                {open && (
                  <div className="mt-3 ml-7 border-t border-white/[0.06] pt-3">
                    <div className="grid gap-2 sm:grid-cols-[minmax(180px,240px)_1fr] sm:items-end">
                      <label className="block space-y-1.5">
                        <span className="label">旁白表达</span>
                        <select className="input h-8 py-1.5 text-xs" value={line.voiceTag ?? "auto"} disabled={!supportsEmotionTags} onChange={(event) => updateVoiceTag(line.id, event.target.value as VoiceTag)}>
                          {voiceTagChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                        </select>
                      </label>
                        <p className="pb-1 text-[11px] leading-5 text-white/40">{supportsEmotionTags ? line.voiceTag?.startsWith("ssml:") ? "SSML 只调节句内停顿；本句不叠加情绪标签或全局表达指令。点击「重录」试听。" : `句子情绪：${line.mood ?? "未标注"}；修改后点击本句「重录」生效。` : "切换到 Qwen-Audio 模型后可设置逐句情绪和 SSML 停顿。"}</p>
                    </div>
                    <button className="mb-2 text-xs text-white/55 hover:text-white" onClick={() => { setLexOpen(true); setLexWord(""); setLexSay(""); }}>添加词典规则</button>
                    {lexOpen && <>
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <input className="input h-8 py-1.5 text-xs" value={lexWord} onChange={(e) => setLexWord(e.target.value)} placeholder="词语" />
                      <input className="input h-8 py-1.5 text-xs" value={lexSay} onChange={(e) => setLexSay(e.target.value)} placeholder="朗读为" />
                      <button className="chip h-8" disabled={lexBusy || !lexWord.trim() || !lexSay.trim()} onClick={addLexicon}>{lexBusy ? <Spinner className="size-3" /> : "保存"}</button>
                    </div>
                    <div className="mt-2 flex gap-3"><button className="text-xs text-white/60" disabled={lexBusy} onClick={previewLexicon}>试听整句</button><button className="text-xs text-white/40" onClick={() => { setLexOpen(false); setLexWord(""); }}>取消</button></div>
                    <p className="mt-2 text-[11px] text-white/45">该规则会作用于本项目中出现的同名词语。字幕原文不变。</p>
                    {previewSrc && <audio className="sr-only" src={previewSrc} />}
                    </>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {selected && lexWord && !lexOpen && <button className="fixed z-50 rounded bg-white px-3 py-2 text-xs font-medium text-black shadow-xl max-sm:!top-auto max-sm:bottom-4 max-sm:!left-1/2 max-sm:-translate-x-1/2" style={{ left: selectionPoint.x, top: selectionPoint.y }} onMouseDown={(e) => e.preventDefault()} onClick={() => setLexOpen(true)}>设置读法</button>}
    </section>
  );
}

function shotUpdate(store: ProjectStore, id: string, fn: (shot: Shot) => Shot) {
  store.setDoc((doc) => ({ ...doc, shots: stampShots(doc.shots.map((s) => (s.id === id ? fn(s) : s)), doc.lines) }));
}

export function StoryboardPanel({ id, store, timeline, jobs, onSeek }: { id: string; store: ProjectStore; timeline: Timeline | null; jobs: Map<string, Job>; onSeek: (ms: number) => void }) {
  const doc = store.doc;
  const { confirm } = useFeedback();
  const [uploading, setUploading] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [candidateCount, setCandidateCount] = useState(1);
  const [imageModels, setImageModels] = useState<{ id: string; label: string }[]>([]);
  const [imageModelId, setImageModelId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);
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

  async function generateAll() {
    if (!imageModelId || remaining === 0) return;
    const detail = [missing && `缺图 ${missing} 个`, stale && `已过期 ${stale} 个`].filter(Boolean).join("、");
    const styleNote = doc?.visualStyle ? `画面风格：${doc.visualStyle.name}。` : "还没有选择画面风格，将自动采用推荐风格（可在「画面风格」里修改）。";
    if (!(await confirm({ title: "生成缺失和过期的图片？", message: `将为 ${remaining} 个镜头（${detail}）提交 ${remaining * candidateCount} 张图片生成请求，费用由图片服务商收取。${styleNote}`, confirmLabel: "开始生成" }))) return;
    setBulkBusy(true);
    setErrors((current) => ({ ...current, bulk: "" }));
    try {
      await store.flush();
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId: imageModelId, candidateCount }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "提交批量任务失败");
    } catch (cause) { setErrors((current) => ({ ...current, bulk: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setBulkBusy(false); }
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
      await store.flush();
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
    store.setDoc((d) => ({ ...d, shots: stampShots([...d.shots, { ...shot, id: newId(), at: { lineId: next.id, char: 0 }, locked: false }], d.lines) }));
  }

  function merge(shot: Shot) {
    const index = ordered.findIndex((s) => s.id === shot.id);
    const next = ordered[index + 1];
    if (!next || next.locked) return;
    store.setDoc((d) => ({ ...d, shots: stampShots(d.shots.filter((s) => s.id !== next.id), d.lines) }));
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
        <label className="sr-only" htmlFor="image-model">生图模型</label><select id="image-model" className="w-full min-w-0 flex-1 basis-full rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-xs text-white/80 outline-none focus:border-accent/50 sm:basis-auto" value={imageModelId} onChange={(event) => setImageModelId(event.target.value)}><option value="">{imageModels.length ? "选择生图模型" : "暂无可用生图模型"}</option>{imageModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select>
        <label className="sr-only" htmlFor="candidate-count">每镜候选数</label><select id="candidate-count" className="rounded-md border border-white/10 bg-[#151515] px-3 py-2 text-xs text-white/80 outline-none" value={candidateCount} onChange={(event) => setCandidateCount(Number(event.target.value))}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} 张/镜</option>)}</select>
        <button className="btn btn-primary btn-sm" disabled={!imageModelId || !remaining || bulkBusy || activeImages > 0} onClick={generateAll}>{bulkBusy ? <Spinner className="size-3.5" /> : <Icon name="sparkle" className="size-3.5" />}全量生成图片</button>
      </div>
      {errors.bulk && <p className="mt-2 text-xs text-red-300">{errors.bulk}</p>}
      {ordered.length === 0 ? <p className="py-8 text-center text-sm text-white/35">配音完成后会自动生成分镜</p> : <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map((shot, index) => {
          const timed = timeline?.shots.find((item) => item.shotId === shot.id);
          const job = [...jobs.values()].findLast((item) => item.stage === "shot-generate" && item.target === `镜头 ${shot.id}`);
          return <ShotCard key={shot.id} shot={shot} timed={timed} timeline={timeline} index={index} active={active === shot.id} lineIndex={lineIndex.get(shot.at.lineId) ?? 0} lineIds={doc.lines.map((l) => l.id)} estimated={timeline?.lines.some((l) => l.estimated) ?? true} store={store} error={errors[shot.id]} job={job} uploading={uploading === shot.id} generating={generating === shot.id} imageReady={!!imageModelId} canMerge={index < ordered.length - 1 && !ordered[index + 1]?.locked} onSelect={() => { setActive(shot.id); if (timed) onSeek(timed.startMs); }} onUpload={(file) => upload(shot, file)} onGenerate={() => generate(shot)} onCandidate={(candidateId) => selectCandidate(shot, candidateId)} onSplit={() => split(shot)} onMerge={() => merge(shot)} />;
        })}
      </div>}
    </section>
  );
}

function ShotCard({ shot, timed, timeline, index, lineIndex, lineIds, estimated, active, store, error, job, uploading, generating, imageReady, canMerge, onSelect, onUpload, onGenerate, onCandidate, onSplit, onMerge }: {
  shot: Shot; timed?: TimelineShot; timeline: Timeline | null; index: number; lineIndex: number; lineIds: string[]; estimated: boolean; active: boolean; store: ProjectStore; error?: string; job?: Job; uploading: boolean; generating: boolean; imageReady: boolean; canMerge: boolean;
  onSelect: () => void; onUpload: (file: File) => void; onGenerate: () => void; onCandidate: (id: string) => void; onSplit: () => void; onMerge: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (active) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [active]);
  const covered = timed && timeline ? timeline.lines.filter((l) => l.endMs > timed.startMs && l.startMs < timed.endMs).map((l) => lineIds.indexOf(l.id) + 1).filter((i) => i > 0) : [];
  const time = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const wantsImage = needsGeneratedImage(shot);
  const compiled = wantsImage && store.doc ? compileShotPrompt(store.doc, shot) : null;
  const stale = !!store.doc && assetStale(store.doc, shot);
  const runningJob = job?.status === "queued" || job?.status === "running";
  const hasImage = !!shot.assetId;
  const status = job?.status === "failed" ? "failed" : job?.status === "canceled" ? "canceled" : runningJob ? (job.status === "queued" ? "queued" : "running") : job?.status === "succeeded" && hasImage ? "done" : "idle";
  const statusLabel = { queued: "排队中", running: `生成中 · ${Math.round((job?.progress ?? 0) * 100)}%`, done: "已完成", failed: "生成失败", canceled: "已取消", idle: hasImage ? "已有图片" : "待生成" }[status];
  return <div ref={cardRef} className={`min-w-0 rounded-lg border bg-white/[0.02] p-3 transition-colors ${active ? "border-white" : status === "running" ? "border-accent/60 generation-card-running" : status === "queued" ? "border-amber-200/30" : status === "failed" ? "border-red-400/35" : status === "done" ? "border-accent/20" : "border-white/[0.07]"}`}>
    <div className="flex items-center justify-between gap-2"><button className="min-w-0 truncate text-left text-xs text-white/75 hover:text-white" onClick={onSelect}>镜头 {index + 1} · {timed ? `${time(timed.startMs)}–${time(timed.endMs)}` : "计算中"} · {covered.length ? `第 ${covered[0]}${covered.length > 1 ? `–${covered.at(-1)}` : ""} 句` : `第 ${lineIndex + 1} 句`}{estimated ? " · 估算" : ""}</button><button className={`chip h-7 px-2.5 ${shot.locked ? "chip-on" : ""}`} onClick={() => shotUpdate(store, shot.id, (s) => ({ ...s, locked: !s.locked }))}>{shot.locked ? "已锁定" : "锁定"}</button></div>
    <button className={`relative mt-2 block w-full overflow-hidden rounded-md border bg-[#17242c] text-left ${status === "running" ? "border-accent/50" : status === "queued" ? "border-amber-200/25" : status === "failed" ? "border-red-400/35" : "border-white/10"}`} style={{ aspectRatio: timeline ? `${timeline.width} / ${timeline.height}` : "16 / 9" }} onClick={onSelect} aria-label={`跳转到镜头 ${index + 1}`}>
      <span className="absolute inset-0 block">{shot.assetId && shot.kind === "video" ? <video key={shot.assetId} muted playsInline preload="metadata" src={mediaUrl(shot.assetId)} className={`h-full w-full object-cover ${status === "done" ? "generation-image-complete" : ""}`} /> : shot.assetId ? <Image key={shot.assetId} src={mediaUrl(shot.assetId)} alt="" fill sizes="(max-width: 640px) 100vw, 320px" unoptimized className={`object-cover ${status === "done" ? "generation-image-complete" : ""}`} /> : timed && timeline ? <ShotThumbnail shot={timed} width={timeline.width} height={timeline.height} fps={timeline.fps} theme={timeline.theme} /> : <span className="grid h-full place-items-center text-xs text-white/40">正在加载预览</span>}</span>
      {runningJob && <span className="pointer-events-none absolute inset-0 bg-black/25" />}
      {runningJob && <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-accent/35 bg-black/65 px-2 py-1 text-[10px] text-accent backdrop-blur"><span className="generation-live-dot size-1.5 rounded-full bg-accent" />{statusLabel}</span>}
      {status === "queued" && <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded bg-black/65 px-2 py-1 text-[10px] text-amber-100/85 backdrop-blur">等待空闲并发</span>}
      {status === "failed" && <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded bg-red-950/80 px-2 py-1 text-[10px] text-red-100 backdrop-blur">生成失败 · 可重试</span>}
      {runningJob && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/45"><span className="block h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round((job?.progress ?? 0) * 100)}%` }} /></span>}
    </button>
    <p className="mt-2 line-clamp-2 min-h-9 text-xs leading-5 text-white/55">{timed?.caption || "暂无覆盖句子"}</p>
    <p className="mt-1.5 text-[11px] text-white/40">{shotExpression(shot, timed)}</p>
    {wantsImage && store.doc && shot.characterIds.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{shot.characterIds.map((cid) => store.doc!.characters.find((c) => c.id === cid)).filter(Boolean).map((c) => <span key={c!.id} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/60">{c!.name}</span>)}</p>}
    {shot.intent && <p className="mt-1 text-xs leading-5 text-white/70" title="导演意图：观众此刻应该看到或感受到什么"><span className="text-white/40">意图 · </span>{shot.intent}</p>}
    {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    {generating && <p className="mt-2 flex items-center gap-1.5 text-xs text-accent"><span className="generation-live-dot size-1.5 rounded-full bg-accent" />正在提交生成任务…</p>}
    {job && (job.status === "queued" || job.status === "running") && <p className="mt-2 flex items-center gap-1.5 text-xs text-accent"><span className="generation-live-dot size-1.5 rounded-full bg-accent" />{statusLabel}{job.message ? ` · ${job.message}` : ""}</p>}
    {job?.status === "succeeded" && shot.assetId && <p className="mt-2 text-xs text-accent/75">图片已就绪，可在预览区播放</p>}
    {job?.status === "failed" && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><p className="text-red-300">{job.error || "生成失败"}</p><button className="chip h-6 px-2.5 text-[11px]" onClick={() => jobAction(job.id, "retry")}>重试</button></div>}
    {job?.status === "canceled" && <p className="mt-2 text-xs text-white/45">任务已取消，可重新生成</p>}
    {wantsImage && !shot.assetId && !generating && <p className="mt-2 text-xs text-amber-200/70">暂无素材，使用占位画面</p>}
    {stale && <p className="mt-2 text-xs text-amber-200/80">画面描述或风格已改，图片已过期</p>}
    <AutoTextarea value={shot.description} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, description: e.target.value }))} className="input mt-2 min-h-16 text-xs" placeholder="画面描述" />
    {wantsImage && <button className="btn btn-ghost btn-sm mt-2" disabled={generating || shot.locked || !imageReady || job?.status === "queued" || job?.status === "running"} onClick={onGenerate}>{generating ? <Spinner className="size-3" /> : <Icon name="sparkle" className="size-3.5" />}{shot.assetId ? "重新生成图片" : "生成图片"}</button>}
    {(shot.kind === "image" || shot.kind === "video") && <>
      {shot.candidates.length > 0 && <div className="mt-2 grid grid-cols-4 gap-1.5">{shot.candidates.map((candidate) => <button key={candidate.id} className={`overflow-hidden rounded border ${candidate.selected ? "border-accent" : "border-white/10"}`} title="选择候选" onClick={() => onCandidate(candidate.id)}>{shot.kind === "video" ? <video muted preload="metadata" src={mediaUrl(candidate.assetId)} className="aspect-video w-full object-cover" /> : <Image src={mediaUrl(candidate.assetId)} alt="" width={96} height={64} unoptimized className="aspect-video w-full object-cover" />}</button>)}</div>}
    </>}
    <div className="mt-3 flex flex-wrap items-center gap-2"><label className="chip h-7 cursor-pointer px-2.5">{uploading ? <Spinner className="size-3" /> : "上传图片"}<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} /></label><button className="chip h-7 px-2.5" onClick={onSplit}>拆分</button><button className="chip h-7 px-2.5" disabled={!canMerge} onClick={onMerge}>合并下一镜</button></div>
    <details className="mt-3 border-t border-white/10 pt-2 text-xs text-white/50"><summary className="cursor-pointer">高级</summary><div className="mt-2 grid gap-2"><Select value={shot.kind} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, kind: v as Shot["kind"] }))}>{[...p1ShotKinds, "image", "video"].map((kind) => <option key={kind} value={kind}>{shotKindLabels[kind as Shot["kind"]]}</option>)}</Select><Select value={shot.motion} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, motion: v as Shot["motion"] }))}><option value="zoom-in">推进</option><option value="zoom-out">拉远</option><option value="pan-left">左移</option><option value="pan-right">右移</option><option value="none">静止</option></Select><Select value={shot.mode === "motion" ? "motion" : "generate"} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, mode: v as Shot["mode"], shotSize: v === "generate" ? (s.shotSize ?? "medium") : s.shotSize }))}><option value="generate">生成画面</option><option value="motion">信息卡（代码动画）</option></Select>{shot.mode !== "motion" && <Select value={shot.shotSize ?? "medium"} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, shotSize: v as Shot["shotSize"] }))}>{shotSizes.map((size) => <option key={size} value={size}>{shotSizeLabels[size]}</option>)}</Select>}<input className="input h-8 py-1.5 text-xs" value={shot.onScreenText ?? ""} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, onScreenText: e.target.value || undefined }))} placeholder="屏幕文字" />{wantsImage && <><AutoTextarea value={shot.prompt ?? ""} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, prompt: e.target.value || undefined }))} className="input min-h-12 text-xs" placeholder="自定义画面内容（留空用画面描述；画面风格仍会自动加上）" /><input className="input h-8 py-1.5 text-xs" type="number" min={0} value={shot.seed ?? ""} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, seed: e.target.value === "" ? undefined : Number(e.target.value) }))} placeholder="seed" />{store.doc && store.doc.characters.some((c) => !c.absent) && <div className="space-y-1"><p className="text-[11px] text-white/40">画面里的角色（最多 {MAX_SHOT_CHARACTERS} 个；外貌自动从角色卡加入）</p><div className="flex flex-wrap gap-1.5">{store.doc.characters.filter((c) => !c.absent || shot.characterIds.includes(c.id)).map((c) => { const on = shot.characterIds.includes(c.id); return <button key={c.id} type="button" className={`chip h-7 px-2.5 ${on ? "chip-on" : ""}`} disabled={!on && shot.characterIds.length >= MAX_SHOT_CHARACTERS} onClick={() => shotUpdate(store, shot.id, (s) => ({ ...s, characterIds: on ? s.characterIds.filter((x) => x !== c.id) : [...s.characterIds, c.id] }))}>{c.name}</button>; })}</div></div>}{compiled && <PromptSlots compiled={compiled} />}</>}</div></details>
  </div>;
}

type Track = { id: string; title: string; src: string; moods: string[]; durationMs: number; license: string; source: string };

export function MusicPanel({ id, store }: { id: string; store: ProjectStore }) {
  const doc = store.doc;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/library/music", { cache: "no-store" }).then((r) => r.json()).then((d) => { setTracks(d.tracks ?? []); setProblems(d.problems ?? []); });
  }, [id]);
  if (!doc) return null;
  const first = doc.lines[0]?.id;
  const last = doc.lines.at(-1)?.id;
  const ensureCue = () => {
    if (!first || !last || tracks.length === 0) return;
    store.setDoc((d) => ({ ...d, music: d.music.length ? d.music : [{ trackId: tracks[0].id, fromLineId: first, toLineId: last, mood: "中性", offsetMs: 0, locked: false }] }));
  };
  const updateCue = (index: number, patch: Partial<MusicCue>) => store.setDoc((d) => ({ ...d, music: d.music.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  return <section className="panel p-5">
    <div className="flex items-center justify-between gap-3"><div><p className="label">配乐</p><h2 className="mt-1 text-base font-medium">配乐</h2></div><label className="flex items-center gap-2 text-sm text-text-muted">启用 <Switch checked={doc.settings.music.enabled} label="启用配乐" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, music: { ...d.settings.music, enabled: checked } } }))} /></label></div>
    {problems.length > 0 && <p className="mt-3 text-xs leading-5 text-amber-200/65">{problems.join("；")}</p>}
    {tracks.length === 0 ? <p className="py-8 text-center text-sm text-white/35">曲库尚未导入。运行 npm run library:ingest。</p> : <>
      <div className="mt-4 space-y-3">
        {doc.music.map((cue, index) => { const track = tracks.find((t) => t.id === cue.trackId); return <div key={`${cue.fromLineId}-${index}`} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="flex items-center gap-2"><Select value={cue.trackId} onChange={(v) => updateCue(index, { trackId: v })} className="min-w-0 flex-1">{tracks.map((t) => <option key={t.id} value={t.id}>{t.title} · {t.moods.join("、")}</option>)}</Select><button className={`chip h-8 px-2.5 ${cue.locked ? "chip-on" : ""}`} onClick={() => updateCue(index, { locked: !cue.locked })}>{cue.locked ? "已锁定" : "锁定"}</button><button className="chip h-8 px-2.5" onClick={() => store.setDoc((d) => ({ ...d, music: d.music.filter((_, i) => i !== index) }))}>移除</button></div>
          {track && <div className="mt-2 flex items-center gap-3"><AudioButton src={track.src} label="试听配乐" /><span className="text-sm text-text-muted">{Math.round(track.durationMs / 1000)}s</span></div>}
        </div>; })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4"><button className="btn btn-ghost btn-sm" disabled={!first || !last} onClick={ensureCue}>添加配乐片段</button><div className="min-w-[220px] flex-1"><RangeField label="音量" value={doc.settings.music.gainDb} min={-24} max={6} step={1} suffix=" dB" onChange={(value) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, music: { ...d.settings.music, gainDb: value } } }))} /></div></div>
    </>}
  </section>;
}

type VoiceCatalog = { providers: { models: { id: string; label: string; configured?: boolean; configurationHint?: string; capabilities?: string[]; voices: { id: string; name: string; gender: string; style: string; timestamps: boolean; instruct?: boolean; ssml?: boolean; emotionTags?: boolean }[] }[] }[] };

export function SettingsPanel({ id, store }: { id: string; store: ProjectStore }) {
  const doc = store.doc;
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const { confirm, toast } = useFeedback();
  useEffect(() => { fetch("/api/voices").then((r) => r.json()).then(setCatalog).catch(() => setCatalog(null)); }, []);
  if (!doc) return null;
  const projectDoc = doc;
  const models = catalog?.providers.flatMap((p) => p.models) ?? [];
  const currentModel = models.find((m) => m.id === doc.settings.voice.model) ?? models[0];
  const voices = currentModel?.voices ?? [];
  const voice = doc.settings.voice;
  const updateVoice = (patch: Partial<VoiceSettings>) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, voice: { ...d.settings.voice, ...patch } } }));
  async function changeVoice(patch: Partial<VoiceSettings>) {
    const changed = Object.entries(patch).some(([key, value]) => voice[key as keyof VoiceSettings] !== value);
    const voicedLines = projectDoc.lines.length;
    if (changed && voicedLines > 0 && !(await confirm({ title: "更换音色并重新配音？", message: `当前已有 ${voicedLines} 句配音。更换音色后这些配音会失效，并按新音色重新排队。`, confirmLabel: "更换并重录", tone: "danger" }))) return;
    updateVoice(patch);
    if (changed && voicedLines > 0) {
      try {
        if ((await store.flush()) == null) throw new Error("音色设置保存失败，请重试");
        const result = await postJson<{ count: number }>(`/api/projects/${id}/lines/tts`, { mode: "all" });
        toast(`已按新音色排队 ${result.count} 句配音`, "success");
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), "error");
      }
    }
  }
  async function previewVoice() {
    setPreviewing(true);
    try {
      const result = await postJson<{ src: string }>("/api/voices/preview", { voice });
      setPreview(result.src);
      window.setTimeout(() => (document.getElementById("voice-preview") as HTMLAudioElement | null)?.play().catch(() => undefined), 0);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setPreviewing(false);
    }
  }
  async function toggleAiLabel(enabled: boolean) {
    if (!enabled && !(await confirm({ title: "关闭 AI 生成标识？", message: "部分发布平台要求保留 AI 生成标识，请确认你仍要关闭。", confirmLabel: "关闭标识", tone: "danger" }))) return;
    store.setDoc((d) => ({ ...d, settings: { ...d.settings, aiLabel: { ...d.settings.aiLabel, enabled } } }));
  }
  return <section className="panel p-5"><div className="flex items-center justify-between gap-3"><div><p className="label">设置</p><h2 className="mt-1 text-base font-medium">制作设置</h2></div><span className="text-sm text-text-muted">{store.save === "saving" ? "保存中" : store.save === "saved" ? "已保存" : ""}</span></div>
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <Field label="音色模型"><Select value={doc.settings.voice.model} onChange={(v) => { const m = models.find((x) => x.id === v); void changeVoice({ model: v, voiceId: m?.voices[0]?.id ?? doc.settings.voice.voiceId }); }}><option value={doc.settings.voice.model}>{currentModel?.label ?? doc.settings.voice.model}{currentModel && !currentModel.configured ? `（${currentModel.configurationHint ?? "待配置"}）` : ""}</option>{models.filter((m) => m.id !== doc.settings.voice.model).map((m) => <option key={m.id} value={m.id} disabled={m.configured === false}>{m.label}{m.configured === false ? `（${m.configurationHint ?? "待配置"}）` : ""}</option>)}</Select></Field>
      <Field label="音色"><div className="flex gap-2"><Select value={doc.settings.voice.voiceId} onChange={(v) => { void changeVoice({ voiceId: v }); }} className="min-w-0 flex-1">{voices.length ? voices.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.style}</option>) : <option value={doc.settings.voice.voiceId}>{doc.settings.voice.voiceId}</option>}</Select><button className="btn btn-ghost btn-sm" disabled={previewing} onClick={previewVoice}>{previewing ? <Spinner className="size-3" /> : "试听"}</button>{preview && <audio id="voice-preview" className="hidden" src={preview} />}</div></Field>
      <Field label="语速"><RangeField label="" value={doc.settings.voice.rate} min={0.5} max={2} step={0.05} suffix="x" onChange={(value) => updateVoice({ rate: value })} /></Field>
      <Field label="音量"><RangeField label="" value={doc.settings.voice.volume} min={0} max={100} step={1} suffix="" onChange={(value) => updateVoice({ volume: value })} /></Field>
      <Field label="旁白表达指令" hint="仅支持该能力的模型生效；修改后需重新配音"><AutoTextarea value={voice.instruction} onChange={(event) => updateVoice({ instruction: event.target.value })} className="input min-h-16 py-2 text-xs leading-5" placeholder="例如：沉稳、清晰，略带悬念的纪录片旁白表达" maxLength={500} /></Field>
      <Field label="预算（元）"><input className="input" type="number" min="0" step="1" value={doc.settings.budgetYuan ?? ""} onChange={(e) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, budgetYuan: e.target.value ? Number(e.target.value) : null } }))} placeholder="不设上限" /></Field>
      <Field label="AI 标识"><Select value={doc.settings.aiLabel.position} onChange={(v) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, aiLabel: { ...d.settings.aiLabel, enabled: true, position: v as "auto" | "top-left" | "top-right" } } }))}><option value="auto">自动位置</option><option value="top-left">左上角</option><option value="top-right">右上角</option></Select></Field>
    </div>
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 border-t border-white/[0.06] pt-4 text-sm text-text-muted"><label className="flex items-center gap-2">字幕 <Switch checked={doc.settings.subtitle.enabled} label="字幕" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, subtitle: { ...d.settings.subtitle, enabled: checked } } }))} /></label><label className="flex items-center gap-2">关键词高亮 <Switch checked={doc.settings.subtitle.highlight} label="关键词高亮" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, subtitle: { ...d.settings.subtitle, highlight: checked } } }))} /></label><label className="flex items-center gap-2">AI 生成标识 <Switch checked={doc.settings.aiLabel.enabled} label="AI 生成标识" onChange={(checked) => { void toggleAiLabel(checked); }} /></label><label className="flex items-center gap-2">转场音效 <Switch checked={doc.settings.sfx.enabled} label="转场音效" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, sfx: { enabled: checked } } }))} /></label><label className="flex items-center gap-2">样片后暂停 <Switch checked={doc.settings.pauseAfterPreview} label="样片后暂停" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, pauseAfterPreview: checked } }))} /></label></div>
  </section>;
}

const cardVariantLabels: Record<CardVariant, string> = { headline: "标题", stat: "数据", list: "要点", split: "对比", quote: "引语" };

/** 镜头卡上的表达方式标签：生成画面 · 景别 / 信息卡 · 版式 */
function shotExpression(shot: Shot, timed: TimelineShot | undefined) {
  if (shot.kind === "title" || shot.kind === "quote") return shotKindLabels[shot.kind];
  if (shot.mode === "motion") return `信息卡 · ${cardVariantLabels[(timed?.card ?? shot.card)?.variant ?? "headline"]}`;
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
