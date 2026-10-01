"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Icon, Select, Spinner } from "@/components/ui";
import { jobAction, postJson, useImageModels } from "@/lib/client";
import { anchorText, castKeyOf, editCharacterField, sheetKindLabels, sheetSourceHash, type SheetKind } from "@/lib/core/cast";
import { newId } from "@/lib/core/sync";
import {
  characterCardSchema,
  characterRoleLabels,
  characterRoles,
  mediaUrl,
  narrativeModeLabels,
  presentationLabels,
  presentations,
  type CharacterCard,
  type CharacterField,
  type FieldSource,
  type Job,
  type ProjectDoc,
} from "@/lib/core/types";
import { useFeedback } from "@/components/feedback";

/**
 * 「角色」面板：选角结果、角色卡编辑（字段标注来源）、定妆工作台。
 * 选定的立绘就是这个角色的标准形象，之后所有镜头以它为参考。
 */

type Store = { doc: ProjectDoc | null; setDoc: (fn: (doc: ProjectDoc) => ProjectDoc) => void; flush: () => Promise<unknown> };

const sourceMeta: Record<FieldSource, { label: string; tone: string; hint: string }> = {
  explicit: { label: "原文", tone: "text-accent", hint: "原文明确写了，修改会与文案矛盾" },
  inferred: { label: "推断", tone: "text-sky-300", hint: "从时代、职业、性格等上下文推断" },
  default: { label: "补全", tone: "text-white/40", hint: "原文没有信息，按题材补全" },
  user: { label: "已改", tone: "text-amber-200", hint: "你改过，重新识别不会覆盖" },
};

const fieldGroups: { title: string; fields: [CharacterField, string, string][] }[] = [
  { title: "身份", fields: [["ageRange", "年龄", "如：二十出头"], ["gender", "性别", ""], ["era", "时代", "如：明朝、九十年代"], ["region", "地域", "仅当背景需要"], ["occupation", "职业", ""]] },
  { title: "外貌", fields: [["hair", "发型", "如：齐耳黑色短发"], ["eyes", "眼睛", ""], ["faceShape", "脸型", ""], ["facialHair", "胡须", ""], ["marks", "标记", "疤痕、痣等"], ["build", "体型", ""], ["height", "身高", ""]] },
];

