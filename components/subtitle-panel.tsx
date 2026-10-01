"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon, RangeField, SegmentedControl, Spinner, Switch } from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import type { ProjectDoc } from "@/lib/core/types";
import {
  fontsForScript,
  fontFamilyStack,
  isStudioFontReady,
  loadStudioFont,
  resolveSecondarySubtitleFontId,
  resolveSubtitleFontId,
  retryStudioFont,
  studioFontById,
  studioFontState,
  subscribeStudioFonts,
  type StudioFont,
  type StudioFontScript,
} from "@/lib/core/subtitle/fonts";
import { inferScriptLanguage } from "@/lib/core/subtitle/language";
import { mergeSecondaryResults } from "@/lib/core/subtitle/merge";
import { SUBTITLE_PRESETS, subtitlePresetMatches, subtitlePresetUpdates } from "@/lib/core/subtitle/presets";
import { secondaryCoverage, translateLinesSecondary } from "@/lib/core/subtitle/secondary";
import { subtitleAnimationLabels, subtitleAnimations, type SubtitleConfig, type SubtitlePreset } from "@/lib/core/subtitle/types";

/**
 * 字幕排版 & 动画面板 —— 从 AI-Video 字幕模块移植。
 * 预设、字体、字号、位置、动效、智能排版和双语翻译都在这里配置；
 * 改动直接写回项目文档，预览和成片随之刷新。
 */

type SubtitlePanelProps = {
  doc: ProjectDoc;
  setDoc: (fn: (doc: ProjectDoc) => ProjectDoc) => void;
};

type TranslationLanguageMode = "auto" | "zh" | "en";

function specimenText(script: StudioFontScript) {
  return script === "latin" ? "The quick brown fox" : "这是当前字幕字体";
}

const MAX_LINES_OPTIONS: number[] = [2, 3, 4];

