"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { Alert, Button, Icon, SegmentedControl, Select, Spinner } from "@/components/ui";
import { jobAction, postJson, useImageModels } from "@/lib/client";
import { anchorText, castKeyOf, editCharacterField, sheetKindLabels, sheetSourceHash, type SheetKind } from "@/lib/core/cast";
import { newId } from "@/lib/core/sync";
import {
  characterCardSchema,
  characterRoleLabels,
  characterRoles,
  mediaUrl,
  presentationLabels,
  presentations,
  type CharacterCard,
  type CharacterField,
  type FieldSource,
  type Job,
  type Look,
  type ProjectDoc,
} from "@/lib/core/types";
import { useFeedback } from "@/components/feedback";

/**
 * 「角色」面板。
 *
 * 自上而下只做一件事：先说进度，再给一个主操作（为未定妆的角色定妆）；
 * 角色以肖像卡一排铺开，点哪个，下方工作区就切到哪个；
 * 工作区里的定妆、外貌、出场句子分成三个页签，同一屏只有一件事在做。
 * 选定的立绘就是这个角色的标准形象，之后所有镜头以它为参考。
 */

type Store = { doc: ProjectDoc | null; setDoc: (fn: (doc: ProjectDoc) => ProjectDoc) => void; flush: () => Promise<unknown> };
type Tab = "sheet" | "look" | "evidence";
type Status = { label: string; tone: string };

const sourceMeta: Record<FieldSource, { label: string; tone: string; hint: string }> = {
  explicit: { label: "原文", tone: "text-accent", hint: "原文明确写了，修改会与文案矛盾" },
  inferred: { label: "推断", tone: "text-info", hint: "从时代、职业、性格等上下文推断" },
  default: { label: "补全", tone: "text-text-faint", hint: "原文没有信息，按题材补全" },
  user: { label: "已改", tone: "text-warn", hint: "你改过，重新识别不会覆盖" },
};

const fieldGroups: { title: string; fields: [CharacterField, string, string][] }[] = [
  { title: "身份", fields: [["ageRange", "年龄", "如：二十出头"], ["gender", "性别", ""], ["era", "时代", "如：明朝、九十年代"], ["region", "地域", "仅当背景需要"], ["occupation", "职业", ""]] },
  { title: "外貌", fields: [["hair", "发型", "如：齐耳黑色短发"], ["eyes", "眼睛", ""], ["faceShape", "脸型", ""], ["facialHair", "胡须", ""], ["marks", "标记", "疤痕、痣等"], ["build", "体型", ""], ["height", "身高", ""]] },
];

/** 完整身份锚，去掉开头的「名字：」，只留特征 */
function anchorBody(card: CharacterCard, look?: Look) {
  const text = anchorText(card, look);
  const head = `${card.name}：`;
  return text.startsWith(head) ? text.slice(head.length) : "";
}

/** 卡片上只放最能认出人的三个特征，完整描述在工作区里 */
function traitsOf(card: CharacterCard) {
  return [card.ageRange, card.hair, ...card.signature].map((x) => x.trim()).filter(Boolean).slice(0, 3).join(" · ");
}

/** 连年龄、发型、识别锚点都没有：定妆会随机生成形象，需要先补充 */
function hasNoAppearance(card: CharacterCard) {
  return !card.hair && !card.appearance && !card.ageRange && card.signature.length === 0;
}

function isSheetStale(card: CharacterCard, doc: ProjectDoc) {
  return !!(card.sheet.portraitAssetId && card.sheet.sourceHash && card.sheet.sourceHash !== sheetSourceHash(card, doc.visualStyle));
}

function statusOf(card: CharacterCard, stale: boolean): Status {
  if (card.absent) return { label: "未出场", tone: "text-white/60" };
  if (card.presentation !== "full") return { label: `只拍${presentationLabels[card.presentation]}`, tone: "text-white/75" };
  if (!card.sheet.portraitAssetId) return { label: "待定妆", tone: "text-warn" };
  if (stale) return { label: "定妆过期", tone: "text-warn" };
  return { label: "已定妆", tone: "text-accent" };
}

function StatusChip({ status, className = "" }: { status: Status; className?: string }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-black/55 px-2.5 text-2xs backdrop-blur ${status.tone} ${className}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {status.label}
    </span>
  );
}

