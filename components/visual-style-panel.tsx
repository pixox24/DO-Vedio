"use client";

import { useState } from "react";
import Image from "next/image";
import { Icon } from "@/components/ui";
import { fetchAixDetail, postJson, useAixStyles, useVisualStyles } from "@/lib/client";
import { aixToVisualStyle } from "@/lib/aix/adapter";
import type { AixCompact } from "@/lib/aix/schema";
import { compileShotPrompt } from "@/lib/core/prompt-compiler";
import { styleMediumLabels, visualStyleInputSchema, type ProjectDoc, type VisualStyle, type VisualStyleInput } from "@/lib/core/types";
import { StyleCover, StyleEditor, StylePromptPreview, StyleSamples } from "@/components/visual-style-editor";
import { useFeedback } from "@/components/feedback";

/**
 * 项目「画面风格」面板：选风格（按解说风格推荐）、项目内微调、从风格库更新、另存为新风格。
 * 项目里保存的是风格快照；换风格会让已生成的画面过期（旧图保留，不自动重新生成）。
 */

type Store = { doc: ProjectDoc | null; setDoc: (fn: (doc: ProjectDoc) => ProjectDoc) => void };

const strip = (s: VisualStyle): VisualStyleInput => visualStyleInputSchema.parse(s);
const same = (a: VisualStyle, b: VisualStyle) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));

/** 换成这个风格后，有多少张已生成的画面会过期 */
function staleCount(doc: ProjectDoc, style: VisualStyle | null) {
  const next = { ...doc, visualStyle: style };
  return doc.shots.filter((s) => (s.kind === "image" || s.kind === "video") && s.assetId && compileShotPrompt(next, s).hash !== s.assetPromptHash).length;
}