function FontSpecimenCard({
  font,
  active = false,
  pickerOpen = false,
  onClick,
  ariaExpanded,
  ariaControls,
  idPrefix = "subtitle-font",
}: {
  font: StudioFont;
  active?: boolean;
  pickerOpen?: boolean;
  onClick: () => void;
  ariaExpanded?: boolean;
  ariaControls?: string;
  idPrefix?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const state = studioFontState(font.id);

  useEffect(() => {
    const element = cardRef.current;
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
    <div
      ref={cardRef}
      className={`overflow-hidden rounded-xl border transition-all ${
        active ? "border-accent/60 bg-white/[0.06] ring-1 ring-accent/30" : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.05]"
      }`}
    >
      <button
        id={`${idPrefix}-${font.id}`}
        type="button"
        onClick={onClick}
        aria-expanded={ariaExpanded}
        aria-controls={ariaControls}
        className="block w-full cursor-pointer text-left"
      >
        <div className="flex items-start justify-between gap-2 px-2.5 pt-2 pb-1.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[11px] font-medium text-white/85">{font.name}</span>
              {active && <span className="shrink-0 rounded border border-emerald-400/30 bg-emerald-400/15 px-1.5 py-px text-[9px] font-semibold text-emerald-300">当前使用</span>}
            </div>
            <p className="mt-0.5 truncate text-[10px] text-white/40">{font.desc}</p>
          </div>
          {active && (
            <span className="flex shrink-0 items-center gap-1 pt-0.5 text-[10px] text-accent">
              {pickerOpen ? "收起" : "更换"}
              <Icon name="chevron" className={`size-3.5 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
            </span>
          )}
        </div>
        <div className="mx-2 mb-2 space-y-1 rounded-lg border border-white/5 bg-black/40 px-3 py-3">
          {state === "ready" && (
            <>
              <p className={`leading-relaxed text-white ${active ? "text-[22px]" : "text-[20px]"}`} style={{ fontFamily: fontFamilyStack(font) }}>
                {specimenText(font.script)}
              </p>
              <p className="text-[11px] leading-relaxed text-white/45" style={{ fontFamily: fontFamilyStack(font) }}>
                {font.script === "latin" ? "字幕 Aa 123" : "Subtitle Aa 123"}
              </p>
            </>
          )}
          {state === "loading" && (
            <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-white/50" role="status">
              <Spinner className="size-3.5" />
              正在载入字体…
            </p>
          )}
          {state === "unloaded" && <p className="text-[11px] leading-relaxed text-white/35">滚动到此处自动载入</p>}
          {state === "error" && (
            <p className="text-[11px] leading-relaxed text-amber-300/90" role="status">
              载入失败，将使用系统字体
            </p>
          )}
        </div>
      </button>
      {state === "error" && (
        <div className="flex justify-end px-2.5 pb-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void retryStudioFont(font.id);
            }}
            className="cursor-pointer rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-200 transition-colors hover:bg-amber-400/20"
          >
            重试
          </button>
        </div>
      )}
    </div>
  );
}

function FontPicker({
  label,
  hint,
  selectedId,
  script,
  open,
  onToggle,
  onSelect,
  idPrefix,
}: {
  label: string;
  hint: string;
  selectedId: string;
  script: StudioFontScript;
  open: boolean;
  onToggle: () => void;
  onSelect: (fontId: string) => void;
  idPrefix: string;
}) {
  const fonts = fontsForScript(script);
  const selected = studioFontById(selectedId);
  const others = fonts.filter((font) => font.id !== selected.id);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="label">{label}</span>
        <span className="text-[10px] text-white/35">{hint}</span>
      </div>
      <FontSpecimenCard font={selected} active pickerOpen={open} onClick={onToggle} ariaExpanded={open} ariaControls={`${idPrefix}-list`} idPrefix={idPrefix} />
      {studioFontState(selected.id) === "error" && (
        <p className="text-[10px] leading-relaxed text-amber-300">当前字体载入失败，预览与成片将使用系统回退字体</p>
      )}
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden" aria-hidden={!open} inert={!open}>
          <div className="space-y-1.5 pt-0.5">
            <p className="px-0.5 text-[10px] text-white/35">点选即用，选完自动收起</p>
            <div id={`${idPrefix}-list`} className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
              {others.map((font) => (
                <FontSpecimenCard key={font.id} font={font} onClick={() => onSelect(font.id)} idPrefix={idPrefix} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SubtitlePanel({ doc, setDoc }: SubtitlePanelProps) {
  const config = doc.settings.subtitle;
  const { toast } = useFeedback();
  const [, setFontTick] = useState(0);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [secondaryPickerOpen, setSecondaryPickerOpen] = useState(false);
  const [translating, setTranslating] = useState<{ done: number; total: number } | null>(null);
  const [stopping, setStopping] = useState(false);
  const [languageMode, setLanguageMode] = useState<TranslationLanguageMode>("auto");
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef(0);

  const language = useMemo(() => inferScriptLanguage(doc.lines.find((line) => line.text.trim())?.text), [doc.lines]);
  const primaryScript: StudioFontScript = language === "en" ? "latin" : "cjk";
  const secondaryFontScript: StudioFontScript = language === "en" ? "cjk" : "latin";
  const selectedFontId = resolveSubtitleFontId(config);
  const secondaryFontId = resolveSecondarySubtitleFontId(config);
  const coverage = useMemo(() => secondaryCoverage(doc.lines), [doc.lines]);
  const maxLinesValue = config.maxLines || 3;
  const maxLinesRefs = useRef(new Map<number, HTMLButtonElement>());

  const update = (patch: Partial<SubtitleConfig>) => {
    setDoc((current) => ({ ...current, settings: { ...current.settings, subtitle: { ...current.settings.subtitle, ...patch } } }));
  };

  const handleMaxLinesKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = MAX_LINES_OPTIONS.indexOf(maxLinesValue);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % MAX_LINES_OPTIONS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + MAX_LINES_OPTIONS.length) % MAX_LINES_OPTIONS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = MAX_LINES_OPTIONS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = MAX_LINES_OPTIONS[nextIndex];
    update({ maxLines: next });
    maxLinesRefs.current.get(next)?.focus();
  };

  useEffect(() => subscribeStudioFonts(() => setFontTick((tick) => tick + 1)), []);
  useEffect(() => {
    void loadStudioFont(selectedFontId);
    void loadStudioFont(secondaryFontId);
  }, [selectedFontId, secondaryFontId]);
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
    const label = slot === "primary" ? "口播字体" : "翻译字体";
    if (!font.url || isStudioFontReady(font.id)) {
      toast(`已切换${label}：${font.name}`, "success");
      return;
    }
    void loadStudioFont(font.id).then((ok) => {
      toast(ok ? `已切换${label}：${font.name}` : `${label}载入失败：${font.name}，预览暂用系统字体`, ok ? "success" : "error");
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

  return (
    <div className="space-y-5 text-sm text-white/75">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-white/90"><Icon name="edit" className="size-4 text-accent" />字幕排版 & 动画动效</p>
          <p className="mt-1 text-xs text-white/40">预览与成片使用同一份配置，改完立即生效</p>
        </div>
        <Switch checked={config.enabled} onChange={(enabled) => update({ enabled })} label="字幕总开关" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 hover:bg-white/[0.05]">
          <input type="checkbox" className="size-3.5 accent-[var(--accent)]" checked={config.burnIn} onChange={(event) => update({ burnIn: event.target.checked })} />
          <span className="text-[11px] text-white/70">烤录进成片</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 hover:bg-white/[0.05]">
          <input type="checkbox" className="size-3.5 accent-[var(--accent)]" checked={config.highlight} onChange={(event) => update({ highlight: event.target.checked })} />
          <span className="text-[11px] text-white/70">关键词强调</span>
        </label>
      </div>

      <div className="space-y-2">
        <p className="label">推荐字幕样式预设</p>
        <div className="grid grid-cols-2 gap-2">
          {SUBTITLE_PRESETS.map((preset) => {
            const selected = config.preset === preset.id;
            const matches = subtitlePresetMatches(config, preset.id);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePresetSelect(preset.id)}
                className={`cursor-pointer rounded-xl border p-2.5 text-left transition-all ${
                  selected ? "border-accent/60 bg-white/[0.06] ring-1 ring-accent/30" : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.05]"
                }`}
              >
                <div className="mb-0.5 flex items-start justify-between gap-1.5">
                  <span className={`truncate text-xs font-semibold ${preset.sampleClass}`}>{preset.name}</span>
                  {selected &&
                    (matches ? (
                      <span className="shrink-0 rounded border border-emerald-400/30 bg-emerald-400/15 px-1.5 py-px text-[9px] font-semibold text-emerald-300">已应用</span>
                    ) : (
                      <span className="shrink-0 rounded border border-amber-400/30 bg-amber-400/15 px-1.5 py-px text-[9px] font-semibold text-amber-300">自定义组合</span>
                    ))}
                </div>
                <div className="line-clamp-1 text-[10px] leading-snug text-white/40">{preset.desc}</div>
                {selected && !matches && <div className="mt-1 text-[9px] leading-snug text-amber-300/90">已手动调整样式，点击卡片重置为该预设</div>}
              </button>
            );
          })}
        </div>
      </div>

      <FontPicker
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
        idPrefix="subtitle-font"
      />
      {config.bilingual && (
        <FontPicker
          label="翻译字体"
          hint={secondaryFontScript === "latin" ? "西文副行" : "中文副行"}
          selectedId={secondaryFontId}
          script={secondaryFontScript}
          open={secondaryPickerOpen}
          onToggle={() => {
            setSecondaryPickerOpen((open) => !open);
            setFontPickerOpen(false);
          }}
          onSelect={(fontId) => applyFont("secondary", fontId)}
          idPrefix="subtitle-font-secondary"
        />
      )}

      <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="block text-xs font-medium text-white/85">双语字幕显示</span>
            <span className="text-[10px] text-white/40">主行是口播语言，副行是翻译</span>
          </div>
          <input type="checkbox" className="size-4 cursor-pointer accent-[var(--accent)]" checked={config.bilingual} onChange={(event) => update({ bilingual: event.target.checked })} />
        </div>
        {config.bilingual && (
          <div className="space-y-1.5 border-t border-white/10 pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-white/45">原文语言方向</span>
              <span className="text-[10px] text-white/30">仅影响翻译请求</span>
            </div>
            <SegmentedControl
              value={languageMode}
              options={[
                { value: "auto", label: "自动按句识别" },
                { value: "zh", label: "统一中文源文" },
                { value: "en", label: "统一英文源文" },
              ]}
              onChange={setLanguageMode}
              label="原文语言方向"
            />
            <p className="text-[10px] leading-relaxed text-white/35">自动模式会逐句识别语言，低置信度句子会被跳过；整稿单一语言时可手动指定方向。</p>
          </div>
        )}
        {config.bilingual && (coverage.total > 0 || translating) && (
          <div className="space-y-1.5 border-t border-white/10 pt-2">
            {coverage.total > 0 && (
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-white/45">
                  已确认 <span className="font-mono text-white/80">{coverage.fresh}/{coverage.total}</span> 句
                </span>
                {coverage.stale > 0 && <span className="text-amber-300">{coverage.stale} 句待更新</span>}
              </div>
            )}
            {translating ? (
              <div className="flex items-center gap-2">
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-white/60">
                  <Spinner className="size-3.5" />
                  <span className="truncate">正在生成翻译… {translating.done}/{translating.total} 句</span>
                </span>
                <button type="button" className="btn btn-ghost btn-sm shrink-0" disabled={stopping} onClick={handleStopTranslate}>
                  <Icon name="stop" className="size-3.5" />
                  {stopping ? "正在停止…" : "停止"}
                </button>
              </div>
            ) : coverage.stale > 0 ? (
              <>
                <p className="text-[10px] text-white/35">无哈希的旧译文会被标记为待更新</p>
                <button type="button" className="btn btn-ghost btn-sm w-full" onClick={() => void handleBackfill()}>
                  <Icon name="wand" className="size-3.5" />
                  补齐翻译（{coverage.stale} 句）
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>

      <div className="space-y-3 pt-1">
        <div className="space-y-1">
          <RangeField label="基准字号" value={config.fontSize} min={18} max={48} step={1} suffix="px" onChange={(fontSize) => update({ fontSize })} />
          <p className="text-[10px] leading-relaxed text-white/35">以 950px 宽画面为基准，渲染时按实际画幅等比缩放</p>
        </div>
        <RangeField label="垂直位置" value={config.positionY} min={20} max={90} step={1} suffix="%" onChange={(positionY) => update({ positionY })} />

        <p className="label">文字出场动效</p>
        <SegmentedControl
          value={config.animation}
          options={subtitleAnimations.map((animation) => ({ value: animation, label: subtitleAnimationLabels[animation] }))}
          onChange={(animation) => update({ animation })}
          label="文字出场动效"
        />

        <div className="space-y-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="flex items-center gap-1.5 text-xs font-medium text-white/85"><Icon name="sparkle" className="size-3.5 text-amber-400" />智能多行排版 & 防截断</span>
              <span className="text-[10px] text-white/40">过长长句自动自然折行与字号自适应</span>
            </div>
            <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">已激活</span>
          </div>
          <RangeField label="安全排版宽度" value={Math.round((config.maxWidthRatio || 0.84) * 100)} min={70} max={92} step={1} suffix="%" onChange={(value) => update({ maxWidthRatio: value / 100 })} />
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-white/60">最大允许行数</span>
            <div className="flex gap-1" role="radiogroup" aria-label="最大允许行数" onKeyDown={handleMaxLinesKeyDown}>
              {MAX_LINES_OPTIONS.map((lines) => (
                <button
                  key={lines}
                  ref={(element) => {
                    if (element) maxLinesRefs.current.set(lines, element);
                    else maxLinesRefs.current.delete(lines);
                  }}
                  type="button"
                  role="radio"
                  aria-checked={maxLinesValue === lines}
                  tabIndex={maxLinesValue === lines ? 0 : -1}
                  onClick={() => update({ maxLines: lines })}
                  className={`cursor-pointer rounded px-2 py-0.5 text-[10px] font-medium transition-all ${
                    maxLinesValue === lines ? "bg-accent text-black" : "bg-white/[0.06] text-white/55 hover:bg-white/[0.1]"
                  }`}
                >
                  {lines} 行
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 hover:bg-white/[0.05]">
            <input type="checkbox" className="size-3.5 accent-[var(--accent)]" checked={config.showBackground} onChange={(event) => update({ showBackground: event.target.checked })} />
            <span className="text-[11px] text-white/70">半透明胶囊背景</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 hover:bg-white/[0.05]">
            <input type="checkbox" className="size-3.5 accent-[var(--accent)]" checked={config.showStroke} onChange={(event) => update({ showStroke: event.target.checked })} />
            <span className="text-[11px] text-white/70">文字描边</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 hover:bg-white/[0.05]">
            <input type="checkbox" className="size-3.5 accent-[var(--accent)]" checked={config.showShadow} onChange={(event) => update({ showShadow: event.target.checked })} />
            <span className="text-[11px] text-white/70">文字阴影</span>
          </label>
        </div>
      </div>
    </div>
  );
}
