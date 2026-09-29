"use client";

import { useRef, useState } from "react";
import { AnglePicker } from "@/components/angle-picker";
import { MemePicker } from "@/components/meme-picker";
import { BriefForm } from "@/components/brief-form";
import { MetadataPanel, CopyButton } from "@/components/metadata-panel";
import { OutlineEditor } from "@/components/outline-editor";
import { ScriptView, type RewriteExtra } from "@/components/script-view";
import { Icon, Spinner } from "@/components/ui";
import { download, isAbort, postJson, postStream, useModels, usePersistent, useProject, useStaleMemes, useTemplates } from "@/lib/client";
import { acceptHumanized, detectAiTone, type ToneContext } from "@/lib/humanize/detect";
import { countMemeUses, resolveSlang, slangLevels, type MemeRef } from "@/lib/memes";
import type { ProjectDoc } from "@/lib/core/types";
import { ProjectBar } from "@/components/project-bar";
import { charsFor, countChars, deviation, formatTime, resolveRate, timeline } from "@/lib/duration";
import { angleToSummary, type Angle, type Brief, type Metadata, type RewriteAction, type Section } from "@/lib/types";
import { useFeedback } from "@/components/feedback";
import { useProjectShortcuts } from "@/lib/shortcuts";

type Draft = Pick<ProjectDoc, "brief" | "modelId" | "sections" | "segments" | "metadata">;

type Busy = null | "angles" | "outline" | "write" | "rewrite" | "humanize" | "metadata";

export function Workbench({ id }: { id: string }) {
  const store = useProject(id);
  if (store.loadError) return <p className="pt-16 text-center text-sm text-red-300/80">{store.loadError}</p>;
  if (!store.doc) return <p className="flex justify-center pt-24 text-white/40"><Spinner /></p>;
  return <WorkbenchInner id={id} store={store as Loaded} />;
}

type Loaded = ReturnType<typeof useProject> & { doc: ProjectDoc };