export function CastPanel({ id, store, jobs }: { id: string; store: Store; jobs: Map<string, Job> }) {
  const doc = store.doc;
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm } = useFeedback();
  if (!doc) return null;
  const analysis = doc.castAnalysis;
  const castJob = [...jobs.values()].findLast((j) => j.stage === "cast" && j.projectId === id);
  const running = !!castJob && ["queued", "running"].includes(castJob.status);
  const present = doc.characters.filter((c) => !c.absent);
  const absent = doc.characters.filter((c) => c.absent);
  const unstyled = present.filter((c) => c.presentation === "full" && !c.sheet.portraitAssetId && !c.locked);

  async function analyze(force: boolean) {
    if (force && !(await confirm({ title: "重新识别角色？", message: "会调用一次大模型重新阅读全文。锁定的角色、你改过的字段和已经定妆的图片都会保留。", confirmLabel: "重新识别", bullets: ["预计费用：会调用一次文本模型，费用以服务商账单为准。", "影响范围：重新分析全文；锁定字段和已定妆图片保留。", "可恢复：新结果写回前可停止任务，已有角色字段不会被锁定内容覆盖。"] }))) return;
    setBusy(true);
    setError("");
    try {
      await store.flush();
      await postJson(`/api/projects/${id}/cast`, { force });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function addCharacter() {
    const card = characterCardSchema.parse({ id: newId(), name: "新角色", key: castKeyOf(`新角色${doc!.characters.length + 1}`), role: "supporting", looks: [{ id: "look-1", name: "默认" }] });
    store.setDoc((d) => ({ ...d, characters: [...d.characters, card] }));
    setOpen(card.id);
  }

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label">选角</p>
          <p className="mt-1 text-xs leading-5 text-white/50">
            {analysis ? analysis.modes.map((m) => `第 ${m.segmentIndex + 1} 章 ${narrativeModeLabels[m.mode]}`).join(" · ") || "已识别" : "还没有识别角色。一键成片时会自动识别，也可以现在就识别。"}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" disabled={busy || running} onClick={() => analyze(!!analysis)}>
            {busy || running ? <Spinner className="size-3" /> : <Icon name="sparkle" className="size-3.5" />}
            {running ? `识别中${castJob?.progress ? ` · ${Math.round(castJob.progress * 100)}%` : ""}` : analysis ? "重新识别" : "识别角色"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={addCharacter}>
            <Icon name="plus" className="size-3.5" />
            新增角色
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      {castJob?.status === "failed" && <p className="text-xs text-red-300">识别失败：{castJob.error}</p>}
      {analysis && analysis.issues.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200/20 bg-amber-200/[0.04] p-3 text-xs leading-5 text-amber-100/80">
          {analysis.issues.map((x) => (
            <li key={x}>· {x}</li>
          ))}
        </ul>
      )}
      {unstyled.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/25 bg-accent/[0.04] p-3">
          <p className="text-xs leading-5 text-white/70">
            {unstyled.length} 个角色还没定妆（{unstyled.map((c) => c.name).join("、")}）。定妆就是先生成角色的标准形象，之后镜头里的人物以它为参考，前后才长得一样。
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => setOpen(unstyled[0].id)}>
            <Icon name="sparkle" className="size-3.5" />
            开始定妆
          </button>
        </div>
      )}
      {analysis && present.length === 0 && <p className="rounded-lg border border-white/10 p-4 text-center text-sm text-white/45">这期视频的画面不需要固定角色。</p>}

      <div className="space-y-3">
        {present.map((card) => (
          <CharacterItem key={card.id} projectId={id} card={card} doc={doc} store={store} jobs={jobs} open={open === card.id} onToggle={() => setOpen(open === card.id ? null : card.id)} />
        ))}
      </div>

      {(analysis?.skipped.length ?? 0) > 0 && (
        <details className="text-xs text-white/45">
          <summary className="cursor-pointer">没有建卡的人物（{analysis!.skipped.length}）</summary>
          <ul className="mt-2 space-y-1 pl-3">
            {analysis!.skipped.map((s) => (
              <li key={s.name}>
                {s.name} —— {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {absent.length > 0 && (
        <details className="text-xs text-white/45">
          <summary className="cursor-pointer">文案里已不再出现的角色（{absent.length}）</summary>
          <div className="mt-2 space-y-3">
            {absent.map((card) => (
              <CharacterItem key={card.id} projectId={id} card={card} doc={doc} store={store} jobs={jobs} open={open === card.id} onToggle={() => setOpen(open === card.id ? null : card.id)} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function CharacterItem({ projectId, card, doc, store, jobs, open, onToggle }: { projectId: string; card: CharacterCard; doc: ProjectDoc; store: Store; jobs: Map<string, Job>; open: boolean; onToggle: () => void }) {
  const update = (fn: (c: CharacterCard) => CharacterCard) => store.setDoc((d) => ({ ...d, characters: d.characters.map((c) => (c.id === card.id ? fn(c) : c)) }));
  const { confirm } = useFeedback();
  const sheetStale = !!(card.sheet.portraitAssetId && card.sheet.sourceHash && card.sheet.sourceHash !== sheetSourceHash(card, doc.visualStyle));
  const shots = doc.shots.filter((s) => s.characterIds.includes(card.id)).length;

  async function remove() {
    if (!(await confirm({ title: `删除角色「${card.name}」？`, message: shots ? `有 ${shots} 个镜头引用了这个角色，删除后这些镜头不再带它的外貌描述。` : "删除后无法恢复。", confirmLabel: "删除", tone: "danger", bullets: ["预计费用：不产生服务商费用。", `影响范围：角色卡会删除${shots ? `，${shots} 个镜头不再引用它` : ""}。`, "可恢复：删除后不能直接恢复角色卡。"] }))) return;
    store.setDoc((d) => ({ ...d, characters: d.characters.filter((c) => c.id !== card.id), shots: d.shots.map((s) => ({ ...s, characterIds: s.characterIds.filter((x) => x !== card.id) })) }));
  }

  return (
    <div className={`rounded-xl border ${open ? "border-white/25" : "border-white/10"} bg-white/[0.015]`}>
      <div className="flex items-center gap-3 p-3">
        <button className="relative size-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]" onClick={onToggle} aria-label={`展开 ${card.name}`}>
          {card.sheet.portraitAssetId ? <Image src={mediaUrl(card.sheet.portraitAssetId)} alt="" fill sizes="56px" unoptimized className="object-cover" /> : <span className="grid h-full place-items-center text-lg text-white/40">{card.name.slice(0, 1)}</span>}
        </button>
        <button className="min-w-0 flex-1 text-left" onClick={onToggle}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{card.name}</span>
            <Badge>{characterRoleLabels[card.role]}</Badge>
            {card.presentation !== "full" && <Badge>只拍{presentationLabels[card.presentation]}</Badge>}
            {!card.sheet.portraitAssetId && card.presentation === "full" && <Badge tone="amber">未定妆</Badge>}
            {sheetStale && <Badge tone="amber">定妆已过期</Badge>}
          </div>
          <p className="mt-1 line-clamp-1 text-xs text-white/45">{anchorText(card, card.looks[0]).split("：")[1] || "外貌待补充"}</p>
          <p className="mt-0.5 text-[11px] text-white/30">
            出现在 {card.evidence.length} 句{shots ? ` · ${shots} 个镜头` : ""}
          </p>
        </button>
        {card.presentation === "full" && !open && (
          <button className={`btn btn-sm shrink-0 ${card.sheet.portraitAssetId ? "btn-ghost" : "btn-primary"}`} onClick={onToggle}>
            <Icon name="sparkle" className="size-3.5" />
            {card.sheet.portraitAssetId ? "定妆" : "去定妆"}
          </button>
        )}
        <button className={`chip h-7 shrink-0 px-2.5 ${card.locked ? "chip-on" : ""}`} onClick={() => update((c) => ({ ...c, locked: !c.locked }))}>
          {card.locked ? "已锁定" : "锁定"}
        </button>
      </div>

      {open && (
        <div className="space-y-5 border-t border-white/10 p-4">
          <div className="space-y-1.5 rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-[11px] text-white/40">身份锚：出现这个角色的镜头都会逐字带上这段描述</p>
            {(card.looks.length ? card.looks : [undefined]).map((look, i) => (
              <p key={look?.id ?? i} className="text-xs leading-5 text-white/75">
                {card.looks.length > 1 && <span className="text-white/35">{look?.name} · </span>}
                {anchorText(card, look)}
              </p>
            ))}
          </div>


          {card.presentation === "full" && <SheetStudio projectId={projectId} card={card} store={store} jobs={jobs} update={update} stale={sheetStale} />}

          <details className="group rounded-lg border border-white/10" open={!card.sheet.portraitAssetId && card.presentation !== "full" ? true : undefined}>
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs text-white/60 hover:text-white">
              <span>编辑外貌与造型{card.overriddenExplicit.length > 0 && <span className="ml-2 text-amber-200/80">有与原文不一致的修改</span>}</span>
              <Icon name="chevron" className="size-3.5 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-white/10 p-3">
            <fieldset disabled={card.locked} className="space-y-5 disabled:opacity-60">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-xs text-white/50">
                  名字
                  <input className="input h-8 py-1.5 text-xs" value={card.name} onChange={(e) => update((c) => ({ ...c, name: e.target.value }))} />
                </label>
                <label className="space-y-1 text-xs text-white/50">
                  身份
                  <Select value={card.role} onChange={(v) => update((c) => ({ ...c, role: v as CharacterCard["role"], real: v === "real", presentation: v === "real" && c.presentation === "full" ? "back" : c.presentation }))} className="h-8 py-1 text-xs">
                    {characterRoles.map((r) => (
                      <option key={r} value={r}>
                        {characterRoleLabels[r]}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="space-y-1 text-xs text-white/50">
                  呈现方式
                  <Select value={card.presentation} onChange={(v) => update((c) => ({ ...c, presentation: v as CharacterCard["presentation"] }))} className="h-8 py-1 text-xs">
                    {presentations.map((p) => (
                      <option key={p} value={p} disabled={card.real && p === "full"}>
                        {presentationLabels[p]}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              {card.real && <p className="text-xs text-white/45">真实人物不生成可辨认的正脸；如果有授权的真实照片，可以在镜头里直接上传。</p>}

              {fieldGroups.map((g) => (
                <div key={g.title}>
                  <p className="mb-2 text-xs text-white/40">{g.title}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {g.fields.map(([f, label, placeholder]) => (
                      <FieldInput key={f} card={card} field={f} label={label} placeholder={placeholder} onChange={(v) => update((c) => editCharacterField(c, f, v))} />
                    ))}
                  </div>
                </div>
              ))}
              <div className="grid gap-2">
                <FieldInput card={card} field="signature" label="识别锚点" placeholder="2–3 个一眼能认出的特征，用逗号分隔，如：红色围巾，圆框眼镜" onChange={(v) => update((c) => editCharacterField(c, "signature", v.split(/[，,、]/).map((x) => x.trim()).filter(Boolean).slice(0, 3)))} />
                <FieldInput card={card} field="personality" label="性格" placeholder="只用于指导姿态和表情，不写进提示词" onChange={(v) => update((c) => editCharacterField(c, "personality", v))} />
              </div>
              <Looks card={card} doc={doc} update={update} />
            </fieldset>
            </div>
          </details>

          {card.evidence.length > 0 && (
            <details className="text-xs text-white/45">
              <summary className="cursor-pointer">出场的句子（{card.evidence.length}）</summary>
              <ul className="mt-2 space-y-1 pl-3">
                {card.evidence.map((e) => (
                  <li key={e.lineId}>「{e.text}」</li>
                ))}
              </ul>
            </details>
          )}


          <div className="flex justify-end border-t border-white/10 pt-3">
            <button className="btn btn-ghost btn-sm hover:border-red-400/40 hover:text-red-300" disabled={card.locked} onClick={remove}>
              <Icon name="trash" className="size-3.5" />
              删除角色
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone?: "amber" }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] ${tone === "amber" ? "bg-amber-200/10 text-amber-200/80" : "bg-white/[0.06] text-white/50"}`}>{children}</span>;
}

function FieldInput({ card, field, label, placeholder, onChange }: { card: CharacterCard; field: CharacterField; label: string; placeholder: string; onChange: (v: string) => void }) {
  const source = card.fieldSources[field];
  const value = card[field];
  // 编辑中保留原样文本（识别锚点按逗号拆分保存，否则末尾的逗号会被吞掉）
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="block space-y-1 text-xs text-white/50">
      <span className="flex items-center gap-1.5">
        {label}
        {source && (
          <span className={`text-[10px] ${sourceMeta[source].tone}`} title={sourceMeta[source].hint}>
            · {sourceMeta[source].label}
          </span>
        )}
      </span>
      <input className="input h-8 py-1.5 text-xs" value={draft ?? (Array.isArray(value) ? value.join("，") : value)} placeholder={placeholder} onChange={(e) => (setDraft(e.target.value), onChange(e.target.value))} onBlur={() => setDraft(null)} />
      {card.overriddenExplicit.includes(field) && <span className="block text-[10px] text-amber-200/80">原文写明了这一点，修改后画面可能与文案矛盾</span>}
    </label>
  );
}

function Looks({ card, doc, update }: { card: CharacterCard; doc: ProjectDoc; update: (fn: (c: CharacterCard) => CharacterCard) => void }) {
  const setLook = (lookId: string, patch: Partial<CharacterCard["looks"][number]>) => update((c) => ({ ...c, looks: c.looks.map((l) => (l.id === lookId ? { ...l, ...patch } : l)) }));
  return (
    <div>
      <p className="mb-2 text-xs text-white/40">造型</p>
      <div className="space-y-2">
        {card.looks.map((look, i) => (
          <div key={look.id} className="grid gap-2 rounded-lg border border-white/10 p-2 sm:grid-cols-[100px_1fr_1fr]">
            <input className="input h-8 py-1.5 text-xs" value={look.name} onChange={(e) => setLook(look.id, { name: e.target.value })} aria-label="造型名称" />
            <input className="input h-8 py-1.5 text-xs" value={look.wardrobe} placeholder="服装" onChange={(e) => setLook(look.id, { wardrobe: e.target.value })} />
            <input className="input h-8 py-1.5 text-xs" value={look.props} placeholder="道具（可选）" onChange={(e) => setLook(look.id, { props: e.target.value })} />
            {i > 0 && (
              <div className="flex items-center gap-2 sm:col-span-3">
                <span className="shrink-0 text-[11px] text-white/40">从这句开始</span>
                <Select value={look.fromLineId ?? ""} onChange={(v) => setLook(look.id, { fromLineId: v || undefined })} className="h-8 min-w-0 flex-1 py-1 text-xs">
                  <option value="">（未指定，按第一套）</option>
                  {doc.lines.map((l, k) => (
                    <option key={l.id} value={l.id}>
                      {k + 1}. {l.text.slice(0, 28)}
                    </option>
                  ))}
                </Select>
                <button type="button" className="text-white/35 hover:text-red-300" aria-label="删除造型" onClick={() => update((c) => ({ ...c, looks: c.looks.filter((l) => l.id !== look.id) }))}>
                  <Icon name="trash" className="size-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
        <button type="button" className="text-xs text-white/40 transition hover:text-white" onClick={() => update((c) => ({ ...c, looks: [...c.looks, { id: newId(), name: c.looks.length ? `造型 ${c.looks.length + 1}` : "默认", wardrobe: "", props: "" }] }))}>
          + 添加造型
        </button>
      </div>
    </div>
  );
}

/** 定妆工作台：立绘候选 → 选定 → 三视图 / 表情组 / 造型；可上传参考图 */
function SheetStudio({ projectId, card, store, jobs, update, stale }: { projectId: string; card: CharacterCard; store: Store; jobs: Map<string, Job>; update: (fn: (c: CharacterCard) => CharacterCard) => void; stale: boolean }) {
  const models = useImageModels();
  const [modelId, setModelId] = useState("");
  const [portraitCount, setPortraitCount] = useState(4);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const { confirm } = useFeedback();
  const model = modelId || models?.[0]?.id || "";
  const job = [...jobs.values()].findLast((j) => j.stage === "character-sheet" && (j.input as { characterId?: string } | null)?.characterId === card.id);
  const running = !!job && ["queued", "running"].includes(job.status);
  const portrait = card.sheet.portraitAssetId;
  // 当前任务：哪一种定妆、共几张、完成几张（完成一张就会写回角色卡，这里只补占位格）
  const jobInput = (job?.input ?? {}) as { kind?: SheetKind; lookId?: string; count?: number };
  const total = jobInput.kind ? (jobInput.kind === "portrait" ? (jobInput.count ?? 4) : { turnaround: 3, expressions: 4, look: 1 }[jobInput.kind]) : 0;
  const done = Math.round((job?.progress ?? 0) * total);
  const pendingFor = (kind: SheetKind, lookId?: string) => (running && jobInput.kind === kind && (kind !== "look" || jobInput.lookId === lookId) ? total - done : 0);
  const elapsed = useElapsed(running ? job?.createdAt : undefined);
  const resumable = !!job?.error && /张成功/.test(job.error);
  const [dismissed, setDismissed] = useState<string | null>(null);

  async function generate(kind: "portrait" | "turnaround" | "expressions" | "look", lookId?: string) {
    const n = kind === "portrait" ? portraitCount : kind === "turnaround" ? 3 : kind === "expressions" ? 4 : 1;
    const label = { portrait: "立绘候选", turnaround: "三视图", expressions: "表情组", look: "造型定妆照" }[kind];
    if (!(await confirm({ title: `生成${label}？`, message: `将生成 ${n} 张图片，费用由图片服务商收取。${kind === "portrait" ? "生成后请挑一张作为这个角色的标准形象。" : "会以选定的立绘为参考。"}`, confirmLabel: "开始生成", bullets: [`预计费用：图片单价暂无法准确估算，以服务商账单为准（${n} 张）。`, `影响范围：只生成当前角色的${label}，现有定妆结果保留。`, "可恢复：任务可以取消或重试；服务商已接单的请求仍可能计费。"] }))) return;
    setError("");
    try {
      await store.flush();
      await postJson(`/api/projects/${projectId}/characters/${card.id}/sheet`, { kind, lookId, modelId: model, count: n });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const res = await fetch("/api/media", { method: "POST", headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }, body: file });
      const asset = (await res.json()) as { hash?: string; error?: string };
      if (!res.ok || !asset.hash) throw new Error(asset.error || "上传失败");
      update((c) => ({ ...c, referenceAssetIds: [...new Set([...c.referenceAssetIds, asset.hash!])] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  const thumbs = (ids: string[], onPick?: (id: string) => void, selected?: string, pending = 0) => (
    <div className="grid grid-cols-4 gap-1.5">
      {Array.from({ length: pending }, (_, i) => (
        <div key={`pending-${i}`} className="grid aspect-square animate-pulse place-items-center rounded-md border border-dashed border-white/15 bg-white/[0.03] text-[10px] text-white/35">
          生成中
        </div>
      ))}
      {ids.map((a) => (
        <button key={a} type="button" disabled={!onPick || card.locked} className={`relative aspect-square overflow-hidden rounded-md border ${selected === a ? "border-accent" : "border-white/10"} ${onPick ? "cursor-pointer hover:border-white/40" : "cursor-default"}`} onClick={() => onPick?.(a)}>
          <Image src={mediaUrl(a)} alt="" fill sizes="120px" unoptimized className="object-cover" />
          {selected === a && <span className="absolute bottom-1 right-1 rounded bg-accent px-1 text-[10px] text-black">已选定</span>}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3 rounded-lg border border-white/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-white/80">定妆</p>
          <p className="text-[11px] text-white/40">选定的立绘是这个角色的标准形象，生成镜头时作为参考图（模型支持时）</p>
        </div>
        {models && models.length > 1 && (
          <Select value={model} onChange={setModelId} className="h-8 max-w-44 py-1 text-xs">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        )}
      </div>
      {stale && <p className="text-xs text-amber-200/80">外貌或画面风格改过，建议重新生成立绘。</p>}
      {models?.length === 0 && <p className="text-xs text-white/40">配置生图模型后可以定妆。</p>}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-white/45">立绘{card.sheet.candidates.length ? `（点击选定）` : ""}</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/40">数量</span>
            <Select value={String(portraitCount)} onChange={(v) => setPortraitCount(Number(v))} className="h-8 w-16 py-1 text-xs">
              {/* ponytail: keep the selector aligned with the API's 1-4 image limit. */}
              {[1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>
                  {count} 张
                </option>
              ))}
            </Select>
            <button className="btn btn-ghost btn-sm" disabled={!model || running || card.locked} onClick={() => generate("portrait")}>
              {running ? <Spinner className="size-3" /> : <Icon name="sparkle" className="size-3.5" />}
              {card.sheet.candidates.length ? `再来 ${portraitCount} 张` : `生成 ${portraitCount} 张立绘`}
            </button>
          </div>
        </div>
        {(card.sheet.candidates.length > 0 || pendingFor("portrait") > 0) && thumbs(card.sheet.candidates, (a) => update((c) => ({ ...c, sheet: { ...c.sheet, portraitAssetId: a } })), portrait, pendingFor("portrait"))}
        {card.sheet.candidates.length > 0 && !portrait && <p className="text-[11px] text-accent/80">点一张作为这个角色的标准形象</p>}
      </div>

      {portrait && (
        <>
          <SheetRow label="三视图" ids={card.sheet.turnaroundAssetIds} pending={pendingFor("turnaround")} count={3} disabled={!model || running || card.locked} onGenerate={() => generate("turnaround")} thumbs={thumbs} />
          <SheetRow label="表情组" ids={card.sheet.expressionAssetIds} pending={pendingFor("expressions")} count={4} disabled={!model || running || card.locked} onGenerate={() => generate("expressions")} thumbs={thumbs} />
          {card.looks.length > 1 &&
            card.looks.map((look) => (
              <SheetRow key={look.id} label={`造型 · ${look.name}`} ids={card.sheet.lookAssetIds[look.id] ? [card.sheet.lookAssetIds[look.id]] : []} pending={pendingFor("look", look.id)} count={1} disabled={!model || running || card.locked || !look.wardrobe} onGenerate={() => generate("look", look.id)} thumbs={thumbs} />
            ))}
        </>
      )}

      <div className="space-y-2 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-white/45">参考图（优先级最高，如已有 IP 形象或授权照片）</span>
          <label className={`chip h-7 cursor-pointer px-2.5 ${card.locked ? "pointer-events-none opacity-50" : ""}`}>
            {uploading ? <Spinner className="size-3" /> : "上传"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
        {card.referenceAssetIds.length > 0 && thumbs(card.referenceAssetIds, card.locked ? undefined : (a) => update((c) => ({ ...c, referenceAssetIds: c.referenceAssetIds.filter((x) => x !== a) })))}
        {card.referenceAssetIds.length > 0 && !card.locked && <p className="text-[10px] text-white/30">点击参考图可以移除</p>}
      </div>

      {running && job && (
        <div className="space-y-0.5 text-xs">
          <p className="text-accent">
            {job.status === "queued" && done === 0 ? "排队中" : `正在生成${jobInput.kind ? sheetKindLabels[jobInput.kind] : ""} · 已完成 ${done}/${total}`} · 已用 {elapsed}
          </p>
          <p className="text-[11px] text-white/40">
            每张通常要 1–4 分钟，{total > 1 ? `${total} 张同时生成，` : ""}完成一张显示一张，可以先去做别的
            {job.attempts > 1 ? `；网络出错后第 ${job.attempts} 次尝试（已成功的不会重新生成）` : ""}
          </p>
        </div>
      )}
      {job?.status === "failed" && dismissed !== job.id && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-400/20 bg-red-400/[0.04] p-2 text-xs">
          <p className="text-red-200/90">{job.error}</p>
          <div className="flex gap-1.5">
            {/* 逐张缓存的任务（报错里带「几张成功」）重试只补缺的；旧任务重试会全部重画，不提供 */}
            {resumable && done < total && (
              <button className="btn btn-ghost btn-sm" onClick={() => jobAction(job.id, "retry").catch((e) => setError(e instanceof Error ? e.message : String(e)))}>
                补齐失败的 {total - done} 张
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(job.id)}>
              知道了
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

function SheetRow({ label, ids, pending, count, disabled, onGenerate, thumbs }: { label: string; ids: string[]; pending: number; count: number; disabled: boolean; onGenerate: () => void; thumbs: (ids: string[], onPick?: undefined, selected?: undefined, pending?: number) => React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-white/45">{label}</span>
        <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={onGenerate}>
          <Icon name="sparkle" className="size-3.5" />
          {ids.length ? `重新生成 · ${count} 张` : `生成 · ${count} 张`}
        </button>
      </div>
      {(ids.length > 0 || pending > 0) && thumbs(ids, undefined, undefined, pending)}
    </div>
  );
}

/** 任务开始至今的时长（每秒刷新） */
function useElapsed(since: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  if (!since) return "";
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
