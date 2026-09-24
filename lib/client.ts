"use client";

import { useEffect, useState } from "react";
import { STREAM_ERROR_MARK, type ModelInfo, type StyleTemplate } from "./types";

async function errorOf(res: Response) {
  const data = await res.json().catch(() => null);
  return new Error(data?.error ?? `请求失败（${res.status}）`);
}

export async function postJson<T>(url: string, body: unknown, method = "POST", signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await errorOf(res);
  return res.json();
}

/** 读取流式文本，每收到一块就回调当前全文；返回最终全文 */
export async function postStream(url: string, body: unknown, onText: (text: string) => void, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw await errorOf(res);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += value;
    const i = text.indexOf(STREAM_ERROR_MARK);
    if (i >= 0) throw new Error(text.slice(i + STREAM_ERROR_MARK.length) || "生成失败");
    onText(text);
  }
  // 部分模型会在行尾输出 Markdown 换行空格
  return text.replace(/[ \t]+$/gm, "").trim();
}

export function isAbort(e: unknown) {
  return e instanceof DOMException && e.name === "AbortError";
}

export function useModels() {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then(setModels, () => setModels([]));
  }, []);
  return models;
}

export function useTemplates() {
  const [templates, setTemplates] = useState<StyleTemplate[]>([]);
  const reload = () => fetch("/api/templates").then((r) => r.json()).then(setTemplates);
  useEffect(() => {
    reload();
  }, []);
  return { templates, reload };
}

/**
 * 状态持久化到 localStorage，刷新页面不丢稿。
 * 写入节流（流式写稿时每秒最多一次），页面关闭前补存；
 * 存储已满或被禁用时不抛错，而是通过 saveError 告知调用方，页面照常可用。
 */
export function usePersistent<T>(key: string, initial: T, delay = 800) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // 挂载后再读 localStorage，避免服务端渲染与客户端首帧不一致
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setValue({ ...initial, ...JSON.parse(raw) });
    } catch {}
    setLoaded(true);
  }, [key]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // 每次 value 变化都会重建 save，所以定时器和 pagehide 拿到的总是最新值
  useEffect(() => {
    if (!loaded) return;
    const save = () => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        setSaveError(false);
      } catch {
        setSaveError(true);
      }
    };
    const timer = setTimeout(save, delay);
    window.addEventListener("pagehide", save);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", save);
    };
  }, [key, value, loaded, delay]);

  return [value, setValue, saveError] as const;
}

export function copy(text: string) {
  return navigator.clipboard.writeText(text);
}

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
