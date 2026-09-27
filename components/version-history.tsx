"use client";

import { useEffect, useState } from "react";
import { postJson, type useProject } from "@/lib/client";
import { useFeedback } from "./feedback";

type Store = ReturnType<typeof useProject>;
type Version = { id: string; revision: number; label: string; createdAt: number; segments: number; summary: string };

export function VersionHistory({ id, store, onClose }: { id: string; store: Store; onClose: () => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<Version | null>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { confirm } = useFeedback();

  useEffect(() => {
    fetch(`/api/projects/${id}/versions`).then((r) => r.json()).then(setVersions, () => setError("读取版本失败"));
  }, [id]);

  async function select(v: Version) {
    setSelected(v);
    setDetails("");
    const res = await fetch(`/api/projects/${id}/versions/${v.id}`);
    if (!res.ok) { setError("读取版本失败"); return; }
    const data = await res.json();
    setDetails(data.doc.segments.map((s: { title: string; text: string }) => `${s.title}\n${s.text.slice(0, 120)}`).join("\n\n"));
  }

  async function restore() {
    if (!selected || !store.project) return;
    if (!(await confirm({ title: "恢复这个版本？", message: "当前文档会先保存为“恢复版本前”，之后可再次恢复。", confirmLabel: "恢复版本", tone: "danger" }))) return;
    setBusy(true);
    setError("");
    try {
      const revision = await store.flush();
      if (revision == null) throw new Error("当前文档尚未保存，请先解决保存冲突");
      const project = await postJson<NonNullable<Store["project"]>>(`/api/projects/${id}/versions/${selected.id}/restore`, { revision });
      store.acceptProject(project);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-[80] flex justify-end bg-black/60" onClick={onClose} role="presentation">
    <div className="flex h-full w-full max-w-lg flex-col border-l border-white/10 bg-[#111] shadow-2xl" role="dialog" aria-modal="true" aria-label="版本历史" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-white/10 p-5"><h2 className="text-base font-semibold">版本历史</h2><button className="btn-text" onClick={onClose} aria-label="关闭版本历史">关闭</button></div>
      {error && <p className="px-5 pt-3 text-sm text-red-300">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {versions.length === 0 && <p className="text-sm text-white/45">还没有历史版本</p>}
        {versions.map((v) => <button key={v.id} className={`mb-2 block w-full rounded border p-3 text-left ${selected?.id === v.id ? "border-white" : "border-white/10"}`} onClick={() => select(v)}>
          <span className="text-sm">{v.label}</span><span className="mt-1 block text-xs text-white/45">{new Date(v.createdAt).toLocaleString("zh-CN")} · rev {v.revision} · {v.segments} 段</span>
        </button>)}
        {selected && <div className="mt-4 border-t border-white/10 pt-4"><p className="text-xs text-white/45">文案摘要</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/70">{details || selected.summary || "无文案"}</p></div>}
      </div>
      <div className="border-t border-white/10 p-5"><button className="btn btn-primary w-full" disabled={!selected || busy} onClick={restore}>{busy ? "恢复中…" : "恢复选中版本"}</button></div>
    </div>
  </div>;
}
