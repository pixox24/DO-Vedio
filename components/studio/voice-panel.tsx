"use client";

// 语音面板：模型与音色、手工添加的百炼音色参数（音色册）、语速与表达，以及应用前的费用确认和批量重录进度。

import { useEffect, useId, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { AutoTextarea, Button, Field, Icon, SegmentedControl, Select, Spinner } from "@/components/ui";
import { postJson } from "@/lib/client";
import { type VoiceSettings } from "@/lib/core/types";
import { voiceIdAfterModelChange, voiceNameError, voiceParamError } from "@/lib/core/voice-book";
import { costLabel } from "@/lib/core/interaction";
import { paragraphSupported } from "@/lib/core/blocks";
import { useFeedback } from "@/components/feedback";
import type { ProjectStore } from "./shared";

type CatalogVoice = {
  id: string;
  name: string;
  gender: string;
  style: string;
  timestamps: boolean;
  instruct?: boolean;
  ssml?: boolean;
  emotionTags?: boolean;
  customId?: string;
  probe?: "unknown" | "ok" | "failed";
  timestampSupport?: "unknown" | "yes" | "no";
  lastError?: string;
};

type CatalogModel = { id: string; label: string; configured?: boolean; configurationHint?: string; capabilities?: string[]; voices: CatalogVoice[] };
type VoiceCatalog = { providers: { id: string; label: string; models: CatalogModel[] }[] };
type VoiceChange = { status: "pending" | "applied"; voice: VoiceSettings; total: number; ready: number; missing: number; failed: number; revertible: boolean; batchId?: string };
type VoiceQuote = { total: number; existing: number; affected: number; reusable: number; generate: number; jobs: number; estimatedCostYuan: number | null; changed: boolean };
type Tone = "accent" | "muted" | "warn" | "danger" | "faint";

const DEFAULT_RATE = 1;
const DEFAULT_VOLUME = 50;
const granularityOptions = [
  { value: "line", label: "逐句" },
  { value: "paragraph", label: "整段" },
] as const;
const granularityLabel: Record<VoiceSettings["granularity"], string> = { line: "逐句", paragraph: "整段" };
const toneClass: Record<Tone, string> = {
  accent: "border-accent/30 bg-accent/10 text-accent",
  muted: "border-line text-text-muted",
  warn: "border-warn-border bg-warn-surface text-warn",
  danger: "border-danger-border bg-danger-surface text-danger",
  faint: "border-dashed border-line text-text-faint",
};

/** 字级时间戳状态：决定字幕按时间戳对齐，还是按字数估算 */
function timestampState(item: CatalogVoice): { tone: Tone; text: string } {
  if (item.customId) {
    if (item.probe === "failed") return { tone: "danger", text: "试听失败" };
    if (item.timestampSupport === "yes") return { tone: "accent", text: "字级时间戳已确认" };
    if (item.timestampSupport === "no") return { tone: "warn", text: "无字级时间戳" };
    return { tone: "faint", text: "待试听确认" };
  }
  return item.timestamps ? { tone: "muted", text: "字级时间戳" } : { tone: "warn", text: "无字级时间戳" };
}

/** 草稿与已保存设置的差异，用于底部应用条的摘要 */
function voiceDiff(catalog: VoiceCatalog | null, saved: VoiceSettings, next: VoiceSettings): string[] {
  const lookup = (s: VoiceSettings) => {
    const model = catalog?.providers.find((p) => p.id === s.provider)?.models.find((m) => m.id === s.model);
    return { model, voice: model?.voices.find((v) => v.id === s.voiceId) };
  };
  const items: string[] = [];
  if (saved.provider !== next.provider || saved.model !== next.model) items.push(`模型 ${lookup(next).model?.label ?? next.model}`);
  if (saved.voiceId !== next.voiceId) items.push(`音色 ${lookup(saved).voice?.name ?? (saved.voiceId || "未选")} → ${lookup(next).voice?.name ?? (next.voiceId || "未选")}`);
  if (saved.rate !== next.rate) items.push(`语速 ${saved.rate}x → ${next.rate}x`);
  if (saved.volume !== next.volume) items.push(`音量 ${saved.volume} → ${next.volume}`);
  if (saved.granularity !== next.granularity) items.push(`合成 ${granularityLabel[saved.granularity]} → ${granularityLabel[next.granularity]}`);
  if (saved.instruction !== next.instruction) items.push("表达已修改");
  return items;
}

/** 试听缓存只跟会影响合成结果的参数有关；改了它们，正在播的试听就不再代表当前设置 */
const previewKeyOf = (v: VoiceSettings) => JSON.stringify([v.provider, v.model, v.voiceId, v.rate, v.volume, v.instruction, v.google?.stylePrompt ?? ""]);

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-2xs ${toneClass[tone]}`}>{children}</span>;
}

/** 折叠区：用 grid 行高过渡展开，收起时 inert 让内容不可聚焦 */
function Collapse({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  return (
    <div id={id} inert={!open} className="grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none" style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}>
      <div className="min-h-0 overflow-hidden">
        {/* 留出焦点环的空间，否则 overflow 会把输入框的光圈裁掉 */}
        <div className="-m-1 p-1">{children}</div>
      </div>
    </div>
  );
}

function Disclosure({ label, summary, open, controls, onToggle }: { label: string; summary?: string; open: boolean; controls: string; onToggle: () => void }) {
  return (
    <button type="button" className="group flex w-full items-center justify-between gap-3 rounded-control py-1 text-left" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <span className="text-sm text-text-secondary transition group-hover:text-text">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-2xs text-text-muted">
        {summary && <span className="truncate tabular-nums">{summary}</span>}
        <Icon name="chevron" className={`size-3.5 shrink-0 transition-transform duration-300 ${open ? "rotate-180 text-accent" : ""}`} />
      </span>
    </button>
  );
}

function Slider({ label, value, min, max, step, defaultValue, format, disabled, onChange }: { label: string; value: number; min: number; max: number; step: number; defaultValue: number; format: (v: number) => string; disabled: boolean; onChange: (v: number) => void }) {
  const changed = value !== defaultValue;
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_4.5rem] items-center gap-3">
      <span className="text-sm text-text-secondary">{label}</span>
      <input type="range" aria-label={label} className="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
      <div className="flex items-center justify-end gap-0.5">
        <span className="text-sm tabular-nums text-text">{format(value)}</span>
        {/* 恢复默认按钮占位保留，出现时不挤动布局 */}
        <button type="button" className={`btn-text px-1 py-1 transition-opacity ${changed ? "opacity-100" : "pointer-events-none opacity-0"}`} aria-label={`${label}恢复默认`} tabIndex={changed ? 0 : -1} disabled={disabled} onClick={() => onChange(defaultValue)}>
          <Icon name="undo" className="size-3" />
        </button>
      </div>
    </div>
  );
}

type Props = {
  id: string;
  store: ProjectStore;
  draft: VoiceSettings | null;
  setDraft: Dispatch<SetStateAction<VoiceSettings | null>>;
  onChanged?: () => void;
  change: VoiceChange | null;
  setChange: (value: VoiceChange | null) => void;
  refreshChange: () => Promise<void>;
};

export function VoicePanel({ id, store, draft, setDraft, onChanged, change, setChange, refreshChange }: Props) {
  const doc = store.doc;
  const addId = useId();
  const expressionId = useId();
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playWhenReady = useRef(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceParam, setVoiceParam] = useState("");
  const [voiceName, setVoiceName] = useState("");
  const [bookError, setBookError] = useState("");
  const [bookBusy, setBookBusy] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [expressionOpen, setExpressionOpen] = useState<boolean | null>(null);
  const { confirm, toast } = useFeedback();
  const reloadCatalog = () => fetch("/api/voices").then((r) => r.json()).then(setCatalog).catch(() => setCatalog(null));
  useEffect(() => { void reloadCatalog(); }, []);
  const [quote, setQuote] = useState<VoiceQuote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const quoteCache = useRef(new Map<string, VoiceQuote>());
  /**
   * 成本前置：改了音色就自动取一次报价，让按钮上直接显示「几句 · 约多少钱」，
   * 用户不必点开弹窗才知道代价。300ms 防抖，避免拖动滑块时刷爆接口。
   * 依赖只用 draft / change（不涉及 doc）——它必须留在 `if (!doc) return null` 之前，
   * 否则 hook 调用数会在渲染之间变化。
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // 首次打开项目时 change 为空，但草稿仍然需要报价；只有正在应用中的
    // 切换不能再次报价，避免把 pending 状态误显示成可提交的新操作。
    if (!draft?.voiceId || change?.status === "pending") { setQuote(null); return; }
    let alive = true;
    const snapshot = draft;
    const cacheKey = JSON.stringify(snapshot);
    const cached = quoteCache.current.get(cacheKey);
    if (cached) {
      setQuote(cached);
      setQuoteBusy(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setQuoteBusy(true);
      postJson<VoiceQuote>(`/api/projects/${id}/voice-change`, { action: "quote", voice: snapshot })
        .then((q) => {
          quoteCache.current.set(cacheKey, q);
          if (alive) setQuote(q);
        })
        .catch(() => { if (alive) setQuote(null); })
        .finally(() => { if (alive) setQuoteBusy(false); });
    }, 300);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [draft, change, id]);
  /* eslint-enable react-hooks/set-state-in-effect */
  // 试听地址换了之后再播放；播放状态由 audio 事件驱动，这里不 setState
  useEffect(() => {
    if (!previewSrc || !playWhenReady.current) return;
    playWhenReady.current = false;
    void audioRef.current?.play().catch(() => undefined);
  }, [previewSrc]);
  if (!doc) return null;

  const saved = doc.settings.voice;
  const voice = draft ?? (change?.status === "pending" ? change.voice : saved);
  const pending = change?.status === "pending";
  const dirtyVoice = JSON.stringify(voice) !== JSON.stringify(saved);
  const currentProvider = catalog?.providers.find((p) => p.id === voice.provider);
  const models = currentProvider?.models ?? [];
  const currentModel = models.find((m) => m.id === voice.model) ?? models[0];
  const voices = currentModel?.voices ?? [];
  const selected = voices.find((item) => item.id === voice.voiceId);
  const customVoices = voices.filter((item) => item.customId);
  const canAddVoice = voice.provider === "dashscope" && (currentModel?.configured === true || customVoices.length > 0);
  const modelKey = `${voice.provider}::${voice.model}`;
  const modelOptions = (catalog?.providers ?? []).flatMap((p) => p.models.map((m) => ({ key: `${p.id}::${m.id}`, label: `${p.label} · ${m.label}`, configured: m.configured !== false })));
  const expressionChanged = saved.rate !== voice.rate || saved.volume !== voice.volume || saved.granularity !== voice.granularity || saved.instruction !== voice.instruction;
  const expressionVisible = expressionOpen ?? expressionChanged;
  const changes = dirtyVoice ? voiceDiff(catalog, saved, voice) : [];
  const progress = change && change.total > 0 ? Math.round((change.ready / change.total) * 100) : 0;
  const verifying = selected ? timestampState(selected).tone === "faint" : false;
  const saveNote = store.save === "saving" ? { text: "保存中", dot: "bg-accent animate-live-dot" }
    : store.save === "saved" ? { text: "已保存", dot: "bg-text-faint" }
    : store.save === "conflict" ? { text: "有冲突", dot: "bg-warn" }
    : store.save === "error" ? { text: "保存失败", dot: "bg-danger" }
    : null;
  const applySuffix = (() => {
    if (!quote?.changed) return "";
    if (!quote.existing) return "（只保存，不生成）";
    const cost = costLabel(quote.estimatedCostYuan);
    return ` · ${quote.generate} 句${cost ? ` · ${cost}` : ""}`;
  })();

  /** 参数一变，正在播的试听就不再代表当前设置 */
  const updateVoice = (patch: Partial<VoiceSettings>) => {
    audioRef.current?.pause();
    setDraft({ ...voice, ...patch });
  };
  function chooseModel(key: string) {
    const [providerId, modelId] = key.split("::");
    const provider = catalog?.providers.find((p) => p.id === providerId);
    const model = provider?.models.find((m) => m.id === modelId);
    if (!provider || !model) return;
    updateVoice({ provider: provider.id as VoiceSettings["provider"], model: model.id, voiceId: voiceIdAfterModelChange(voice.voiceId, model.voices.map((v) => v.id)) });
  }
  function voiceInUse(voiceId: string) {
    const pendingVoice = change?.status === "pending" ? change.voice : null;
    return [saved, pendingVoice].some((item) => item && item.provider === voice.provider && item.model === voice.model && item.voiceId === voiceId);
  }
  async function applyVoice() {
    if (!voice.voiceId) {
      toast("请先选择音色", "info");
      return;
    }
    setVoiceBusy(true);
    try {
      if ((await store.flush()) == null) throw new Error("项目设置保存失败，请重试");
      const quote = await postJson<VoiceQuote>(`/api/projects/${id}/voice-change`, { action: "quote", voice });
      if (!quote.changed) return;
      const cost = quote.estimatedCostYuan == null ? "费用暂无法准确估算，以服务商账单为准。" : `预计费用约 ¥${quote.estimatedCostYuan.toFixed(2)}，实际以服务商账单为准。`;
      const paragraphMode = voice.granularity === "paragraph" && paragraphSupported(voice);
      const jobLabel = paragraphMode && quote.jobs > 0 ? `预计需生成 ${quote.generate} 句，合并为 ${quote.jobs} 个段落任务。` : `预计需生成 ${quote.generate} 句。`;
      const message = quote.existing ? `当前 ${quote.existing} 句已有配音，其中 ${quote.affected} 句会受新设置影响。新设置可复用 ${quote.reusable} 句缓存，${jobLabel}生成期间继续使用旧配音，全部就绪后统一切换。${cost}` : `当前没有已生成配音，本次只保存配音设置，不会发起配音请求。`;
      if (!(await confirm({
        title: "应用配音设置？",
        message,
        confirmLabel: quote.generate ? "应用并生成" : "应用设置",
        bullets: [
          `预计费用：${quote.estimatedCostYuan == null ? "暂无法准确估算，以服务商账单为准" : `约 ¥${quote.estimatedCostYuan.toFixed(2)}`}。`,
          `影响范围：${quote.generate ? `${quote.generate} 句新配音，全部就绪后统一切换` : "只保存设置，不发起配音任务"}。`,
          "可撤回：已应用的音色可以恢复；服务商已接单的请求仍可能计费。",
        ],
      }))) return;
      const result = await postJson<{ change: VoiceChange | null }>(`/api/projects/${id}/voice-change`, { action: "apply", voice });
      setChange(result.change);
      await refreshChange();
      setDraft(null);
      if (result.change?.status === "applied") { await store.reload(); onChanged?.(); }
      toast(quote.generate ? `已开始生成 ${quote.generate} 句新配音` : "配音设置已应用", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally { setVoiceBusy(false); }
  }
  async function voiceAction(action: "retry" | "cancel" | "revert") {
    setVoiceBusy(true);
    try {
      const result = await postJson<{ change: VoiceChange | null }>(`/api/projects/${id}/voice-change`, { action });
      setChange(result.change);
      await refreshChange();
      if (action === "cancel") setDraft(change?.voice ?? null);
      if (action === "revert" || result.change?.status === "applied") { await store.reload(); onChanged?.(); }
      toast(action === "retry" ? "已补齐排队中的新配音" : action === "cancel" ? "已取消，继续使用原配音" : "已恢复原配音", "success");
    } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); }
    finally { setVoiceBusy(false); }
  }
  async function stopVoiceBatch() {
    if (!change?.batchId) return;
    setVoiceBusy(true);
    try {
      await postJson(`/api/projects/${id}/lines/tts/cancel`, { batchId: change.batchId });
      await refreshChange();
      toast("已停止本次配音，已完成的音频继续保留", "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally { setVoiceBusy(false); }
  }
  /** 试听：同一组参数再次点击时直接播放已合成的音频，参数变了才重新合成 */
  async function togglePreview() {
    if (!voice.voiceId) {
      toast("请先选择音色", "info");
      return;
    }
    const audio = audioRef.current;
    const key = previewKeyOf(voice);
    if (previewSrc && previewKey === key && audio) {
      if (!audio.paused) audio.pause();
      else {
        audio.currentTime = 0;
        void audio.play().catch(() => undefined);
      }
      return;
    }
    setPreviewing(true);
    try {
      const result = await postJson<{ src: string }>("/api/voices/preview", { voice });
      setPreviewKey(key);
      if (result.src === previewSrc && audio) {
        audio.currentTime = 0;
        void audio.play().catch(() => undefined);
      } else {
        playWhenReady.current = true;
        setPreviewSrc(result.src);
      }
      await reloadCatalog();
    } catch (error) {
      await reloadCatalog();
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setPreviewing(false);
    }
  }
  async function addVoice() {
    const paramError = voiceParamError(voiceParam);
    const nameError = voiceNameError(voiceName);
    if (paramError || nameError) {
      setBookError(paramError || nameError || "");
      return;
    }
    setBookBusy(true);
    setBookError("");
    try {
      const created = await postJson<{ voice: { voiceId: string } }>("/api/voices/custom", { provider: voice.provider, model: voice.model, voiceId: voiceParam.trim(), name: voiceName.trim() });
      setVoiceParam("");
      setVoiceName("");
      await reloadCatalog();
      updateVoice({ voiceId: created.voice.voiceId });
      toast("已加入音色册，试听一次即可确认", "success");
    } catch (error) {
      setBookError(error instanceof Error ? error.message : String(error));
    } finally { setBookBusy(false); }
  }
  async function removeVoice(item: CatalogVoice) {
    if (!item.customId) return;
    if (voiceInUse(item.id)) {
      toast("当前项目正在使用这个音色。先改选其他音色并应用，再删除。", "info");
      return;
    }
    if (!(await confirm({
      title: `移除音色「${item.name}」？`,
      message: "它会从音色列表里消失。已经生成的配音保留。其他项目如果还选着这个参数，仍按它合成，只是下拉列表里不再出现。",
      confirmLabel: "移除",
      tone: "danger",
      bullets: ["预计费用：不产生费用。", "影响范围：只从这台机器的音色册删除。", "可恢复：可以重新填入同一个音色参数。"],
    }))) return;
    setBookBusy(true);
    try {
      await postJson(`/api/voices/custom/${item.customId}`, undefined, "DELETE");
      if (voice.voiceId === item.id) updateVoice({ voiceId: "" });
      await reloadCatalog();
      toast("已从音色册移除", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally { setBookBusy(false); }
  }

  const granularityLocked = pending || !paragraphSupported(voice);

  return (
    <section className="panel" aria-labelledby="voice-panel-title">
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4 sm:px-6">
        <h2 id="voice-panel-title" className="text-base font-semibold text-text">语音</h2>
        {saveNote && (
          <span role="status" className="flex items-center gap-1.5 text-2xs text-text-faint">
            <span className={`size-1.5 rounded-full ${saveNote.dot}`} aria-hidden="true" />
            {saveNote.text}
          </span>
        )}
      </header>

      <div className="px-5 sm:px-6">
        {pending && change && (
          <div className="animate-rise mt-5 rounded-surface border border-accent/25 bg-accent/[0.05] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm text-text">正在生成新配音</span>
              <span className="text-xs tabular-nums text-text-muted">{change.ready}/{change.total} 句就绪{change.failed ? ` · ${change.failed} 句失败` : ""}</span>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="配音进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button size="sm" disabled={voiceBusy || change.missing === 0} onClick={() => void voiceAction("retry")}>补齐缺失</Button>
              {change.batchId && <Button size="sm" disabled={voiceBusy} onClick={() => void stopVoiceBatch()}>停止生成</Button>}
              <Button size="sm" disabled={voiceBusy} onClick={() => void voiceAction("cancel")}>取消切换</Button>
            </div>
          </div>
        )}

        {!pending && !dirtyVoice && change?.status === "applied" && change.revertible && (
          <div className="animate-fade-in mt-5 flex items-center justify-between gap-3 text-xs text-text-muted">
            <span className="flex items-center gap-2"><Icon name="check" className="size-3.5 text-accent" />配音设置已应用</span>
            <button type="button" className="btn-text px-2 py-1" disabled={voiceBusy} onClick={() => void voiceAction("revert")}>撤回</button>
          </div>
        )}

        <div className="space-y-5 py-5">
          <div className="space-y-2">
            <Field label="模型">
              <Select value={modelKey} disabled={pending} onChange={chooseModel}>
                {!modelOptions.some((o) => o.key === modelKey) && <option value={modelKey}>{currentModel?.label ?? voice.model}</option>}
                {modelOptions.map((o) => <option key={o.key} value={o.key} disabled={!o.configured}>{o.configured ? o.label : `${o.label}（未配置）`}</option>)}
              </Select>
            </Field>
            {currentModel?.configured === false && <p className="text-2xs text-warn">{currentModel.configurationHint ?? "这个模型暂不可用"}</p>}
            {voice.provider === "google-gemini" && <p className="text-2xs text-text-faint">文本会发送至 Google，音色为预置。</p>}
          </div>

          <div className="space-y-2">
            <Field label="音色">
              <div className="flex gap-2">
                <Select value={voice.voiceId} disabled={pending} onChange={(value) => updateVoice({ voiceId: value })} className="min-w-0 flex-1">
                  {!voice.voiceId && <option value="">选择音色</option>}
                  {voices.map((item) => <option key={item.customId ?? item.id} value={item.id}>{item.name}</option>)}
                  {voice.voiceId && !selected && <option value={voice.voiceId}>{voice.voiceId}（不在此模型中）</option>}
                </Select>
                <button
                  type="button"
                  className={`audio-button h-10 shrink-0 px-4 disabled:cursor-not-allowed disabled:opacity-35 ${verifying ? "border-accent/50 text-accent" : ""}`}
                  data-playing={playing ? "true" : undefined}
                  disabled={previewing || pending || !voice.voiceId || currentModel?.configured === false}
                  onClick={() => void togglePreview()}
                >
                  {previewing ? <Spinner className="size-3.5" /> : playing ? <span className="audio-eq" aria-hidden="true"><span /><span /><span /></span> : <Icon name="play" className="size-3.5" />}
                  {previewing ? "合成中" : playing ? "暂停" : "试听"}
                </button>
                <audio ref={audioRef} src={previewSrc ?? undefined} preload="none" className="hidden" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
              </div>
            </Field>
            {selected && (() => {
              const ts = timestampState(selected);
              return (
                <div key={selected.id} className="animate-fade-in flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-2xs">
                  <span className="text-text-muted">{selected.style}</span>
                  <span className="font-mono text-text-faint">{selected.id}</span>
                  <Chip tone={ts.tone}>{ts.text}</Chip>
                </div>
              );
            })()}
            {selected?.probe === "failed" && selected.lastError && <p className="text-2xs text-danger">{selected.lastError}</p>}
            {voice.voiceId && !selected && <p className="text-2xs text-warn">这个音色不在当前模型中，请重新选择。</p>}
          </div>

          {canAddVoice && (
            <div className="border-t border-hairline pt-5">
              <Disclosure label="添加音色" summary={customVoices.length ? `已添加 ${customVoices.length} 个` : undefined} open={bookOpen} controls={addId} onToggle={() => setBookOpen((open) => !open)} />
              <Collapse id={addId} open={bookOpen}>
                <div className="space-y-4 pt-4">
                  <p className="text-2xs leading-5 text-text-faint">参数来自百炼文档，保存在本机，所有项目共用。</p>
                  {currentModel?.configured === true && (
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto]">
                        <input className="input py-2 font-mono text-xs" aria-label="音色参数" placeholder="音色参数，如 longanhuan_v3" value={voiceParam} disabled={pending || bookBusy} maxLength={128} onChange={(event) => { setVoiceParam(event.target.value); setBookError(""); }} />
                        <input className="input py-2 text-sm" aria-label="显示名" placeholder="显示名（可选）" value={voiceName} disabled={pending || bookBusy} maxLength={40} onChange={(event) => { setVoiceName(event.target.value); setBookError(""); }} />
                        <Button loading={bookBusy} disabled={pending || bookBusy || !voiceParam.trim()} onClick={() => void addVoice()}>添加</Button>
                      </div>
                      {bookError && <p role="alert" className="text-2xs text-danger">{bookError}</p>}
                    </div>
                  )}
                  {customVoices.length > 0 && (
                    <ul className="divide-y divide-hairline overflow-hidden rounded-surface border border-line">
                      {customVoices.map((item) => {
                        const blocked = voiceInUse(item.id);
                        const ts = timestampState(item);
                        return (
                          <li key={item.customId} className="flex items-center gap-3 px-3.5 py-2.5">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-text">{item.name}</p>
                              <p className="truncate font-mono text-2xs text-text-faint">{item.id}</p>
                            </div>
                            <Chip tone={ts.tone}>{ts.text}</Chip>
                            {blocked && <Chip tone="muted">使用中</Chip>}
                            <button
                              type="button"
                              className="btn-text px-2 py-1.5"
                              aria-label={`移除音色 ${item.name}`}
                              title={blocked ? "正在使用，先改选其他音色并应用" : "从音色册移除"}
                              disabled={bookBusy || pending || blocked}
                              onClick={() => void removeVoice(item)}
                            >
                              <Icon name="trash" className="size-3.5" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </Collapse>
            </div>
          )}
        </div>

        <div className="border-t border-hairline py-5">
          <Disclosure
            label="语速与表达"
            summary={`${voice.rate}x · 音量 ${voice.volume}${voice.granularity === "paragraph" ? " · 整段" : ""}`}
            open={expressionVisible}
            controls={expressionId}
            onToggle={() => setExpressionOpen(!expressionVisible)}
          />
          <Collapse id={expressionId} open={expressionVisible}>
            <div className="space-y-5 pt-5">
              <fieldset disabled={granularityLocked} className={`min-w-0 space-y-2 ${granularityLocked ? "opacity-40" : ""}`}>
                <span className="label block">合成方式</span>
                <SegmentedControl value={paragraphSupported(voice) ? voice.granularity : "line"} options={granularityOptions} onChange={(value) => updateVoice({ granularity: value })} label="合成方式" />
                <p className="text-2xs text-text-faint">
                  {!paragraphSupported(voice) ? "当前模型只能逐句合成" : voice.granularity === "paragraph" ? "整段一起合成，语气更连贯；改一句会整段重录" : "逐句合成，改一句只重录这一句"}
                </p>
              </fieldset>

              <fieldset disabled={pending} className="min-w-0 space-y-4">
                <Slider label="语速" value={voice.rate} min={0.5} max={2} step={0.05} defaultValue={DEFAULT_RATE} format={(v) => `${v}x`} disabled={pending} onChange={(rate) => updateVoice({ rate })} />
                <Slider label="音量" value={voice.volume} min={0} max={100} step={1} defaultValue={DEFAULT_VOLUME} format={(v) => String(v)} disabled={pending} onChange={(volume) => updateVoice({ volume })} />
              </fieldset>

              <Field label="表达" hint={voice.provider === "google-gemini" ? "暂不生效" : undefined}>
                <AutoTextarea
                  value={voice.provider === "google-gemini" ? voice.google?.stylePrompt ?? "" : voice.instruction}
                  onChange={(event) => updateVoice({ instruction: event.target.value })}
                  className="input min-h-16 py-2.5 leading-6"
                  placeholder="例如：沉稳、清晰，略带悬念"
                  maxLength={voice.provider === "google-gemini" ? 1000 : 500}
                  disabled={voice.provider === "google-gemini" || pending}
                />
              </Field>
            </div>
          </Collapse>
        </div>
      </div>

      {!pending && dirtyVoice && (
        <div className="animate-rise sticky bottom-0 z-[var(--z-sticky)] flex flex-wrap items-center gap-3 rounded-b-panel border-t border-hairline bg-ink-raised/95 px-5 py-3.5 backdrop-blur-xl sm:px-6">
          <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {changes.map((item) => <li key={item}><Chip tone="muted">{item}</Chip></li>)}
          </ul>
          <button type="button" className="btn-text" disabled={voiceBusy} onClick={() => setDraft(null)}>放弃</button>
          <Button variant="primary" size="sm" loading={voiceBusy || quoteBusy} disabled={voiceBusy || !voice.voiceId} onClick={() => void applyVoice()}>
            应用{quoteBusy || !voice.voiceId ? "" : applySuffix}
          </Button>
        </div>
      )}
    </section>
  );
}