function WorkbenchInner({ id, store }: { id: string; store: Loaded }) {
  const models = useModels();
  const { templates } = useTemplates();
  const draft: Draft = store.doc;
  const setDraft = (fn: (d: Draft) => Draft) => store.setDoc((d) => ({ ...d, ...fn(d) }));
  const [busy, setBusy] = useState<Busy>(null);
  const [step, setStep] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<Map<number, string>>(new Map());
  const [angles, setAngles] = useState<Angle[]>([]);
  const [angleStyle, setAngleStyle] = useState("");
  const [anglesOpen, setAnglesOpen] = useState(false);
  const [view, setView] = useState<"outline" | "script" | null>(null);
  const seenAngles = useRef<string[]>([]);
  const direction = useRef("");
  const abort = useRef<AbortController | null>(null);
  const { confirm, toast } = useFeedback();
  // 成稿后自动去 AI 味：个人偏好，存在本机
  const [prefs, setPrefs] = usePersistent("do-vedio:humanize", { auto: true });
  /** 正在挑梗：resolve 收到 null 表示取消 */
  const [memePick, setMemePick] = useState<{ brief: Brief; resolve: (memes: MemeRef[] | null) => void } | null>(null);
  useProjectShortcuts({ save: () => { void store.flush(); }, undo: store.undo });

  async function snapshot(label: string) {
    const revision = await store.flush();
    if (revision == null) throw new Error("文档尚未保存，请先解决保存冲突");
    await postJson(`/api/projects/${id}/versions`, { revision, label });
  }

  const { brief, sections, segments, metadata } = draft;
  const modelId = models?.some((m) => m.id === draft.modelId) ? draft.modelId : (models?.[0]?.id ?? "");
  const template = templates.find((t) => t.id === brief.templateId);
  const rate = resolveRate(brief.rate, template);
  const slang = resolveSlang(brief.slang, template);
  const stale = useStaleMemes();
  /** 去 AI 味检测上下文：选用的梗不算痕迹，过气梗和超量用梗算 */
  const toneCtx = (b: Brief): ToneContext => ({ memes: b.memes ?? [], stale, slang: resolveSlang(b.slang, template) });
  /** 全片已用过的梗及次数；except 为正在改写的段 */
  const memeUsage = (except?: number) => {
    const out: Record<string, number> = {};
    segments.forEach((s, j) => {
      if (j !== except) for (const [term, n] of countMemeUses(s.text, brief.memes ?? [])) out[term] = (out[term] ?? 0) + n;
    });
    return out;
  };
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const setSegment = (i: number, text: string) =>
    setDraft((d) => ({ ...d, segments: d.segments.map((s, j) => (j === i ? { ...s, text } : s)) }));

  async function run(kind: Exclude<Busy, null>, fn: (signal: AbortSignal) => Promise<void>) {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(kind);
    setError("");
    try {
      await fn(ctrl.signal);
    } catch (e) {
      if (!isAbort(e)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setStep("");
      setActive(null);
      abort.current = null;
    }
  }

  // 以下函数显式接收 brief：选中角度后概要刚更新，闭包里的 brief 还是旧值
  const fetchAngles = (b: Brief, signal: AbortSignal) =>
    postJson<{ angles: Angle[] }>("/api/angles", { brief: b, modelId, exclude: seenAngles.current }, "POST", signal).then((r) => {
      seenAngles.current.push(...r.angles.map((a) => a.angle));
      return r.angles;
    });

  const fetchOutline = (b: Brief, signal: AbortSignal) =>
    postJson<{ sections: Section[] }>("/api/outline", { brief: b, modelId }, "POST", signal).then((r) => r.sections);

  async function writeAll(list: Section[], b: Brief, signal: AbortSignal) {
    setUndo(new Map());
    setView("script");
    patch({ sections: list, segments: list.map((s) => ({ title: s.title, text: "" })), metadata: null });
    setStep("");
    let previousTail = "";
    const rejected: string[] = [];
    // 全片累计用梗次数，同一个梗用够次数后后面的章节不再给
    const memeUsage: Record<string, number> = {};
    for (let i = 0; i < list.length; i++) {
      setActive(i);
      let text = await postStream("/api/section", { brief: b, modelId, sections: list, index: i, previousTail, memeUsage }, (t) => setSegment(i, t), signal);
      setSegment(i, text);
      if (prefs.auto && detectAiTone(text, toneCtx(b)).length > 0) {
        setStep(`正在给第 ${i + 1} / ${list.length} 段去 AI 味…`);
        const raw = text;
        const r = await humanize(i, raw, b, previousTail, "", signal);
        text = r.text;
        if (r.reason) rejected.push(`第 ${i + 1} 段：${r.reason}`);
        // 自动处理也能撤销，回到模型初稿
        else if (text !== raw) setUndo((m) => new Map(m).set(i, raw));
        setStep("");
      }
      previousTail = text.slice(-160);
      for (const [term, n] of countMemeUses(text, b.memes ?? [])) memeUsage[term] = (memeUsage[term] ?? 0) + n;
    }
    if (rejected.length) toast(`去 AI 味有 ${rejected.length} 段未采用，已保留初稿（${rejected.join("；")}）`, "info");
  }

  /**
   * 去 AI 味（白名单式最小改写）。结果没通过验收就退回原文，返回原因。
   * 显式接收原文和 brief：一键成稿时 segments 闭包还是旧值。
   */
  async function humanize(i: number, text: string, b: Brief, before: string, after: string, signal: AbortSignal) {
    const out = await postStream("/api/rewrite", { brief: b, modelId, action: "humanize", text, before, after }, (t) => setSegment(i, t), signal).catch((e) => {
      setSegment(i, text);
      throw e;
    });
    const check = acceptHumanized(text, out, toneCtx(b));
    setSegment(i, check.ok ? out : text);
    return check.ok ? { text: out } : { text, reason: check.reason };
  }

  /** 把角度写入概要，返回新的 brief。题材与风格冲突（灾难、悼念等）时顺带关掉网感 */
  function applyAngle(a: Angle, base: Brief = brief) {
    const b = { ...base, summary: angleToSummary(a, direction.current) };
    if (a.note && resolveSlang(b.slang, template) !== "off") {
      b.slang = "off";
      toast("这个题材比较沉重，已关闭网感，需要的话可以在表单里重新打开", "info");
    }
    patch({ brief: b });
    setAnglesOpen(false);
    return b;
  }

  /**
   * 网感开启、这期还没挑过梗时，先弹出挑梗面板。
   * 返回挑好梗的 brief；用户取消返回 null。
   */
  function ensureMemes(b: Brief): Promise<Brief | null> {
    if (resolveSlang(b.slang, template) === "off" || b.memes !== null) return Promise.resolve(b);
    return new Promise((resolve) =>
      setMemePick({
        brief: b,
        resolve: (memes) => {
          setMemePick(null);
          if (memes === null) return resolve(null);
          const next = { ...b, memes };
          patch({ brief: next });
          resolve(next);
        },
      }),
    );
  }

  const onRepickMemes = () => void ensureMemes({ ...brief, memes: null });

  const onAngles = () =>
    run("angles", async (signal) => {
      seenAngles.current = [];
      direction.current = brief.summary.trim();
      setAngles(await fetchAngles(brief, signal));
      setAngleStyle(template?.name ?? "");
      setAnglesOpen(true);
    });

  const onMoreAngles = () =>
    run("angles", async (signal) => {
      // 用最初的方向重新构思，而不是已被角度覆盖的概要
      setAngles(await fetchAngles({ ...brief, summary: direction.current }, signal));
      setAngleStyle(template?.name ?? "");
    });

  const onOutline = async () => {
    if (!(await confirmOutlineReset())) return;
    const b = await ensureMemes(brief);
    if (!b) return;
    await run("outline", async (signal) => {
      await snapshot("重新生成大纲前");
      patch({ sections: await fetchOutline(b, signal), segments: [], metadata: null });
      setView("outline");
    });
  };

  async function confirmFullRewrite() {
    if (!segments.some((segment) => segment.text.trim())) return true;
    return confirm({
      title: "重新生成全文？",
      message: "当前文案会被新的生成结果覆盖，现有手动修改也会丢失。",
      confirmLabel: "重新生成",
      tone: "danger",
    });
  }

  async function confirmOutlineReset() {
    if (!segments.some((segment) => segment.text.trim())) return true;
    return confirm({
      title: "重新生成大纲？",
      message: "当前文案会被清空，只保留新的大纲。",
      confirmLabel: "重新生成大纲",
      tone: "danger",
    });
  }

  // 概要为空时自动构思角度并采用第一个
  const onOneShot = async () => {
    if (!(await confirmFullRewrite())) return;
    const picked = await ensureMemes(brief);
    if (!picked) return;
    await run("write", async (signal) => {
      await snapshot("全文重写前");
      let b = picked;
      if (!b.summary.trim()) {
        setStep("正在构思选题角度…");
        seenAngles.current = [];
        direction.current = "";
        const [first] = await fetchAngles(b, signal);
        b = applyAngle(first, b);
      }
      setStep("正在构思大纲…");
      await writeAll(await fetchOutline(b, signal), b, signal);
    });
  };

  const onPickOutline = async (a: Angle) => {
    if (!(await confirmOutlineReset())) return;
    const b = await ensureMemes(applyAngle(a));
    if (!b) return;
    await run("outline", async (signal) => {
      await snapshot("重新生成大纲前");
      patch({ sections: await fetchOutline(b, signal), segments: [], metadata: null });
      setView("outline");
    });
  };

  const onPickOneShot = async (a: Angle) => {
    if (!(await confirmFullRewrite())) return;
    const b = await ensureMemes(applyAngle(a));
    if (!b) return;
    run("write", async (signal) => {
      await snapshot("全文重写前");
      setStep("正在构思大纲…");
      await writeAll(await fetchOutline(b, signal), b, signal);
    });
  };

  const onWrite = async () => {
    if (!(await confirmFullRewrite())) return;
    const b = await ensureMemes(brief);
    if (!b) return;
    await run("write", async (signal) => {
      await snapshot("全文重写前");
      await writeAll(sections, b, signal);
    });
  };

  async function rewriteOne(i: number, action: RewriteAction, extra: RewriteExtra & { targetChars?: number }, signal: AbortSignal) {
    const original = segments[i].text;
    setUndo((m) => new Map(m).set(i, original));
    setActive(i);
    const before = segments[i - 1]?.text.slice(-200) ?? "";
    const after = segments[i + 1]?.text.slice(0, 200) ?? "";
    if (action === "humanize") {
      const r = await humanize(i, original, brief, before, after, signal);
      if (r.text === original)
        setUndo((m) => {
          const n = new Map(m);
          n.delete(i);
          return n;
        });
      return r;
    }
    try {
      const text = await postStream(
        "/api/rewrite",
        {
          brief,
          modelId,
          action,
          text: original,
          before,
          after,
          memeUsage: action === "addMemes" ? memeUsage(i) : undefined,
          ...extra,
        },
        (t) => setSegment(i, t),
        signal,
      );
      setSegment(i, text);
      return { text };
    } catch (e) {
      setSegment(i, original);
      throw e;
    }
  }

  const onRewrite = (i: number, action: RewriteAction, extra: RewriteExtra = {}) =>
    run(action === "humanize" ? "humanize" : "rewrite", async (signal) => {
      await snapshot(`${action === "humanize" ? "去 AI 味" : "改写"}第 ${i + 1} 段前`);
      const r = await rewriteOne(i, action, { ...extra, targetChars: action === "fit" ? charsFor(sections[i]?.minutes ?? 1, rate) : undefined }, signal);
      if (action !== "humanize") return;
      if ("reason" in r && r.reason) toast(`未采用改写结果，已保留原文：${r.reason}`, "info");
      else if (r.text === segments[i].text) toast("没有找到需要改的地方，原文保留", "info");
    });

  // 只处理检测到疑似 AI 痕迹的段落
  const onHumanizeAll = () =>
    run("humanize", async (signal) => {
      await snapshot("全文去 AI 味前");
      const todo = segments.map((s, i) => i).filter((i) => detectAiTone(segments[i].text, toneCtx(brief)).length > 0);
      let changed = 0;
      const rejected: string[] = [];
      for (const i of todo) {
        const r = await rewriteOne(i, "humanize", {}, signal);
        if ("reason" in r && r.reason) rejected.push(`第 ${i + 1} 段：${r.reason}`);
        else if (r.text !== segments[i].text) changed++;
      }
      toast(`已处理 ${changed} 段${rejected.length ? `；${rejected.length} 段未采用，保留原文（${rejected.join("；")}）` : ""}`, rejected.length ? "info" : "success");
    });

  // 只改写偏差超过 10% 的段落，校准到各章目标字数
  const onFit = () =>
    run("rewrite", async (signal) => {
      await snapshot("时长校准前");
      for (let i = 0; i < segments.length; i++) {
        const target = charsFor(sections[i]?.minutes ?? brief.minutes / segments.length, rate);
        if (Math.abs(deviation(countChars(segments[i].text), target)) > 0.1) {
          await rewriteOne(i, "fit", { targetChars: target }, signal);
        }
      }
    });

  const times = timeline(segments.map((s) => s.text), rate);
  const chapters = segments.map((s, i) => `${formatTime(times[i].start)} ${s.title}`).join("\n");
  const plain = segments.map((s) => s.text).join("\n\n");
  const markdown = [
    `# ${brief.title}`,
    ...segments.map((s, i) => `## [${formatTime(times[i].start)}-${formatTime(times[i].end)}] ${s.title}\n\n${s.text}`),
  ].join("\n\n");

  const onMetadata = () =>
    run("metadata", async () => {
      patch({ metadata: await postJson<Metadata>("/api/metadata", { brief, modelId, script: plain }) });
    });

  const writing = segments.length > 0;
  const stage = memePick ? "memes" : anglesOpen && angles.length > 0 ? "angles" : view ?? (writing ? "script" : sections.length > 0 ? "outline" : "empty");

  return (
    <div className="grid min-w-0 gap-8 pt-10 lg:grid-cols-[440px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pb-4">
        <BriefForm
          brief={brief}
          onChange={(p) => patch({ brief: { ...brief, ...p } })}
          templates={templates}
          models={models}
          modelId={modelId}
          onModel={(id) => patch({ modelId: id })}
          busy={busy !== null || memePick !== null}
          onOutline={onOutline}
          onOneShot={onOneShot}
          hasScript={writing}
          onAngles={onAngles}
          autoHumanize={prefs.auto}
          onAutoHumanize={(auto) => setPrefs({ auto })}
          slang={slang}
          onRepickMemes={onRepickMemes}
        />
      </aside>

      <section className="min-w-0 space-y-6">
        <ProjectBar id={id} store={store} title={brief.title} active="script" />

        {error && (
          <div className="flex animate-rise items-start justify-between gap-4 rounded-2xl border border-red-400/20 bg-red-400/[0.05] px-5 py-3.5 text-sm text-red-200/90">
            <span className="break-all">{error}</span>
            <button className="shrink-0 cursor-pointer text-red-200/50 hover:text-red-100" onClick={() => setError("")}>
              关闭
            </button>
          </div>
        )}

        {busy && (
          <div className="flex items-center justify-between rounded-full border border-accent/20 bg-accent/[0.04] py-1.5 pr-1.5 pl-5 text-sm text-accent/90">
            <span className="flex items-center gap-2.5">
              <Spinner className="size-3.5" />
              {busy === "angles" && `正在以「${template?.name ?? ""}」的视角构思选题…`}
              {busy === "outline" && "正在构思大纲…"}
              {busy === "write" && (step || (active === null ? "正在构思大纲…" : `正在写第 ${active + 1} / ${segments.length} 段`))}
              {busy === "rewrite" && `正在改写第 ${(active ?? 0) + 1} 段`}
              {busy === "humanize" && `正在给第 ${(active ?? 0) + 1} 段去 AI 味`}
              {busy === "metadata" && "正在生成标题与简介…"}
            </span>
            {busy !== "metadata" && (
              <button className="btn btn-ghost btn-sm" onClick={() => abort.current?.abort()}>
                <Icon name="stop" className="size-3.5" /> 停止
              </button>
            )}
          </div>
        )}

        {stage === "empty" && busy === null && <Hero />}

        {stage === "memes" && memePick && (
          <MemePicker brief={memePick.brief} modelId={modelId} styleName={template?.name ?? ""} levelLabel={slangLevels[resolveSlang(memePick.brief.slang, template)].label} onDone={memePick.resolve} />
        )}

        {stage === "angles" && (
          <AnglePicker
            angles={angles}
            styleName={angleStyle}
            busy={busy !== null}
            loadingMore={busy === "angles"}
            onOutline={onPickOutline}
            onOneShot={onPickOneShot}
            onMore={onMoreAngles}
            onClose={() => setAnglesOpen(false)}
          />
        )}

        {stage === "outline" && (
          <OutlineEditor
            sections={sections}
            onChange={(s) => patch({ sections: s })}
            minutes={brief.minutes}
            rate={rate}
            busy={busy !== null}
            onWrite={onWrite}
            onRegenerate={onOutline}
            memes={slang !== "off" ? (brief.memes ?? []) : []}
          />
        )}

        {stage === "script" && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="label">Step 02 · 文案</p>
                <h2 className="mt-2 truncate text-3xl font-semibold tracking-tight">{brief.title || "未命名"}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => setView("outline")}>
                  返回大纲
                </button>
                <span className="btn btn-ghost btn-sm">
                  <CopyButton text={plain} label="复制全文" />
                </span>
                <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => download(`${brief.title || "文案"}.md`, markdown)}>
                  <Icon name="download" className="size-3.5" /> Markdown
                </button>
              </div>
            </div>
            <ScriptView
              segments={segments}
              sections={sections}
              rate={rate}
              minutes={brief.minutes}
              templates={templates.filter((t) => t.id !== brief.templateId)}
              activeIndex={active}
              busy={busy !== null}
              undoable={new Set(undo.keys())}
              onEdit={setSegment}
              onRewrite={onRewrite}
              onUndo={(i) => {
                setSegment(i, undo.get(i) ?? segments[i].text);
                setUndo((m) => {
                  const n = new Map(m);
                  n.delete(i);
                  return n;
                });
              }}
              onFit={onFit}
              onHumanizeAll={onHumanizeAll}
              toneCtx={toneCtx(brief)}
            />
            <MetadataPanel metadata={metadata} chapters={chapters} busy={busy === "metadata"} disabled={busy !== null || !plain} onGenerate={onMetadata} />
          </>
        )}
      </section>
    </div>
  );
}

