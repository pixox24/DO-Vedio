"use client";

import { charsFor, normalizeMinutes } from "@/lib/duration";
import type { Section, SpeechRate } from "@/lib/types";
import { AutoTextarea, Icon, Spinner } from "./ui";

type Props = {
  sections: Section[];
  onChange: (sections: Section[]) => void;
  minutes: number;
  rate: SpeechRate;
  busy: boolean;
  onWrite: () => void;
  onRegenerate: () => void;
};

export function OutlineEditor({ sections, onChange, minutes, rate, busy, onWrite, onRegenerate }: Props) {
  const total = sections.reduce((s, x) => s + x.minutes, 0);
  const off = Math.abs(total - minutes) > 0.05;
  const update = (i: number, patch: Partial<Section>) => onChange(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="animate-rise space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Step 01 · 大纲</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">调整章节，再开始写稿</h2>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onRegenerate}>
            重新生成
          </button>
          <button className="btn btn-primary" disabled={busy || sections.length === 0} onClick={onWrite}>
            {busy ? <Spinner /> : <Icon name="arrow" />}
            开始写稿
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-white/45">
        <Icon name="clock" className="size-3.5" />
        合计 <span className={`font-mono ${off ? "text-amber-300" : "text-white/80"}`}>{total.toFixed(1)}</span> / {minutes} 分钟
        {off && (
          <button className="text-accent hover:underline" onClick={() => onChange(normalizeMinutes(sections, minutes))}>
            按目标时长等比校正
          </button>
        )}
      </div>

      <ol className="space-y-2">
        {sections.map((s, i) => (
          <li key={i} className="panel group grid grid-cols-[2.5rem_1fr_auto] gap-4 rounded-2xl p-4 transition hover:border-white/15">
            <span className="pt-1.5 font-mono text-sm text-white/25">{String(i + 1).padStart(2, "0")}</span>
            <div className="space-y-1.5">
              <input
                className="w-full bg-transparent text-[15px] font-medium outline-none placeholder:text-white/25"
                value={s.title}
                placeholder="章节标题"
                onChange={(e) => update(i, { title: e.target.value })}
              />
              <AutoTextarea
                className="w-full bg-transparent text-sm leading-relaxed text-white/55 outline-none placeholder:text-white/25"
                value={s.points}
                placeholder="本章要点"
                onChange={(e) => update(i, { points: e.target.value })}
              />
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1">
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={s.minutes}
                  onChange={(e) => update(i, { minutes: Math.max(0.1, Number(e.target.value) || 0.1) })}
                  className="w-12 bg-transparent text-right font-mono text-sm outline-none"
                />
                <span className="text-[11px] text-white/35">分</span>
              </div>
              <span className="text-[11px] text-white/30">≈ {charsFor(s.minutes, rate)} 字</span>
              <button
                className="cursor-pointer text-white/25 opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                title="删除本章"
                onClick={() => onChange(sections.filter((_, j) => j !== i))}
              >
                <Icon name="trash" className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ol>

      <button
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 py-3 text-sm text-white/40 transition hover:border-white/25 hover:text-white"
        onClick={() => onChange([...sections, { title: "", points: "", minutes: 1 }])}
      >
        <Icon name="plus" /> 添加章节
      </button>
    </div>
  );
}
