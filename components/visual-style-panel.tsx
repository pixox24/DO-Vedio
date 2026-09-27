"use client";

import { useState } from "react";
import { Icon } from "@/components/ui";
import { postJson, useVisualStyles } from "@/lib/client";
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
  const { styles, reload } = useVisualStyles(doc?.brief.templateId);
  const [view, setView] = useState<"current" | "pick" | "edit">("current");
  const { confirm, toast } = useFeedback();
  if (!doc) return null;
  const current = doc.visualStyle;
  const recommended = styles[0];
  const source = current ? styles.find((s) => s.id === current.id) : undefined;
  const tweaked = !!(current && source && !same(source, current));

  async function apply(style: VisualStyle, reason: "switch" | "update") {
    if (!doc) return;
    const n = staleCount(doc, style);
    const parts = [
      n > 0 && `${n} 张已生成的画面会标记为过期（旧图保留，不会自动重新生成，可以在「镜头」里一键重新生成）。`,
      reason === "switch" && tweaked && "项目里对当前风格的微调会丢失。",
      "信息卡、标题卡会立刻换成新配色。",
    ].filter(Boolean);
    if ((n > 0 || tweaked) && !(await confirm({ title: reason === "update" ? `更新为风格库中的「${style.name}」？` : `切换到「${style.name}」？`, message: parts.join(""), confirmLabel: reason === "update" ? "更新" : "切换" }))) return;
    store.setDoc((d) => ({ ...d, visualStyle: style }));
    setView("current");
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

  const suits = (s: VisualStyle) => s.suits.includes(doc.brief.templateId);

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
                  <button className="btn btn-primary btn-sm" onClick={() => apply(recommended, "switch")}>
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
          <div className="grid gap-3 sm:grid-cols-2">
            {styles.map((s) => (
              <button key={s.id} className={`overflow-hidden rounded-xl border text-left transition hover:border-white/30 ${current?.id === s.id ? "border-white" : "border-white/10"}`} onClick={() => (current?.id === s.id ? setView("current") : apply(s, "switch"))}>
                <StyleCover style={s} />
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.name}</span>
                    {suits(s) && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">推荐</span>}
                    {current?.id === s.id && <span className="text-[10px] text-white/45">当前</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-white/45">{s.description}</p>
                </div>
              </button>
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
          <StyleEditor value={strip(current)} onChange={(v) => store.setDoc((d) => ({ ...d, visualStyle: { ...v, id: current.id, builtin: current.builtin } }))} />
          <StylePromptPreview value={strip(current)} />
        </div>
      )}
    </div>
  );
}