function Hero() {
  const steps = [
    { n: "01", t: "描述视频", d: "标题、时长和解说风格；概要留空，AI 会按风格构思选题" },
    { n: "02", t: "确认大纲", d: "AI 按时长分配章节，你可以随意增删调整" },
    { n: "03", t: "逐段成稿", d: "流式写作，自动计算时间轴，可分段改写" },
  ];
  return (
    <div className="relative flex min-h-[70vh] flex-col justify-center overflow-hidden rounded-[2rem] border border-white/[0.06] px-5 py-10 sm:px-10 sm:py-16">
      <div className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-accent/10 blur-[120px]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.025)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.025)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)] bg-[size:48px_48px]" />
      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/55">
          <span className="size-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
          为 B站 / 西瓜中长视频打造
        </span>
        <h1 className="mt-6 max-w-full break-words text-5xl leading-[1.08] font-semibold tracking-[-0.03em] md:text-6xl 2xl:text-7xl">
          把一个想法，
          <br />
          <span>
            写成<span className="text-accent">能直接开录</span>的稿子。
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-white/50">按时长精确控制字数，八种解说风格随心切换，每一段都自带时间轴，配音和剪辑一步到位。</p>
        <div className="mt-14 grid max-w-3xl gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="bg-ink/90 p-5">
              <span className="font-mono text-xs text-accent">{s.n}</span>
              <p className="mt-3 text-sm font-medium">{s.t}</p>
              <p className="mt-1 text-xs leading-relaxed text-white/40">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
