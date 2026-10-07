"use client";

// 制作设置面板：音色、批量换音色、画幅、预算与制作预设。

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AutoTextarea, Field, RangeField, Select, Spinner, Switch } from "@/components/ui";
import { postJson } from "@/lib/client";
import { type ProjectDoc, type VoiceSettings } from "@/lib/core/types";
import { costLabel } from "@/lib/core/interaction";
import { outputSpecIdForAspect, outputSpecsFor } from "@/lib/core/output-spec";
import { paragraphSupported } from "@/lib/core/blocks";
import { useFeedback } from "@/components/feedback";
import { PresetSection } from "@/components/preset-dialog";
import type { ProjectStore } from "./shared";

type VoiceCatalog = { providers: { id: string; label: string; models: { id: string; label: string; configured?: boolean; configurationHint?: string; capabilities?: string[]; voices: { id: string; name: string; gender: string; style: string; timestamps: boolean; instruct?: boolean; ssml?: boolean; emotionTags?: boolean }[] }[] }[] };

type VoiceChange = { status: "pending" | "applied"; voice: VoiceSettings; total: number; ready: number; missing: number; failed: number; revertible: boolean; batchId?: string };
type VoiceQuote = { total: number; existing: number; affected: number; reusable: number; generate: number; jobs: number; estimatedCostYuan: number | null; changed: boolean };

