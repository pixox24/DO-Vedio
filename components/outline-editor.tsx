"use client";

import { charsFor, normalizeMinutes } from "@/lib/duration";
import type { MemeRef } from "@/lib/memes";
import type { Section, SpeechRate } from "@/lib/types";
import { AutoTextarea, Icon, Select, Spinner } from "./ui";

type Props = {
  sections: Section[];
  onChange: (sections: Section[]) => void;
  minutes: number;
  rate: SpeechRate;
  busy: boolean;
  onWrite: () => void;
  onRegenerate: () => void;
  /** 本期选用的梗；为空表示网感关闭或没挑梗，不显示用梗分配 */
  memes: MemeRef[];
};

export function OutlineEditor({ sections, onChange, minutes, rate, busy, onWrite, onRegenerate, memes }: Props) {
  const total = sections.reduce((s, x) => s + x.minutes, 0);
  const off = Math.abs(total - minutes) > 0.05;
  const update = (i: number, patch: Partial<Section>) => onChange(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const terms = new Set(memes.map((m) => m.term));
  const assigned = sections.some((s) => s.memes);
  // 手动调整分配后，其余没分配过的章节视为“本章不用梗”，避免旧大纲里全部梗每章都能用
  const setMemes = (i: number, list: string[]) => onChange(sections.map((s, j) => (j === i ? { ...s, memes: list } : { ...s, memes: s.memes ?? [] })));
  const taken = new Set(sections.flatMap((s) => s.memes ?? []));

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
              {memes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                  {(s.memes ?? []).filter((t) => terms.has(t)).map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/[0.06] px-2 py-0.5 text-accent/90">
                      {t}
                      <button className="cursor-pointer text-accent/50 hover:text-accent" title="本章不用这个梗" onClick={() => setMemes(i, (s.memes ?? []).filter((x) => x !== t))}>
                        ×
                      </button>
                    </span>
                  ))}
                  {!s.memes && <span className="text-white/30">{assigned ? "本章不用梗" : "未分配，写稿时本期的梗都可用"}</span>}
                  {(s.memes?.length ?? 0) < 2 && memes.some((m) => !taken.has(m.term)) && (
                    <Select
                      className="w-auto min-w-24 text-[11px]"
                      value=""
                      onChange={(value) => value && setMemes(i, [...(s.memes ?? []), value])}
                      aria-label="给本章加梗"
                    >
                      <option value="">+ 加梗</option>
                      {memes.filter((m) => !taken.has(m.term)).map((m) => <option key={m.term} value={m.term}>{m.term}</option>)}
                    </Select>
                  )}
                </div>
              )}
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
