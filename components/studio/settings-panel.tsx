"use client";

// 制作设置面板：画幅、预算与制作预设。配音在「语音」面板。

import { useEffect, useState } from "react";
import Link from "next/link";
import { Select, Switch } from "@/components/ui";
import { type ProjectDoc } from "@/lib/core/types";
import { outputSpecIdForAspect } from "@/lib/core/output-spec";
import { isAiVideo, isStock } from "@/lib/core/video";
import { useFeedback } from "@/components/feedback";
import { PresetSection } from "@/components/preset-dialog";
import type { ProjectStore } from "./shared";
import { DisclosureRow, SettingGroup, SettingRow } from "./setting-rows";

type VoiceCatalog = { providers: { id: string; models: { id: string; voices: { id: string }[] }[] }[] };
type StockStatus = { configured: boolean; provider: string; label: string; hint?: string };

export function SettingsPanel({ store }: { store: ProjectStore }) {
  const doc = store.doc;
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [mediaModels, setMediaModels] = useState<{ id: string; label: string; kind: string }[]>([]);
  const [outputMore, setOutputMore] = useState(false);
  const [publishMore, setPublishMore] = useState(false);
  const [stockStatus, setStockStatus] = useState<StockStatus | null>(null);
  const [stockTest, setStockTest] = useState<{ state: "idle" | "testing" | "ok" | "error"; message?: string }>({ state: "idle" });
  const { confirm } = useFeedback();
  useEffect(() => { fetch("/api/voices").then((r) => r.json()).then(setCatalog).catch(() => setCatalog(null)); }, []);
  // 素材来源不在 /api/providers 里：Pexels 是检索源不是生成式服务商，所以单独一条轻量路由。
  const stockPipeline = isStock(doc?.settings.visualPipeline);
  useEffect(() => {
    if (!stockPipeline) return;
    let alive = true;
    fetch("/api/stock", { cache: "no-store" }).then((r) => r.json()).then((data: StockStatus) => { if (alive) setStockStatus(data); }).catch(() => { if (alive) setStockStatus(null); });
    return () => { alive = false; };
  }, [stockPipeline]);
  useEffect(() => {
    let alive = true;
    fetch("/api/providers", { cache: "no-store" }).then((r) => r.json()).then((data) => {
      if (alive) setMediaModels((data.providers ?? []).filter((m: { configured: boolean; enabled: boolean; kind: string }) => m.configured && m.enabled && ["image", "video"].includes(m.kind)).map((m: { providerId: string; modelId: string; providerLabel: string; modelLabel: string; kind: string }) => ({ id: `${m.providerId}::${m.modelId}`, label: `${m.providerLabel} · ${m.modelLabel}`, kind: m.kind })));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const modelId = mediaModels.find((model) => model.kind === "image")?.id;
    if (modelId && isAiVideo(doc?.settings.visualPipeline) && !doc.settings.video.referenceImageModelId) {
      store.setDoc((current) => ({ ...current, settings: { ...current.settings, video: { ...current.settings.video, referenceImageModelId: current.settings.video.referenceImageModelId || modelId } } }));
    }
  }, [mediaModels, doc?.settings.visualPipeline, doc?.settings.video.referenceImageModelId, store]);
  if (!doc) return null;
  /** 打一次真实检索。路由失败也返回 200 + ok:false，所以这里只认 `ok` 字段。 */
  async function testStock() {
    setStockTest({ state: "testing" });
    try {
      const response = await fetch("/api/stock", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const data = await response.json() as { ok?: boolean; message?: string; sample?: { durationSec?: number } };
      setStockTest(data.ok ? { state: "ok", message: `连接成功，示例素材 ${data.sample?.durationSec ?? "—"} 秒` } : { state: "error", message: data.message || "连接失败" });
    } catch (cause) {
      setStockTest({ state: "error", message: cause instanceof Error ? cause.message : String(cause) });
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
          <p className="mt-1 text-2xs text-text-faint">调整输出和成片选项。配音在「语音」里。</p>
        </div>
        {store.save !== "idle" && <span className="shrink-0 text-2xs text-text-faint">{store.save === "saving" ? "保存中" : store.save === "saved" ? "已保存" : store.save === "conflict" ? "有冲突" : "保存失败"}</span>}
      </div>

      <div className="space-y-0 px-5 sm:px-6">
        <SettingGroup title="预设">
          <PresetSection doc={doc} store={store} catalog={catalog} />
        </SettingGroup>

        <SettingGroup title="画面驱动">
          <Select aria-label="画面驱动管线" value={doc.settings.visualPipeline} onChange={(value) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, visualPipeline: value as ProjectDoc["settings"]["visualPipeline"], video: { ...current.settings.video, referenceImageModelId: current.settings.video.referenceImageModelId || (isAiVideo(value) ? mediaModels.find((m) => m.kind === "image")?.id ?? "" : "") } } }))}>
            <option value="image">图片驱动</option><option value="video">AI 视频驱动</option><option value="stock">视频素材（Pexels）</option>
          </Select>
          {isStock(doc.settings.visualPipeline) && <div className="mt-3 space-y-3">
            <div className="rounded-control border border-hairline bg-white/[0.02] px-3 py-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-text-secondary">素材来源 · {stockStatus?.label ?? "Pexels"}</span>
                <span className={stockStatus?.configured ? "text-accent" : "text-warn"}>{stockStatus === null ? "正在检查…" : stockStatus.configured ? "Key 已配置" : "Key 未配置"}</span>
              </div>
              {stockStatus && !stockStatus.configured && <p className="mt-1.5 text-2xs leading-5 text-text-faint">{stockStatus.hint ?? "在 .env.local 配置 PEXELS_API_KEY 后重启后台。"}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className="chip h-7 px-2.5 text-xs" disabled={!stockStatus?.configured || stockTest.state === "testing"} onClick={() => void testStock()}>{stockTest.state === "testing" ? "正在测试…" : "测试连接"}</button>
                {stockTest.state === "ok" && <span className="text-2xs text-accent">{stockTest.message}</span>}
                {stockTest.state === "error" && <span className="text-2xs text-danger">{stockTest.message}</span>}
              </div>
            </div>
            <label className="block space-y-1 text-xs"><span>素材最短时长（秒）</span>
              <input className="input h-8 w-24 py-1 text-right text-sm" type="number" min="1" max="600" aria-label="素材最短时长（秒）" value={doc.settings.stock.minDurationSec} onChange={(event) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, stock: { ...current.settings.stock, minDurationSec: Math.min(600, Math.max(1, Math.round(Number(event.target.value) || 1))) } } }))} />
            </label>
            <label className="block space-y-1 text-xs"><span>每次检索取回条数</span>
              <input className="input h-8 w-24 py-1 text-right text-sm" type="number" min="1" max="80" aria-label="每次检索取回条数" value={doc.settings.stock.perPage} onChange={(event) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, stock: { ...current.settings.stock, perPage: Math.min(80, Math.max(1, Math.round(Number(event.target.value) || 1))) } } }))} />
            </label>
            <p className="text-2xs leading-5 text-text-faint">按每个镜头的检索词去 {stockStatus?.label ?? "Pexels"} 找真实视频，自动采用第一条够长、能填满画幅的素材。实际最短时长取这里与镜头时长的较大者；检索方向由输出画幅决定（竖屏素材塞进横屏会被裁掉两侧）。免费额度 200 请求/小时，搜索与下载都算。</p>
          </div>}
          {isAiVideo(doc.settings.visualPipeline) && <div className="mt-3 space-y-3">
            <label className="block space-y-1 text-xs"><span>制作方式</span><Select aria-label="视频制作方式" value={doc.settings.video.autoContinue ? "auto" : "review"} onChange={(mode) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, video: { ...current.settings.video, autoContinue: mode === "auto" } } }))}><option value="review">整批审图后继续（推荐）</option><option value="auto">自动制作</option></Select></label>
            <p className="text-2xs leading-5 text-text-faint">整批审图只需标记不满意的画面，其余一次确认。自动制作会在参考图完成后继续视频和合成；参考图与视频费用以服务商账单为准。</p>
            <details><summary className="cursor-pointer text-xs">模型与清晰度 · 项目统一设置</summary><div className="mt-3 space-y-3">
            <label className="block space-y-1 text-xs"><span>视频模型</span><Select aria-label="视频模型" value={doc.settings.video.modelId} onChange={(modelId) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, video: { ...current.settings.video, modelId } } }))}>
              {!mediaModels.some((m) => m.id === doc.settings.video.modelId) && <option value={doc.settings.video.modelId}>MiniMax H3 · 未配置或未启用</option>}
              {mediaModels.filter((m) => m.kind === "video").map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select></label>
            <label id="reference-image-model-settings" className="block space-y-1 text-xs"><span>参考图模型</span><Select aria-label="参考图模型" value={doc.settings.video.referenceImageModelId} onChange={(referenceImageModelId) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, video: { ...current.settings.video, referenceImageModelId } } }))}>
              {doc.settings.video.referenceImageModelId && !mediaModels.some((model) => model.id === doc.settings.video.referenceImageModelId) && <option value={doc.settings.video.referenceImageModelId}>当前参考图模型未配置或未启用</option>}
              <option value="">自动选择可用图片模型</option>{mediaModels.filter((m) => m.kind === "image").map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select></label>
            <Link href="/settings/providers" className="inline-block text-xs text-text-secondary underline underline-offset-4">在模型中心检查服务商与权限</Link>
            <label className="block space-y-1 text-xs"><span>视频生成分辨率</span><Select aria-label="视频生成分辨率" value={doc.settings.video.resolution} onChange={(resolution) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, video: { ...current.settings.video, resolution: resolution as "480p" | "768p" } } }))}><option value="480p">480p</option><option value="768p">768p</option></Select></label>
            <p className="text-2xs leading-5 text-text-faint">以上参数由所有镜头继承，可保存到制作预设。生成源为 {doc.settings.video.resolution}，1080p 成片导出不会增加源视频细节。</p>
            </div></details>
          </div>}
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

        <SettingGroup title="角色和场景">
          <SettingRow label="自动生成角色和场景标准图">
            <Switch checked={doc.settings.autoPortrait} label="自动生成角色和场景标准图" onChange={(checked) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, autoPortrait: checked } }))} />
          </SettingRow>
          <p className="mt-2 text-2xs leading-5 text-text-faint">
            开启后，阅读全文识别角色和主要地点，为需要立绘的角色生成 1 张立绘，为每个缺少标准图的场景生成 1 张空场景图，之后的镜头共用。场景描述或画面风格修改后会更新自动生成的场景图；上传的参考图保留。生图费用由图片服务商收取，不计入预算与开工预估。
          </p>
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
            <SettingRow label="动画音效">
              <Switch checked={doc.settings.sfx.enabled} label="动画音效" onChange={(checked) => store.setDoc((current) => ({ ...current, settings: { ...current.settings, sfx: { enabled: checked } } }))} />
            </SettingRow>
          </div>}
        </SettingGroup>
      </div>
    </section>
  );
}
