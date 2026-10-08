"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { postJson } from "@/lib/client";
import { memeCategories, type MemeRef } from "@/lib/memes";
import type { Brief } from "@/lib/types";
import { Icon, Spinner } from "./ui";

type Props = {
  brief: Brief;
  modelId: string;
  styleName: string;
  levelLabel: string;
  groundedLevelLabel: string;
  hotEnabled: boolean;
  groundedEnabled: boolean;
  /** null = 取消；[] = 这期不用梗 */
  onDone: (memes: MemeRef[] | null) => void;
};

/** 生成前挑梗：模型从梗库里挑出和这期搭得上的，用户勾掉不想要的 */
export function MemePicker({ brief, modelId, styleName, levelLabel, groundedLevelLabel, hotEnabled, groundedEnabled, onDone }: Props) {
  const [candidates, setCandidates] = useState<MemeRef[] | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [off, setOff] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);

  const pick = useCallback(
    (signal?: AbortSignal) =>
      postJson<{ candidates: MemeRef[]; fetched: boolean; refreshing: boolean }>("/api/memes/pick", { brief: { ...brief, memes: null }, modelId }, "POST", signal).then((r) => {
        setCandidates(r.candidates);
        setNotice(r.fetched ? "梗库刚刚联网刷新过一轮。" : r.refreshing ? "梗库超过 7 天没刷新，已在后台联网刷新；这次先用现有的梗，下次挑梗就能用上新的。" : "");
      }),
    // 面板打开期间 brief 不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    pick(ctrl.signal).catch((e) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : String(e)));
    return () => ctrl.abort();
  }, [pick]);

  /** 按本期题材联网再搜一轮，搜完重新挑；已勾掉的梗保持勾掉 */
  async function searchTopic() {
    setSearching(true);
    setError("");
    try {
      const r = await postJson<{ added: number; updated: number }>("/api/memes/fetch", { topic: brief.title.slice(0, 60) });
      await pick();
      setNotice(`按「${brief.title}」搜到新梗 ${r.added} 个、续期 ${r.updated} 个，已重新挑选。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  const chosen = candidates?.filter((m) => !off.has(m.term)) ?? [];
  const toggle = (term: string) =>
    setOff((s) => {
      const n = new Set(s);
      if (n.has(term)) n.delete(term);
      else n.add(term);
      return n;
    });

  return (
    <div className="animate-rise space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Step 00 · 选表达</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            本期可用表达 <span className="text-base font-normal text-white/40">· 「{styleName}」</span>
          </h2>
          <p className="mt-2 text-sm text-white/45">
            {hotEnabled && `网感${levelLabel}`}{hotEnabled && groundedEnabled && " · "}{groundedEnabled && `接地气${groundedLevelLabel}`} · 只使用你勾选的表达，合适时才用。
          </p>
        </div>
        <div className="flex gap-2">
          {hotEnabled && <button className="btn btn-ghost btn-sm" disabled={searching || candidates === null} onClick={searchTopic} title="用视频标题联网搜相关的近期热梗，大约需要两三分钟">
            {searching ? <Spinner className="size-3.5" /> : <Icon name="search" className="size-3.5" />}
            {searching ? "正在按题材搜梗…" : "按本期题材再搜热梗"}
          </button>}
          <Link href="/memes" target="_blank" className="btn btn-ghost btn-sm">
            管理梗库
          </Link>
        </div>
      </div>
      {notice && <p className="text-xs text-white/40">{notice}</p>}

      {error ? (
        <p className="rounded-2xl border border-red-400/20 bg-red-400/[0.05] px-5 py-3.5 text-sm text-red-200/90">{error}</p>
      ) : candidates === null ? (
        <p className="panel flex items-center gap-2.5 p-6 text-sm text-white/50">
          <Spinner className="size-4" /> 正在从梗库里挑选和这期搭得上的表达…{hotEnabled ? "（没有近期热梗时会联网补充）" : ""}
        </p>
      ) : candidates.length === 0 ? (
        <p className="panel p-6 text-sm leading-relaxed text-white/55">
          梗库里暂时没有适合这期的表达。可以去
          <Link href="/memes" target="_blank" className="mx-1 text-accent hover:underline">
            梗库
          </Link>
          {hotEnabled ? "刷新热梗后再挑，或者这期先不用表达。" : "添加一些日常口语或情绪表达后再挑，或者这期先不用表达。"}
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {candidates.map((m) => {
              const on = !off.has(m.term);
              return (
                <button
                  key={m.term}
                  type="button"
                  onClick={() => toggle(m.term)}
                  className={`panel cursor-pointer p-4 text-left transition ${on ? "border-accent/50 bg-accent/[0.05]" : "opacity-50 hover:opacity-80"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span>
                      <span className={`block text-[15px] font-medium ${on ? "text-accent" : "text-white/80"}`}>{m.term}</span>
                      <span className="mt-1 block text-[10px] text-white/35">{memeCategories[m.category]}</span>
                    </span>
                    <span className={`flex size-4 shrink-0 items-center justify-center rounded border ${on ? "border-accent bg-accent text-black" : "border-white/25"}`}>
                      {on && <Icon name="check" className="size-3" />}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-white/60">{m.meaning}</p>
                  <p className="mt-2 border-l-2 border-white/15 pl-2 text-xs leading-relaxed text-white/45">{m.example}</p>
                  {m.where && <p className="mt-2 text-[11px] text-sky-200/60">适合：{m.where}</p>}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn btn-ghost btn-sm" onClick={() => onDone(null)}>
          取消
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => onDone([])}>
          这期不用表达
        </button>
        <button className="btn btn-primary btn-sm" disabled={!chosen.length} onClick={() => onDone(chosen)}>
          <Icon name="check" className="size-3.5" /> 用选中的 {chosen.length} 个表达
        </button>
      </div>
    </div>
  );
}
