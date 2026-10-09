"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Alert, Button, Icon, Spinner } from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import type { ProjectDoc } from "@/lib/core/types";
import {
  fontFamilyStack,
  fontsForScript,
  isStudioFontReady,
  loadStudioFont,
  resolveSecondarySubtitleFontId,
  resolveSubtitleFontId,
  resolveSubtitleTypeface,
  retryStudioFont,
  studioFontById,
  studioFontState,
  subscribeStudioFonts,
  type StudioFont,
  type StudioFontScript,
} from "@/lib/core/subtitle/fonts";
import { inferScriptLanguage } from "@/lib/core/subtitle/language";
import { mergeSecondaryResults } from "@/lib/core/subtitle/merge";
import { SUBTITLE_PRESETS, subtitlePresetMatches, subtitlePresetMeta, subtitlePresetUpdates } from "@/lib/core/subtitle/presets";
import { secondaryCoverage, translateLinesSecondary } from "@/lib/core/subtitle/secondary";
import { subtitleAnimationLabels, subtitleAnimations, type SubtitleConfig, type SubtitlePreset } from "@/lib/core/subtitle/types";

/**
 * 字幕样式面板 —— 从 AI-Video 字幕模块移植。
 *
 * 自上而下：样张（即时反馈，可重播动效）→ 样式预设 → 字体与字号 → 双语 → 位置与排版
 * → 入场动效 → 外观 → 输出。每组只放一个主控件，说明压到一行以内。
 * 改动直接写回项目文档，预览和成片随之刷新。
 */

type SubtitlePanelProps = {
  doc: ProjectDoc;
  setDoc: (fn: (doc: ProjectDoc) => ProjectDoc) => void;
};

type TranslationLanguageMode = "auto" | "zh" | "en";
type TranslateProgress = { done: number; total: number };

const MAX_LINES_OPTIONS = [2, 3, 4] as const;
const LANGUAGE_OPTIONS: { value: TranslationLanguageMode; label: string }[] = [
  { value: "auto", label: "自动识别" },
  { value: "zh", label: "统一中文" },
  { value: "en", label: "统一英文" },
];
const ANIMATION_OPTIONS = subtitleAnimations.map((animation) => ({ value: animation, label: subtitleAnimationLabels[animation] }));

/** 样张文案：双语时副行取另一种文字脚本，与真实成片的配对方式一致 */
const SAMPLE_LINES: Record<StudioFontScript, { primary: string; keyword: string; secondary: string }> = {
  cjk: { primary: "今天我们聊聊字幕设计", keyword: "字幕", secondary: "Let's talk about subtitle design" },
  latin: { primary: "Let's talk about subtitle design", keyword: "subtitle", secondary: "今天我们聊聊字幕设计" },
};

/** 逐字高亮在样张里走完整段的时长（毫秒） */
const KARAOKE_SPAN_MS = 1600;
/** 样张与预设色块共用的画面底色：中间亮、四周暗，接近视频画面的明暗关系 */
const FRAME_BACKGROUND = "radial-gradient(120% 90% at 50% 0%, #2a4450 0%, #17242c 55%, #0b1215 100%)";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

function specimenText(script: StudioFontScript) {
  return script === "latin" ? "The quick brown fox" : "这是当前字幕字体";
}

/** 高度过渡的折叠容器。收起时 inert 且 aria-hidden，焦点不会落到看不见的内容上。 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
      {/* 展开时放宽裁切边界，让焦点环与选中光圈不被切掉；收起时必须严格裁掉，否则边框会从 0 高度里露出来 */}
      <div className="min-h-0 overflow-clip" style={open ? { overflowClipMargin: "10px" } : undefined} aria-hidden={!open} inert={!open}>
        {children}
      </div>
    </div>
  );
}

function Section({ title, meta, action, open = true, children }: { title: string; meta?: ReactNode; action?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <section className="border-t border-hairline py-5">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="label shrink-0">{title}</h3>
          {meta && <span className="truncate text-2xs text-text-faint">{meta}</span>}
        </div>
        {action}
      </div>
      <Collapse open={open}>
        <div className="space-y-4 pt-4">{children}</div>
      </Collapse>
    </section>
  );
}

