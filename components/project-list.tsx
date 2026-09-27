"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, Select, Spinner } from "@/components/ui";
import { postJson } from "@/lib/client";
import { emptyDoc, mediaUrl, type Project, type ProjectPipelineStatus, type ProjectSummary } from "@/lib/core/types";
import { useFeedback } from "@/components/feedback";

const LEGACY_KEY = "do-vedio:draft";

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return new Date(t).toLocaleDateString("zh-CN");
}

const statusLabels: Record<ProjectPipelineStatus, string> = {
  empty: "未开始",
  script: "文案中",
  annotating: "标注中",
  voicing: "配音中",
  storyboard: "分镜中",
  music: "配乐中",
  rendering: "渲染中",
  ready: "已出片",
  failed: "渲染失败",
};

function formatDuration(durationMs: number | null) {
  if (durationMs == null || durationMs <= 0) return "暂无成片时长";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ProjectList() {
  const router = useRouter();
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [legacy, setLegacy] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "title">("updated");
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const { confirm, toast } = useFeedback();

  const reload = () => fetch("/api/projects").then((r) => r.json()).then(setList, () => setList([]));

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    reload();
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      const d = raw && JSON.parse(raw);
      if (d?.brief && (d.brief.title || d.segments?.length)) setLegacy(d);
    } catch {}
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function create(doc?: unknown) {
    setBusy(true);
    setError("");
    try {
      const p = await postJson<Project>("/api/projects", { doc });
      router.push(`/projects/${p.id}`);
      return p;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function createFromTitle() {
    const title = createTitle.trim();
    if (!title) return;
    const base = emptyDoc();
    const p = await create({ ...base, brief: { ...base.brief, title } });
    if (p) {
      setCreateTitle("");
      setCreateOpen(false);
    }
  }

  async function importLegacy() {
    const p = await create(legacy);
    if (p) localStorage.removeItem(LEGACY_KEY);
  }

  async function remove(p: ProjectSummary) {
    if (!(await confirm({ title: `删除「${p.title || "未命名项目"}」？`, message: "项目和其中的文案、素材记录都会被删除。", confirmLabel: "删除", tone: "danger" }))) return;
    try {
      const response = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("删除项目失败");
      toast("项目已删除", "success");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function duplicate(p: ProjectSummary) {
    await postJson("/api/projects", { duplicateOf: p.id });
    reload();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 pt-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="label">项目</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">我的项目</h1>
          <p className="mt-2 text-sm text-white/45">从一个想法到一条成片：写文案、配音、分镜、配乐、合成。</p>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={() => setCreateOpen(true)}>
          {busy ? <Spinner className="size-3.5" /> : <Icon name="plus" className="size-4" />} 新建项目
        </button>
      </div>

      {error && <p className="text-sm text-red-300/80">{error}</p>}

      {legacy != null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/20 bg-accent/[0.04] px-5 py-3.5 text-sm text-white/75">
          <span>
            发现浏览器里保存的旧稿件「{(legacy as { brief: { title: string } }).brief.title || "未命名"}」，导入后会保存到服务器，不再占用浏览器存储。
          </span>
          <span className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => (localStorage.removeItem(LEGACY_KEY), setLegacy(null))}>
              丢弃
            </button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={importLegacy}>
              导入为项目
            </button>
          </span>
        </div>
      )}

      {list === null ? (
        <div className="flex justify-center py-20 text-white/40">
          <Spinner />
        </div>
      ) : list.length === 0 ? (
        <div className="panel py-20 text-center text-sm text-white/40">还没有项目，点右上角「新建项目」开始。</div>
      ) : (
        <>
          {list.length > 12 && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="relative block w-full max-w-md">
                <span className="sr-only">搜索项目</span>
                <input className="input pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目标题" />
                <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40" />
              </label>
              <Select value={sort} onChange={(value) => setSort(value as typeof sort)} className="w-36">
                <option value="updated">最近更新</option>
                <option value="title">名称排序</option>
              </Select>
            </div>
          )}
          {(() => {
            const keyword = query.trim().toLocaleLowerCase();
            const visible = [...(keyword ? list.filter((p) => (p.title || "未命名项目").toLocaleLowerCase().includes(keyword)) : list)].sort((a, b) => sort === "title" ? (a.title || "未命名项目").localeCompare(b.title || "未命名项目", "zh-CN") : b.updatedAt - a.updatedAt);
            if (visible.length === 0) return <div className="panel py-16 text-center text-sm text-white/45">没有匹配的项目。</div>;
            return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((p) => {
                const title = p.title || "未命名项目";
                return <div key={p.id} className="panel group relative overflow-hidden transition hover:border-white/20">
                  <Link href={`/projects/${p.id}`} className="absolute inset-0 z-0" aria-label={title} />
                  <div className="relative aspect-video overflow-hidden bg-white/[0.04]">
                    {p.coverHash ? <video className="size-full object-cover" muted playsInline preload="metadata" src={mediaUrl(p.coverHash)} /> : <div className="grid size-full place-items-center bg-[linear-gradient(135deg,rgb(255_255_255_/_0.08),rgb(255_255_255_/_0.02))] text-4xl font-semibold text-white/25">{title.slice(0, 1)}</div>}
                    <span className={`absolute top-3 left-3 rounded-full border px-2.5 py-1 text-xs ${p.pipelineStatus === "failed" ? "border-red-300/30 bg-red-300/10 text-red-100" : "border-white/25 bg-black/45 text-white"}`}>{statusLabels[p.pipelineStatus]}</span>
                  </div>
                  <div className="relative z-10 space-y-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium">{title}</p>
                      <p className="mt-1.5 text-sm text-text-muted">{p.minutes} 分钟 · {p.segments > 0 ? `${p.segments} 段文案` : "未成稿"} · {ago(p.updatedAt)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-sm text-text-secondary"><Icon name="clock" className="size-3.5" /> {formatDuration(p.lastRenderDurationMs)}</span>
                      <div className="flex gap-1.5">
                        <Link href={`/projects/${p.id}/video`} className="chip" onClick={(event) => event.stopPropagation()}>制作视频</Link>
                        <button type="button" className="chip px-2.5" aria-label={`复制${title}`} onClick={() => duplicate(p)}><Icon name="copy" className="size-3.5" /></button>
                        <button type="button" className="chip px-2.5 hover:border-red-400/40 hover:text-red-300" aria-label={`删除${title}`} onClick={() => remove(p)}><Icon name="trash" className="size-3.5" /></button>
                      </div>
                    </div>
                  </div>
                </div>;
              })}
            </div>;
          })()}
        </>
      )}

      {createOpen && <div className="fixed inset-0 z-40 grid place-items-center bg-black/65 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
        <div className="panel w-full max-w-md space-y-5 p-6" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
          <div><h2 id="create-project-title" className="text-lg font-semibold">新建项目</h2><p className="mt-1.5 text-sm text-text-muted">先给项目起个标题，之后可以继续完善内容。</p></div>
          <label className="block space-y-2"><span className="label">项目标题</span><input autoFocus className="input" value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") createFromTitle(); }} placeholder="例如：春季品牌故事" /></label>
          {error && <p className="text-sm text-red-300/80">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCreateOpen(false); setCreateTitle(""); }}>取消</button><button type="button" className="btn btn-primary btn-sm" disabled={busy || !createTitle.trim()} onClick={createFromTitle}>{busy ? <Spinner className="size-3" /> : "创建项目"}</button></div>
        </div>
      </div>}
    </div>
  );
}
