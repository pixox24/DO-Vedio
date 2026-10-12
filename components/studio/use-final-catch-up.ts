"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/client";
import { CATCH_UP_SETTLE_MS } from "@/lib/core/catch-up";

export type CatchUpResponse = {
  action: "fresh" | "skipped" | "started" | "running" | "canceled";
  reason?: string;
  count?: number;
  jobs?: { id: string; aspect: string }[];
};

/**
 * 字幕或配乐变了之后：预览还在播就不动；停下再等一会儿，只提交一轮成片更新。
 * 导出可以跳过等待，立刻走同一条提交。
 */
export function useFinalCatchUp(options: { id: string; enabled: boolean; signature: string; playing: boolean; flush: () => Promise<number | null | undefined> }) {
  const { id, enabled, signature, playing, flush } = options;
  const inflight = useRef<{ token: string; promise: Promise<CatchUpResponse> } | null>(null);
  /** 取消和开始串行。新的开始一定排在这次编辑的取消后面。 */
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const signatureRef = useRef(signature);
  const [tracked, setTracked] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (signature !== tracked) {
    setTracked(signature);
    setError("");
    setPending(tracked !== "" && enabled);
  }

  useEffect(() => {
    signatureRef.current = signature;
  }, [signature]);

  const post = useCallback((action: "start" | "cancel") => postJson<CatchUpResponse>(`/api/projects/${id}/catch-up`, { action }), [id]);
  const enqueue = useCallback(<T,>(op: () => Promise<T>) => {
    const run = chain.current.then(op, op);
    chain.current = run.then(() => {}, () => {});
    return run;
  }, []);

  const startNow = useCallback(() => {
    const token = signature;
    if (inflight.current?.token === token) return inflight.current.promise;
    const promise = (async () => {
      setError("");
      const saved = await flush();
      if (token !== signatureRef.current) return { action: "canceled" as const, count: 0 };
      if (saved == null) throw new Error("项目还没保存，稍后再更新成片");
      const result = await enqueue(async () => {
        if (token !== signatureRef.current) return { action: "canceled" as const, count: 0 };
        return post("start");
      });
      if (token !== signatureRef.current) return { action: "canceled" as const, count: 0 };
      setPending(false);
      return result;
    })();
    inflight.current = { token, promise };
    return promise;
  }, [enqueue, flush, post, signature]);

  useEffect(() => {
    if (!pending) return;
    void enqueue(() => post("cancel")).catch(() => {});
  }, [enqueue, pending, post, signature]);

  useEffect(() => {
    if (!pending || !enabled || playing) return;
    const token = signature;
    const timer = setTimeout(() => {
      void startNow().catch((reason: unknown) => {
        if (token !== signatureRef.current) return;
        setPending(false);
        setError(reason instanceof Error ? reason.message : "成片没有跟上");
      });
    }, CATCH_UP_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [enabled, pending, playing, signature, startNow]);

  return { pending, error, startNow };
}