/** 开关。默认是整行可点的行内样式；compact 用于标题栏，只显示开启状态。 */
function Toggle({ label, hint, checked, onChange, compact = false }: { label: string; hint?: string; checked: boolean; onChange: (next: boolean) => void; compact?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={compact ? label : undefined}
      onClick={() => onChange(!checked)}
      className={`group flex cursor-pointer items-center gap-3 text-left transition ${compact ? "rounded-full" : "w-full justify-between py-3"} ${FOCUS_RING}`}
    >
      {compact ? (
        <span className={`text-xs transition ${checked ? "text-white" : "text-text-muted group-hover:text-white"}`}>{checked ? "已开启" : "已关闭"}</span>
      ) : (
        <span className="min-w-0">
          <span className="block text-sm text-text transition group-hover:text-white">{label}</span>
          {hint && <span className="mt-0.5 block text-2xs leading-relaxed text-text-faint">{hint}</span>}
        </span>
      )}
      <span className="switch pointer-events-none shrink-0" data-checked={checked} aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </button>
  );
}

type SegmentOption<T extends string | number> = { value: T; label: string };

/**
 * 分段控件：白色滑块在选项之间平移，方向键切换并移动焦点（radiogroup 语义）。
 * 原来的 SegmentedControl 只有按钮，没有单选语义也没有键盘移动。
 */
