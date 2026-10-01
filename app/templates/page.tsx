"use client";

import { useState } from "react";
import { slangLevels } from "@/lib/memes";
import { AutoTextarea, Field, Icon, Select, Spinner } from "@/components/ui";
import { postJson, useModels, useTemplates } from "@/lib/client";
import { speechRateLabels, templateInputSchema, type StyleTemplate, type TemplateInput } from "@/lib/types";
import { useFeedback } from "@/components/feedback";

const blank: TemplateInput = { name: "", description: "", tone: "", speechRate: "medium", structureHints: "", ideation: "", slang: "off", dos: [], donts: [], sample: "" };

type Editing = { id?: string; value: TemplateInput } | null;

export default function TemplatesPage() {
  const { templates, reload } = useTemplates();
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState("");
  const { confirm, toast } = useFeedback();

  // zod 默认丢弃 schema 外的字段（id、builtin）
  const strip = (t: StyleTemplate): TemplateInput => templateInputSchema.parse(t);

  async function remove(t: StyleTemplate) {
    if (!(await confirm({ title: `删除模板「${t.name}」？`, message: "删除后，使用这个模板的新稿件将无法再引用它。", confirmLabel: "删除", tone: "danger", bullets: ["预计费用：不产生服务商费用。", "影响范围：新稿件不能再引用这条模板，已有稿件不受影响。", "可恢复：删除后不能从模板库恢复。"] }))) return;
    try {
      await postJson(`/api/templates/${t.id}`, undefined, "DELETE");
      await reload();
      toast("模板已删除", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  return (
    <div className="pt-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="label">风格库</p>
          <h1 className="mt-3 text-5xl font-semibold tracking-[-0.03em]">风格模板</h1>
          <p className="mt-3 max-w-lg text-sm text-white/45">内置 8 种解说风格。你也可以手动创建，或粘贴自己过去的文案，让 AI 提炼出专属风格。</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({ value: blank })}>
          <Icon name="plus" /> 新建模板
        </button>
      </div>

      {error && <p className="mt-6 rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-200/90">{error}</p>}

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

      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((t) => (
          <article key={t.id} className="panel group flex flex-col p-6 transition hover:border-white/15">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{t.name}</h2>
                <p className="mt-1 text-xs text-white/45">{t.description}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] ${t.builtin ? "bg-white/[0.06] text-white/45" : "bg-accent/15 text-accent"}`}>
                {t.builtin ? "内置" : "自定义"}
              </span>
            </div>
            <blockquote className="mt-5 flex-1 border-l-2 border-accent/40 pl-4 text-sm leading-relaxed text-white/60">{t.sample}</blockquote>
            <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4">
              <span className="text-[11px] text-white/35">{speechRateLabels[t.speechRate]}语速</span>
              <div className="flex gap-1.5 opacity-60 transition group-hover:opacity-100">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEditing({ value: { ...strip(t), name: t.builtin ? `${t.name}（副本）` : t.name }, id: t.builtin ? undefined : t.id })}
                >
                  <Icon name={t.builtin ? "copy" : "edit"} className="size-3.5" />
                  {t.builtin ? "复制修改" : "编辑"}
                </button>
                {!t.builtin && (
                  <button className="btn btn-ghost btn-sm hover:border-red-400/40 hover:text-red-300" onClick={() => remove(t)}>
                    <Icon name="trash" className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Editor({ initial, onClose, onSaved }: { initial: NonNullable<Editing>; onClose: () => void; onSaved: () => void }) {
  const models = useModels();
  const [modelId, setModelId] = useState("");
  const [value, setValue] = useState(initial.value);
  const [samples, setSamples] = useState(["", ""]);
  const [busy, setBusy] = useState<null | "extract" | "save">(null);
  const [error, setError] = useState("");
  const set = (p: Partial<TemplateInput>) => setValue((v) => ({ ...v, ...p }));
  const model = modelId || models?.[0]?.id || "";

  async function extract() {
    setBusy("extract");
    setError("");
    try {
      setValue(await postJson<TemplateInput>("/api/templates/extract", { modelId: model, samples }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError("");
    try {
      await postJson(initial.id ? `/api/templates/${initial.id}` : "/api/templates", value, initial.id ? "PUT" : "POST");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const lines = (a: string[]) => a.join("\n");
  const toLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  return (
    <div className="mt-10 grid animate-rise gap-4 lg:grid-cols-[380px_1fr]">
      <div className="panel space-y-4 p-6">
        <div>
          <p className="label">AI 风格提炼</p>
          <p className="mt-2 text-sm leading-relaxed text-white/45">粘贴 1–3 篇你过去写的文案，AI 会分析语气、句式和结构，自动填好右侧表单。</p>
        </div>
        {samples.map((s, i) => (
          <textarea
            key={i}
            className="input h-36 resize-y leading-relaxed"
            value={s}
            placeholder={`样本文案 ${i + 1}`}
            onChange={(e) => setSamples((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
          />
        ))}
        {samples.length < 3 && (
          <button className="text-xs text-white/40 transition hover:text-white" onClick={() => setSamples((a) => [...a, ""])}>
            + 再加一篇
          </button>
        )}
        <Select value={model} onChange={setModelId}>
          {models?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} · {m.model}
            </option>
          ))}
        </Select>
        <button className="btn btn-primary w-full" disabled={!model || !samples.some((s) => s.trim()) || busy !== null} onClick={extract}>
          {busy === "extract" ? <Spinner /> : <Icon name="sparkle" />}
          提炼风格
        </button>
      </div>

      <div className="panel space-y-5 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{initial.id ? "编辑模板" : "新建模板"}</h2>
          <button className="cursor-pointer text-sm text-white/40 hover:text-white" onClick={onClose}>
            取消
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_140px_140px]">
          <Field label="名称">
            <input className="input" value={value.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="一句话描述">
            <input className="input" value={value.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="默认语速">
            <Select value={value.speechRate} onChange={(v) => set({ speechRate: v as TemplateInput["speechRate"] })}>
              <option value="slow">舒缓</option>
              <option value="medium">适中</option>
              <option value="fast">紧凑</option>
            </Select>
          </Field>
          <Field label="默认网感">
            <Select value={value.slang} onChange={(v) => set({ slang: v as TemplateInput["slang"] })}>
              {Object.entries(slangLevels).map(([id, l]) => (
                <option key={id} value={id}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="语气与人设">
          <AutoTextarea className="input" value={value.tone} onChange={(e) => set({ tone: e.target.value })} />
        </Field>
        <Field label="结构偏好">
          <AutoTextarea className="input" value={value.structureHints} onChange={(e) => set({ structureHints: e.target.value })} />
        </Field>
        <Field label="选题偏好" hint="概要留空时，AI 按它来构思切入角度">
          <AutoTextarea
            className="input"
            value={value.ideation}
            placeholder="例如：找一个具体的人和一个具体的瞬间，从小细节切入"
            onChange={(e) => set({ ideation: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="推荐写法" hint="每行一条">
            <AutoTextarea className="input min-h-24" value={lines(value.dos)} onChange={(e) => set({ dos: e.target.value.split("\n") })} onBlur={(e) => set({ dos: toLines(e.target.value) })} />
          </Field>
          <Field label="禁止写法" hint="每行一条">
            <AutoTextarea className="input min-h-24" value={lines(value.donts)} onChange={(e) => set({ donts: e.target.value.split("\n") })} onBlur={(e) => set({ donts: toLines(e.target.value) })} />
          </Field>
        </div>
        <Field label="示范段落" hint="100–200 字，AI 会模仿它的语气节奏">
          <AutoTextarea className="input min-h-24 leading-relaxed" value={value.sample} onChange={(e) => set({ sample: e.target.value })} />
        </Field>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex justify-end">
          <button className="btn btn-primary" disabled={!value.name.trim() || busy !== null} onClick={() => save()}>
            {busy === "save" ? <Spinner /> : <Icon name="check" />}
            保存模板
          </button>
        </div>
      </div>
    </div>
  );
}
