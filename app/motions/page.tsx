"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { useFeedback } from "@/components/feedback";
import { Alert, Button, Field, Icon, Select } from "@/components/ui";
import { postJson } from "@/lib/client";
import { cameraCatalog, filterMotionCatalog, motionCatalog, motionEnergyLabel, shelfEnergyLabel, transitionCatalog, type MotionCatalogItem, type MotionFilter, type ShelfEnergy } from "@/lib/core/motion-library";
import { sfxLabel, type SfxRole, type SfxSources } from "@/lib/core/sfx";
import { motionNoteEnergyLabels, motionNoteEnergies, motionShelfLabels, motionShelves, type MotionNote, type MotionNoteEnergy, type MotionNoteInput, type MotionShelf } from "@/lib/core/motion-notes";
import type { FocusPresetId, Motion, TransitionIn } from "@/lib/core/types";

const MotionPreview = dynamic(() => import("@/components/motion-preview").then((mod) => mod.MotionPreview), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-white/40">正在加载预览</div>,
});
const CameraShelfPreview = dynamic(() => import("@/components/shelf-preview").then((mod) => mod.CameraShelfPreview), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-white/40">正在加载预览</div>,
});
const TransitionShelfPreview = dynamic(() => import("@/components/shelf-preview").then((mod) => mod.TransitionShelfPreview), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-white/40">正在加载预览</div>,
});

const filters: { id: MotionFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "short", label: "短词" },
  { id: "long", label: "长句" },
  { id: "number", label: "数字" },
  { id: "english", label: "带英文小字" },
];

const emptyNote: MotionNoteInput = { name: "", summary: "", link: "", shelf: "text", energy: "mid" };

type Segment = "text" | "camera" | "transition" | "notes";

function smallCopy(item: MotionCatalogItem) {
  if (item.englishSlot) return "双语开着，并且这句英文译文放得下一行，才显示英文小字。否则用中文辅助字，或留空。";
  return "小字只显示中文辅助字。";
}

/** 列表键盘导航：↑/↓ 逐条移动，Home/End 跳到两端。 */
function handleListKeys(event: KeyboardEvent<HTMLDivElement>, ids: readonly string[], currentId: string | null, select: (id: string) => void) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = ids.findIndex((id) => id === currentId);
  const next = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : event.key === "ArrowDown" ? Math.min(current + 1, ids.length - 1) : Math.max(current - 1, 0);
  const id = ids[next];
  if (!id) return;
  select(id);
  (event.currentTarget.querySelector(`[data-motion-id="${id}"]`) as HTMLElement | null)?.focus();
}

