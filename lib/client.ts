"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { STREAM_ERROR_MARK, type ModelInfo, type StyleTemplate } from "./types";
import type { VisualStyle } from "./core/types";
import { mergeProjectJobUpdates, type ProjectJobState } from "./core/project-events";
import type { AixCompact, AixDetail, AixMeta } from "./aix/schema";
import { staticAixCatalog } from "./aix/catalog-client";

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

/** 视觉风格库；传 templateId 时按解说风格推荐排序（推荐的在前） */
export function useVisualStyles(templateId?: string) {
  const [styles, setStyles] = useState<VisualStyle[]>([]);
  const reload = useCallback(
    () =>
      fetch(`/api/visual-styles${templateId ? `?templateId=${encodeURIComponent(templateId)}` : ""}`)
        .then((r) => r.json())
        .then((x) => Array.isArray(x) && setStyles(x)),
    [templateId],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  return { styles, reload };
}

export function useAixStyles() {
  const [items, setItems] = useState<AixCompact[]>(staticAixCatalog.items);
  const [meta, setMeta] = useState<AixMeta | null>(staticAixCatalog.meta);
  const reload = useCallback(() => fetch("/api/style-library", { cache: "force-cache" }).then((r) => r.json()).then((x: { items?: AixCompact[]; meta?: AixMeta }) => { setItems(x.items ?? []); setMeta(x.meta ?? null); }).catch(() => fetch("/aix/catalog.json", { cache: "force-cache" }).then((r) => r.json()).then((x: { items?: AixCompact[]; meta?: AixMeta }) => { setItems(x.items ?? []); setMeta(x.meta ?? null); })), []);
  useEffect(() => { reload(); }, [reload]);
  return { items, meta, reload };
}

export async function fetchAixDetail(id: string, signal?: AbortSignal) {
  const res = await fetch(`/api/style-library/${encodeURIComponent(id)}`, { signal, cache: "force-cache" });
  if (!res.ok) throw await errorOf(res);
  const data = await res.json() as { detail: AixDetail; libraryVersion: string };
  return { ...data.detail, libraryVersion: data.libraryVersion };
}

/** 模型中心里已配置并启用的生图模型；id 形如 providerId::modelId */
export function useImageModels() {
  const [models, setModels] = useState<{ id: string; label: string }[] | null>(null);
  useEffect(() => {
    type P = { providerId: string; providerLabel: string; modelId: string; modelLabel: string; kind: string; configured: boolean; enabled: boolean };
    fetch("/api/providers", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { providers?: P[] }) => setModels((data.providers ?? []).filter((m) => m.kind === "image" && m.configured && m.enabled).map((m) => ({ id: `${m.providerId}::${m.modelId}`, label: `${m.providerLabel} · ${m.modelLabel}` }))))
      .catch(() => setModels([]));
  }, []);
  return models;
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

type ProjectState = { id: string; revision: number; doc: import("./core/types").ProjectDoc };
export type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

/**
 * 服务端项目文档：本地先改、节流保存（乐观锁）。
 * 冲突（别处改过）时暂停自动保存，由调用方选择载入最新或覆盖。
 * 外部（Worker）改了文档时调用 reload()，未保存的本地修改优先保留。
 */
export function useProject(id: string, delay = 800) {
  type Doc = import("./core/types").ProjectDoc;
  const [state, setState] = useState<ProjectState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [save, setSave] = useState<SaveState>("idle");
  const [conflict, setConflict] = useState<ProjectState | null>(null);
  const dirty = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);
  const latest = useRef<ProjectState | null>(null);
  const past = useRef<{ doc: Doc; at: number }[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  /** 上次与服务端一致的文档，三方合并的基准 */
  const base = useRef<ProjectState | null>(null);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}`);
    if (!res.ok) throw await errorOf(res);
    const p = (await res.json()) as ProjectState;
    return { id: p.id, revision: p.revision, doc: p.doc };
  }, [id]);

  useEffect(() => {
    let alive = true;
    load().then(
      (p) => {
        if (!alive) return;
        base.current = p;
        setState(p);
      },
      (e) => alive && setLoadError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [load]);

  const flush = useCallback(
    async (force = false) => {
      if (inflight.current) await inflight.current;
      const cur = latest.current;
      if (!cur) return null;
      if (!dirty.current) return cur.revision;
      dirty.current = false;
      setSave("saving");
      const requestBase = base.current;
      const run = (async () => {
        const res = await fetch(`/api/projects/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doc: cur.doc, revision: force ? null : cur.revision }),
          keepalive: JSON.stringify(cur.doc).length < 60_000,
        });
        if (res.status === 409) {
          const data = await res.json();
          const theirs: ProjectState = { id, revision: data.current.revision, doc: data.current.doc };
          // 请求期间可能又发生了本地编辑；合并最新本地快照，不能把它回滚到请求开始时的 cur。
          const local = latest.current ?? cur;
          dirty.current = true;
          // 常见情况是 Worker 写回了标注、分镜、配乐：与本地修改做三方合并，不打扰用户
          const { mergeDocs } = await import("./core/sync");
          const localAtMerge = latest.current ?? local;
          const m = requestBase ? mergeDocs(requestBase.doc, localAtMerge.doc, theirs.doc) : { doc: localAtMerge.doc, conflict: true };
          if (!m.conflict) {
            base.current = theirs;
            latest.current = { ...localAtMerge, revision: theirs.revision, doc: m.doc };
            setState((s) => (s ? { ...s, revision: theirs.revision, doc: m.doc } : s));
            setSave("saving");
            return;
          }
          setConflict(theirs);
          setSave("conflict");
          return null;
        }
        if (!res.ok) {
          dirty.current = true;
          setSave("error");
          return null;
        }
        const { revision } = (await res.json()) as { revision: number };
        base.current = { id, revision, doc: cur.doc };
        const changedDuringRequest = latest.current !== cur;
        if (latest.current) latest.current = { ...latest.current, revision };
        setState((s) => (s ? { ...s, revision } : s));
        setSave(changedDuringRequest ? "saving" : "saved");
        // 返回 null 表示本次只保存了旧快照，调用方不应把后续编辑当成已落盘。
        return changedDuringRequest ? null : revision;
      })().catch(() => {
        dirty.current = true;
        setSave("error");
        return null;
      });
      inflight.current = run.then(() => {});
      const revision = await run;
      inflight.current = null;
      return revision;
    },
    [id],
  );

  // 节流保存；页面关闭前补存
  useEffect(() => {
    if (!state || !dirty.current || conflict) return;
    const t = setTimeout(() => flush(), delay);
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pagehide", onHide);
    };
  }, [state, conflict, delay, flush]);

  const setDoc = useCallback((fn: Doc | ((d: Doc) => Doc)) => {
    const cur = latest.current;
    if (!cur) return;
    const doc = typeof fn === "function" ? (fn as (d: Doc) => Doc)(cur.doc) : fn;
    if (doc === cur.doc) return;
    const now = Date.now();
    if (!past.current.length || now - past.current.at(-1)!.at > 750) past.current.push({ doc: cur.doc, at: now });
    else past.current.at(-1)!.at = now;
    if (past.current.length > 50) past.current.shift();
    setCanUndo(true);
    dirty.current = true;
    latest.current = { ...cur, doc };
    setState(latest.current);
  }, []);

  const undo = useCallback(() => {
    const entry = past.current.pop();
    const cur = latest.current;
    if (!entry || !cur) return;
    latest.current = { ...cur, doc: entry.doc };
    dirty.current = true;
    setState(latest.current);
    setCanUndo(past.current.length > 0);
  }, []);

  const acceptProject = useCallback((p: ProjectState) => {
    base.current = p;
    latest.current = p;
    dirty.current = false;
    past.current = [];
    setCanUndo(false);
    setConflict(null);
    setSave("saved");
    setState(p);
  }, []);

  /** 服务端文档变了（例如 Worker 写回了结果）：没有本地未保存修改时直接载入 */
  const reload = useCallback(
    async (revision?: number) => {
      if (revision !== undefined && latest.current && revision <= latest.current.revision) return;
      if (dirty.current || inflight.current) return;
      const p = await load().catch(() => null);
      if (p && !dirty.current) {
        acceptProject(p);
      }
    },
    [load, acceptProject],
  );

  const resolveConflict = useCallback(
    async (choice: "theirs" | "mine") => {
      if (!conflict) return;
      if (choice === "theirs") {
        acceptProject(conflict);
      } else {
        base.current = conflict;
        setConflict(null);
        dirty.current = true;
        await flush(true);
      }
    },
    [conflict, flush, acceptProject],
  );

  return { project: state, doc: state?.doc ?? null, setDoc, save, flush, reload, conflict, resolveConflict, undo, canUndo, acceptProject, loadError };
}