export function CastPanel({ id, store, jobs }: { id: string; store: Store; jobs: Map<string, Job> }) {
  const doc = store.doc;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm } = useFeedback();
  const workspaceRef = useRef<HTMLDivElement>(null);
  if (!doc) return null;
  const analysis = doc.castAnalysis;
  const castJob = [...jobs.values()].findLast((j) => j.stage === "cast" && j.projectId === id);
  const running = !!castJob && ["queued", "running"].includes(castJob.status);
  const present = doc.characters.filter((c) => !c.absent);
  const absent = doc.characters.filter((c) => c.absent);
  const skipped = analysis?.skipped ?? [];
  // 需要定妆的是正常出镜的角色；锁定的角色不由这里推动
  const needsSheet = present.filter((c) => c.presentation === "full");
  const styled = needsSheet.filter((c) => c.sheet.portraitAssetId).length;
  const todo = needsSheet.filter((c) => !c.sheet.portraitAssetId && !c.locked);
  // 工作区：用户点过的优先；否则落在第一个待定妆的角色上
  const active = doc.characters.find((c) => c.id === selectedId) ?? todo[0] ?? present[0] ?? absent[0] ?? null;
  const pick = (card: CharacterCard) => setSelectedId(card.id);

  async function analyze(force: boolean) {
    if (force && !(await confirm({ title: "重新识别角色？", message: "会重新阅读全文。锁定的角色、你改过的字段和已定妆的图片都会保留。", confirmLabel: "重新识别", bullets: ["预计费用：会调用一次文本模型，费用以服务商账单为准。", "影响范围：重新分析全文；锁定字段和已定妆图片保留。", "可恢复：新结果写回前可停止任务，已有角色字段不会被锁定内容覆盖。"] }))) return;
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
    setSelectedId(card.id);
  }

  function startSheets() {
    if (!todo[0]) return;
    setSelectedId(todo[0].id);
    workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const roster = (cards: CharacterCard[]) =>
    cards.map((card, i) => <CharacterTile key={card.id} card={card} index={i} active={active?.id === card.id} stale={isSheetStale(card, doc)} onSelect={() => pick(card)} />);

  return (
    <div className="@container space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium text-text">{present.length ? `${present.length} 个角色` : "还没有角色"}</p>
          {needsSheet.length > 0 && (
            <div className="flex items-center gap-3">
              <div role="progressbar" aria-label="定妆进度" aria-valuemin={0} aria-valuemax={needsSheet.length} aria-valuenow={styled} className="h-1 w-40 max-w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${(styled / needsSheet.length) * 100}%` }} />
              </div>
              <span className="text-xs tabular-nums text-text-muted">已定妆 {styled}/{needsSheet.length}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={analysis || present.length ? "ghost" : "primary"} loading={busy || running} icon={<Icon name="sparkle" className="size-3.5" />} onClick={() => analyze(!!analysis)}>
            {running ? `识别中${castJob?.progress ? ` · ${Math.round(castJob.progress * 100)}%` : ""}` : analysis ? "重新识别" : "识别角色"}
          </Button>
          <Button size="sm" variant="ghost" icon={<Icon name="plus" className="size-3.5" />} onClick={addCharacter}>
            新增角色
          </Button>
        </div>
      </header>

      {error && <Alert tone="danger" size="sm">{error}</Alert>}
      {castJob?.status === "failed" && <Alert tone="danger" size="sm">识别失败：{castJob.error}</Alert>}

      {todo.length > 0 && (
        <div className="animate-rise flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-surface border border-accent/20 bg-accent/[0.04] p-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
              <Icon name="sparkle" className="size-4" />
            </span>
            <div className="min-w-0 space-y-2.5">
              <div>
                <p className="text-sm font-medium text-text">下一步：为 {todo.length} 个角色定妆</p>
                <p className="mt-0.5 text-xs leading-5 text-text-muted">先生成标准形象，之后镜头都以它为参考，人物前后才长得一样。</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {todo.map((c) => (
                  <span key={c.id} className="tag">
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <Button size="sm" variant="primary" icon={<Icon name="sparkle" className="size-3.5" />} onClick={startSheets}>
            开始定妆
          </Button>
        </div>
      )}

      {analysis && analysis.issues.length > 0 && (
        <div className="rounded-control border border-warn-border bg-warn-surface text-warn">
          <button type="button" aria-expanded={issuesOpen} onClick={() => setIssuesOpen((v) => !v)} className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left text-xs">
            <span className="flex items-center gap-2">
              <Icon name="alert" className="size-3.5 shrink-0" />
              {analysis.issues.length} 条提示需要留意
            </span>
            <Icon name="chevron" className={`size-3.5 shrink-0 transition-transform duration-300 ${issuesOpen ? "rotate-180" : ""}`} />
          </button>
          {issuesOpen && (
            <ul className="animate-fade-in space-y-1.5 border-t border-warn-border px-4 py-3 text-xs leading-5 text-warn/85">
              {analysis.issues.map((x) => (
                <li key={x} className="flex gap-2">
                  <span aria-hidden>·</span>
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {present.length === 0 ? (
        <div className="rounded-surface border border-dashed border-line px-6 py-10 text-center">
          <p className="text-sm text-text">{analysis ? "这期视频的画面不需要固定角色" : "还没有角色"}</p>
          <p className="mt-1 text-xs text-text-muted">{analysis ? "需要的话可以手动新增。" : "识别角色会让 AI 读完整篇文案；一键成片时也会自动识别。"}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @xl:grid-cols-4">{roster(present)}</div>
      )}

      {active && (
        <div ref={workspaceRef} className="scroll-mt-20">
          <CharacterWorkspace key={active.id} projectId={id} card={active} doc={doc} store={store} jobs={jobs} />
        </div>
      )}

      {skipped.length > 0 && (
        <Fold title={`没有建卡的人物 · ${skipped.length}`}>
          <ul className="space-y-1.5 text-xs leading-5 text-text-muted">
            {skipped.map((s) => (
              <li key={s.name}>
                <span className="text-text-secondary">{s.name}</span> —— {s.reason}
              </li>
            ))}
          </ul>
        </Fold>
      )}
      {absent.length > 0 && (
        <Fold title={`文案里已不再出现 · ${absent.length}`}>
          <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @xl:grid-cols-4">{roster(absent)}</div>
        </Fold>
      )}
    </div>
  );
}

/** 角色肖像卡：选角的主入口。状态与锁定标在图上，名字和一句特征压在底部 */
function CharacterTile({ card, index, active, stale, onSelect }: { card: CharacterCard; index: number; active: boolean; stale: boolean; onSelect: () => void }) {
  const status = statusOf(card, stale);
  const traits = traitsOf(card);
  const portrait = card.sheet.portraitAssetId;
  // 外层负责入场动画，内层负责悬停位移：同一元素上 fill-mode 会压住 transform
  return (
    <div className="animate-rise" style={{ animationDelay: `${index * 60}ms` }}>
      <button
        type="button"
        aria-pressed={active}
        onClick={onSelect}
        className={`group relative block aspect-[3/4] w-full overflow-hidden rounded-surface border text-left transition duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${active ? "border-accent/60 ring-4 ring-accent/15" : "border-line hover:border-line-strong"} ${card.absent ? "opacity-60" : ""}`}
      >
        {portrait ? (
          <Image src={mediaUrl(portrait)} alt="" fill sizes="(min-width: 36rem) 25vw, 50vw" unoptimized className="object-cover transition duration-500 group-hover:scale-[1.03]" />
        ) : (
          <span className="absolute inset-0 grid place-items-center bg-white/[0.03] text-6xl font-light text-white/20 transition group-hover:text-white/35">{card.name.slice(0, 1)}</span>
        )}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 to-transparent" />
        <StatusChip status={status} className="absolute left-2.5 top-2.5" />
        {card.locked && (
          <span title="已锁定" className="absolute right-2.5 top-2.5 grid size-6 place-items-center rounded-full bg-black/55 text-white/85 backdrop-blur">
            <Icon name="lock" className="size-3" />
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 min-w-0 p-3">
          <span className="block truncate text-sm font-medium text-white">{card.name}</span>
          <span className={`mt-0.5 block truncate text-2xs ${traits ? "text-white/60" : "text-warn/85"}`}>{traits || "外貌待补充"}</span>
        </span>
      </button>
    </div>
  );
}

/** 选中角色的工作区：头部是身份与操作，下面三个页签各管一件事 */
function CharacterWorkspace({ projectId, card, doc, store, jobs }: { projectId: string; card: CharacterCard; doc: ProjectDoc; store: Store; jobs: Map<string, Job> }) {
  const update = (fn: (c: CharacterCard) => CharacterCard) => store.setDoc((d) => ({ ...d, characters: d.characters.map((c) => (c.id === card.id ? fn(c) : c)) }));
  const { confirm } = useFeedback();
  // 没有外貌信息的角色先落在「外貌与造型」：定妆前先补充，否则会随机生成形象
  const [tab, setTab] = useState<Tab>(card.presentation !== "full" || (hasNoAppearance(card) && !card.sheet.portraitAssetId) ? "look" : "sheet");
  const stale = isSheetStale(card, doc);
  const shots = doc.shots.filter((s) => s.characterIds.includes(card.id)).length;
  const status = statusOf(card, stale);
  const traits = anchorBody(card, card.looks[0]);
  const tabs: { value: Tab; label: string }[] = [
    { value: "sheet", label: "定妆" },
    { value: "look", label: "外貌与造型" },
    { value: "evidence", label: `出场句子 ${card.evidence.length}` },
  ];

  async function remove() {
    if (!(await confirm({ title: `删除角色「${card.name}」？`, message: shots ? `有 ${shots} 个镜头引用了这个角色，删除后这些镜头不再带它的外貌描述。` : "删除后无法恢复。", confirmLabel: "删除", tone: "danger", bullets: ["预计费用：不产生服务商费用。", `影响范围：角色卡会删除${shots ? `，${shots} 个镜头不再引用它` : ""}。`, "可恢复：删除后不能直接恢复角色卡。"] }))) return;
    store.setDoc((d) => ({ ...d, characters: d.characters.filter((c) => c.id !== card.id), shots: d.shots.map((s) => ({ ...s, characterIds: s.characterIds.filter((x) => x !== card.id) })) }));
  }

  return (
    <section aria-label={`${card.name} 的设置`} className="animate-rise space-y-4 rounded-surface border border-line bg-white/[0.02] p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-medium text-text">{card.name}</h3>
            <span className="text-xs text-text-muted">{characterRoleLabels[card.role]}</span>
            <StatusChip status={status} />
          </div>
          <p className={`line-clamp-2 text-xs leading-5 ${traits ? "text-text-muted" : "text-warn/85"}`} title={traits || undefined}>
            {traits || "外貌待补充"}
          </p>
          <p className="text-2xs text-text-faint">
            出现在 {card.evidence.length} 句{shots ? ` · ${shots} 个镜头` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" aria-pressed={card.locked} className={card.locked ? "border-line-bold text-text" : ""} icon={<Icon name="lock" className="size-3.5" />} onClick={() => update((c) => ({ ...c, locked: !c.locked }))}>
            {card.locked ? "已锁定" : "锁定"}
          </Button>
          <button type="button" className="btn-text hover:text-danger disabled:cursor-not-allowed disabled:opacity-35" disabled={card.locked} onClick={remove}>
            <Icon name="trash" className="size-3.5" />
            删除
          </button>
        </div>
      </header>
      {card.locked && <p className="animate-fade-in text-xs text-text-muted">已锁定：重新识别不会改动这个角色，也暂停生成和修改。</p>}

      <SegmentedControl value={tab} options={tabs} onChange={setTab} label="角色设置" />
      {/* key 让每次切换页签都重新入场，避免新旧内容短暂叠在一起 */}
      <div key={tab} className="animate-fade-in">
        {tab === "sheet" &&
          (card.presentation === "full" ? (
            <SheetStudio projectId={projectId} card={card} store={store} jobs={jobs} update={update} stale={stale} />
          ) : (
            <p className="text-xs text-text-muted">这个角色只拍{presentationLabels[card.presentation]}，不需要定妆。</p>
          ))}
        {tab === "look" && <AppearanceTab card={card} doc={doc} update={update} />}
        {tab === "evidence" && <EvidenceTab card={card} />}
      </div>
    </section>
  );
}

/** 外貌与造型：镜头里会附上的描述，以及可以编辑的字段 */
function AppearanceTab({ card, doc, update }: { card: CharacterCard; doc: ProjectDoc; update: (fn: (c: CharacterCard) => CharacterCard) => void }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs text-text-muted">
          镜头里会附上的外貌描述 <span className="ml-1 text-text-faint">同一造型下逐字相同</span>
        </p>
        <div className="space-y-1.5 rounded-control border border-line bg-black/25 p-3">
          {(card.looks.length ? card.looks : [undefined]).map((look, i) => (
            <p key={look?.id ?? i} className="text-xs leading-5 text-text-secondary">
              {card.looks.length > 1 && <span className="text-text-faint">{look?.name} · </span>}
              {anchorText(card, look)}
            </p>
          ))}
        </div>
      </div>
      {hasNoAppearance(card) && <Alert tone="warn" size="sm">还没有外貌信息，定妆会随机生成形象。先填写下面的发型、年龄或识别锚点。</Alert>}

      <fieldset disabled={card.locked} className="space-y-5 disabled:opacity-60">
        <div className="grid gap-3 @md:grid-cols-3">
          <label className="block space-y-1.5 text-xs text-text-muted">
            名字
            <input className="input h-9 py-1.5 text-sm" value={card.name} onChange={(e) => update((c) => ({ ...c, name: e.target.value }))} />
          </label>
          <label className="block space-y-1.5 text-xs text-text-muted">
            身份
            <Select value={card.role} onChange={(v) => update((c) => ({ ...c, role: v as CharacterCard["role"], real: v === "real", presentation: v === "real" && c.presentation === "full" ? "back" : c.presentation }))} className="h-9 py-1.5 text-sm">
              {characterRoles.map((r) => (
                <option key={r} value={r}>
                  {characterRoleLabels[r]}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1.5 text-xs text-text-muted">
            呈现方式
            <Select value={card.presentation} onChange={(v) => update((c) => ({ ...c, presentation: v as CharacterCard["presentation"] }))} className="h-9 py-1.5 text-sm">
              {presentations.map((p) => (
                <option key={p} value={p} disabled={card.real && p === "full"}>
                  {presentationLabels[p]}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {card.real && <p className="text-xs text-text-muted">真实人物不生成可辨认的正脸，可以在「定妆」里上传授权照片。</p>}

        {fieldGroups.map((g) => (
          <div key={g.title} className="space-y-2.5">
            <p className="text-xs font-medium text-text-faint">{g.title}</p>
            <div className="grid gap-3 @md:grid-cols-2">
              {g.fields.map(([f, label, placeholder]) => (
                <FieldInput key={f} card={card} field={f} label={label} placeholder={placeholder} onChange={(v) => update((c) => editCharacterField(c, f, v))} />
              ))}
            </div>
          </div>
        ))}

        <div className="space-y-2.5">
          <p className="text-xs font-medium text-text-faint">识别特征</p>
          <div className="grid gap-3">
            <FieldInput card={card} field="signature" label="识别锚点" placeholder="2–3 个一眼能认出的特征，逗号分隔，如：红色围巾、圆框眼镜" onChange={(v) => update((c) => editCharacterField(c, "signature", v.split(/[，,、]/).map((x) => x.trim()).filter(Boolean).slice(0, 3)))} />
            <FieldInput card={card} field="personality" label="性格" placeholder="只指导姿态和表情，不写进提示词" onChange={(v) => update((c) => editCharacterField(c, "personality", v))} />
          </div>
        </div>

        <Looks card={card} doc={doc} update={update} />
      </fieldset>
    </div>
  );
}

function FieldInput({ card, field, label, placeholder, onChange }: { card: CharacterCard; field: CharacterField; label: string; placeholder: string; onChange: (v: string) => void }) {
  const source = card.fieldSources[field];
  const value = card[field];
  // 编辑中保留原样文本（识别锚点按逗号拆分保存，否则末尾的逗号会被吞掉）
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-xs text-text-muted">
        {label}
        {source && (
          <span className={`text-2xs ${sourceMeta[source].tone}`} title={sourceMeta[source].hint}>
            · {sourceMeta[source].label}
          </span>
        )}
      </span>
      <input className="input h-9 py-1.5 text-sm" value={draft ?? (Array.isArray(value) ? value.join("，") : value)} placeholder={placeholder} onChange={(e) => (setDraft(e.target.value), onChange(e.target.value))} onBlur={() => setDraft(null)} />
      {card.overriddenExplicit.includes(field) && <span className="block text-2xs text-warn">与原文不一致，画面可能和文案矛盾</span>}
    </label>
  );
}

function Looks({ card, doc, update }: { card: CharacterCard; doc: ProjectDoc; update: (fn: (c: CharacterCard) => CharacterCard) => void }) {
  const setLook = (lookId: string, patch: Partial<Look>) => update((c) => ({ ...c, looks: c.looks.map((l) => (l.id === lookId ? { ...l, ...patch } : l)) }));
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium text-text-faint">造型</p>
        <p className="text-2xs text-text-faint">需要换装时再添加一套</p>
      </div>
      {card.looks.map((look, i) => (
        <div key={look.id} className="space-y-2.5 rounded-control border border-line bg-white/[0.02] p-3">
          <div className="grid gap-2 @md:grid-cols-[7rem_1fr_1fr]">
            <input className="input h-9 py-1.5 text-sm" value={look.name} onChange={(e) => setLook(look.id, { name: e.target.value })} aria-label="造型名称" />
            <input className="input h-9 py-1.5 text-sm" value={look.wardrobe} placeholder="服装" onChange={(e) => setLook(look.id, { wardrobe: e.target.value })} />
            <input className="input h-9 py-1.5 text-sm" value={look.props} placeholder="道具（可选）" onChange={(e) => setLook(look.id, { props: e.target.value })} />
          </div>
          {i > 0 && (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-2xs text-text-faint">从这句开始</span>
              <Select value={look.fromLineId ?? ""} onChange={(v) => setLook(look.id, { fromLineId: v || undefined })} aria-label="换装起始句" className="h-8 min-w-0 flex-1 py-1 text-xs">
                <option value="">（未指定，按第一套）</option>
                {doc.lines.map((l, k) => (
                  <option key={l.id} value={l.id}>
                    {k + 1}. {l.text.slice(0, 28)}
                  </option>
                ))}
              </Select>
              <button type="button" className="btn-text px-2 hover:text-danger" aria-label="删除造型" onClick={() => update((c) => ({ ...c, looks: c.looks.filter((l) => l.id !== look.id) }))}>
                <Icon name="trash" className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}
      <button type="button" className="btn-text w-full justify-center border border-dashed border-line-strong py-2 text-xs hover:border-line-bold" onClick={() => update((c) => ({ ...c, looks: [...c.looks, { id: newId(), name: c.looks.length ? `造型 ${c.looks.length + 1}` : "默认", wardrobe: "", props: "" }] }))}>
        <Icon name="plus" className="size-3.5" />
        添加造型
      </button>
    </div>
  );
}

function EvidenceTab({ card }: { card: CharacterCard }) {
  if (!card.evidence.length) return <p className="text-xs text-text-faint">文案里没有找到这个角色的出场句子（手动添加的角色没有这一项）。</p>;
  return (
    <ul className="space-y-2.5">
      {card.evidence.map((e) => (
        <li key={e.lineId} className="border-l-2 border-accent/35 pl-3 text-xs leading-5 text-text-secondary">
          「{e.text}」
        </li>
      ))}
    </ul>
  );
}

/**
 * 定妆：先选一张标准形象，再按需延展三视图、表情和造型；参考图单独一区，优先级最高。
 * 生成是长任务（每张 1–4 分钟），所以切走页签或切换角色都不会打断它。
 */
function SheetStudio({ projectId, card, store, jobs, update, stale }: { projectId: string; card: CharacterCard; store: Store; jobs: Map<string, Job>; update: (fn: (c: CharacterCard) => CharacterCard) => void; stale: boolean }) {
  const models = useImageModels();
  const [modelId, setModelId] = useState("");
  const [portraitCount, setPortraitCount] = useState(4);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const { confirm } = useFeedback();
  const model = modelId || models?.[0]?.id || "";
  const job = [...jobs.values()].findLast((j) => j.stage === "character-sheet" && (j.input as { characterId?: string } | null)?.characterId === card.id);
  const running = !!job && ["queued", "running"].includes(job.status);
  const portrait = card.sheet.portraitAssetId;
  const candidates = card.sheet.candidates;
  const cannotGenerate = !model || running || card.locked;
  // 当前任务：哪一种定妆、共几张、完成几张（完成一张就会写回角色卡，这里只补占位格）
  const jobInput = (job?.input ?? {}) as { kind?: SheetKind; lookId?: string; count?: number };
  const total = jobInput.kind ? (jobInput.kind === "portrait" ? (jobInput.count ?? 4) : { turnaround: 3, expressions: 4, look: 1 }[jobInput.kind]) : 0;
  const done = Math.round((job?.progress ?? 0) * total);
  const pendingFor = (kind: SheetKind, lookId?: string) => (running && jobInput.kind === kind && (kind !== "look" || jobInput.lookId === lookId) ? total - done : 0);
  const elapsed = useElapsed(running ? job?.createdAt : undefined);
  const resumable = !!job?.error && /张成功/.test(job.error);

  async function generate(kind: "portrait" | "turnaround" | "expressions" | "look", lookId?: string) {
    const n = kind === "portrait" ? portraitCount : kind === "turnaround" ? 3 : kind === "expressions" ? 4 : 1;
    const label = { portrait: "立绘", turnaround: "三视图", expressions: "表情组", look: "造型定妆照" }[kind];
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

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{portrait ? "标准形象" : "选一张标准形象"}</p>
            <p className="mt-0.5 text-xs text-text-muted">{portrait ? "镜头里的这个角色都以它为参考" : candidates.length ? "点一张设为标准形象" : "先生成几张候选，挑最像的一张"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {models && models.length > 1 && (
              <Select value={model} onChange={setModelId} aria-label="生图模型" className="h-8 max-w-44 py-1 text-xs">
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            )}
            <Select value={String(portraitCount)} onChange={(v) => setPortraitCount(Number(v))} aria-label="生成数量" className="h-8 w-20 py-1 text-xs">
              {/* ponytail: keep the selector aligned with the API's 1-4 image limit. */}
              {[1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>
                  {count} 张
                </option>
              ))}
            </Select>
            <Button size="sm" variant={candidates.length ? "ghost" : "primary"} loading={running} disabled={cannotGenerate} icon={<Icon name="sparkle" className="size-3.5" />} onClick={() => generate("portrait")}>
              {candidates.length ? `再来 ${portraitCount} 张` : `生成 ${portraitCount} 张`}
            </Button>
          </div>
        </div>

        {models?.length === 0 && <p className="text-xs text-text-muted">还没有可用的生图模型，配置后才能定妆。</p>}
        {stale && <Alert tone="warn" size="sm">外貌或画面风格有改动，建议重新生成立绘。</Alert>}
        {running && job && (
          <div className="animate-fade-in space-y-2 rounded-control border border-accent/20 bg-accent/[0.04] px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="text-accent">{job.status === "queued" && done === 0 ? "排队中" : `正在生成${jobInput.kind ? sheetKindLabels[jobInput.kind] : ""} · ${done}/${total}`}</p>
              <p className="tabular-nums text-text-faint">已用 {elapsed}</p>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>
            <p className="text-2xs text-text-faint">
              每张约 1–4 分钟，完成即显示，可以先去做别的{job.attempts > 1 ? `；网络出错后第 ${job.attempts} 次尝试，已成功的不会重做` : ""}。
            </p>
          </div>
        )}
        {job?.status === "failed" && dismissed !== job.id && (
          <Alert
            tone="danger"
            size="sm"
            actions={
              <>
                {/* 逐张缓存的任务（报错里带「几张成功」）重试只补缺的；旧任务重试会全部重画，不提供 */}
                {resumable && done < total && (
                  <Button size="sm" variant="ghost" onClick={() => jobAction(job.id, "retry").catch((e) => setError(e instanceof Error ? e.message : String(e)))}>
                    补齐失败的 {total - done} 张
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setDismissed(job.id)}>
                  知道了
                </Button>
              </>
            }
          >
            {job.error}
          </Alert>
        )}
        {error && <Alert tone="danger" size="sm">{error}</Alert>}

        {(candidates.length > 0 || pendingFor("portrait") > 0) && (
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: pendingFor("portrait") }, (_, i) => (
              <PendingTile key={`pending-${i}`} />
            ))}
            {candidates.map((a) => (
              <Thumb key={a} id={a} selected={a === portrait} disabled={card.locked} onPick={() => update((c) => ({ ...c, sheet: { ...c.sheet, portraitAssetId: a } }))} />
            ))}
          </div>
        )}
      </section>

      {portrait && (
        <section className="animate-rise space-y-4 border-t border-hairline pt-5">
          <div>
            <p className="text-sm font-medium text-text">延展素材</p>
            <p className="mt-0.5 text-xs text-text-muted">三视图、表情和造型，用来稳住不同镜头里的人物，按需生成。</p>
          </div>
          <SheetRow label="三视图" count={3} ids={card.sheet.turnaroundAssetIds} pending={pendingFor("turnaround")} disabled={cannotGenerate} onGenerate={() => generate("turnaround")} />
          <SheetRow label="表情组" count={4} ids={card.sheet.expressionAssetIds} pending={pendingFor("expressions")} disabled={cannotGenerate} onGenerate={() => generate("expressions")} />
          {card.looks.length > 1 &&
            card.looks.map((look) => (
              <SheetRow
                key={look.id}
                label={`造型 · ${look.name}`}
                count={1}
                ids={card.sheet.lookAssetIds[look.id] ? [card.sheet.lookAssetIds[look.id]] : []}
                pending={pendingFor("look", look.id)}
                disabled={cannotGenerate || !look.wardrobe}
                hint={look.wardrobe ? undefined : "先填写服装"}
                onGenerate={() => generate("look", look.id)}
              />
            ))}
        </section>
      )}

      <section className="space-y-3 border-t border-hairline pt-5">
        <div>
          <p className="text-sm font-medium text-text">
            参考图 <span className="ml-1 text-xs font-normal text-text-faint">可选</span>
          </p>
          <p className="mt-0.5 text-xs text-text-muted">已有 IP 形象或授权照片时上传，优先级高于生成的立绘。</p>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {card.referenceAssetIds.map((a) => (
            <Thumb key={a} id={a} onRemove={card.locked ? undefined : () => update((c) => ({ ...c, referenceAssetIds: c.referenceAssetIds.filter((x) => x !== a) }))} />
          ))}
          {!card.locked && (
            <label className="grid aspect-square cursor-pointer place-items-center rounded-control border border-dashed border-line-strong text-xs text-text-muted transition hover:border-line-bold hover:text-text">
              {uploading ? (
                <Spinner className="size-4" />
              ) : (
                <span className="flex flex-col items-center gap-1.5">
                  <Icon name="plus" className="size-4" />
                  上传
                </span>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          )}
        </div>
      </section>
    </div>
  );
}

/** 一行延展素材：标题与生成按钮在上，结果网格在下；生成中的格子带扫光占位 */
function SheetRow({ label, count, ids, pending, disabled, hint, onGenerate }: { label: string; count: number; ids: string[]; pending: number; disabled: boolean; hint?: string; onGenerate: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-secondary">
          {label}
          {ids.length > 0 && <span className="ml-1.5 tabular-nums text-text-faint">{ids.length} 张</span>}
          {hint && <span className="ml-1.5 text-text-faint">{hint}</span>}
        </p>
        <Button size="sm" variant="ghost" disabled={disabled} icon={<Icon name="sparkle" className="size-3.5" />} onClick={onGenerate}>
          {ids.length ? "重新生成" : `生成 ${count} 张`}
        </Button>
      </div>
      {(ids.length > 0 || pending > 0) && (
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: pending }, (_, i) => (
            <PendingTile key={`pending-${i}`} />
          ))}
          {ids.map((a) => (
            <Thumb key={a} id={a} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 图片格：可选为标准形象（点击，悬停提示），或带移除按钮（参考图） */
function Thumb({ id, selected = false, disabled = false, onPick, onRemove }: { id: string; selected?: boolean; disabled?: boolean; onPick?: () => void; onRemove?: () => void }) {
  const frame = `group relative block aspect-square w-full overflow-hidden rounded-control border transition duration-300 ${selected ? "border-accent ring-2 ring-accent/35" : "border-line"}`;
  const content = (
    <>
      <Image src={mediaUrl(id)} alt="" fill sizes="200px" unoptimized className="generation-image-complete object-cover" />
      {selected && (
        <span className="animate-check-in absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-2xs font-medium text-black">
          <Icon name="check" className="size-3" />
          标准形象
        </span>
      )}
      {onPick && !selected && !disabled && (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-2 pt-8 text-center text-2xs text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">设为标准形象</span>
      )}
    </>
  );
  if (onPick) {
    return (
      <button type="button" aria-pressed={selected} disabled={disabled} onClick={onPick} className={`${frame} cursor-pointer hover:border-line-bold disabled:cursor-default`}>
        {content}
      </button>
    );
  }
  return (
    <div className={frame}>
      {content}
      {onRemove && (
        <button type="button" aria-label="移除参考图" title="移除" onClick={onRemove} className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-black/60 text-white/80 transition hover:text-danger">
          <Icon name="trash" className="size-3" />
        </button>
      )}
    </div>
  );
}

/** 生成中的占位格：虚线边框加扫光，表示这里马上会出图 */
function PendingTile() {
  return (
    <span className="relative block aspect-square overflow-hidden rounded-control border border-dashed border-line-strong bg-white/[0.03]">
      <span aria-hidden className="action-shimmer absolute inset-0 overflow-hidden" />
      <span className="absolute inset-0 grid place-items-center text-2xs text-text-faint">生成中</span>
    </span>
  );
}

/** 折叠区：低频信息（跳过的人物、已不出现的角色）收在这里，不抢主区域 */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-control border border-hairline">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-xs text-text-muted transition hover:text-text [&::-webkit-details-marker]:hidden">
        {title}
        <Icon name="chevron" className="size-3.5 shrink-0 transition-transform duration-300 group-open:rotate-180" />
      </summary>
      <div className="border-t border-hairline p-4">{children}</div>
    </details>
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
