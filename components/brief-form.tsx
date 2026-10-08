"use client";

import { useState } from "react";
import { charsFor, resolveRate } from "@/lib/duration";
import { groundedLevels, slangLevels, type SlangLevel } from "@/lib/memes";
import { speechRateLabels, type Brief, type ModelInfo, type StyleTemplate } from "@/lib/types";
import { AutoTextarea, Field, Icon, Select, Spinner, Switch } from "./ui";

const presets = [3, 5, 10, 15];

type Props = {
  brief: Brief;
  onChange: (patch: Partial<Brief>) => void;
  templates: StyleTemplate[];
  models: ModelInfo[] | null;
  modelId: string;
  onModel: (id: string) => void;
  busy: boolean;
  onOutline: () => void;
  onOneShot: () => void;
  hasScript?: boolean;
  onAngles: () => void;
  autoHumanize: boolean;
  onAutoHumanize: (on: boolean) => void;
  /** 生效的网感档位（auto 已按风格解析） */
  slang: SlangLevel;
  onRepickMemes: () => void;
};

export function BriefForm({ brief, onChange, templates, models, modelId, onModel, busy, onOutline, onOneShot, hasScript = false, onAngles, autoHumanize, onAutoHumanize, slang, onRepickMemes }: Props) {
  const [advanced, setAdvanced] = useState(false);
  const template = templates.find((t) => t.id === brief.templateId);
  const rate = resolveRate(brief.rate, template);
  const ready = brief.title.trim() && modelId;
  const hasSummary = brief.summary.trim().length > 0;

  return (
    <div className="panel space-y-6 p-6">
      <Field label="视频标题">
        <input className="input text-base" value={brief.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="例如：为什么年轻人开始逃离大城市？" />
      </Field>

      <div className="space-y-2">
        <span className="flex items-baseline justify-between">
          <span className="label">
            内容概要 <span className="tracking-normal text-white/25 normal-case">· 选填</span>
          </span>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={onAngles}
            className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-accent/80 transition hover:text-accent disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Icon name="sparkle" className="size-3" />
            {hasSummary ? "按这个方向想角度" : "帮我想角度"}
          </button>
        </span>
        <AutoTextarea
          className="input max-h-72 min-h-28 leading-relaxed"
          value={brief.summary}
          onChange={(e) => onChange({ summary: e.target.value })}
          placeholder={`留空则由 AI 按「${template?.name ?? "所选风格"}」的视角构思选题\n\n也可以写下想讲什么、核心观点、案例或数据……\n例如：房租与收入对比；远程办公兴起；三个返乡创业案例`}
        />
      </div>

      <Field label="目标时长" hint={`≈ ${charsFor(brief.minutes, rate).toLocaleString()} 字 · ${speechRateLabels[rate]}语速`}>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={30}
            step={0.5}
            value={brief.minutes}
            onChange={(e) => onChange({ minutes: Number(e.target.value) })}
            className="h-1 flex-1 cursor-pointer accent-accent"
          />
          <span className="w-20 text-right font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {brief.minutes}
            <span className="ml-1 text-xs font-normal text-white/40">分钟</span>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {presets.map((m) => (
            <button key={m} type="button" onClick={() => onChange({ minutes: m })} className={`chip ${brief.minutes === m ? "chip-on" : ""}`}>
              {m} 分钟
            </button>
          ))}
        </div>
      </Field>

      <div className="space-y-2">
        <span className="flex items-baseline justify-between">
          <span className="label">解说风格</span>
          <a href="/templates" className="text-[11px] text-white/35 transition hover:text-accent">
            管理模板 →
          </a>
        </span>
        <div className="grid grid-cols-2 gap-2">
          {templates.map((t) => {
            const on = t.id === brief.templateId;
            return (
              <button
                key={t.id}
                type="button"
                title={t.sample}
                onClick={() => onChange({ templateId: t.id })}
                className={`group cursor-pointer rounded-2xl border p-3 text-left transition ${
                  on ? "border-accent/60 bg-accent/[0.07] shadow-[inset_0_0_24px_-12px_rgb(205_255_58/0.5)]" : "border-white/[0.07] bg-white/[0.015] hover:border-white/20"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${on ? "text-accent" : "text-white/90"}`}>{t.name}</span>
                  {!t.builtin && <span className="rounded-full bg-white/10 px-1.5 text-[10px] text-white/50">自定义</span>}
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-white/40">{t.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Field label="网感" hint="用多少近期流行的梗；严肃题材建议关">
          <Select value={brief.slang} onChange={(v) => onChange({ slang: v as Brief["slang"] })}>
            <option value="auto">跟随风格（{slangLevels[template?.slang ?? "off"].label}）</option>
            {Object.entries(slangLevels).map(([id, l]) => (
              <option key={id} value={id}>
                {l.label}
                {l.charsPerMeme ? ` · 约每 ${l.charsPerMeme} 字 1 处` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <div className="space-y-2 border-t border-white/[0.06] pt-3">
          <label className="flex items-center justify-between gap-3 text-xs">
            <span>
              <span className="block font-medium text-white/80">接地气表达</span>
              <span className="mt-1 block text-[11px] text-white/40">日常口语、情绪反应和自然的转折句式</span>
            </span>
            <Switch checked={brief.groundedEnabled} onChange={(groundedEnabled) => onChange({ groundedEnabled })} label="使用接地气表达" />
          </label>
          {brief.groundedEnabled && (
            <Field label="接地气力度" hint={`约每 ${groundedLevels[brief.groundedLevel].charsPerExpression} 字 1 处；合适时才用`}>
              <Select value={brief.groundedLevel} onChange={(v) => onChange({ groundedLevel: v as Brief["groundedLevel"] })}>
                {Object.entries(groundedLevels).map(([id, level]) => <option key={id} value={id}>{level.label}</option>)}
              </Select>
            </Field>
          )}
        </div>
        {(slang !== "off" || brief.groundedEnabled) && (
          <div className="flex items-start justify-between gap-3 text-[11px] leading-relaxed">
            <span className="min-w-0 text-white/40">
              {brief.memes === null
                ? "生成前会先挑选本期表达"
                : brief.memes.length === 0
                  ? "这期不用梗库表达"
                  : `本期表达：${brief.memes.slice(0, 6).map((m) => m.term).join("、")}${brief.memes.length > 6 ? ` 等 ${brief.memes.length} 个` : ""}`}
            </span>
            <button type="button" disabled={!ready || busy} onClick={onRepickMemes} className="shrink-0 cursor-pointer text-accent/80 transition hover:text-accent disabled:cursor-not-allowed disabled:opacity-35">
              {brief.memes === null ? "现在挑" : "重新挑"}
            </button>
          </div>
        )}
      </div>

      <div>
        <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex cursor-pointer items-center gap-1.5 text-xs text-white/45 transition hover:text-white">
          <Icon name="chevron" className={`size-3.5 transition ${advanced ? "rotate-180" : ""}`} />
          更多设置
          <span className="text-white/25">受众 · 视角 · 语速 · 必含要点 · 禁用词</span>
        </button>
        {advanced && (
          <div className="mt-4 animate-rise space-y-4">
            <Field label="目标受众">
              <input className="input" value={brief.audience} onChange={(e) => onChange({ audience: e.target.value })} placeholder="例如：刚毕业的职场新人" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="叙述视角">
                <Select value={brief.perspective} onChange={(v) => onChange({ perspective: v as Brief["perspective"] })}>
                  <option value="first">第一人称 UP 主</option>
                  <option value="third">第三人称旁白</option>
                </Select>
              </Field>
              <Field label="语速">
                <Select value={brief.rate} onChange={(v) => onChange({ rate: v as Brief["rate"] })}>
                  <option value="auto">跟随风格{template ? `（${speechRateLabels[template.speechRate]}）` : ""}</option>
                  <option value="slow">舒缓 · 200 字/分</option>
                  <option value="medium">适中 · 250 字/分</option>
                  <option value="fast">紧凑 · 300 字/分</option>
                </Select>
              </Field>
            </div>
            <Field label="必须包含的要点" hint="每行一条">
              <AutoTextarea className="input min-h-16" value={brief.mustInclude} onChange={(e) => onChange({ mustInclude: e.target.value })} />
            </Field>
            <Field label="禁用词 / 避免内容">
              <input className="input" value={brief.avoid} onChange={(e) => onChange({ avoid: e.target.value })} placeholder="例如：竞品名称、绝对化用语" />
            </Field>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-white/[0.06] pt-5">
        {models && models.length === 0 ? (
          <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-relaxed text-amber-200/80">
            未检测到可用模型。请复制 <code className="font-mono">.env.local.example</code> 为 <code className="font-mono">.env.local</code>，填入至少一个 API Key 后重启服务。
          </p>
        ) : (
          <Select value={modelId} onChange={onModel}>
            {models === null && <option>加载模型中…</option>}
            {models?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.model}
              </option>
            ))}
          </Select>
        )}
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="min-w-0">
            <span className="text-white/70">成稿后自动去 AI 味</span>
            <span className="mt-0.5 block text-[11px] text-white/30">只改命中规则的句子，不增删信息</span>
          </span>
          <Switch checked={autoHumanize} onChange={onAutoHumanize} label="成稿后自动去 AI 味" />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-ghost flex-1"
            disabled={!ready || busy}
            onClick={hasSummary ? onOutline : onAngles}
            title={hasSummary ? undefined : "概要为空，先由 AI 构思选题角度"}
          >
            {hasSummary ? "先出大纲" : "先想角度"}
          </button>
          <button type="button" className={`btn flex-[1.4] ${hasScript ? "btn-ghost" : "btn-primary"}`} disabled={!ready || busy} onClick={onOneShot}>
            {busy ? <Spinner /> : <Icon name="sparkle" />}
            {hasScript ? "重新生成全文" : "一键成稿"}
          </button>
        </div>
        {!hasSummary && ready && <p className="text-center text-[11px] text-white/30">概要为空时，一键成稿会自动采用 AI 构思的第一个角度</p>}
      </div>
    </div>
  );
}
