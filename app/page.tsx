"use client";

import { useRef, useState } from "react";
import { AnglePicker } from "@/components/angle-picker";
import { BriefForm } from "@/components/brief-form";
import { MetadataPanel, CopyButton } from "@/components/metadata-panel";
import { OutlineEditor } from "@/components/outline-editor";
import { ScriptView, type RewriteExtra } from "@/components/script-view";
import { Icon, Spinner } from "@/components/ui";
import { download, isAbort, postJson, postStream, useModels, usePersistent, useTemplates } from "@/lib/client";
import { charsFor, countChars, deviation, formatTime, resolveRate, timeline } from "@/lib/duration";
import { angleToSummary, type Angle, type Brief, type Metadata, type RewriteAction, type Section, type Segment } from "@/lib/types";

const emptyBrief: Brief = {
  title: "",
  summary: "",
  minutes: 5,
  templateId: "humor",
  audience: "",
  perspective: "first",
  mustInclude: "",
  avoid: "",
  rate: "auto",
};

type Draft = {
  brief: Brief;
  modelId: string;
  sections: Section[];
  segments: Segment[];
  metadata: Metadata | null;
};

type Busy = null | "angles" | "outline" | "write" | "rewrite" | "metadata";

export default function Home() {
  const models = useModels();
  const { templates } = useTemplates();
  const [draft, setDraft, saveError] = usePersistent<Draft>("do-vedio:draft", { brief: emptyBrief, modelId: "", sections: [], segments: [], metadata: null });
  const [busy, setBusy] = useState<Busy>(null);
  const [step, setStep] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<Map<number, string>>(new Map());
  const [angles, setAngles] = useState<Angle[]>([]);
  const [angleStyle, setAngleStyle] = useState("");
  const [anglesOpen, setAnglesOpen] = useState(false);
  const seenAngles = useRef<string[]>([]);
  const direction = useRef("");
  const abort = useRef<AbortController | null>(null);

  const { brief, sections, segments, metadata } = draft;
  const modelId = models?.some((m) => m.id === draft.modelId) ? draft.modelId : (models?.[0]?.id ?? "");
  const template = templates.find((t) => t.id === brief.templateId);
  const rate = resolveRate(brief.rate, template);
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
    patch({ sections: list, segments: list.map((s) => ({ title: s.title, text: "" })), metadata: null });
    let previousTail = "";
    for (let i = 0; i < list.length; i++) {
      setActive(i);
      const text = await postStream("/api/section", { brief: b, modelId, sections: list, index: i, previousTail }, (t) => setSegment(i, t), signal);
      setSegment(i, text);
      previousTail = text.slice(-160);
    }
  }

  /** 把角度写入概要，返回新的 brief */
  function applyAngle(a: Angle) {
    const b = { ...brief, summary: angleToSummary(a, direction.current) };
    patch({ brief: b });
    setAnglesOpen(false);
    return b;
  }

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

  const onOutline = () =>
    run("outline", async (signal) => {
      patch({ sections: await fetchOutline(brief, signal), segments: [], metadata: null });
    });

  // 概要为空时自动构思角度并采用第一个
  const onOneShot = () =>
    run("write", async (signal) => {
      let b = brief;
      if (!b.summary.trim()) {
        setStep("正在构思选题角度…");
        seenAngles.current = [];
        direction.current = "";
        const [first] = await fetchAngles(b, signal);
        b = applyAngle(first);
      }
      setStep("正在构思大纲…");
      await writeAll(await fetchOutline(b, signal), b, signal);
    });

  const onPickOutline = (a: Angle) => {
    const b = applyAngle(a);
    run("outline", async (signal) => {
      patch({ sections: await fetchOutline(b, signal), segments: [], metadata: null });
    });
  };

  const onPickOneShot = (a: Angle) => {
    const b = applyAngle(a);
    run("write", async (signal) => {
      setStep("正在构思大纲…");
      await writeAll(await fetchOutline(b, signal), b, signal);
    });
  };

  const onWrite = () => run("write", (signal) => writeAll(sections, brief, signal));

  async function rewriteOne(i: number, action: RewriteAction, extra: RewriteExtra & { targetChars?: number }, signal: AbortSignal) {
    const original = segments[i].text;
    setUndo((m) => new Map(m).set(i, original));
    setActive(i);
    try {
      const text = await postStream(
        "/api/rewrite",
        {
          brief,
          modelId,
          action,
          text: original,
          before: segments[i - 1]?.text.slice(-200) ?? "",
          after: segments[i + 1]?.text.slice(0, 200) ?? "",
          ...extra,
        },
        (t) => setSegment(i, t),
        signal,
      );
      setSegment(i, text);
    } catch (e) {
      setSegment(i, original);
      throw e;
    }
  }

  const onRewrite = (i: number, action: RewriteAction, extra: RewriteExtra = {}) =>
    run("rewrite", (signal) =>
      rewriteOne(i, action, { ...extra, targetChars: action === "fit" ? charsFor(sections[i]?.minutes ?? 1, rate) : undefined }, signal),
    );

  // 只改写偏差超过 10% 的段落，校准到各章目标字数
  const onFit = () =>
    run("rewrite", async (signal) => {
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
  const stage = anglesOpen && angles.length > 0 ? "angles" : writing ? "script" : sections.length > 0 ? "outline" : "empty";

  return (
    <div className="grid gap-8 pt-10 lg:grid-cols-[440px_1fr]">
      <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pb-4">
        <BriefForm
          brief={brief}
          onChange={(p) => patch({ brief: { ...brief, ...p } })}
          templates={templates}
          models={models}
          modelId={modelId}
          onModel={(id) => patch({ modelId: id })}
          busy={busy !== null}
          onOutline={onOutline}
          onOneShot={onOneShot}
          onAngles={onAngles}
        />
      </aside>

      <section className="min-w-0 space-y-6">
        {saveError && (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] px-5 py-3.5 text-sm leading-relaxed text-amber-100/80">
            浏览器存储空间已满，当前稿件无法自动保存，刷新页面会丢失。请先「复制全文」或导出 Markdown 备份；
            清理本站点数据（浏览器开发者工具 → 应用 → 存储 → 清除网站数据）后即可恢复自动保存。
          </div>
        )}

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
              {busy === "write" && (active === null ? step || "正在构思大纲…" : `正在写第 ${active + 1} / ${segments.length} 段`)}
              {busy === "rewrite" && `正在改写第 ${(active ?? 0) + 1} 段`}
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
                <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => patch({ segments: [], metadata: null })}>
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
    <div className="relative flex min-h-[70vh] flex-col justify-center overflow-hidden rounded-[2rem] border border-white/[0.06] px-10 py-16">
      <div className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-accent/10 blur-[120px]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.025)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.025)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)] bg-[size:48px_48px]" />
      <div className="relative">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/55">
          <span className="size-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
          为 B站 / 西瓜中长视频打造
        </span>
        <h1 className="mt-6 text-5xl leading-[1.08] font-semibold tracking-[-0.03em] md:text-6xl 2xl:text-7xl">
          把一个想法，
          <br />
          <span className="whitespace-nowrap">
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