export default function MotionsPage() {
  const { confirm, toast } = useFeedback();
  const [segment, setSegment] = useState<Segment>("text");
  const [filter, setFilter] = useState<MotionFilter>("all");
  const [selectedId, setSelectedId] = useState<FocusPresetId | null>(null);
  const [cameraId, setCameraId] = useState<Motion | null>(null);
  const [transitionId, setTransitionId] = useState<TransitionIn | null>(null);
  const [sfxSources, setSfxSources] = useState<SfxSources>({});
  const [notes, setNotes] = useState<MotionNote[]>([]);
  const [draft, setDraft] = useState<MotionNoteInput>(emptyNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const transition = transitionCatalog.find((item) => item.id === transitionId) ?? null;
  const visible = filterMotionCatalog(filter);
  if (selectedId && !visible.some((item) => item.id === selectedId)) setSelectedId(visible[0]?.id ?? null);
  const selected = visible.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sfx")
      .then((res) => (res.ok ? res.json() : {}))
      .then((sources: SfxSources) => {
        if (!cancelled) setSfxSources(sources ?? {});
      })
      .catch(() => {});
    postJson<MotionNote[]>("/api/motions/notes", undefined, "GET")
      .then((items) => {
        if (!cancelled) setNotes(items);
      })
      .catch((reason) => {
        if (!cancelled) toast(reason instanceof Error ? reason.message : String(reason), "error");
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  async function addNote() {
    setBusy(true);
    setError("");
    try {
      const note = await postJson<MotionNote>("/api/motions/notes", draft);
      setNotes((items) => [note, ...items]);
      setDraft(emptyNote);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function removeNote(note: MotionNote) {
    if (!(await confirm({
      title: `删除「${note.name}」？`,
      message: "这条参考会从待做成里消失。",
      confirmLabel: "删除",
      tone: "danger",
      bullets: ["预计费用：不产生服务商费用。", "影响范围：只删除这条收藏，已有项目不受影响。", "可恢复：删除后不能恢复。"],
    }))) return;
    try {
      await postJson(`/api/motions/notes/${note.id}`, undefined, "DELETE");
      setNotes((items) => items.filter((item) => item.id !== note.id));
      toast("参考已删除", "success");
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : String(reason), "error");
    }
  }

  return (
    <div className="pt-12">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
        <div className="min-w-0 max-w-xl">
          <p className="label">创作资源</p>
          <h1 className="mt-3 text-5xl font-semibold tracking-[-0.03em]">动画库</h1>
          <p className="mt-3 text-sm leading-6 text-text-muted">决定画面怎么动。分镜负责拍什么，这里负责这一下怎么进来。文字、运镜和转场都可以在分镜里锁定。</p>
        </div>
        <SegmentTabs value={segment} notesCount={notes.length} onChange={setSegment} />
      </header>

      <div key={segment} className="animate-fade-in">
        {segment === "text" ? (
          <BrowserLayout
            stage={
              <Stage active={selected != null}>
                {selected ? (
                  <div key={selected.id} className="h-full animate-fade-in">
                    <MotionPreview item={selected} sfxSrc={sfxSources[selected.sfx]} />
                  </div>
                ) : (
                  <EmptyStage />
                )}
              </Stage>
            }
            list={
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-1.5">
                    {filters.map((item) => (
                      <button key={item.id} type="button" className={`chip h-7 px-3 text-2xs ${filter === item.id ? "chip-on" : ""}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>
                    ))}
                  </div>
                  <p className="shrink-0 font-mono text-3xs text-text-faint">{visible.length}/{motionCatalog.length}</p>
                </div>
                <div
                  role="listbox"
                  aria-label="文字动画"
                  onKeyDown={(event) => handleListKeys(event, visible.map((item) => item.id), selectedId, (id) => setSelectedId(id as FocusPresetId))}
                  className="space-y-1.5 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto lg:pr-1.5"
                >
                  {visible.map((item, index) => (
                    <CatalogRow
                      key={item.id}
                      id={item.id}
                      index={index}
                      name={item.name}
                      fit={item.fit}
                      energy={item.energy}
                      meta={`${item.width[0]}–${item.width[1]} 字`}
                      active={item.id === selectedId}
                      onSelect={() => setSelectedId(item.id)}
                    />
                  ))}
                </div>
              </div>
            }
            detail={
              selected ? (
                <DetailPanel
                  title={selected.name}
                  fit={selected.fit}
                  tags={
                    <>
                      <span className="tag gap-1.5"><EnergyDots energy={selected.energy} />能量 {motionEnergyLabel(selected.energy)}</span>
                      <span className="tag">{sfxLabel(selected.sfx)}</span>
                      <span className="tag">{selected.width[0]}–{selected.width[1]} 字</span>
                      {selected.englishSlot && <span className="tag">带英文小字位</span>}
                    </>
                  }
                  cells={[
                    { label: "节奏", body: selected.rhythm },
                    { label: "小字", body: smallCopy(selected) },
                    { label: "用法", body: `在分镜里把这条镜头锁成「${selected.name}」。` },
                  ]}
                />
              ) : (
                <DetailPlaceholder />
              )
            }
          />
        ) : segment === "camera" ? (
          <ShelfBrowser
            label="运镜"
            items={cameraCatalog}
            selectedId={cameraId}
            onSelect={(id) => setCameraId(id as Motion)}
            usage={(name) => `在分镜的画面镜头里锁成「${name}」。重点文字不用运镜。`}
            preview={cameraId ? <CameraShelfPreview key={cameraId} id={cameraId} /> : null}
          />
        ) : segment === "transition" ? (
          <ShelfBrowser
            label="转场"
            items={transitionCatalog}
            selectedId={transitionId}
            onSelect={(id) => setTransitionId(id as TransitionIn)}
            usage={(name) => `在分镜里把进入这一镜的转场锁成「${name}」。没锁定时，仍按原来的规则自动配。`}
            preview={transition ? <TransitionShelfPreview key={transition.id} id={transition.id} sfxSrc={transition.sfx ? sfxSources[transition.sfx] : undefined} /> : null}
          />
        ) : (
          <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(19rem,23rem)_minmax(0,1fr)] lg:gap-5">
            <form
              className="panel space-y-4 p-5 lg:sticky lg:top-16"
              onSubmit={(event) => {
                event.preventDefault();
                void addNote();
              }}
            >
              <div>
                <h2 className="text-base font-semibold">记下一条参考</h2>
                <p className="mt-1 text-xs leading-5 text-text-faint">还不能调用的动效先记下来。做成之后，用同一份名字在分镜里锁定。</p>
              </div>
              <Field label="名称">
                <input className="input h-10" maxLength={40} value={draft.name} aria-label="名称" placeholder="例如：弹幕式滚动" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </Field>
              <Field label="一句话" hint={`${draft.summary.length}/120`}>
                <textarea className="input min-h-20" maxLength={120} value={draft.summary} aria-label="一句话" placeholder="它怎么动，适合什么句子" onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
              </Field>
              <Field label="参考链接" hint="可空">
                <input className="input h-10" maxLength={500} value={draft.link} aria-label="参考链接" placeholder="https://…" onChange={(event) => setDraft({ ...draft, link: event.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="货架">
                  <Select value={draft.shelf} aria-label="货架" onChange={(shelf) => setDraft({ ...draft, shelf: shelf as MotionShelf })}>
                    {motionShelves.map((shelf) => <option key={shelf} value={shelf}>{motionShelfLabels[shelf]}</option>)}
                  </Select>
                </Field>
                <Field label="能量">
                  <Select value={draft.energy} aria-label="能量" onChange={(energy) => setDraft({ ...draft, energy: energy as MotionNoteEnergy })}>
                    {motionNoteEnergies.map((energy) => <option key={energy} value={energy}>{motionNoteEnergyLabels[energy]}</option>)}
                  </Select>
                </Field>
              </div>
              {error && <Alert tone="danger" size="sm">{error}</Alert>}
              <div className="flex justify-end">
                <Button variant="primary" type="submit" loading={busy} disabled={!draft.name.trim() || !draft.summary.trim()} icon={<Icon name="plus" />}>
                  添加
                </Button>
              </div>
            </form>
            {notes.length === 0 ? (
              <div className="panel grid place-items-center border-dashed px-6 py-16 text-center">
                <span className="grid size-11 place-items-center rounded-full border border-line bg-white/[0.03] text-text-faint">
                  <Icon name="sparkle" className="size-5" />
                </span>
                <p className="mt-4 text-sm text-text-muted">还没有待做成的参考</p>
                <p className="mt-1 max-w-64 text-2xs leading-5 text-text-faint">看到想做的动效，先在表单里记下来，链接和能量都可以补上。</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {notes.map((note) => (
                  <article key={note.id} className="panel flex flex-col p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="min-w-0 text-sm font-semibold leading-6">{note.name}</h2>
                      <button type="button" className="btn btn-ghost btn-sm shrink-0 hover:border-red-400/40 hover:text-red-300" aria-label={`删除${note.name}`} onClick={() => void removeNote(note)}>
                        <Icon name="trash" className="size-3.5" />
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-text-muted">{note.summary}</p>
                    {note.link && <NoteLink link={note.link} />}
                    <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                      <span className="tag">{motionShelfLabels[note.shelf]}</span>
                      <span className="tag gap-1.5"><EnergyDots energy={note.energy} />能量 {motionNoteEnergyLabels[note.energy]}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 主导航：四个货架的分段切换，带图标与计数。 */
function SegmentTabs({ value, notesCount, onChange }: { value: Segment; notesCount: number; onChange: (segment: Segment) => void }) {
  const tabs: { id: Segment; label: string; count: number; icon: "captions" | "frames" | "arrow" | "sparkle" }[] = [
    { id: "text", label: "文字动画", count: motionCatalog.length, icon: "captions" },
    { id: "camera", label: "运镜", count: cameraCatalog.length, icon: "frames" },
    { id: "transition", label: "转场", count: transitionCatalog.length, icon: "arrow" },
    { id: "notes", label: "待做成", count: notesCount, icon: "sparkle" },
  ];
  return (
    <div role="group" aria-label="动画类别" className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-line bg-white/[0.025] p-1">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tab.id)}
            className={`flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-sm whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${active ? "bg-white text-black" : "text-text-muted hover:bg-white/[0.05] hover:text-white"}`}
          >
            <Icon name={tab.icon} className="size-3.5" />
            {tab.label}
            <span className={`font-mono text-3xs ${active ? "text-black/50" : "text-text-faint"}`}>{tab.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 浏览布局：预览台在上（随滚钉住），列表在左，详情在预览台下方。移动端按 舞台 → 列表 → 详情 排列。 */
function BrowserLayout({ stage, list, detail }: { stage: ReactNode; list: ReactNode; detail: ReactNode }) {
  return (
    <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(19rem,23rem)_minmax(0,1fr)] lg:gap-5">
      <div className="sticky top-16 z-[var(--z-sticky)] lg:col-start-2 lg:row-start-1">{stage}</div>
      <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">{list}</div>
      <div className="lg:col-start-2 lg:row-start-2">{detail}</div>
    </div>
  );
}

/** 预览台：状态行 + 取景角标的监视器容器。 */
function Stage({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
        <p className="font-mono text-3xs uppercase tracking-[0.2em] text-text-faint">预览 · 循环约 3 秒</p>
        <p className="flex items-center gap-1.5 text-3xs text-text-faint">
          <span className={`size-1.5 rounded-full ${active ? "animate-live-dot bg-accent" : "bg-white/20"}`} aria-hidden="true" />
          {active ? "播放中" : "待选择"}
        </p>
      </div>
      <div className="relative aspect-video bg-stage">
        <div aria-hidden="true" className="pointer-events-none absolute inset-3 z-10">
          <span className="absolute left-0 top-0 size-3 border-l border-t border-white/20" />
          <span className="absolute right-0 top-0 size-3 border-r border-t border-white/20" />
          <span className="absolute bottom-0 left-0 size-3 border-b border-l border-white/20" />
          <span className="absolute bottom-0 right-0 size-3 border-b border-r border-white/20" />
        </div>
        {children}
      </div>
    </section>
  );
}

function EmptyStage() {
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="flex max-w-60 flex-col items-center gap-3 text-center">
        <span className="grid size-11 place-items-center rounded-full border border-line bg-white/[0.03] text-text-faint">
          <Icon name="frames" className="size-5" />
        </span>
        <p className="text-sm text-text-muted">从列表里选一条，看它怎么动</p>
        <p className="text-2xs leading-5 text-text-faint">每个循环约 3 秒，名字和分镜里锁定的是同一份</p>
      </div>
    </div>
  );
}

/** 能量可视化：低 / 中 / 高 = 1 / 2 / 3 格。 */
function EnergyDots({ energy }: { energy: "low" | "mid" | "high" }) {
  const level = energy === "low" ? 1 : energy === "mid" ? 2 : 3;
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`size-1 rounded-full ${i < level ? "bg-accent" : "bg-white/15"}`} />
      ))}
    </span>
  );
}

/** 目录行：编号 + 名称与适合 + 右侧能量与元信息。 */
function CatalogRow({ id, index, name, fit, energy, meta, active, onSelect }: {
  id: string;
  index: number;
  name: string;
  fit: string;
  energy: "low" | "mid" | "high";
  meta?: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-motion-id={id}
      onClick={onSelect}
      style={{ animationDelay: `${Math.min(index, 10) * 20}ms` }}
      className={`animate-rise relative flex w-full items-center gap-3 rounded-surface border px-3.5 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
        active ? "border-line-strong bg-white/[0.07]" : "border-transparent hover:border-hairline hover:bg-white/[0.04]"
      }`}
    >
      <span className={`absolute left-1 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full transition ${active ? "bg-accent" : "bg-transparent"}`} aria-hidden="true" />
      <span className={`w-6 shrink-0 pl-1.5 font-mono text-2xs ${active ? "text-accent" : "text-text-faint"}`}>{String(index + 1).padStart(2, "0")}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-medium ${active ? "text-white" : "text-white/85"}`}>{name}</span>
        <span className="mt-0.5 block truncate text-2xs text-text-faint">{fit}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <EnergyDots energy={energy} />
        {meta && <span className="font-mono text-3xs text-text-faint">{meta}</span>}
      </span>
    </button>
  );
}

/** 详情面板：名称与标签在上，节奏 / 小字 / 用法分栏在下。 */
function DetailPanel({ title, fit, tags, cells }: { title: string; fit: string; tags: ReactNode; cells: { label: string; body: ReactNode }[] }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-hairline px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-text-faint">{fit}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">{tags}</div>
      </div>
      <div className={`grid divide-y divide-hairline sm:divide-x sm:divide-y-0 ${cells.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {cells.map((cell) => (
          <div key={cell.label} className="px-5 py-4">
            <p className="label">{cell.label}</p>
            <p className="mt-1.5 text-sm leading-6 text-text-muted">{cell.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function DetailPlaceholder() {
  return (
    <section className="panel border-dashed px-5 py-4">
      <p className="text-xs leading-5 text-text-faint">选中一条后，这里显示它的节奏、小字规则和用法。</p>
    </section>
  );
}

/** 运镜与转场共用：目录 + 预览台 + 详情。 */
function ShelfBrowser({ label, items, selectedId, onSelect, usage, preview }: {
  label: string;
  items: readonly { id: string; name: string; fit: string; rhythm: string; energy: ShelfEnergy; sfx: SfxRole | null }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  usage: (name: string) => string;
  preview: ReactNode;
}) {
  const selected = items.find((item) => item.id === selectedId) ?? null;
  return (
    <BrowserLayout
      stage={
        <Stage active={selected != null}>
          {selected ? (
            <div key={selected.id} className="h-full animate-fade-in">
              {preview}
            </div>
          ) : (
            <EmptyStage />
          )}
        </Stage>
      }
      list={
        <div
          role="listbox"
          aria-label={label}
          onKeyDown={(event) => handleListKeys(event, items.map((item) => item.id), selectedId, onSelect)}
          className="space-y-1.5 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto lg:pr-1.5"
        >
          {items.map((item, index) => (
            <CatalogRow
              key={item.id}
              id={item.id}
              index={index}
              name={item.name}
              fit={item.fit}
              energy={item.energy}
              active={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
            />
          ))}
        </div>
      }
      detail={
        selected ? (
          <DetailPanel
            title={selected.name}
            fit={selected.fit}
            tags={
              <>
                <span className="tag gap-1.5"><EnergyDots energy={selected.energy} />能量 {shelfEnergyLabel(selected.energy)}</span>
                <span className="tag">{sfxLabel(selected.sfx)}</span>
              </>
            }
            cells={[
              { label: "节奏", body: selected.rhythm },
              { label: "用法", body: usage(selected.name) },
            ]}
          />
        ) : (
          <DetailPlaceholder />
        )
      }
    />
  );
}

function NoteLink({ link }: { link: string }) {
  const href = /^https?:\/\//i.test(link) ? link : "";
  return href
    ? <a className="mt-1 block truncate text-xs text-accent/80 hover:text-accent" href={href} target="_blank" rel="noreferrer">{link}</a>
    : <p className="mt-1 truncate text-xs text-white/40">{link}</p>;
}