function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly SegmentOption<T>[]; onChange: (value: T) => void }) {
  const count = options.length;
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(options[next].value);
    itemRefs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="relative grid rounded-control border border-line bg-white/[0.02] p-1" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 rounded-[calc(var(--radius-control)-0.25rem)] bg-white shadow-[0_6px_18px_-8px_rgb(255_255_255/0.7)] transition-transform duration-300 ease-out"
        style={{ width: `calc((100% - 0.5rem) / ${count})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((option, i) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            ref={(element) => {
              itemRefs.current[i] = element;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`relative z-10 h-8 cursor-pointer rounded-[calc(var(--radius-control)-0.25rem)] px-2 text-xs transition-colors duration-200 ${FOCUS_RING} ${active ? "font-medium text-black" : "text-text-muted hover:text-white"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** 滑杆：数值在标题行右侧，填充色随值变化。说明紧跟在名称后面，不再单独占一行。 */
function SliderRow({ label, note, valueText, value, min, max, step = 1, onChange }: { label: string; note?: string; valueText: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  const id = useId();
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="min-w-0 text-sm text-text">
          {label}
          {note && <span className="ml-2 text-2xs text-text-faint">{note}</span>}
        </label>
        <output htmlFor={id} className="shrink-0 font-mono text-sm tabular-nums text-white">
          {valueText}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ background: `linear-gradient(to right, var(--color-accent) ${percent}%, rgb(255 255 255 / 0.15) ${percent}%)` }}
      />
    </div>
  );
}

/** 预设色块：用预设的真实配色画一小段文字，比文字描述更容易比较 */
function PresetSwatch({ look }: { look: Partial<SubtitleConfig> }) {
  return (
    <span className="flex h-16 flex-col items-center justify-center gap-1 rounded-[calc(var(--radius-control)-0.25rem)] leading-none" style={{ background: FRAME_BACKGROUND }} aria-hidden="true">
      <span
        className="inline-flex items-center rounded-full px-2.5 py-1.5 text-sm font-bold"
        style={{
          color: look.primaryColor,
          background: look.showBackground ? look.backgroundColor : undefined,
          WebkitTextStroke: look.showStroke ? `0.6px ${look.strokeColor ?? "#000000"}` : undefined,
          paintOrder: "stroke fill",
        }}
      >
        这是<span style={{ color: look.highlightColor }}>重点</span>
      </span>
      {look.bilingual && (
        <span className="text-2xs" style={{ color: look.highlightColor }}>
          Key point
        </span>
      )}
    </span>
  );
}

/** 按字符渲染样张文本；关键词用强调色，逐字高亮时每个字符各自延迟过渡 */
function SampleText({ text, keyword, highlight, highlightColor, karaoke }: { text: string; keyword: string; highlight: boolean; highlightColor: string; karaoke: boolean }) {
  const chars = Array.from(text);
  const start = highlight && keyword ? text.indexOf(keyword) : -1;
  const end = start + keyword.length;
  if (!karaoke && start < 0) return <>{text}</>;
  return (
    <>
      {chars.map((char, i) => {
        if (start >= 0 && i >= start && i < end) {
          return (
            <span key={i} style={{ color: highlightColor }}>
              {char}
            </span>
          );
        }
        if (karaoke) {
          return (
            <span key={i} className="animate-sub-kara" style={{ animationDelay: `${Math.round((i / chars.length) * KARAOKE_SPAN_MS)}ms` }}>
              {char}
            </span>
          );
        }
        return <span key={i}>{char}</span>;
      })}
    </>
  );
}

/**
 * 样张：按 Remotion 字幕层的同一套参数绘制（字号按 950px 基准换算为容器宽度的百分比，
 * 描边、阴影、胶囊内边距都以字号为单位），所以在面板里看到的比例与成片一致。
 * 样式变化即时生效；动效在入场时播放一次，点「重播」可再看。
 */
function SubtitleStage({ config, script, playKey, onReplay }: { config: SubtitleConfig; script: StudioFontScript; playKey: number; onReplay: () => void }) {
  const sample = SAMPLE_LINES[script];
  const typeface = resolveSubtitleTypeface(config);
  const animated = config.animation !== "none";
  const karaoke = config.animation === "karaoke";
  const sizeCqw = (config.fontSize / 950) * 100;
  const widthCqw = (config.maxWidthRatio || 0.84) * 100;
  const animationClass = config.animation === "pop" ? "animate-sub-pop" : config.animation === "fade" ? "animate-sub-fade" : "";
  const fontName = studioFontById(resolveSubtitleFontId(config)).name;
  const cssVars = { "--sub-base": config.primaryColor, "--sub-hl": config.highlightColor } as CSSProperties;

  return (
    <div className="relative overflow-hidden rounded-xl border border-line" style={{ aspectRatio: "16 / 9", containerType: "inline-size", background: FRAME_BACKGROUND }}>
      <div className="absolute inset-x-0 flex justify-center px-[6%]" style={{ top: `${config.positionY}%`, transform: "translateY(-50%)" }}>
        <div
          key={`${config.animation}-${playKey}`}
          role="img"
          aria-label={`字幕样张：${fontName}，基准字号 ${config.fontSize}，位于画面 ${config.positionY}% 处`}
          className={`flex flex-col items-center text-center ${animationClass}`}
          style={{
            ...cssVars,
            fontSize: `${sizeCqw}cqw`,
            padding: config.showBackground ? "0.55em 0.85em" : undefined,
            borderRadius: config.showBackground ? "0.5em" : undefined,
            background: config.showBackground ? config.backgroundColor : undefined,
          }}
        >
          <div
            className="leading-[1.32]"
            style={{
              maxWidth: `${widthCqw}cqw`,
              fontFamily: typeface.primaryFamily,
              fontWeight: Number(typeface.primaryWeight) || typeface.primaryWeight,
              color: config.primaryColor,
              WebkitTextStroke: config.showStroke ? `max(2px, 0.16em) ${config.strokeColor || "#000000"}` : undefined,
              paintOrder: "stroke fill",
              textShadow: config.showShadow ? "0 0.08em 0.32em rgb(0 0 0 / 0.55)" : undefined,
            }}
          >
            <SampleText text={sample.primary} keyword={sample.keyword} highlight={config.highlight} highlightColor={config.highlightColor} karaoke={karaoke} />
          </div>
          {config.bilingual && (
            <div
              className="leading-[1.28]"
              style={{
                maxWidth: `${widthCqw}cqw`,
                marginTop: "0.4em",
                fontSize: "0.62em",
                fontFamily: typeface.secondaryFamily,
                fontWeight: Number(typeface.secondaryWeight) || typeface.secondaryWeight,
                color: config.highlightColor,
                WebkitTextStroke: config.showStroke ? "max(1.5px, 0.15em) rgb(0 0 0 / 0.8)" : undefined,
                paintOrder: "stroke fill",
                textShadow: config.showShadow ? "0 0.13em 0.52em rgb(0 0 0 / 0.55)" : undefined,
              }}
            >
              {sample.secondary}
            </div>
          )}
        </div>
      </div>
      {animated && (
        <button
          type="button"
          onClick={onReplay}
          className={`absolute top-2.5 right-2.5 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-3 text-2xs text-white/80 backdrop-blur-md transition hover:border-white/30 hover:bg-black/55 hover:text-white ${FOCUS_RING}`}
        >
          <Icon name="play" className="size-3" />
          重播
        </button>
      )}
    </div>
  );
}

function FontOption({ font, selected, onSelect }: { font: StudioFont; selected: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const state = studioFontState(font.id);

  // 字体文件按可见性懒加载：收起的列表高度为 0，不会请求；展开并滚动到才加载
  useEffect(() => {
    const element = ref.current;
    if (!element || !font.url) return;
    if (typeof IntersectionObserver === "undefined") {
      void loadStudioFont(font.id);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        if (studioFontState(font.id) === "unloaded") void loadStudioFont(font.id);
      },
      { threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [font.id, font.url]);

  return (
    <button
      ref={ref}
      type="button"
      aria-current={selected || undefined}
      onClick={onSelect}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-control px-3 py-2.5 text-left transition-colors ${FOCUS_RING} ${selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-white" style={{ fontFamily: fontFamilyStack(font) }}>
          {font.name}
        </span>
        <span className="block truncate text-2xs text-text-faint">{font.desc}</span>
      </span>
      {state === "loading" && <Spinner className="size-3 shrink-0 text-text-faint" />}
      {state === "error" && (
        <>
          <span className="size-1.5 shrink-0 rounded-full bg-amber-300" aria-hidden="true" />
          <span className="sr-only">载入失败</span>
        </>
      )}
      {selected && <Icon name="check" className="size-3.5 shrink-0 animate-check-in text-accent" />}
    </button>
  );
}

function FontSelect({
  idPrefix,
  label,
  hint,
  selectedId,
  script,
  open,
  onToggle,
  onSelect,
}: {
  idPrefix: string;
  label: string;
  hint: string;
  selectedId: string;
  script: StudioFontScript;
  open: boolean;
  onToggle: () => void;
  onSelect: (fontId: string) => void;
}) {
  const fonts = fontsForScript(script);
  const selected = studioFontById(selectedId);
  const state = studioFontState(selected.id);
  const listId = `${idPrefix}-list`;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-text">{label}</span>
        <span className="text-2xs text-text-faint">{hint}</span>
      </div>
      <button
        id={`${idPrefix}-trigger`}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
        className={`group w-full cursor-pointer rounded-surface border px-4 py-3 text-left transition-colors ${FOCUS_RING} ${open ? "border-accent/50 bg-white/[0.04]" : "border-line bg-white/[0.02] hover:border-line-strong hover:bg-white/[0.04]"}`}
      >
        <span className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-medium text-white">{selected.name}</span>
            <span className="truncate text-2xs text-text-faint">{selected.desc}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-2xs text-text-muted transition group-hover:text-white">
            {state === "loading" && <Spinner className="mr-1 size-3" />}
            {open ? "收起" : "更换"}
            <Icon name="chevron" className={`size-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </span>
        </span>
        <span className="mt-2 block truncate text-lg leading-snug text-white" style={{ fontFamily: fontFamilyStack(selected) }}>
          {specimenText(script)}
        </span>
      </button>
      {state === "error" && (
        <Alert
          tone="warn"
          size="sm"
          actions={
            <Button size="sm" onClick={() => void retryStudioFont(selected.id)}>
              重试
            </Button>
          }
        >
          载入失败，预览与成片暂用系统字体
        </Alert>
      )}
      <Collapse open={open}>
        <div id={listId} role="group" aria-label={label} className="max-h-72 space-y-0.5 overflow-y-auto rounded-surface border border-line bg-black/25 p-1.5">
          {fonts.map((font) => (
            <FontOption key={font.id} font={font} selected={font.id === selected.id} onSelect={() => onSelect(font.id)} />
          ))}
        </div>
      </Collapse>
    </div>
  );
}

export function SubtitlePanel({ doc, setDoc }: SubtitlePanelProps) {
  const config = doc.settings.subtitle;
  const { toast } = useFeedback();
  const [, setFontTick] = useState(0);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [secondaryPickerOpen, setSecondaryPickerOpen] = useState(false);
  const [translating, setTranslating] = useState<TranslateProgress | null>(null);
  const [stopping, setStopping] = useState(false);
  const [languageMode, setLanguageMode] = useState<TranslationLanguageMode>("auto");
  const [playKey, setPlayKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);

  const language = useMemo(() => inferScriptLanguage(doc.lines.find((line) => line.text.trim())?.text), [doc.lines]);
  const primaryScript: StudioFontScript = language === "en" ? "latin" : "cjk";
  const secondaryFontScript: StudioFontScript = language === "en" ? "cjk" : "latin";
  const selectedFontId = resolveSubtitleFontId(config);
  const secondaryFontId = resolveSecondarySubtitleFontId(config);
  const coverage = useMemo(() => secondaryCoverage(doc.lines), [doc.lines]);
  const maxLinesValue = config.maxLines || 3;
  const maxWidthPercent = Math.round((config.maxWidthRatio || 0.84) * 100);
  const presetMeta = subtitlePresetMeta(config.preset);
  const presetModified = !subtitlePresetMatches(config, config.preset);

  const update = (patch: Partial<SubtitleConfig>) => {
    setDoc((current) => ({ ...current, settings: { ...current.settings, subtitle: { ...current.settings.subtitle, ...patch } } }));
  };

  useEffect(() => subscribeStudioFonts(() => setFontTick((tick) => tick + 1)), []);
  useEffect(() => {
    void loadStudioFont(selectedFontId);
    // 副字体只在双语开启时才需要，关闭时不去下载
    if (config.bilingual) void loadStudioFont(secondaryFontId);
  }, [selectedFontId, secondaryFontId, config.bilingual]);
  useEffect(() => {
    if (!fontPickerOpen && !secondaryPickerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFontPickerOpen(false);
        setSecondaryPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fontPickerOpen, secondaryPickerOpen]);

  useEffect(() => {
    return () => {
      genRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const applyFont = (slot: "primary" | "secondary", fontId: string) => {
    const font = studioFontById(fontId);
    if (slot === "primary") {
      setFontPickerOpen(false);
      if (font.id === selectedFontId) return;
      update({ fontId: font.id, fontFamily: fontFamilyStack(font) });
    } else {
      setSecondaryPickerOpen(false);
      if (font.id === secondaryFontId) return;
      update({ secondaryFontId: font.id });
    }
    // 切换成功时列表项的对勾与触发器名称已经更新，不再弹 toast；只在载入失败时提示
    if (!font.url || isStudioFontReady(font.id)) return;
    const label = slot === "primary" ? "口播字体" : "翻译字体";
    void loadStudioFont(font.id).then((ok) => {
      if (!ok) toast(`${label}载入失败：${font.name}，预览暂用系统字体`, "error");
    });
  };

  const handlePresetSelect = (preset: SubtitlePreset) => {
    setDoc((current) => ({ ...current, settings: { ...current.settings, subtitle: { ...current.settings.subtitle, ...subtitlePresetUpdates(preset) } } }));
  };

  const handleStopTranslate = () => {
    if (!translating || stopping) return;
    abortRef.current?.abort();
    setStopping(true);
  };

  const handleBackfill = async () => {
    if (translating) return;
    const modelId = doc.modelId || doc.settings.modelId;
    if (!modelId) {
      toast("请先在「设置」里选择并启用一个文本模型，再生成翻译", "error");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++genRef.current;
    setTranslating({ done: 0, total: 0 });
    setStopping(false);
    try {
      const result = await translateLinesSecondary(doc.lines, {
        modelId,
        mode: languageMode,
        signal: controller.signal,
        onProgress: (progress) => {
          if (genRef.current === generation) setTranslating(progress);
        },
      });
      if (genRef.current !== generation) return;
      if (result.translated > 0) {
        setDoc((current) => ({ ...current, lines: mergeSecondaryResults(current.lines, result.results) }));
      }
      const missed = result.failed.length + result.skipped.length;
      if (result.aborted) {
        toast(`已停止，已完成的 ${result.translated} 句翻译已保留`, "info");
      } else if (result.translated > 0) {
        toast(
          missed > 0 ? `已补齐 ${result.translated} 句翻译，${missed} 句未译出，可再点一次` : `已补齐 ${result.translated} 句翻译`,
          missed > 0 ? "info" : "success",
        );
      } else {
        toast(result.error || "翻译没生成出来，请检查模型设置", "error");
      }
    } catch (e) {
      if (genRef.current !== generation) return;
      if (controller.signal.aborted) {
        toast("已停止，已完成的翻译已保留", "info");
        return;
      }
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      if (genRef.current === generation) {
        abortRef.current = null;
        setTranslating(null);
        setStopping(false);
      }
    }
  };

  // 进度条：翻译中按本批进度；总数未知时用脉冲表示「正在进行」；空闲时表示已确认的译文占比
  const translatingIndeterminate = translating !== null && translating.total === 0;
  const barPercent = translating
    ? translating.total > 0
      ? (translating.done / translating.total) * 100
      : 30
    : coverage.total > 0
      ? (coverage.fresh / coverage.total) * 100
      : 0;

  return (
    <div className="text-sm text-text-secondary">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-medium text-white">
            <Icon name="edit" className="size-4 text-accent" />
            字幕样式
          </h2>
          <p className="mt-1 text-2xs text-text-faint">预览与成片共用同一份配置</p>
        </div>
        <Toggle compact label="启用字幕" checked={config.enabled} onChange={(enabled) => update({ enabled })} />
      </div>

      <div className={`transition-opacity duration-200 ${config.enabled ? "" : "opacity-40"}`} aria-disabled={!config.enabled} inert={!config.enabled}>
        <div className="pt-4">
          <SubtitleStage config={config} script={primaryScript} playKey={playKey} onReplay={() => setPlayKey((key) => key + 1)} />
        </div>

        <Section title="样式预设">
          <div role="group" aria-label="样式预设" className="grid grid-cols-3 gap-2">
            {SUBTITLE_PRESETS.map((preset) => {
              const selected = config.preset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  title={preset.desc}
                  onClick={() => handlePresetSelect(preset.id)}
                  className={`group cursor-pointer rounded-control border p-1.5 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 ${FOCUS_RING} ${
                    selected ? "border-accent/60 bg-accent/[0.06] ring-1 ring-accent/30" : "border-line bg-white/[0.02] hover:border-line-strong hover:bg-white/[0.04]"
                  }`}
                >
                  <PresetSwatch look={subtitlePresetUpdates(preset.id)} />
                  <span className="mt-2 flex items-center justify-between gap-1 px-1 pb-0.5">
                    <span className={`truncate text-xs transition ${selected ? "text-white" : "text-text-secondary group-hover:text-white"}`}>{preset.name}</span>
                    {selected && <Icon name="check" className="size-3.5 shrink-0 animate-check-in text-accent" />}
                  </span>
                </button>
              );
            })}
          </div>
          <p className={`text-2xs leading-relaxed ${presetModified ? "text-amber-300" : "text-text-faint"}`}>
            {presetModified ? `已手动调整「${presetMeta.name}」，点击卡片恢复预设` : presetMeta.desc}
          </p>
        </Section>

        <Section title="字体与字号">
          <FontSelect
            idPrefix="subtitle-font"
            label="口播字体"
            hint={primaryScript === "latin" ? "西文" : "中文"}
            selectedId={selectedFontId}
            script={primaryScript}
            open={fontPickerOpen}
            onToggle={() => {
              setFontPickerOpen((open) => !open);
              setSecondaryPickerOpen(false);
            }}
            onSelect={(fontId) => applyFont("primary", fontId)}
          />
          <SliderRow
            label="基准字号"
            note="以 950px 宽画面为基准"
            valueText={`${config.fontSize}px`}
            value={config.fontSize}
            min={18}
            max={48}
            onChange={(fontSize) => update({ fontSize })}
          />
        </Section>

        <Section
          title="双语字幕"
          meta={config.bilingual ? undefined : "主行口播，副行翻译"}
          open={config.bilingual}
          action={<Toggle compact label="双语字幕" checked={config.bilingual} onChange={(bilingual) => update({ bilingual })} />}
        >
          <FontSelect
            idPrefix="subtitle-font-secondary"
            label="翻译字体"
            hint={secondaryFontScript === "latin" ? "西文" : "中文"}
            selectedId={secondaryFontId}
            script={secondaryFontScript}
            open={secondaryPickerOpen}
            onToggle={() => {
              setSecondaryPickerOpen((open) => !open);
              setFontPickerOpen(false);
            }}
            onSelect={(fontId) => applyFont("secondary", fontId)}
          />

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-text">原文语言</span>
              <span className="text-2xs text-text-faint">仅影响翻译请求</span>
            </div>
            <Segmented label="原文语言方向" value={languageMode} options={LANGUAGE_OPTIONS} onChange={setLanguageMode} />
            <p className="text-2xs text-text-faint">逐句识别，低置信度的句子会跳过；整稿只有一种语言时可手动指定</p>
          </div>

          {(coverage.total > 0 || translating) && (
            <div className="space-y-3 rounded-surface border border-line bg-white/[0.02] p-3.5">
              <div className="flex items-center justify-between gap-3 text-2xs">
                <span className="text-text-muted">
                  已确认 <span className="font-mono text-white">{coverage.fresh}/{coverage.total}</span> 句
                </span>
                {!translating && coverage.stale > 0 && (
                  <span className="text-amber-300" title="旧译文没有校验哈希，补齐后才会生效">
                    {coverage.stale} 句待更新
                  </span>
                )}
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full bg-accent transition-[width] duration-500 ease-out ${translatingIndeterminate ? "animate-pulse" : ""}`}
                  style={{ width: `${barPercent}%` }}
                />
              </div>
              {translating ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-xs text-text-secondary">
                    <Spinner className="size-3.5 shrink-0" />
                    <span className="truncate">
                      正在翻译 <span className="font-mono">{translating.done}/{translating.total}</span> 句
                    </span>
                  </span>
                  <Button size="sm" disabled={stopping} icon={<Icon name="stop" className="size-3" />} onClick={handleStopTranslate}>
                    {stopping ? "正在停止" : "停止"}
                  </Button>
                </div>
              ) : coverage.stale > 0 ? (
                <Button className="w-full border-accent/40 text-accent hover:border-accent hover:bg-accent/10 hover:text-accent" icon={<Icon name="wand" className="size-3.5" />} onClick={() => void handleBackfill()}>
                  补齐翻译 · {coverage.stale} 句
                </Button>
              ) : null}
            </div>
          )}
        </Section>

        <Section title="位置与排版" meta="长句自动折行、缩小字号">
          <SliderRow label="垂直位置" note="字幕中心距顶部" valueText={`${config.positionY}%`} value={config.positionY} min={20} max={90} onChange={(positionY) => update({ positionY })} />
          <SliderRow
            label="排版宽度"
            note="占画面宽度"
            valueText={`${maxWidthPercent}%`}
            value={maxWidthPercent}
            min={70}
            max={92}
            onChange={(value) => update({ maxWidthRatio: value / 100 })}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-text">最多行数</span>
            <Segmented label="最多行数" value={maxLinesValue} options={MAX_LINES_OPTIONS.map((lines) => ({ value: lines, label: `${lines} 行` }))} onChange={(maxLines) => update({ maxLines })} />
          </div>
        </Section>

        <Section title="入场动效" meta={config.animation === "none" ? undefined : "点样张右上角可重播"}>
          <Segmented label="入场动效" value={config.animation} options={ANIMATION_OPTIONS} onChange={(animation) => update({ animation })} />
        </Section>

        <Section title="外观">
          <div className="divide-y divide-hairline rounded-surface border border-line bg-white/[0.02] px-4">
            <Toggle label="半透明胶囊底" checked={config.showBackground} onChange={(showBackground) => update({ showBackground })} />
            <Toggle label="文字描边" checked={config.showStroke} onChange={(showStroke) => update({ showStroke })} />
            <Toggle label="文字阴影" checked={config.showShadow} onChange={(showShadow) => update({ showShadow })} />
            <Toggle label="关键词强调" hint="命中的关键词使用强调色" checked={config.highlight} onChange={(highlight) => update({ highlight })} />
          </div>
        </Section>

        <Section title="输出">
          <div className="rounded-surface border border-line bg-white/[0.02] px-4">
            <Toggle label="烤录进成片" hint="关闭后画面不显示字幕，SRT 仍可下载" checked={config.burnIn} onChange={(burnIn) => update({ burnIn })} />
          </div>
        </Section>
      </div>
    </div>
  );
}