type JobT = import("./core/types").Job;

/** 订阅项目事件：任务进度、文档修订、Worker 在线、累计花费 */
export function useProjectEvents(id: string, onRevision?: (revision: number) => void) {
  const [jobState, setJobState] = useState<ProjectJobState>(() => ({ projectId: id, jobs: new Map() }));
  const [online, setOnline] = useState<boolean | null>(null);
  const [spendState, setSpendState] = useState({ projectId: id, value: 0 });
  const [eventsErrorState, setEventsErrorState] = useState({ projectId: id, value: false });
  const refreshWorker = useCallback(async () => {
    const response = await fetch("/api/worker", { cache: "no-store" });
    if (!response.ok) throw new Error("无法检查生成服务状态");
    const data = (await response.json()) as { online?: boolean };
    setOnline(data.online === true);
    return data.online === true;
  }, []);
  const cb = useRef(onRevision);
  useEffect(() => {
    cb.current = onRevision;
  });
  useEffect(() => {
    let active = true;
    const es = new EventSource(`/api/projects/${id}/events`);
    es.onopen = () => { if (active) setEventsErrorState({ projectId: id, value: false }); };
    es.onerror = () => { if (active) setEventsErrorState({ projectId: id, value: true }); };
    es.addEventListener("jobs", (e) => {
      const list = JSON.parse((e as MessageEvent).data) as JobT[];
      if (active) setJobState((current) => mergeProjectJobUpdates(current, id, list));
    });
    es.addEventListener("revision", (e) => { if (active) cb.current?.(JSON.parse((e as MessageEvent).data).revision); });
    es.addEventListener("worker", (e) => { if (active) setOnline(JSON.parse((e as MessageEvent).data).online); });
    es.addEventListener("spend", (e) => { if (active) setSpendState({ projectId: id, value: JSON.parse((e as MessageEvent).data).costYuan }); });
    return () => { active = false; es.close(); };
  }, [id]);
  const jobs = jobState.projectId === id ? jobState.jobs : new Map<string, JobT>();
  const spend = spendState.projectId === id ? spendState.value : 0;
  const eventsError = eventsErrorState.projectId === id && eventsErrorState.value;
  return { jobs, online, spend, eventsError, refreshWorker };
}

