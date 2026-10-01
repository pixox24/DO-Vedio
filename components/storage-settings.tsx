"use client";

import { useEffect, useState } from "react";
import { Icon, Spinner } from "@/components/ui";
import { useFeedback } from "@/components/feedback";

type StorageDir = { key: string; label: string; bytes: number; files: number };
type TrashItem = { id: string; title: string; deletedAt: number };
type Usage = { dirs: StorageDir[]; dbBytes: number; assets: { count: number; bytes: number }; trash: TrashItem[] };

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function StorageSettings() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { confirm, toast } = useFeedback();

  const refresh = () => fetch("/api/storage", { cache: "no-store" }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "读取存储统计失败");
    setUsage(await r.json());
  });

  useEffect(() => {
    refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  async function clean(tasks: string[], label: string) {
    setBusy(label);
    try {
      const res = await fetch("/api/storage/cleanup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tasks }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "清理失败");
      const freed = (["bundles", "temp", "probes", "gc"] as const).reduce((sum, key) => sum + (data.result?.[key]?.freedBytes ?? 0), 0);
      const projects = data.result?.trash?.projects ?? 0;
      const parts = [freed > 0 ? `释放 ${formatBytes(freed)}` : "没有可释放的空间"];
      if (projects > 0) parts.push(`彻底删除 ${projects} 个项目`);
      toast(`${label}完成：${parts.join("，")}`, "success");
      await refresh();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setBusy("");
    }
  }

  async function clearTrash() {
    if (!usage || usage.trash.length === 0) return;
    if (!(await confirm({ title: `清空回收站中的 ${usage.trash.length} 个项目？`, message: "彻底删除后不可恢复。", confirmLabel: "清空回收站", tone: "danger", bullets: ["预计费用：不产生服务商费用。", "影响范围：项目文案、版本快照、任务记录会被删除；财务记录保留。", "可恢复：不可恢复；无引用素材会在回收无引用素材时释放磁盘空间。"] }))) return;
    await clean(["trash"], "清空回收站");
  }

  async function restore(item: TrashItem) {
    setBusy(item.id);
    try {
      const res = await fetch(`/api/projects/${item.id}/restore`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "恢复失败");
      toast(`「${item.title}」已恢复到项目列表`, "success");
      await refresh();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setBusy("");
    }
  }

  async function purge(item: TrashItem) {
    if (!(await confirm({ title: `彻底删除「${item.title}」？`, message: "彻底删除后不可恢复。", confirmLabel: "彻底删除", tone: "danger", bullets: ["预计费用：不产生服务商费用。", "影响范围：项目文案、版本快照、任务记录会被删除；财务记录保留。", "可恢复：不可恢复；无引用素材会在回收无引用素材时释放磁盘空间。"] }))) return;
    setBusy(item.id);
    try {
      const res = await fetch(`/api/projects/${item.id}?purge=1`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "彻底删除失败");
      toast(`「${item.title}」已彻底删除`, "success");
      await refresh();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setBusy("");
    }
  }

  const totalBytes = usage ? usage.dirs.reduce((sum, dir) => sum + dir.bytes, 0) + usage.dbBytes : 0;

  return <div className="mx-auto max-w-6xl space-y-8 pt-8 pb-20">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-7">
      <div>
        <p className="label text-accent">制作设置 / 存储</p>
        <h1 className="mt-2 text-2xl font-semibold">存储管理</h1>
        <p className="mt-2 text-sm text-white/45">查看数据目录占用，清理缓存、临时文件、无引用素材与回收站。</p>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <span className="text-white/45">总占用 <strong className="ml-1 font-medium text-white">{usage ? formatBytes(totalBytes) : "—"}</strong></span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy || usage === null} onClick={() => refresh().catch(() => {})}>{busy === "刷新" ? <Spinner className="size-3" /> : "刷新"}</button>
      </div>
    </header>

    {error && <p className="text-sm text-red-300/80">{error}</p>}

    {usage === null ? (
      <div className="flex justify-center py-20 text-white/40"><Spinner /></div>
    ) : (
      <>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {usage.dirs.map((dir) => (
            <div key={dir.key} className="panel p-4">
              <p className="text-sm text-white/45">{dir.label}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">{formatBytes(dir.bytes)}</p>
              <p className="mt-1 text-xs text-white/35">{dir.files} 个文件</p>
            </div>
          ))}
          <div className="panel p-4">
            <p className="text-sm text-white/45">数据库</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{formatBytes(usage.dbBytes)}</p>
            <p className="mt-1 text-xs text-white/35">{usage.assets.count} 条素材记录 · {formatBytes(usage.assets.bytes)}</p>
          </div>
        </section>

        <section className="panel space-y-4 p-5">
          <div>
            <h2 className="text-base font-medium">清理</h2>
            <p className="mt-1 text-sm text-white/45">删除不会再被引用的文件和缓存，不影响在用项目。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => clean(["bundles", "temp", "probes"], "缓存与临时文件清理")}>
              {busy === "缓存与临时文件清理" ? <Spinner className="size-3" /> : <Icon name="server" className="size-3.5" />} 清理缓存与临时文件
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => clean(["gc"], "无引用素材回收")}>
              {busy === "无引用素材回收" ? <Spinner className="size-3" /> : <Icon name="wand" className="size-3.5" />} 回收无引用素材
            </button>
            <button type="button" className="btn btn-sm border border-red-400/30 bg-red-400/15 text-red-100 hover:bg-red-400/25" disabled={!!busy || usage.trash.length === 0} onClick={clearTrash}>
              {busy === "清空回收站" ? <Spinner className="size-3" /> : <Icon name="trash" className="size-3.5" />} 清空回收站（{usage.trash.length}）
            </button>
          </div>
          <p className="text-xs leading-relaxed text-white/35">打包缓存只保留最近两份且不碰 24 小时内新建的目录；手动清理会避开一小时内还在写入的临时文件和素材，正在渲染或生成的任务不受影响。回收无引用素材只删除不再被任何项目、版本或成片引用的文件。</p>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-base font-medium">回收站</h2>
            <p className="mt-1 text-sm text-white/45">删除的项目在这里保留 30 天，之后由 Worker 定期维护自动彻底删除。</p>
          </div>
          {usage.trash.length === 0 ? (
            <div className="panel py-12 text-center text-sm text-white/40">回收站是空的。</div>
          ) : (
            <ul className="panel divide-y divide-white/[0.06]">
              {usage.trash.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white/85">{item.title}</p>
                    <p className="mt-0.5 text-xs text-white/35">{new Date(item.deletedAt).toLocaleString("zh-CN", { hour12: false })} 删除</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" className="chip px-2.5" disabled={!!busy} onClick={() => restore(item)}>
                      {busy === item.id ? <Spinner className="size-3" /> : <Icon name="undo" className="size-3.5" />} 恢复
                    </button>
                    <button type="button" className="chip px-2.5 hover:border-red-400/40 hover:text-red-300" disabled={!!busy} onClick={() => purge(item)}>
                      {busy === item.id ? <Spinner className="size-3" /> : <Icon name="trash" className="size-3.5" />} 彻底删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    )}
  </div>;
}