export function VisualStylePanel({ store }: { store: Store }) {
  const doc = store.doc;
  const { styles: customStyles, reload } = useVisualStyles();
  const { items: aixItems } = useAixStyles();
  const [view, setView] = useState<"current" | "pick" | "edit">("current");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm, toast } = useFeedback();
  if (!doc) return null;
  const current = doc.visualStyle;
  const recommended = aixItems[0];
  const currentAixId = current?.source?.kind === "aix" ? current.source.aixId : undefined;
  const source = currentAixId ? (aixItems.some((s) => s.id === currentAixId) ? current : undefined) : customStyles.find((s) => s.id === current?.id);
  const tweaked = !!(current && source && !same(source, current));

  async function apply(style: VisualStyle, reason: "switch" | "update") {
    if (!doc) return;
    const n = staleCount(doc, style);
    const parts = [
      n > 0 && `${n} 张已生成的画面会标记为过期（旧图保留，不会自动重新生成，可以在「镜头」里一键重新生成）。`,
      reason === "switch" && tweaked && "项目里对当前风格的微调会丢失。",
      "信息卡、标题卡会立刻换成新配色。",
    ].filter(Boolean);
    if ((n > 0 || tweaked) && !(await confirm({ title: reason === "update" ? `更新为风格库中的「${style.name}」？` : `切换到「${style.name}」？`, message: parts.join(""), confirmLabel: reason === "update" ? "更新" : "切换", bullets: [`预计费用：不自动重新生成图片，不产生新的生图费用。`, `影响范围：${n ? `${n} 张旧图会标记为过期` : "仅更新当前项目的风格设置"}。`, "可恢复：可以再次切换或恢复风格库版本。"] }))) return;
    store.setDoc((d) => ({ ...d, visualStyle: style }));
    setView("current");
  }

  async function applyAix(id: string) {
    setBusyId(id);
    try {
      const detail = await fetchAixDetail(id);
      await apply(aixToVisualStyle(detail, "normal", detail.libraryVersion), "switch");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function saveAsNew() {
    if (!current) return;
    try {
      const created = await postJson<VisualStyle>("/api/visual-styles", { ...strip(current), name: `${current.name}（${doc?.brief.title || "项目"}）` });
      await reload();
      store.setDoc((d) => ({ ...d, visualStyle: created }));
      toast(`已保存为新风格「${created.name}」`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  return (
    <div className="space-y-5 p-4 sm:p-5">
      {view === "current" && (
        <>
          {current ? (
            <div className="overflow-hidden rounded-xl border border-white/10">
              <StyleCover style={current} />
              <div className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold">{current.name}</h3>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/50">{styleMediumLabels[current.medium]}</span>
                  {tweaked && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">已在项目中微调</span>}
                  {!source && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/45">风格库中已删除</span>}
                </div>
                <p className="text-xs text-white/50">{current.description}</p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => setView("pick")}>
                    换风格
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setView("edit")}>
                    <Icon name="edit" className="size-3.5" />
                    在项目中微调
                  </button>
                  {tweaked && source && (
                    <button className="btn btn-ghost btn-sm" onClick={() => apply(source, "update")}>
                      恢复为风格库版本
                    </button>
                  )}
                  {(tweaked || !source) && (
                    <button className="btn btn-ghost btn-sm" onClick={saveAsNew}>
                      <Icon name="copy" className="size-3.5" />
                      另存为新风格
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-accent/25 bg-accent/[0.04] p-4">
              <p className="text-sm text-white/80">还没有选择画面风格。</p>
              <p className="mt-1 text-xs leading-5 text-white/50">{recommended ? `生成图片时会自动采用推荐的「${recommended.name}」。也可以现在就选好，信息卡和标题卡会跟着换配色。` : "生成图片时会自动采用推荐风格。"}</p>
              <div className="mt-3 flex gap-2">
                {recommended && (
              <button className="btn btn-primary btn-sm" onClick={() => applyAix(recommended.id)} disabled={!!busyId}>
                    使用「{recommended.name}」
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => setView("pick")}>
                  选择其他风格
                </button>
              </div>
            </div>
          )}
          {current && (
            <div className="grid gap-4 xl:grid-cols-2">
              <StylePromptPreview value={strip(current)} />
              <StyleSamples value={strip(current)} />
            </div>
          )}
        </>
      )}

      {view === "pick" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="label">选择画面风格</p>
            <button className="text-sm text-white/40 hover:text-white" onClick={() => setView("current")}>
              取消
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {[['', '全部'], ['illustration', '插画'], ['painting', '绘画'], ['photographic', '摄影'], ['3d', '3D'], ['graphic', '平面']].map(([value, label]) => <button key={value} type="button" className={`btn btn-ghost btn-sm ${category === value ? "border-accent/50 text-accent" : ""}`} onClick={() => setCategory(value)}>{label}</button>)}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            <div className="col-span-full">
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索风格名称、编号、标签" className="input w-full" />
            </div>
            {aixItems.filter((s) => (!category || s.category === category) && (!query || [s.id, s.name, s.description, ...s.tags, ...s.aliases].join(" ").toLowerCase().includes(query.toLowerCase()))).map((s) => (
              <AixCard key={s.id} item={s} current={current?.source?.kind === "aix" && current.source.aixId === s.id} busy={busyId === s.id} onClick={() => applyAix(s.id)} />
            ))}
          </div>
        </div>
      )}

      {view === "edit" && current && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="label">在项目中微调「{current.name}」</p>
            <button className="btn btn-ghost btn-sm" onClick={() => setView("current")}>
              <Icon name="check" className="size-3.5" />
              完成
            </button>
          </div>
          <p className="text-xs text-white/45">只影响这个项目；改动会让已生成的画面过期。想在其他项目复用，可以「另存为新风格」。</p>
          <StyleEditor value={strip(current)} onChange={(v) => store.setDoc((d) => ({ ...d, visualStyle: { ...v, id: current.id, source: current.source, themeSource: current.themeSource } }))} />
          <StylePromptPreview value={strip(current)} />
        </div>
      )}
    </div>
  );
}

function AixCard({ item, current, busy, onClick }: { item: AixCompact; current: boolean; busy: boolean; onClick: () => void }) {
  return <button type="button" className={`overflow-hidden rounded-xl border text-left transition hover:border-white/30 ${current ? "border-accent" : "border-white/10"}`} onClick={onClick} disabled={busy}>
    <Image src={item.thumbnailPath} alt={item.thumbnailAlt} width={360} height={640} unoptimized loading="lazy" className="aspect-[9/16] w-full object-cover" />
    <div className="p-3"><div className="flex items-center gap-2"><span className="text-sm font-medium">{item.name}</span>{current && <span className="text-[10px] text-accent">当前</span>}{busy && <span className="text-[10px] text-white/45">读取中</span>}</div><p className="mt-1 line-clamp-2 text-xs text-white/45">{item.description}</p><p className="mt-2 text-[10px] text-white/35">{item.id} · {item.tags.slice(0, 2).join(" · ")}</p></div>
  </button>;
}
