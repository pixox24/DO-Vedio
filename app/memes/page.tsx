"use client";

import { useCallback, useEffect, useState } from "react";
import { useFeedback } from "@/components/feedback";
import { MemeImport } from "@/components/meme-import";
import { Icon, Select, Spinner } from "@/components/ui";
import { postJson } from "@/lib/client";
import {
  memeCategories, memeCircles, memeHeats, memeKinds, memeRisks, memeSources, memeTrusts, normalizeTerm, searchWindows, sinceBucket, sinceBuckets, STALE_DAYS,
  type Meme, type MemeCategory, type MemeHeat, type MemeRisk, type MemeTrust, type SearchWindow, type SinceBucket,
} from "@/lib/memes";
import type { FetchResult, RecheckResult } from "@/lib/server/meme-fetch";
import type { MemeBlock, MemeFetch } from "@/lib/server/memes";

type View = Meme & { storedHeat: MemeHeat; isNew: boolean };
type Data = { memes: View[]; lastFetch: MemeFetch | null; latestFetch: MemeFetch | null; blocks: MemeBlock[]; recheckCount: number; searchModel: { id: string; label: string } | null };

const trustTone: Record<MemeTrust, string> = { verified: "text-accent/80", doubtful: "text-amber-200/80", unchecked: "text-white/35" };
const sorts = { verified: "按确认时间", since: "按流行时间", term: "按名称" } as const;
/** 流行时间展示：解析出的年-月优先，否则原文 */
const sinceLabel = (m: Meme) => (m.sinceMonth ? `${m.sinceMonth} 起` : m.since ? `${m.since}起` : "");

const heatTone: Record<MemeHeat, string> = {
  rising: "border-accent/40 text-accent",
  peak: "border-rose-300/40 text-rose-200",
  fading: "border-white/15 text-white/40",
  dead: "border-white/10 text-white/25 line-through",
};
const riskTone: Record<MemeRisk, string> = { safe: "text-white/45", caution: "text-amber-200/80", banned: "text-red-300/80" };

const date = (ms: number) => new Date(ms).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });

