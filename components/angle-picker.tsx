"use client";

import { contentKinds, type Angle } from "@/lib/types";
import { Icon, Spinner } from "./ui";

type Props = {
  angles: Angle[];
  styleName: string;
  busy: boolean;
  loadingMore: boolean;
  onOutline: (a: Angle) => void;
  onOneShot: (a: Angle) => void;
  onMore: () => void;
  onClose: () => void;
};

const kindTone: Record<Angle["kind"], string> = {
  fact: "border-sky-300/25 text-sky-200/80",
  opinion: "border-violet-300/25 text-violet-200/80",
  story: "border-rose-300/25 text-rose-200/80",
};

export function AnglePicker({ angles, styleName, busy, loadingMore, onOutline, onOneShot, onMore, onClose }: Props) {
  return (
    <div className="animate-rise space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Step 00 · 选题</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            以「<span className="text-accent">{styleName}</span>」的视角，挑一个切入点
          </h2>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onMore}>
            {loadingMore ? <Spinner className="size-3.5" /> : <Icon name="sparkle" className="size-3.5" />}
            换一批
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>
            收起
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {angles.map((a, i) => (
          <article key={`${i}-${a.angle}`} className="panel group flex animate-rise flex-col p-5 transition hover:border-accent/30">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-accent">{String(i + 1).padStart(2, "0")}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${kindTone[a.kind]}`}>{contentKinds[a.kind].label}</span>
            </div>
            <h3 className="mt-3 text-[15px] leading-snug font-medium">{a.angle}</h3>
            <blockquote className="mt-3 border-l-2 border-accent/40 pl-3 text-sm leading-relaxed text-white/70">“{a.hook}”</blockquote>
            <ul className="mt-4 flex-1 space-y-1.5 text-xs leading-relaxed text-white/45">
              {a.points.map((p, j) => (
                <li key={j} className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-white/25" />
                  {p}
                </li>
              ))}
            </ul>
            {a.note && (
              <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-[11px] leading-relaxed text-amber-100/75">⚠ {a.note}</p>
            )}
            <div className="mt-5 flex gap-2 border-t border-white/[0.06] pt-4">
              <button className="btn btn-ghost btn-sm flex-1" disabled={busy} onClick={() => onOutline(a)}>
                出大纲
              </button>
              <button className="btn btn-primary btn-sm flex-1" disabled={busy} onClick={() => onOneShot(a)}>
                <Icon name="sparkle" className="size-3.5" /> 一键成稿
              </button>
            </div>
          </article>
        ))}
      </div>
      <p className="text-xs text-white/30">选中后会把角度写入左侧「内容概要」，你随时可以再修改。</p>
    </div>
  );
}