export const jobAction = (id: string, action: "cancel" | "retry") => postJson(`/api/jobs/${id}`, { action });

export type VoiceChangeState = { status: "pending" | "applied"; voice: import("./core/types").VoiceSettings; total: number; ready: number; missing: number; failed: number; revertible: boolean; batchId?: string };

/**
 * 配音切换状态。由制作页独占持有，避免顶栏状态区和设置面板各轮询一次。
 * 只在切换进行中（pending）才轮询，完成后停下。
 */
export function useVoiceChange(id: string, onApplied?: () => void) {
  const [change, setChange] = useState<VoiceChangeState | null>(null);
  const applied = useRef(false);
  const cb = useRef(onApplied);
  useEffect(() => { cb.current = onApplied; });

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}/voice-change`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { change: VoiceChangeState | null };
    setChange(data.change);
    if (data.change?.status === "applied" && !applied.current) {
      applied.current = true;
      cb.current?.();
    }
    if (data.change?.status === "pending") applied.current = false;
  }, [id]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { void refresh(); }, [refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (change?.status !== "pending") return;
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [change?.status, refresh]);

  return { change, setChange, refresh };
}

/** 梗库里已经过气的梗（含变体），给去 AI 味检测用；拿不到时为空 */
export function useStaleMemes() {
  const [stale, setStale] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/memes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { memes?: { term: string; variants: string[]; heat: string; category?: string }[] }) => setStale((d.memes ?? []).filter((m) => m.category === "hot" && m.heat === "dead").flatMap((m) => [m.term, ...m.variants])))
      .catch(() => {});
  }, []);
  return stale;
}
