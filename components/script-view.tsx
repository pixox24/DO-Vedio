"use client";

import { useState } from "react";
import { charsFor, countChars, deviation, formatTime, timeline, TOLERANCE } from "@/lib/duration";
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
};

export function ScriptView({ segments, sections, rate, minutes, templates, activeIndex, busy, undoable, onEdit, onRewrite, onUndo, onFit }: Props) {
  const times = timeline(segments.map((s) => s.text), rate);
  const totalSec = times.at(-1)?.end ?? 0;
  const totalChars = segments.reduce((s, x) => s + countChars(x.text), 0);
  const dev = deviation(totalSec, minutes * 60);
  const done = activeIndex === null && segments.length > 0;

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

      <div className="relative space-y-3">
        {segments.map((seg, i) => (
          <SegmentCard
            key={i}
            index={i}
            segment={seg}
            time={times[i]}
            targetChars={sections[i] ? charsFor(sections[i].minutes, rate) : undefined}
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
  { action: "expand", label: "扩写" },
  { action: "shrink", label: "缩写" },
  { action: "colloquial", label: "更口语化" },
];

type CardProps = {
  index: number;
  segment: Segment;
  time: { start: number; end: number };
  targetChars?: number;
  templates: StyleTemplate[];
  streaming: boolean;
  busy: boolean;
  undoable: boolean;
  onEdit: (text: string) => void;
  onRewrite: (action: RewriteAction, extra?: RewriteExtra) => void;
  onUndo: () => void;
};

function SegmentCard({ index, segment, time, targetChars, templates, streaming, busy, undoable, onEdit, onRewrite, onUndo }: CardProps) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const chars = countChars(segment.text);
  const off = targetChars ? deviation(chars, targetChars) : 0;
  const run = (action: RewriteAction, extra?: RewriteExtra) => {
    onRewrite(action, extra);
    setOpen(false);
  };

  return (
    <article
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

      {open && (
        <div className="mb-4 animate-rise space-y-3 rounded-xl border border-white/[0.07] bg-black/30 p-3">
          <div className="flex flex-wrap gap-2">
            {quickActions.map((a) => (
              <button key={a.action} className="chip" onClick={() => run(a.action)}>
                {a.label}
              </button>
            ))}
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
          value={segment.text}
          readOnly={streaming || busy}
          onChange={(e) => onEdit(e.target.value)}
          className="w-full bg-transparent text-[15px] leading-[1.9] text-white/85 outline-none"
        />
      )}
    </article>
  );
}
