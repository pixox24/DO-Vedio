"use client";

// 制作设置面板：画幅、预算与制作预设。配音在「语音」面板。

import { useEffect, useState } from "react";
import { Select, Switch } from "@/components/ui";
import { type ProjectDoc } from "@/lib/core/types";
import { outputSpecIdForAspect } from "@/lib/core/output-spec";
import { useFeedback } from "@/components/feedback";
import { PresetSection } from "@/components/preset-dialog";
import type { ProjectStore } from "./shared";
import { DisclosureRow, SettingGroup, SettingRow } from "./setting-rows";

type VoiceCatalog = { providers: { id: string; models: { id: string; voices: { id: string }[] }[] }[] };

export function SettingsPanel({ store }: { store: ProjectStore }) {
  const doc = store.doc;
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [outputMore, setOutputMore] = useState(false);
  const [publishMore, setPublishMore] = useState(false);
  const { confirm } = useFeedback();
  useEffect(() => { fetch("/api/voices").then((r) => r.json()).then(setCatalog).catch(() => setCatalog(null)); }, []);
  if (!doc) return null;
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
