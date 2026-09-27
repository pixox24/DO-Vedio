"use client";

import Link from "next/link";
import { useState } from "react";
import type { SaveState, useProject } from "@/lib/client";
import { VersionHistory } from "./version-history";
import { Icon } from "./ui";

type Store = ReturnType<typeof useProject>;

const saveLabel: Record<SaveState, string> = { idle: "", saving: "保存中…", saved: "已保存", error: "保存失败，稍后自动重试", conflict: "有冲突" };

/** 项目页顶部：返回列表、文案 / 制作切换、保存状态和冲突处理 */
export function ProjectBar({ id, store, title, active }: { id: string; store: Store; title: string; active: "script" | "video" }) {
  const [history, setHistory] = useState(false);
  const tabs = [
    { key: "script", href: `/projects/${id}`, label: "01 文案" },
    { key: "video", href: `/projects/${id}/video`, label: "02 制作" },
  ] as const;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <Link href="/" className="text-white/40 hover:text-white">
            项目
          </Link>
          <span className="text-white/20">/</span>
          <span className="truncate text-white/75">{title || "未命名项目"}</span>
          <span className={`text-xs ${store.save === "error" ? "text-amber-300/80" : "text-white/30"}`}>{saveLabel[store.save]}</span>
        </div>
        <div className="flex items-center gap-2">
        <button className="btn-text" onClick={() => store.undo()} disabled={!store.canUndo} aria-label={store.canUndo ? "撤销最近一次文档修改" : "没有可撤销的修改"} title="撤销"><Icon name="undo" className="size-4" /></button>
        {active === "script" && <button className="btn-text" onClick={() => setHistory(true)}>版本历史</button>}
        <div className="flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.02] p-1">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              onClick={() => store.flush()}
              className={`rounded-full px-4 py-1 text-xs transition ${active === t.key ? "bg-white text-black" : "text-white/55 hover:text-white"}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        </div>
      </div>
      {store.conflict != null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/25 bg-amber-300/[0.05] px-5 py-3 text-sm text-amber-100/85">
          <span>这个项目已在别的页面或后台任务中修改，自动保存已暂停。</span>
          <span className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => store.resolveConflict("theirs")}>
              载入最新（放弃我的修改）
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => store.resolveConflict("mine")}>
              用我的覆盖
            </button>
          </span>
        </div>
      )}
      {history && <VersionHistory id={id} store={store} onClose={() => setHistory(false)} />}
    </div>
  );
}
