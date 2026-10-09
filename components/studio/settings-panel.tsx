"use client";

// 制作设置面板：音色、批量换音色、画幅、预算与制作预设。

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AutoTextarea, Field, Icon, RangeField, Select, Spinner, Switch } from "@/components/ui";
import { postJson } from "@/lib/client";
import { type ProjectDoc, type VoiceSettings } from "@/lib/core/types";
import { costLabel } from "@/lib/core/interaction";
import { outputSpecIdForAspect } from "@/lib/core/output-spec";
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
  const [voiceMore, setVoiceMore] = useState<boolean | null>(null);
  const [outputMore, setOutputMore] = useState(false);
  const [publishMore, setPublishMore] = useState(false);
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
  const voiceOpen = voiceMore ?? false;
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
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-text">制作设置</h2>
          <p className="mt-1 text-2xs text-text-faint">调整输出、配音和成片选项</p>
        </div>
        {store.save !== "idle" && <span className="shrink-0 text-2xs text-text-faint">{store.save === "saving" ? "保存中" : store.save === "saved" ? "已保存" : store.save === "conflict" ? "有冲突" : "保存失败"}</span>}
      </div>

      <div className="space-y-0 px-5 sm:px-6">
        <SettingGroup title="预设">
          <PresetSection doc={doc} store={store} catalog={catalog} />
        </SettingGroup>

        <SettingGroup title="输出">
          <div className="flex flex-wrap gap-2" aria-label="输出画幅">
            {(["16:9", "9:16"] as const).map((aspect) => {
              const active = doc.settings.aspects.includes(aspect);
              return (
                <button key={aspect} type="button" className={`chip h-8 px-3 ${active ? "chip-on" : ""}`} onClick={() => store.setDoc((current) => {
                  const next = current.settings.aspects.includes(aspect) ? current.settings.aspects.filter((item) => item !== aspect) : [...current.settings.aspects, aspect];
                  const aspects = next.length ? next : [aspect];
                  return { ...current, settings: { ...current.settings, aspects, outputSpecIds: aspects.map(outputSpecIdForAspect), previewAspect: aspects.includes(current.settings.previewAspect ?? "16:9") ? current.settings.previewAspect : aspects[0] } };
                })}>
                  {aspect} · {aspect === "16:9" ? "1920×1080" : "1080×1920"}
                </button>
              );
            })}
          </div>
          <DisclosureRow label="素材策略" value={doc.settings.assetFraming === "smart-dual" ? "智能双版" : doc.settings.assetFraming === "per-output" ? "分别生成" : "共享素材"} open={outputMore} onClick={() => setOutputMore((open) => !open)} />
          {outputMore && <div className="mt-3 max-w-sm">
            <Select aria-label="素材策略" value={doc.settings.assetFraming} onChange={(value) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, assetFraming: value as ProjectDoc["settings"]["assetFraming"] } }))}>
              <option value="smart-dual">智能双版</option>
              <option value="per-output">分别生成</option>
              <option value="shared">共享素材</option>
            </Select>
          </div>}
        </SettingGroup>

        <SettingGroup title="配音" action={pending ? <span className="text-2xs text-text-muted">生成中 {change.ready}/{change.total}</span> : undefined}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="服务商">
              <Select value={voice.provider} disabled={pending} onChange={(value) => { const provider = catalog?.providers.find((item) => item.id === value); const model = provider?.models.find((item) => item.configured !== false) ?? provider?.models[0]; updateVoice({ provider: value as VoiceSettings["provider"], model: model?.id ?? voice.model, voiceId: model?.voices[0]?.id ?? voice.voiceId }); }}>
                {catalog?.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
              </Select>
            </Field>
            <Field label="模型">
              <Select value={voice.model} disabled={pending} onChange={(value) => { const model = models.find((item) => item.id === value); updateVoice({ model: value, voiceId: model?.voices[0]?.id ?? voice.voiceId }); }}>
                <option value={voice.model}>{currentModel?.label ?? voice.model}{currentModel && !currentModel.configured ? `（${currentModel.configurationHint ?? "待配置"}）` : ""}</option>
                {models.filter((model) => model.id !== voice.model).map((model) => <option key={model.id} value={model.id} disabled={model.configured === false}>{model.label}{model.configured === false ? `（${model.configurationHint ?? "待配置"}）` : ""}</option>)}
              </Select>
            </Field>
          </div>
          {voice.provider === "google-gemini" && <p className="mt-2 text-2xs text-text-faint">配音文本会发往 Google。</p>}
          <div className="mt-3">
            <Field label="音色">
              <div className="flex gap-2">
                <Select value={voice.voiceId} disabled={pending} onChange={(value) => updateVoice({ voiceId: value })} className="min-w-0 flex-1">
                  {voices.length ? voices.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.style}</option>) : <option value={voice.voiceId}>{voice.voiceId}</option>}
                </Select>
                <button className="btn btn-ghost btn-sm" disabled={previewing || pending} onClick={() => void previewVoice()}>{previewing ? <Spinner className="size-3" /> : "试听"}</button>
                {preview && <audio id="voice-preview" className="hidden" src={preview} />}
              </div>
            </Field>
          </div>
          <DisclosureRow label="语速与表达" value={`${voice.rate}x · 音量 ${voice.volume}${voice.granularity === "paragraph" ? " · 段落" : ""}`} open={voiceOpen} onClick={() => setVoiceMore(!voiceOpen)} />
          {voiceOpen && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="合成粒度" hint={!paragraphSupported(voice) ? "仅逐句" : voice.granularity === "paragraph" ? "整段重录" : undefined}>
                <Select value={paragraphSupported(voice) ? voice.granularity : "line"} disabled={pending || !paragraphSupported(voice)} onChange={(value) => updateVoice({ granularity: value as VoiceSettings["granularity"] })}>
                  <option value="line">逐句</option>
                  <option value="paragraph">段落</option>
                </Select>
              </Field>
              <div className="sm:col-span-2 space-y-3">
                <fieldset disabled={pending}><RangeField label="语速" value={voice.rate} min={0.5} max={2} step={0.05} suffix="x" onChange={(value) => updateVoice({ rate: value })} /></fieldset>
                <fieldset disabled={pending}><RangeField label="音量" value={voice.volume} min={0} max={100} step={1} onChange={(value) => updateVoice({ volume: value })} /></fieldset>
              </div>
              <div className="sm:col-span-2">
                <Field label="表达" hint={voice.provider === "google-gemini" ? "暂不生效" : undefined}>
                  <AutoTextarea value={voice.provider === "google-gemini" ? voice.google?.stylePrompt ?? "" : voice.instruction} onChange={(event) => updateVoice({ instruction: event.target.value })} className="input min-h-16 py-2 text-xs leading-5" placeholder="沉稳、清晰，略带悬念" maxLength={voice.provider === "google-gemini" ? 1000 : 500} disabled={voice.provider === "google-gemini" || pending} />
                </Field>
              </div>
            </div>
          )}
          {pending && <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-3">
            <span className="mr-auto text-2xs text-text-muted">{change.ready}/{change.total} 句就绪{change.failed ? ` · ${change.failed} 失败` : ""}</span>
            <button className="btn btn-ghost btn-sm" disabled={voiceBusy || change.missing === 0} onClick={() => void voiceAction("retry")}>补齐</button>
            {change.batchId && <button className="btn btn-ghost btn-sm" disabled={voiceBusy} onClick={() => void stopVoiceBatch()}>停止</button>}
            <button className="btn btn-ghost btn-sm" disabled={voiceBusy} onClick={() => void voiceAction("cancel")}>取消</button>
          </div>}
          {!pending && (dirtyVoice || (change?.status === "applied" && change.revertible)) && <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-3">
            {dirtyVoice && <button className="btn-text px-1.5" disabled={voiceBusy} onClick={() => setDraft(null)}>放弃</button>}
            {dirtyVoice && <button className="btn btn-primary btn-sm" disabled={voiceBusy} onClick={() => void applyVoice()}>{voiceBusy || quoteBusy ? <Spinner className="size-3" /> : null}应用{quoteBusy ? "" : applySuffix}</button>}
            {change?.status === "applied" && change.revertible && !dirtyVoice && <button className="btn-text px-1.5" disabled={voiceBusy} onClick={() => void voiceAction("revert")}>撤回</button>}
          </div>}
        </SettingGroup>

        <SettingGroup title="成片选项">
          <SettingRow label="字幕">
            <Switch checked={doc.settings.subtitle.enabled} label="字幕" onChange={(checked) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, subtitle: { ...current.settings.subtitle, enabled: checked } } }))} />
          </SettingRow>
          <SettingRow label="关键词高亮">
            <Switch checked={doc.settings.subtitle.highlight} label="关键词高亮" onChange={(checked) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, subtitle: { ...current.settings.subtitle, highlight: checked } } }))} />
          </SettingRow>
          <DisclosureRow label="更多成片选项" value={publishMore ? "收起" : "预算、标识与音效"} open={publishMore} onClick={() => setPublishMore((open) => !open)} />
          {publishMore && <div className="mt-3 space-y-1 border-t border-hairline pt-2">
            <SettingRow label="预算">
              <input className="input h-8 w-28 py-1 text-right text-sm" type="number" min="0" step="1" aria-label="预算（元）" value={doc.settings.budgetYuan ?? ""} placeholder="不设上限" onChange={(event) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, budgetYuan: event.target.value ? Number(event.target.value) : null } }))} />
            </SettingRow>
            <SettingRow label="AI 标识">
            <span className="flex items-center gap-2">
              {doc.settings.aiLabel.enabled && (
                <Select className="h-8 w-28 min-h-8 py-1 text-xs" aria-label="AI 标识位置" value={doc.settings.aiLabel.position} onChange={(value) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, aiLabel: { ...current.settings.aiLabel, enabled: true, position: value as "auto" | "top-left" | "top-right" } } }))}>
                  <option value="auto">自动</option>
                  <option value="top-left">左上</option>
                  <option value="top-right">右上</option>
                </Select>
              )}
              <Switch checked={doc.settings.aiLabel.enabled} label="AI 生成标识" onChange={(checked) => { void toggleAiLabel(checked); }} />
            </span>
            </SettingRow>
            <SettingRow label="转场音效">
              <Switch checked={doc.settings.sfx.enabled} label="转场音效" onChange={(checked) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, sfx: { enabled: checked } } }))} />
            </SettingRow>
            <SettingRow label="样片后暂停">
              <Switch checked={doc.settings.pauseAfterPreview} label="样片后暂停" onChange={(checked) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, pauseAfterPreview: checked } }))} />
            </SettingRow>
          </div>}
        </SettingGroup>
      </div>
    </section>
  );
}

function SettingGroup({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline py-5 first:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-text-secondary">{title}</h3>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DisclosureRow({ label, value, open, onClick }: { label: string; value: string; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className="mt-4 flex w-full items-center justify-between gap-3 border-t border-hairline pt-3 text-left text-sm transition hover:text-white" aria-expanded={open} onClick={onClick}>
      <span className="text-text-secondary">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-xs text-text-muted"><span className="truncate">{value}</span><Icon name="chevron" className={`size-3.5 shrink-0 transition ${open ? "rotate-180" : ""}`} /></span>
    </button>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-text">{label}</span>
      {children}
    </div>
  );
}
