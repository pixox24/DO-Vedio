"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon, Select, Spinner, Switch } from "@/components/ui";
import type { ProviderKind, ProviderProfile } from "@/lib/providers/types";
import { useFeedback } from "@/components/feedback";

const tabs: { id: ProviderKind | "all"; label: string }[] = [
  { id: "all", label: "全部模型" }, { id: "text", label: "文本" }, { id: "image", label: "图片" },
  { id: "video", label: "视频" }, { id: "tts", label: "配音" },
];
const labels: Record<ProviderKind, string> = { text: "文本", image: "图片", video: "视频", tts: "配音", align: "对齐", lipsync: "口型" };
type ConnectionCheck = { state: "testing" | "success" | "error"; message?: string; latencyMs?: number };

export function ProviderSettings() {
  const [models, setModels] = useState<ProviderProfile[]>([]);
  const [tab, setTab] = useState<ProviderKind | "all">("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [interfaceType, setInterfaceType] = useState<"openai-compatible" | "anthropic">("openai-compatible");
  const [apiKey, setApiKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [connectionChecks, setConnectionChecks] = useState<Record<string, ConnectionCheck>>({});
  const { confirm, toast } = useFeedback();
  const refresh = () => fetch("/api/providers", { cache: "no-store" }).then((r) => r.json()).then((data) => setModels(data.providers ?? []));
  useEffect(() => { refresh().catch((cause) => setError(String(cause))).finally(() => setLoading(false)); }, []);

  const visible = useMemo(() => tab === "all" ? models : models.filter((model) => model.kind === tab), [models, tab]);
  const providers = [...new Set(visible.map((model) => model.providerId))];
  const ready = models.filter((model) => model.enabled && model.configured && model.adapterStatus === "ready").length;

  async function patch(model: ProviderProfile, value: { enabled?: boolean; kind?: "text" | "image" }) {
    setBusy(`${model.providerId}/${model.modelId}`);
    setError("");
    try {
      const response = await fetch(`/api/providers/${encodeURIComponent(model.providerId)}/models/${encodeURIComponent(model.modelId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
      if (!response.ok) throw new Error((await response.json()).error || "保存失败");
      const next = await response.json() as ProviderProfile;
      setModels((list) => list.map((item) => item.providerId === next.providerId && item.modelId === next.modelId ? next : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  }

  async function testConnection(model: ProviderProfile) {
    const key = `${model.providerId}/${model.modelId}`;
    setConnectionChecks((current) => ({ ...current, [key]: { state: "testing" } }));
    try {
      const response = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: model.providerId, modelId: model.modelId, voiceId: "Kore" }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; latencyMs?: number };
      if (!response.ok || !result.ok) throw new Error(result.message || "连接测试失败");
      setConnectionChecks((current) => ({ ...current, [key]: { state: "success", latencyMs: result.latencyMs } }));
      await refresh();
    } catch (cause) {
      setConnectionChecks((current) => ({ ...current, [key]: { state: "error", message: cause instanceof Error ? cause.message : String(cause) } }));
    }
  }

  async function addProvider() {
    setAdding(true);
    setError("");
    try {
      const response = await fetch("/api/providers/custom", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, baseUrl, interfaceType, apiKey }) });
      if (!response.ok) throw new Error((await response.json()).error || "添加失败");
      setName(""); setBaseUrl(""); setApiKey("");
      await refresh();
      toast("服务商已添加", "success");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setAdding(false); }
  }

  async function removeProvider(providerId: string) {
    if (!(await confirm({ title: "删除第三方服务商？", message: "该服务商的模型和已保存的密钥将一起删除。", confirmLabel: "删除", tone: "danger" }))) return;
    setBusy(providerId);
    try {
      const response = await fetch(`/api/providers/custom/${encodeURIComponent(providerId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error || "删除失败");
      setModels((list) => list.filter((model) => model.providerId !== providerId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  }

  return <div className="mx-auto max-w-6xl space-y-8 pt-8 pb-20">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-7">
      <div><p className="label text-accent">制作设置 / 模型中心</p><h1 className="mt-2 text-2xl font-semibold">模型与供应商</h1><p className="mt-2 text-sm text-white/45">管理模型用途与启用状态。</p></div>
      <div className="flex items-center gap-5 text-sm"><span className="text-white/45">接入模型 <strong className="ml-1 font-medium text-white">{models.length}</strong></span><span className="text-white/45">可用 <strong className="ml-1 font-medium text-accent">{ready}</strong></span></div>
    </header>

    <div className="grid gap-8 md:grid-cols-[168px_minmax(0,1fr)]">
      <nav className="flex gap-1 overflow-x-auto border-b border-white/10 pb-3 md:sticky md:top-24 md:block md:self-start md:border-0 md:pb-0" aria-label="模型用途">
        {tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`flex shrink-0 items-center justify-between gap-5 rounded-md px-3 py-2.5 text-left text-sm transition md:w-full ${tab === item.id ? "bg-white/10 text-white" : "text-white/45 hover:bg-white/[0.04] hover:text-white"}`} aria-current={tab === item.id ? "page" : undefined}><span>{item.label}</span><span className="text-xs tabular-nums text-white/35">{item.id === "all" ? models.length : models.filter((model) => model.kind === item.id).length}</span></button>)}
      </nav>

      <main className="min-w-0 space-y-9">
        {error && <div role="alert" className="rounded-md border border-red-400/25 bg-red-400/5 px-4 py-3 text-sm text-red-200">{error}</div>}
        {loading ? <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-md bg-white/[0.04]" />)}</div> : visible.length === 0 ? <div className="border-t border-white/10 py-16 text-center text-sm text-white/45">此分类还没有模型</div> : providers.map((providerId) => {
          const items = visible.filter((model) => model.providerId === providerId);
          const first = items[0];
          return <section key={providerId} aria-label={first.providerLabel}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/15 pb-3">
              <div className="min-w-0"><h2 className="text-base font-medium">{first.providerLabel}</h2><p className="mt-0.5 truncate text-xs text-white/35">{first.baseUrl || first.providerId}</p></div>
              {first.custom && <button className="btn-text text-xs text-red-200/70" disabled={busy === providerId} onClick={() => removeProvider(providerId)}><Icon name="trash" className="size-3.5" />删除</button>}
            </div>
            <div className="divide-y divide-white/[0.07]">{items.map((model) => {
              const key = `${model.providerId}/${model.modelId}`;
              const available = model.enabled && model.configured && model.adapterStatus === "ready";
              const check = connectionChecks[key];
              return <div key={key} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-medium">{model.modelLabel}</h3><span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/45">{labels[model.kind]}</span><span className={`text-xs ${available ? "text-accent" : "text-white/35"}`}>{available ? "可用" : !model.configured ? "待配置" : model.enabled ? "暂不可用" : "已停用"}</span></div><p className="mt-1 truncate font-mono text-[11px] text-white/35">{model.modelId}</p></div>
                <div className="flex items-center gap-4 sm:justify-end">
                  {model.custom && model.interfaceType === "openai-compatible" && <Select aria-label={`${model.modelLabel} 用途`} className="w-28 text-xs" value={model.kind} disabled={busy === key} onChange={(value) => patch(model, { kind: value as "text" | "image" })}><option value="text">文本模型</option><option value="image">生图模型</option></Select>}
                  {model.providerId === "google-gemini" && <div className="flex min-w-0 items-center gap-2">
                    <button type="button" className="btn btn-ghost btn-sm whitespace-nowrap" disabled={check?.state === "testing"} onClick={() => testConnection(model)}>
                      {check?.state === "testing" ? <Spinner className="size-3.5" /> : check?.state === "success" ? <Icon name="check" className="size-3.5 text-accent" /> : <Icon name="play" className="size-3.5" />}
                      {check?.state === "testing" ? "测试中" : "测试连接"}
                    </button>
                    {check?.state === "success" && <span className="text-xs text-accent">连接正常 · {((check.latencyMs ?? 0) / 1000).toFixed(1)}s</span>}
                    {check?.state === "error" && <span className="max-w-56 truncate text-xs text-red-200" title={check.message}>{check.message}</span>}
                  </div>}
                  <Switch checked={model.enabled} label={`${model.modelLabel}${model.enabled ? "停用" : "启用"}`} onChange={(enabled) => patch(model, { enabled })} />
                </div>
              </div>;
            })}</div>
          </section>;
        })}

        <section className="border-t border-white/15 pt-6" aria-label="添加服务商">
          <div className="flex items-start gap-3"><Icon name="plus" className="mt-0.5 size-4 text-accent" /><div><h2 className="text-base font-medium">添加第三方服务商</h2><p className="mt-1 text-xs text-white/40">连接后选择模型用途，密钥只保存在服务端。</p></div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-xs text-white/50">服务商名称<input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="服务商名称" /></label><label className="space-y-1.5 text-xs text-white/50">接口协议<Select value={interfaceType} onChange={(value) => setInterfaceType(value as typeof interfaceType)}><option value="openai-compatible">OpenAI Compatible</option><option value="anthropic">Anthropic Messages</option></Select></label><label className="space-y-1.5 text-xs text-white/50">Base URL<input className="input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://host/v1" /></label><label className="space-y-1.5 text-xs text-white/50">API Key<input className="input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="输入密钥" /></label></div>
          <div className="mt-4 flex justify-end"><button className="btn btn-primary btn-sm" disabled={adding || !name.trim() || !baseUrl.trim() || !apiKey.trim()} onClick={addProvider}>{adding ? <Spinner className="size-3" /> : <Icon name="plus" className="size-3.5" />}添加服务商</button></div>
        </section>
      </main>
    </div>
  </div>;
}