export default function MemesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [fetching, setFetching] = useState(false);
  const [heat, setHeat] = useState<"all" | "live" | MemeHeat>("live");
  const [category, setCategory] = useState<"all" | MemeCategory>("all");
  const [risk, setRisk] = useState<"all" | MemeRisk>("all");
  const [circle, setCircle] = useState<"all" | "none" | string>("all");
  const [onlyNew, setOnlyNew] = useState(false);
  /** 刷新哪个圈层；空 = 全网 */
  const [fetchCircle, setFetchCircle] = useState("");
  const [showBlocks, setShowBlocks] = useState(false);
  const [months, setMonths] = useState<SearchWindow>(1);
  const [trust, setTrust] = useState<"all" | MemeTrust>("all");
  const [since, setSince] = useState<"all" | SinceBucket>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<keyof typeof sorts>("verified");
  const [checking, setChecking] = useState(false);
  const { confirm, toast } = useFeedback();
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState("");
  const [manualCategory, setManualCategory] = useState<MemeCategory>("hot");
  const [working, setWorking] = useState<null | "term">(null);

  async function addTerm() {
    setWorking("term");
    try {
      const r = await postJson<{ added: number; updated: number; online: boolean }>("/api/memes/manual", { term, category: manualCategory });
      toast(`${r.added ? "已添加" : "已更新"}「${term.trim()}」${r.online ? "（已联网核实）" : "（未联网核实，请自己确认含义）"}`, "success");
      setTerm("");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setWorking(null);
      await reload();
    }
  }

  const reload = useCallback(() => fetch("/api/memes", { cache: "no-store" }).then((r) => r.json()).then(setData), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function refresh() {
    setFetching(true);
    try {
      const r = await postJson<FetchResult>("/api/memes/fetch", { circle: fetchCircle, months });
      const extra = [
        r.unverified && `单独搜不到、丢弃 ${r.unverified} 个`,
        r.dropped && `丢弃 ${r.dropped} 个（没写流行时间 / 平台，或不适合收录）`,
        r.blocked && `跳过已屏蔽的 ${r.blocked} 个`,
        r.rechecked && `顺带复核 ${r.rechecked} 个老梗`,
      ].filter(Boolean).join("，");
      const added = r.added ? `新增 ${r.added} 个（已核实 ${r.verified}${r.doubtful ? `，待核实 ${r.doubtful}` : ""}）` : "没有新增";
      toast(`${fetchCircle ? `「${fetchCircle}」` : ""}${added}，续期 ${r.updated} 个${extra ? `，${extra}` : ""}`, "success");
      // 有新梗就直接只看新增，方便过一遍
      if (r.added > 0) {
        setOnlyNew(true);
        setHeat("all");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setFetching(false);
      await reload();
    }
  }

  async function recheck() {
    setChecking(true);
    try {
      const r = await postJson<RecheckResult>("/api/memes/verify", {});
      toast(r.checked ? `核实了 ${r.checked} 个：${r.verified} 个查得到并已续期${r.doubtful ? `，${r.doubtful} 个查不到或来源太少，标为待核实` : ""}` : "没有需要核实的梗", "success");
      if (r.doubtful) setTrust("doubtful");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setChecking(false);
      await reload();
    }
  }

  async function blockAllDoubtful(n: number) {
    if (!(await confirm({ title: `把 ${n} 个待核实的梗都不再收录？`, message: "这些梗核实时查不到或来源太少。删除后以后刷新也不会再收录，可以在「已屏蔽」里恢复。", confirmLabel: "全部不再收录", tone: "danger", bullets: ["预计费用：不产生服务商费用。", `影响范围：${n} 个待核实的梗会被屏蔽，已有项目不受影响。`, "可恢复：可以在「已屏蔽」里恢复。"] }))) return;
    const r = await postJson<{ blocked: number }>("/api/memes/block-doubtful", {}).catch((e) => (toast(String(e), "error"), null));
    if (r) toast(`已屏蔽 ${r.blocked} 个`, "success");
    setTrust("all");
    await reload();
  }

  async function patch(m: View, p: { category?: MemeCategory; risk?: MemeRisk; heat?: MemeHeat; say?: string }) {
    try {
      await postJson(`/api/memes/${m.id}`, p, "PATCH");
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function remove(m: View, block = false) {
    const ok = await confirm(
      block
        ? { title: `不再收录「${m.term}」？`, message: "删除这个梗，以后刷新搜到它（包括各种写法）都会跳过。可以在页面底部的「已屏蔽」里恢复。已经用过它的项目不受影响。", confirmLabel: "不再收录", tone: "danger", bullets: ["预计费用：不产生服务商费用。", "影响范围：后续刷新不会再收录这个梗，已有项目不受影响。", "可恢复：可以在「已屏蔽」里恢复。"] }
        : { title: `删除「${m.term}」？`, message: "以后刷新如果又搜到，会重新收录；不想再看到它请用「不再收录」。已经用过它的项目不受影响。", confirmLabel: "删除", tone: "danger", bullets: ["预计费用：不产生服务商费用。", "影响范围：当前梗记录会删除，后续刷新可能再次收录。", "可恢复：不能直接恢复这次删除。"] },
    );
    if (!ok) return;
    await postJson(`/api/memes/${m.id}${block ? "?block=1" : ""}`, undefined, "DELETE").catch((e) => toast(String(e), "error"));
    await reload();
  }

  async function restore(b: MemeBlock) {
    await postJson(`/api/memes/blocks/${b.id}`, undefined, "DELETE").catch((e) => toast(String(e), "error"));
    toast(`已恢复「${b.term}」，以后刷新搜到会重新收录`, "success");
    await reload();
  }

  const newCount = data?.memes.filter((m) => m.isNew).length ?? 0;
  const q = normalizeTerm(query);
  const list = (data?.memes ?? [])
    .filter(
      (m) =>
        (category === "all" || m.category === category) &&
        (m.category !== "hot" || heat === "all" || (heat === "live" ? m.heat === "rising" || m.heat === "peak" : m.heat === heat)) &&
        (risk === "all" || m.risk === risk) &&
        (circle === "all" || (circle === "none" ? !m.circle : m.circle === circle)) &&
        (trust === "all" || m.trust === trust) &&
        (since === "all" || sinceBucket(m.sinceMonth) === since) &&
        (!q || [m.term, ...m.variants, m.meaning].some((x) => normalizeTerm(x).includes(q))) &&
        (!onlyNew || m.isNew),
    )
    // 本次新增的排在前面，其余按所选方式
    .sort(
      (a, b) =>
        Number(b.isNew) - Number(a.isNew) ||
        (sort === "since" ? (b.sinceMonth || "0").localeCompare(a.sinceMonth || "0") : sort === "term" ? a.term.localeCompare(b.term, "zh-CN") : b.verifiedAt - a.verifiedAt),
    );
  const doubtful = data?.memes.filter((m) => m.category === "hot" && m.trust === "doubtful").length ?? 0;
  const stale = data?.memes.filter((m) => m.category === "hot" && m.heat === "fading" && m.storedHeat !== "fading").length ?? 0;

  return (
    <div className="pt-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="label">梗库</p>
            <h1 className="mt-3 text-5xl font-semibold tracking-[-0.03em]">热梗与口语词库</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/45">
            热梗会联网刷新；日常口语、情绪表达和节奏句式由你维护。写稿时只会使用本期挑中的表达，并分别控制热梗和接地气表达的密度。
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setAdding((v) => !v)}>
              <Icon name="plus" /> 手动添加
            </button>
            <button className="btn btn-ghost" disabled={checking || fetching || !data?.searchModel || !data?.recheckCount} onClick={recheck} title="逐个联网搜一次，查得到的续期，查不到或来源太少的标为待核实">
              {checking ? <Spinner /> : <Icon name="check" />}
              {checking ? "正在逐个核实…" : `核实现有梗${data?.recheckCount ? ` ${Math.min(data.recheckCount, 30)}` : ""}`}
            </button>
            <Select value={String(months)} onChange={(v) => setMonths(Number(v) as SearchWindow)} className="w-32">
              {Object.entries(searchWindows).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
            <Select value={fetchCircle} onChange={setFetchCircle} className="w-32">
              <option value="">全网</option>
              {memeCircles.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <button className="btn btn-primary" disabled={fetching || checking || !data?.searchModel} onClick={refresh}>
              {fetching ? <Spinner /> : <Icon name="search" />}
              {fetching ? "正在联网搜梗…" : fetchCircle ? `刷新「${fetchCircle}」` : "刷新热梗"}
            </button>
          </div>
          <p className="text-[11px] text-white/35">
            {data?.searchModel ? `搜索模型：${data.searchModel.label}` : "需要在模型中心配置通义千问（DASHSCOPE_API_KEY）"}
            {data?.lastFetch && ` · 上次 ${date(data.lastFetch.createdAt)}${data.lastFetch.error ? "（失败）" : ""}`}
          </p>
        </div>
      </div>

      {fetching && (
        <p className="mt-6 text-sm text-white/45">
          联网搜索、整理，再把每个新梗单独搜一遍核实，大约需要三到五分钟。近 30 天确认过的梗会告诉模型不用再列，名额留给新梗。
        </p>
      )}
      {checking && <p className="mt-6 text-sm text-white/45">正在把现有的梗逐个单独联网搜一遍，大约需要两三分钟。</p>}

      {adding && (
        <div className="panel mt-6 animate-rise space-y-6 p-5">
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (term.trim()) void addTerm();
            }}
          >
            <p className="text-sm font-medium">添加表达</p>
            <p className="text-xs text-white/40">输入词条并选择类别，AI 会补全含义、用法和例句；只有热梗会联网查询。</p>
            <div className="flex max-w-2xl flex-wrap gap-2">
              <input className="input h-9 min-w-40 flex-1 py-0" value={term} maxLength={24} onChange={(e) => setTerm(e.target.value)} placeholder="例如：房租刺客" />
              <Select value={manualCategory} onChange={(value) => setManualCategory(value as MemeCategory)} className="w-36" aria-label="表达类别">
                {Object.entries(memeCategories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </Select>
              <button className="btn btn-primary btn-sm h-9" disabled={!term.trim() || working !== null}>
                {working === "term" ? <Spinner className="size-3.5" /> : <Icon name="plus" className="size-3.5" />} 添加
              </button>
            </div>
          </form>
          <div className="border-t border-white/[0.06] pt-5">
            <MemeImport searchAvailable={!!data?.searchModel} onImported={() => void reload()} />
          </div>
        </div>
      )}
      {doubtful > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] px-4 py-3 text-sm text-amber-100/80">
          <span>有 {doubtful} 个梗核实时查不到或来源太少，已标为待核实，不会进入候选。</span>
          <span className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => setTrust("doubtful")}>
              查看
            </button>
            <button className="btn btn-sm border border-amber-300/40 text-amber-200 hover:bg-amber-300/10" onClick={() => blockAllDoubtful(doubtful)}>
              全部不再收录
            </button>
          </span>
        </div>
      )}
      {stale > 0 && (
        <p className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] px-4 py-3 text-sm text-amber-100/80">
          有 {stale} 个梗超过 {STALE_DAYS} 天没被再次搜到，已自动视为退潮，不会再进入候选。刷新热梗时如果又搜到，会自动续期。
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <input className="input h-10 w-56 py-0" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索梗或含义" />
        <Select value={sort} onChange={(v) => setSort(v as keyof typeof sorts)} className="w-36">
          {Object.entries(sorts).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Select value={category} onChange={(v) => setCategory(v as typeof category)} className="w-36" aria-label="表达类别">
          <option value="all">全部类别</option>
          {Object.entries(memeCategories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </Select>
        <Select value={heat} onChange={(v) => setHeat(v as typeof heat)} className="w-40" aria-label="热梗热度">
          <option value="live">正在流行</option>
          <option value="all">全部热度</option>
          {Object.entries(memeHeats).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        <Select value={circle} onChange={setCircle} className="w-36">
          <option value="all">全部圈层</option>
          {memeCircles.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="none">未分类</option>
        </Select>
        <Select value={since} onChange={(v) => setSince(v as typeof since)} className="w-36">
          <option value="all">全部时间</option>
          {Object.entries(sinceBuckets).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        <Select value={trust} onChange={(v) => setTrust(v as typeof trust)} className="w-36">
          <option value="all">全部可信度</option>
          {Object.entries(memeTrusts).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        <Select value={risk} onChange={(v) => setRisk(v as typeof risk)} className="w-36">
          <option value="all">全部风险</option>
          {Object.entries(memeRisks).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        {newCount > 0 && (
          <button
            className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs transition ${onlyNew ? "border-accent/60 bg-accent/[0.08] text-accent" : "border-white/10 text-white/50 hover:border-white/25"}`}
            onClick={() => setOnlyNew((v) => !v)}
          >
            {onlyNew ? "✓ " : ""}只看本次新增 {newCount}
          </button>
        )}
        <span className="text-xs text-white/35">
          {list.length} / {data?.memes.length ?? 0} 个
        </span>
      </div>

      {!data ? (
        <p className="flex justify-center pt-16 text-white/40">
          <Spinner />
        </p>
      ) : data.memes.length === 0 ? (
        <p className="panel mt-6 p-8 text-center text-sm text-white/45">梗库还是空的。点「刷新热梗」联网抓一轮；写稿时挑梗也会自动先抓一次。</p>
      ) : list.length === 0 ? (
        <p className="panel mt-6 p-8 text-center text-sm text-white/45">
          没有符合筛选条件的梗。
          <button
            className="ml-1 cursor-pointer text-accent hover:underline"
            onClick={() => {
              setCategory("all");
              setHeat("all");
              setCircle("all");
              setTrust("all");
              setSince("all");
              setRisk("all");
              setQuery("");
              setOnlyNew(false);
            }}
          >
            清除筛选
          </button>
        </p>
      ) : (
        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => (
            <article key={m.id} className="panel flex flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-[15px] font-medium">
                    {m.term}
                    {m.isNew && <span className="rounded bg-accent px-1.5 py-px text-[10px] font-semibold text-black">新</span>}
                  </h3>
                  {m.variants.length > 0 && <p className="mt-0.5 truncate text-[11px] text-white/35">也写作 {m.variants.join("、")}</p>}
                </div>
                    {m.category === "hot" && <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${heatTone[m.heat]}`}>{memeHeats[m.heat]}</span>}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-white/65">{m.meaning}</p>
              {m.usage && <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">用法：{m.usage}</p>}
              <p className="mt-2 border-l-2 border-white/15 pl-2 text-xs leading-relaxed text-white/50">{m.example}</p>
              <p className="mt-3 flex-1 text-[11px] text-white/30">
                {memeCategories[m.category]} · {m.circle || "未分类"} · {memeKinds[m.kind]} · {memeSources[m.source]}
                {m.platform && ` · ${m.platform}`}
                {sinceLabel(m) && ` · ${sinceLabel(m)}`} · 确认于 {date(m.verifiedAt)}
                <span className={`ml-1.5 ${trustTone[m.trust]}`}>· {m.trust === "verified" ? "✓ " : ""}{memeTrusts[m.trust]}</span>
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3 text-[11px]">
                <Select value={m.category} onChange={(value) => patch(m, { category: value as MemeCategory })} className="w-auto min-w-28 text-[11px]" aria-label="表达类别">
                  {Object.entries(memeCategories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </Select>
                <Select value={m.risk} onChange={(value) => patch(m, { risk: value as MemeRisk })} className={`w-auto min-w-16 text-[11px] ${riskTone[m.risk]}`} aria-label="风险">
                  {Object.entries(memeRisks).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </Select>
                <Select value={m.storedHeat} onChange={(value) => patch(m, { heat: value as MemeHeat })} className="w-auto min-w-20 text-[11px] text-white/45" aria-label="热度">
                  {Object.entries(memeHeats).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </Select>
                <input
                  className="min-w-0 flex-1 rounded border border-white/10 bg-transparent px-1.5 py-0.5 text-white/60 outline-none placeholder:text-white/20 focus:border-white/30"
                  defaultValue={m.say}
                  placeholder="配音读法（缩写才需要）"
                  onBlur={(e) => e.target.value.trim() !== m.say && patch(m, { say: e.target.value })}
                />
                <button className="cursor-pointer text-white/30 transition hover:text-red-300" onClick={() => remove(m, true)} title="删除，以后刷新也不再收录">
                  不再收录
                </button>
                <button className="cursor-pointer text-white/30 transition hover:text-red-300" onClick={() => remove(m)} title="删除（以后刷新搜到会重新收录）">
                  <Icon name="trash" className="size-3.5" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {data && data.blocks.length > 0 && (
        <div className="mt-10 border-t border-white/[0.06] pt-5">
          <button className="flex cursor-pointer items-center gap-1.5 text-xs text-white/45 transition hover:text-white" onClick={() => setShowBlocks((v) => !v)}>
            <Icon name="chevron" className={`size-3.5 transition ${showBlocks ? "rotate-180" : ""}`} />
            已屏蔽 {data.blocks.length} 个 <span className="text-white/25">刷新时会跳过这些梗</span>
          </button>
          {showBlocks && (
            <div className="mt-3 flex animate-rise flex-wrap gap-2">
              {data.blocks.map((b) => (
                <span key={b.id} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-white/55">
                  {b.term}
                  <button className="cursor-pointer text-accent/70 hover:text-accent" onClick={() => restore(b)}>
                    恢复
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
