"use client";

import { useEffect, useState } from "react";

const DRAFT_KEY = "do-vedio:draft";

/** 运行时出错时的兜底界面：不白屏，提供重试和清空草稿 */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [cleared, setCleared] = useState(false);
  useEffect(() => console.error(error), [error]);

  return (
    <div className="mx-auto max-w-xl pt-24">
      <div className="panel space-y-5 p-8">
        <p className="label">出错了</p>
        <h1 className="text-2xl font-semibold tracking-tight">页面遇到了一个意外错误</h1>
        <p className="rounded-xl border border-white/[0.06] bg-black/30 p-4 font-mono text-xs leading-relaxed break-all text-red-200/80">{error.message}</p>
        <p className="text-sm leading-relaxed text-white/45">
          可以先重试。如果反复出错，可能是浏览器里保存的草稿损坏，清空草稿后再试（会丢失未导出的稿件）。
        </p>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={() => retry()}>
            重试
          </button>
          <button
            className="btn btn-ghost"
            disabled={cleared}
            onClick={() => {
              try {
                localStorage.removeItem(DRAFT_KEY);
              } catch {}
              setCleared(true);
            }}
          >
            {cleared ? "草稿已清空" : "清空草稿"}
          </button>
        </div>
      </div>
    </div>
  );
}