export function SettingsPanel({ id, store, draft, setDraft, onChanged, change, setChange, refreshChange }: { id: string; store: ProjectStore; draft: VoiceSettings | null; setDraft: Dispatch<SetStateAction<VoiceSettings | null>>; onChanged?: () => void; change: VoiceChange | null; setChange: (value: VoiceChange | null) => void; refreshChange: () => Promise<void> }) {
  const doc = store.doc;
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const { confirm, toast } = useFeedback();
  useEffect(() => { fetch("/api/voices").then((r) => r.json()).then(setCatalog).catch(() => setCatalog(null)); }, []);
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
    if (!draft || change?.status === "pending") { setQuote(null); return; }
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
  if (!doc) return null;
  const voice = draft ?? (change?.status === "pending" ? change.voice : doc.settings.voice);
  const pending = change?.status === "pending";
  const dirtyVoice = JSON.stringify(voice) !== JSON.stringify(doc.settings.voice);
  const currentProvider = catalog?.providers.find((p) => p.id === voice.provider);
  const models = currentProvider?.models ?? [];
  const currentModel = models.find((m) => m.id === voice.model) ?? models[0];
  const voices = currentModel?.voices ?? [];
  const updateVoice = (patch: Partial<VoiceSettings>) => setDraft({ ...voice, ...patch });
  /**
   * 「应用到项目 · 8 句 · 约 ¥0.03」的按钮后缀。
   * 没有已生成配音时只是保存设置、不会花钱，明确写「不生成」而不是显示 ¥0.00。
   */
  const applySuffix = (() => {
    if (!quote?.changed) return "";
    if (!quote.existing) return "（只保存，不生成）";
    const cost = costLabel(quote.estimatedCostYuan);
    return ` · ${quote.generate} 句${cost ? ` · ${cost}` : ""}`;
  })();
  async function applyVoice() {
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
    if (!enabled && !(await confirm({ title: "关闭 AI 生成标识？", message: "部分发布平台要求保留 AI 生成标识，请确认你仍要关闭。", confirmLabel: "关闭标识", tone: "danger", bullets: ["预计费用：不产生新的服务商费用。", "影响范围：后续导出的视频不再显示 AI 生成标识。", "可恢复：可以随时重新打开标识。"] }))) return;
    store.setDoc((d) => ({ ...d, settings: { ...d.settings, aiLabel: { ...d.settings.aiLabel, enabled } } }));
  }
  return <section className="panel p-5"><div className="flex items-center justify-between gap-3"><div><p className="label">设置</p><h2 className="mt-1 text-base font-medium">制作设置</h2></div><span className="text-sm text-text-muted">{store.save === "saving" ? "保存中" : store.save === "saved" ? "已保存" : ""}</span></div>
    <PresetSection doc={doc} store={store} catalog={catalog} />
    <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium text-white/85">输出规格</p><p className="mt-1 text-xs text-white/40">分辨率与帧率由预设决定，当前固定 30fps。</p></div><span className="text-xs text-white/45">当前预览：{doc.settings.previewAspect ?? outputSpecsFor(doc.settings)[0].aspect}</span></div>
      <div className="mt-3 flex flex-wrap gap-2">{(["16:9", "9:16"] as const).map((aspect) => { const active = doc.settings.aspects.includes(aspect); return <button key={aspect} className={`chip h-8 px-3 ${active ? "chip-on" : ""}`} onClick={() => store.setDoc((d) => { const next = d.settings.aspects.includes(aspect) ? d.settings.aspects.filter((item) => item !== aspect) : [...d.settings.aspects, aspect]; const aspects = next.length ? next : [aspect]; return { ...d, settings: { ...d.settings, aspects, outputSpecIds: aspects.map(outputSpecIdForAspect), previewAspect: aspects.includes(d.settings.previewAspect ?? "16:9") ? d.settings.previewAspect : aspects[0] } }; })}>{aspect} · {aspect === "16:9" ? "1920×1080" : "1080×1920"}</button>; })}</div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-white/50"><span>素材策略</span><Select className="h-8 min-h-8 py-1.5 text-xs" value={doc.settings.assetFraming} onChange={(value) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, assetFraming: value as ProjectDoc["settings"]["assetFraming"] } }))}><option value="smart-dual">智能双版</option><option value="per-output">全部分别生成</option><option value="shared">全部共享素材</option></Select><span>{outputSpecsFor(doc.settings).map((spec) => `${spec.label} · ${spec.fps}fps`).join(" · ")}</span></div>
    </div>
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <Field label="配音服务商"><Select value={voice.provider} disabled={pending} onChange={(value) => { const provider = catalog?.providers.find((item) => item.id === value); const model = provider?.models.find((item) => item.configured !== false) ?? provider?.models[0]; updateVoice({ provider: value as VoiceSettings["provider"], model: model?.id ?? voice.model, voiceId: model?.voices[0]?.id ?? voice.voiceId }); }}>{catalog?.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</Select></Field>
      {voice.provider === "google-gemini" && <p className="md:col-span-2 -mt-2 text-xs leading-5 text-amber-200/70">启用 Google Gemini 后，本项目的配音文本会发送到 Google Gemini API。</p>}
      <Field label="音色模型"><Select value={voice.model} disabled={pending} onChange={(v) => { const m = models.find((x) => x.id === v); updateVoice({ model: v, voiceId: m?.voices[0]?.id ?? voice.voiceId }); }}><option value={voice.model}>{currentModel?.label ?? voice.model}{currentModel && !currentModel.configured ? `（${currentModel.configurationHint ?? "待配置"}）` : ""}</option>{models.filter((m) => m.id !== voice.model).map((m) => <option key={m.id} value={m.id} disabled={m.configured === false}>{m.label}{m.configured === false ? `（${m.configurationHint ?? "待配置"}）` : ""}</option>)}</Select></Field>
      <Field label="音色"><div className="flex gap-2"><Select value={voice.voiceId} disabled={pending} onChange={(v) => updateVoice({ voiceId: v })} className="min-w-0 flex-1">{voices.length ? voices.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.style}</option>) : <option value={voice.voiceId}>{voice.voiceId}</option>}</Select><button className="btn btn-ghost btn-sm" disabled={previewing} onClick={previewVoice}>{previewing ? <Spinner className="size-3" /> : "试听"}</button>{preview && <audio id="voice-preview" className="hidden" src={preview} />}</div></Field>
      <Field label="合成粒度" hint={paragraphSupported(voice) ? (voice.granularity === "paragraph" ? `实验：按自然段合成再切成单句，句间衔接更自然、停顿更舒展；改一句会整段重录；同样文案成片约长 5–15%${voice.provider === "google-gemini" ? "。Gemini 没有字级时间戳，按停顿切分，切不准时自动拆小或逐句合成" : ""}` : "每句单独合成，改一句只重录一句") : "当前服务商暂只支持逐句合成"}><Select value={paragraphSupported(voice) ? voice.granularity : "line"} disabled={pending || !paragraphSupported(voice)} onChange={(v) => updateVoice({ granularity: v as VoiceSettings["granularity"] })}><option value="line">逐句</option><option value="paragraph">段落（实验）</option></Select></Field>
      <Field label="语速"><fieldset disabled={pending}><RangeField label="" value={voice.rate} min={0.5} max={2} step={0.05} suffix="x" onChange={(value) => updateVoice({ rate: value })} /></fieldset></Field>
      <Field label="音量"><fieldset disabled={pending}><RangeField label="" value={voice.volume} min={0} max={100} step={1} suffix="" onChange={(value) => updateVoice({ volume: value })} /></fieldset></Field>
      <Field label={voice.provider === "google-gemini" ? "旁白表达指令（暂不可用）" : "旁白表达指令"} hint={voice.provider === "google-gemini" ? "当前不生效；已填写内容保留。" : "应用后生效"}><AutoTextarea value={voice.provider === "google-gemini" ? voice.google?.stylePrompt ?? "" : voice.instruction} onChange={(event) => updateVoice({ instruction: event.target.value })} className="input min-h-16 py-2 text-xs leading-5" placeholder="例如：沉稳、清晰，略带悬念的纪录片旁白表达" maxLength={voice.provider === "google-gemini" ? 1000 : 500} disabled={voice.provider === "google-gemini" || pending} /></Field>
      <Field label="预算（元）"><input className="input" type="number" min="0" step="1" value={doc.settings.budgetYuan ?? ""} onChange={(e) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, budgetYuan: e.target.value ? Number(e.target.value) : null } }))} placeholder="不设上限" /></Field>
      <Field label="AI 标识"><Select value={doc.settings.aiLabel.position} onChange={(v) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, aiLabel: { ...d.settings.aiLabel, enabled: true, position: v as "auto" | "top-left" | "top-right" } } }))}><option value="auto">自动位置</option><option value="top-left">左上角</option><option value="top-right">右上角</option></Select></Field>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-4 text-sm">
      {pending ? (
        <>
          <span className="text-white/65">新配音 {change.ready}/{change.total} 句就绪，当前仍播放原配音{change.failed ? `；${change.failed} 句生成失败` : ""}</span>
          <button className="btn btn-ghost btn-sm" disabled={voiceBusy || change.missing === 0} onClick={() => void voiceAction("retry")}>补齐缺失句</button>
          {change.batchId && <button className="btn btn-ghost btn-sm" disabled={voiceBusy} onClick={() => void stopVoiceBatch()}>停止本次</button>}
          <button className="btn btn-ghost btn-sm" disabled={voiceBusy} onClick={() => void voiceAction("cancel")}>取消应用</button>
        </>
      ) : (
        <>
          <button className="btn btn-primary btn-sm" disabled={!dirtyVoice || voiceBusy} onClick={() => void applyVoice()}>{voiceBusy ? <Spinner className="size-3" /> : null}应用到项目{applySuffix}</button>
          {dirtyVoice && <button className="btn btn-ghost btn-sm" disabled={voiceBusy} onClick={() => setDraft(null)}>放弃修改</button>}
          {change?.status === "applied" && change.revertible && !dirtyVoice && <button className="btn btn-ghost btn-sm" disabled={voiceBusy} onClick={() => void voiceAction("revert")}>撤回本次应用</button>}
          {dirtyVoice && <span className="text-white/45">{quoteBusy ? "正在估算费用…" : "待应用；当前配音不变"}</span>}
        </>
      )}
    </div>
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 border-t border-white/[0.06] pt-4 text-sm text-text-muted"><label className="flex items-center gap-2">字幕 <Switch checked={doc.settings.subtitle.enabled} label="字幕" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, subtitle: { ...d.settings.subtitle, enabled: checked } } }))} /></label><label className="flex items-center gap-2">关键词高亮 <Switch checked={doc.settings.subtitle.highlight} label="关键词高亮" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, subtitle: { ...d.settings.subtitle, highlight: checked } } }))} /></label><label className="flex items-center gap-2">AI 生成标识 <Switch checked={doc.settings.aiLabel.enabled} label="AI 生成标识" onChange={(checked) => { void toggleAiLabel(checked); }} /></label><label className="flex items-center gap-2">转场音效 <Switch checked={doc.settings.sfx.enabled} label="转场音效" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, sfx: { enabled: checked } } }))} /></label><label className="flex items-center gap-2">样片后暂停 <Switch checked={doc.settings.pauseAfterPreview} label="样片后暂停" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, pauseAfterPreview: checked } }))} /></label></div>
  </section>;
}
