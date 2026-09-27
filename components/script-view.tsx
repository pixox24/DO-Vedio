"use client";

import { useMemo, useRef, useState } from "react";
import { charsFor, countChars, deviation, formatTime, timeline, TOLERANCE } from "@/lib/duration";
import { detectAiTone, groupHits, type Hit, type ToneContext } from "@/lib/humanize/detect";
import { findMemeUses, type MemeUse } from "@/lib/memes";
import type { RewriteAction, Section, Segment, SpeechRate, StyleTemplate } from "@/lib/types";
import { AutoTextarea, Icon, Spinner } from "./ui";

export type RewriteExtra = { instruction?: string; restyleId?: string };

type Props = {
  segments: Segment[];
  sections: Section[];
  rate: SpeechRate;
  minutes: number;
  templates: StyleTemplate[];
  /** 正在流式写入的段落 */
  activeIndex: number | null;
  busy: boolean;
  undoable: Set<number>;
  onEdit: (i: number, text: string) => void;
  onRewrite: (i: number, action: RewriteAction, extra?: RewriteExtra) => void;
  onUndo: (i: number) => void;
  onFit: () => void;
  onHumanizeAll: () => void;
  /** 用梗检测上下文：选用的梗、过气梗、网感档位 */
  toneCtx: ToneContext;
};

