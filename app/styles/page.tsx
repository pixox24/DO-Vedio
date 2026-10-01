"use client";

import { useState } from "react";
import Image from "next/image";
import { Icon, Spinner } from "@/components/ui";
import { postJson, useAixStyles, useVisualStyles } from "@/lib/client";
import { styleMediumLabels, visualStyleInputSchema, type VisualStyle, type VisualStyleInput } from "@/lib/core/types";
import { defaultMotionProfile } from "@/lib/core/motion";
import { StyleCover, StyleEditor, StylePromptPreview, StyleSamples } from "@/components/visual-style-editor";
import { useFeedback } from "@/components/feedback";

type Editing = { id?: string; value: VisualStyleInput } | null;

const strip = (s: VisualStyle): VisualStyleInput => visualStyleInputSchema.parse(s);

export default function StylesPage() {
  const { styles, reload } = useVisualStyles();
  const { items: aixItems } = useAixStyles();
  const [editing, setEditing] = useState<Editing>(null);
  const { confirm, toast } = useFeedback();

  async function remove(s: VisualStyle) {
    if (!(await confirm({ title: `删除风格「${s.name}」？`, message: "已经在用这个风格的项目不受影响（项目里保存的是风格快照）。", confirmLabel: "删除", tone: "danger", bullets: ["预计费用：不产生服务商费用。", "影响范围：风格库中的这条记录会被删除，已有项目不受影响。", "可恢复：删除后不能从风格库恢复。"] }))) return;
    try {
      await postJson(`/api/visual-styles/${s.id}`, undefined, "DELETE");
      await reload();
      toast("风格已删除", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  return (
    <div className="pt-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="label">风格库</p>
          <h1 className="mt-3 text-5xl font-semibold tracking-[-0.03em]">画面风格</h1>
          <p className="mt-3 max-w-xl text-sm text-white/45">决定画面「怎么画」：画风、色彩、光影、氛围和质感。分镜只负责「画什么」，生图时风格会统一注入，换风格不会改变画面内容。</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({ value: { name: "我的风格", description: "", medium: "illustration", rendering: "", texture: "", palette: { schemes: [["#173653", "#24728a", "#8bd4d7"]], accent: "#cdff3a" }, colorGrade: "", saturation: "mid", contrast: "mid", lighting: "", atmosphere: "", moodTweaks: {}, deniedMoods: [], lens: "", depthOfField: "shallow", composition: "", negative: [], strength: "normal", motion: defaultMotionProfile, suits: [] } })}>
          <Icon name="plus" /> 新建风格
        </button>
      </div>

      {editing && (
        <Editor
          key={editing.id ?? "new"}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}

      <div className="mt-10 mb-8 flex items-center justify-between"><div><p className="label">Aix 风格库</p><p className="mt-1 text-xs text-white/45">160 种系统风格，选择时直接写入项目快照。</p></div></div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {aixItems.map((s) => <article key={s.id} className="panel overflow-hidden"><Image src={s.thumbnailPath} alt={s.thumbnailAlt} width={360} height={640} unoptimized loading="lazy" className="aspect-[9/16] w-full object-cover" /><div className="p-4"><h2 className="text-sm font-semibold">{s.name}</h2><p className="mt-1 line-clamp-2 text-xs text-white/45">{s.description}</p><p className="mt-2 text-[10px] text-white/35">{s.id} · {s.tags.slice(0, 2).join(" · ")}</p></div></article>)}
      </div>
      <div className="mt-12 mb-8 flex items-center justify-between"><div><p className="label">我的风格</p><p className="mt-1 text-xs text-white/45">用户创建的风格独立保存，不会覆盖 Aix 系统目录。</p></div></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {styles.map((s) => (
          <article key={s.id} className="panel group flex flex-col overflow-hidden transition hover:border-white/15">
            <StyleCover style={s} />
            <div className="flex flex-1 flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight">{s.name}</h2>
                  <p className="mt-1 text-xs text-white/45">{s.description}</p>
                </div>
                <span className="shrink-0 rounded-full bg-accent/15 px-2.5 py-0.5 text-[10px] text-accent">我的风格</span>
              </div>
              <p className="mt-3 flex-1 text-xs leading-5 text-white/50">
                {styleMediumLabels[s.medium]}
                {s.colorGrade && ` · ${s.colorGrade}`}
                {s.atmosphere && ` · ${s.atmosphere}`}
              </p>
              <div className="mt-4 flex items-center justify-end gap-1.5 border-t border-white/[0.06] pt-4 opacity-60 transition group-hover:opacity-100">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ value: { ...strip(s), name: s.name }, id: s.id })}>
                  <Icon name="edit" className="size-3.5" />
                  编辑
                </button>
                <button className="btn btn-ghost btn-sm hover:border-red-400/40 hover:text-red-300" aria-label="删除" onClick={() => remove(s)}>
                  <Icon name="trash" className="size-3.5" />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Editor({ initial, onClose, onSaved }: { initial: NonNullable<Editing>; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(initial.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      await postJson(initial.id ? `/api/visual-styles/${initial.id}` : "/api/visual-styles", value, initial.id ? "PUT" : "POST");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <div className="mt-10 grid animate-rise gap-4 lg:grid-cols-[1fr_380px]">
      <div className="panel p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{initial.id ? "编辑风格" : "新建风格"}</h2>
          <button className="cursor-pointer text-sm text-white/40 hover:text-white" onClick={onClose}>
            取消
          </button>
        </div>
        <StyleEditor value={value} onChange={setValue} />
        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
        <div className="mt-6 flex justify-end">
          <button className="btn btn-primary" disabled={!value.name.trim() || busy} onClick={save}>
            {busy ? <Spinner /> : <Icon name="check" />}
            保存风格
          </button>
        </div>
      </div>
      <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <div className="panel p-5">
          <StylePromptPreview value={value} />
        </div>
        <div className="panel p-5">
          <StyleSamples value={value} />
        </div>
      </div>
    </div>
  );
}