export function ScriptView({ segments, sections, rate, minutes, templates, activeIndex, busy, undoable, onEdit, onRewrite, onUndo, onFit, onHumanizeAll, toneCtx }: Props) {
  const times = timeline(segments.map((s) => s.text), rate);
  const totalSec = times.at(-1)?.end ?? 0;
  const totalChars = segments.reduce((s, x) => s + countChars(x.text), 0);
  const dev = deviation(totalSec, minutes * 60);
  const done = activeIndex === null && segments.length > 0;
  const ctxKey = JSON.stringify(toneCtx);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 上下文按内容比较
  const hits = useMemo(() => segments.map((s) => detectAiTone(s.text, toneCtx)), [segments, ctxKey]);
  const canAddMemes = toneCtx.slang !== undefined && toneCtx.slang !== "off" && !!toneCtx.memes?.length;
  const allHits = hits.flat();
  const picked = canAddMemes ? (toneCtx.memes ?? []) : [];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 上下文按内容比较
  const uses = useMemo(() => segments.map((s) => findMemeUses(s.text, picked)), [segments, ctxKey]);
  const areas = useRef<(HTMLTextAreaElement | null)[]>([]);
  const cards = useRef<(HTMLElement | null)[]>([]);
  /** 没用上的梗：提示在大纲分给它的那一章 */
  const [hint, setHint] = useState<{ index: number; term: string } | null>(null);

  /** 滚到这段文字大致所在的位置，并在文本框里选中它 */
  function locate(i: number, start: number, end: number) {
    const el = areas.current[i];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = window.scrollY + rect.top + rect.height * (start / Math.max(1, el.value.length)) - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    el.focus({ preventScroll: true });
    el.setSelectionRange(start, end);
  }

  function showUnused(term: string) {
    const index = sections.findIndex((s) => s.memes?.includes(term));
    setHint({ index, term });
    if (index >= 0) cards.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="space-y-5">
      <div className="panel grid grid-cols-3 divide-x divide-white/[0.06] overflow-hidden">
        <Stat label="预计时长" value={formatTime(totalSec)} sub={`目标 ${formatTime(minutes * 60)}`} />
        <Stat label="口播字数" value={totalChars.toLocaleString()} sub={`目标 ${charsFor(minutes, rate).toLocaleString()}`} />
        <Stat
          label="时长偏差"
          value={`${dev > 0 ? "+" : ""}${Math.round(dev * 100)}%`}
          sub={Math.abs(dev) <= TOLERANCE ? "在 ±15% 范围内" : dev > 0 ? "偏长" : "偏短"}
          tone={!done ? undefined : Math.abs(dev) <= TOLERANCE ? "good" : "warn"}
        />
      </div>

      {done && Math.abs(dev) > TOLERANCE && (
        <div className="flex animate-rise items-center justify-between gap-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] px-5 py-3.5">
          <p className="text-sm text-amber-100/80">
            实际时长比目标{dev > 0 ? "长" : "短"}了 {Math.abs(Math.round(dev * 100))}%，可以让 AI 逐段{dev > 0 ? "缩写" : "扩写"}到目标长度。
          </p>
          <button className="btn btn-sm border border-amber-300/40 text-amber-200 hover:bg-amber-300/10" disabled={busy} onClick={onFit}>
            <Icon name="wand" className="size-3.5" /> 自动校准时长
          </button>
        </div>
      )}

      {done && !busy && allHits.length > 0 && (
        <div className="flex animate-rise flex-wrap items-center justify-between gap-4 rounded-2xl border border-sky-300/20 bg-sky-300/[0.04] px-5 py-3.5">
          <div className="min-w-0 text-sm text-sky-100/80">
            <p>
              检测到 {allHits.length} 处疑似 AI 写作痕迹，分布在 {hits.filter((h) => h.length).length} 段里
            </p>
            <p className="mt-1 text-xs text-sky-100/45">{groupHits(allHits).map((g) => `${g.rule.name} ${g.hits.length}`).join(" · ")}</p>
          </div>
          <button className="btn btn-sm border border-sky-300/40 text-sky-200 hover:bg-sky-300/10" disabled={busy} onClick={onHumanizeAll}>
            <Icon name="wand" className="size-3.5" /> 一键去 AI 味
          </button>
        </div>
      )}

      {done && picked.length > 0 && (
        <MemeStrip
          memes={picked.map((m) => m.term)}
          uses={uses}
          hint={hint?.index === -1 ? hint.term : null}
          onLocate={locate}
          onUnused={showUnused}
        />
      )}

      <div className="relative space-y-3">
        {segments.map((seg, i) => (
          <SegmentCard
            key={i}
            index={i}
            segment={seg}
            time={times[i]}
            targetChars={sections[i] ? charsFor(sections[i].minutes, rate) : undefined}
            hits={hits[i]}
            canAddMemes={canAddMemes}
            memeUses={uses[i]}
            hasMemes={uses[i].length > 0 || hits[i].some((h) => h.rule === "slang")}
            hint={hint?.index === i ? hint.term : null}
            onDismissHint={() => setHint(null)}
            cardRef={(el) => {
              cards.current[i] = el;
            }}
            areaRef={(el) => {
              areas.current[i] = el;
            }}
            onLocate={(start, end) => locate(i, start, end)}
            templates={templates}
            streaming={activeIndex === i}
            busy={busy}
            undoable={undoable.has(i)}
            onEdit={(t) => onEdit(i, t)}
            onRewrite={(a, e) => onRewrite(i, a, e)}
            onUndo={() => onUndo(i)}
          />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" | "warn" }) {
  const color = tone === "good" ? "text-accent" : tone === "warn" ? "text-amber-300" : "text-white";
  return (
    <div className="px-5 py-4">
      <p className="label">{label}</p>
      <p className={`mt-1.5 font-mono text-2xl font-semibold tracking-tight tabular-nums ${color}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-white/35">{sub}</p>
    </div>
  );
}

const quickActions: { action: RewriteAction; label: string }[] = [
  { action: "humanize", label: "去 AI 味" },
  { action: "expand", label: "扩写" },
  { action: "shrink", label: "缩写" },
  { action: "colloquial", label: "更口语化" },
];

type CardProps = {
  index: number;
  segment: Segment;
  time: { start: number; end: number };
  targetChars?: number;
  hits: Hit[];
  canAddMemes: boolean;
  memeUses: MemeUse[];
  hasMemes: boolean;
  /** 没用上、但大纲分给本章的梗 */
  hint: string | null;
  onDismissHint: () => void;
  cardRef: (el: HTMLElement | null) => void;
  areaRef: (el: HTMLTextAreaElement | null) => void;
  onLocate: (start: number, end: number) => void;
  templates: StyleTemplate[];
  streaming: boolean;
  busy: boolean;
  undoable: boolean;
  onEdit: (text: string) => void;
  onRewrite: (action: RewriteAction, extra?: RewriteExtra) => void;
  onUndo: () => void;
};

function SegmentCard({ index, segment, time, targetChars, hits, canAddMemes, memeUses, hasMemes, hint, onDismissHint, cardRef, areaRef, onLocate, templates, streaming, busy, undoable, onEdit, onRewrite, onUndo }: CardProps) {
  const [open, setOpen] = useState(false);
  const [showHits, setShowHits] = useState(false);
  const [showMemes, setShowMemes] = useState(false);
  const [instruction, setInstruction] = useState("");
  const chars = countChars(segment.text);
  const off = targetChars ? deviation(chars, targetChars) : 0;
  const run = (action: RewriteAction, extra?: RewriteExtra) => {
    onRewrite(action, extra);
    setOpen(false);
  };

  return (
    <article
      ref={cardRef}
      className={`panel group relative animate-rise rounded-2xl p-5 transition ${
        streaming ? "border-accent/30 shadow-[0_0_48px_-20px_rgb(205_255_58/0.4)]" : "hover:border-white/12"
      }`}
    >
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-accent/90 tabular-nums">
          {formatTime(time.start)} – {formatTime(time.end)}
        </span>
        <h3 className="text-[15px] font-medium tracking-tight">{segment.title}</h3>
        {streaming && segment.text && <span className="size-1.5 animate-caret rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />}
        <span className="ml-auto flex items-center gap-3 text-[11px] text-white/35">
          {!streaming && memeUses.length > 0 && (
            <button
              className={`cursor-pointer rounded-full border px-2 py-0.5 transition ${showMemes ? "border-accent/60 text-accent" : "border-accent/25 text-accent/75 hover:border-accent/45"}`}
              onClick={() => setShowMemes((v) => !v)}
              title="查看本段用到的梗"
            >
              梗 {memeUses.length}
            </button>
          )}
          {!streaming && hits.length > 0 && (
            <button
              className={`cursor-pointer rounded-full border px-2 py-0.5 transition ${showHits ? "border-sky-300/50 text-sky-200" : "border-sky-300/20 text-sky-200/70 hover:border-sky-300/40"}`}
              onClick={() => setShowHits((v) => !v)}
              title="查看疑似 AI 写作痕迹"
            >
              AI 味 {hits.length}
            </button>
          )}
          <span className={Math.abs(off) > 0.2 ? "text-amber-300/80" : ""}>
            {chars} 字{targetChars ? ` / ${targetChars}` : ""}
          </span>
          {!streaming && segment.text && (
            <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
              {undoable && (
                <button className="btn btn-ghost btn-sm h-7 px-2.5" disabled={busy} onClick={onUndo} title="撤销上次改写">
                  <Icon name="undo" className="size-3.5" />
                </button>
              )}
              <button className={`btn btn-sm h-7 px-3 ${open ? "btn-primary" : "btn-ghost"}`} disabled={busy} onClick={() => setOpen((v) => !v)}>
                <Icon name="wand" className="size-3.5" /> AI 改写
              </button>
            </span>
          )}
        </span>
      </header>

      {hint && !streaming && (
        <div className="mb-4 flex animate-rise flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/20 bg-accent/[0.04] px-3 py-2 text-xs">
          <span className="text-white/65">
            大纲把「<span className="text-accent">{hint}</span>」分给了这一章，但正文里没找到原词（化用的认不出）
          </span>
          <span className="flex gap-2">
            {canAddMemes && (
              <button className="chip" disabled={busy} onClick={() => { onDismissHint(); onRewrite("addMemes"); }}>
                加点梗
              </button>
            )}
            <button className="cursor-pointer text-white/35 hover:text-white" onClick={onDismissHint}>
              知道了
            </button>
          </span>
        </div>
      )}

      {showMemes && !streaming && memeUses.length > 0 && (
        <div className="mb-4 flex animate-rise flex-wrap items-center gap-1.5 rounded-xl border border-accent/15 bg-accent/[0.03] p-3 text-xs">
          <span className="mr-1 text-white/40">点一下在正文里选中：</span>
          {memeUses.map((u) => (
            <button key={u.start} className="cursor-pointer rounded bg-accent/10 px-1.5 py-0.5 text-accent/90 transition hover:bg-accent/20" onClick={() => onLocate(u.start, u.end)}>
              {segment.text.slice(u.start, u.end)}
            </button>
          ))}
        </div>
      )}

      {showHits && !streaming && hits.length > 0 && (
        <div className="mb-4 animate-rise space-y-2.5 rounded-xl border border-sky-300/15 bg-sky-300/[0.03] p-3 text-xs leading-relaxed">
          {groupHits(hits).map(({ rule, hits: list }) => (
            <div key={rule.id}>
              <p className="text-sky-100/85">
                {rule.name}
                <span className="ml-2 text-white/35">{rule.fix}</span>
              </p>
              <p className="mt-1 flex flex-wrap gap-1.5">
                {list.map((h) => (
                  <button key={h.start} className="cursor-pointer rounded bg-white/[0.06] px-1.5 py-0.5 text-white/70 transition hover:bg-white/[0.12] hover:text-white" onClick={() => onLocate(h.start, h.end)} title="在正文里选中">
                    {h.text}
                  </button>
                ))}
              </p>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] pt-2.5">
            <span className="text-white/30">按触发标记检测，只代表“疑似”；设问、比喻、句内排比不算 AI 痕迹</span>
            <button className="chip shrink-0" disabled={busy} onClick={() => { setShowHits(false); onRewrite("humanize"); }}>
              去 AI 味
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="mb-4 animate-rise space-y-3 rounded-xl border border-white/[0.07] bg-black/30 p-3">
          <div className="flex flex-wrap gap-2">
            {quickActions.map((a) => (
              <button key={a.action} className="chip" onClick={() => run(a.action)}>
                {a.label}
              </button>
            ))}
            {canAddMemes && (
              <button className="chip" onClick={() => run("addMemes")}>
                加点梗
              </button>
            )}
            {hasMemes && (
              <button className="chip" onClick={() => run("dropMemes")}>
                去掉梗
              </button>
            )}
            {targetChars && (
              <button className="chip" onClick={() => run("fit")}>
                校准到 {targetChars} 字
              </button>
            )}
            <span className="mx-1 w-px self-stretch bg-white/10" />
            {templates.map((t) => (
              <button key={t.id} className="chip" onClick={() => run("restyle", { restyleId: t.id })}>
                换成「{t.name}」
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (instruction.trim()) run("custom", { instruction });
            }}
          >
            <input className="input h-9 py-0" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="自定义要求，例如：加一个生活中的类比" />
            <button className="btn btn-primary btn-sm h-9" disabled={!instruction.trim()}>
              改写
            </button>
          </form>
        </div>
      )}

      {streaming && !segment.text ? (
        <p className="flex items-center gap-2 text-sm text-white/40">
          <Spinner className="size-3.5" /> 正在写第 {index + 1} 段…
        </p>
      ) : (
        <AutoTextarea
          inputRef={areaRef}
          value={segment.text}
          readOnly={streaming || busy}
          onChange={(e) => onEdit(e.target.value)}
          className="w-full bg-transparent text-[15px] leading-[1.9] text-white/85 outline-none"
        />
      )}
    </article>
  );
}

type StripProps = {
  memes: string[];
  uses: MemeUse[][];
  /** 没分到章节的未用梗 */
  hint: string | null;
  onLocate: (index: number, start: number, end: number) => void;
  onUnused: (term: string) => void;
};

/** 本期用梗一览：每个梗用了几次、在哪几段；点击依次定位到每一处 */
function MemeStrip({ memes, uses, hint, onLocate, onUnused }: StripProps) {
  const cursor = useRef(new Map<string, number>());
  const where = (term: string) => uses.flatMap((list, index) => list.filter((u) => u.term === term).map((u) => ({ ...u, index })));
  const used = memes.filter((t) => where(t).length > 0).length;

  const jump = (term: string) => {
    const all = where(term);
    const k = (cursor.current.get(term) ?? -1) + 1;
    const next = all[k % all.length];
    cursor.current.set(term, k % all.length);
    onLocate(next.index, next.start, next.end);
  };

  return (
    <div className="panel animate-rise space-y-2.5 px-5 py-4">
      <p className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-white/80">
          本期用梗 <span className="font-mono text-accent">{used}</span>
          <span className="text-white/35"> / {memes.length}</span>
        </span>
        <span className="text-[11px] text-white/30">只识别原写法和变体，化用的不计 · 点击在正文里定位</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {memes.map((term) => {
          const all = where(term);
          if (!all.length)
            return (
              <button key={term} className="cursor-pointer rounded-full border border-dashed border-white/15 px-2.5 py-1 text-xs text-white/35 transition hover:border-white/30 hover:text-white/60" onClick={() => onUnused(term)} title="正文里没找到原词">
                {term} · 未找到原词
              </button>
            );
          const segs = [...new Set(all.map((u) => u.index + 1))];
          return (
            <button key={term} className="cursor-pointer rounded-full border border-accent/30 bg-accent/[0.06] px-2.5 py-1 text-xs text-accent/90 transition hover:border-accent/60" onClick={() => jump(term)} title={all.length > 1 ? "再点一次跳到下一处" : "在正文里选中"}>
              {term} <span className="text-accent/60">×{all.length} · 第 {segs.join("、")} 段</span>
            </button>
          );
        })}
      </div>
      {hint && <p className="text-[11px] text-white/40">「{hint}」没有分到具体章节，可以在任意段落的「AI 改写」里点「加点梗」。</p>}
    </div>
  );
}
