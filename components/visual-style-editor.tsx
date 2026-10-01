"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AutoTextarea, Field, Icon, SegmentedControl, Select, Spinner } from "@/components/ui";
import { postJson, useImageModels, useTemplates } from "@/lib/client";
import { compilePrompt } from "@/lib/core/prompt-compiler";
import { easingLabels, easingNames, motionPresetIds, motionPresetLabels, motionProfile, type EasingName, type MotionPresetId } from "@/lib/core/motion";
import { mediaUrl, moods, shotSizeLabels, styleMediumLabels, styleMediums, type Job, type Mood, type VisualStyleInput } from "@/lib/core/types";

/**
 * 视觉风格编辑器：按维度编辑（画风 / 色彩 / 光影氛围 / 质感镜头 / 约束），
 * 右侧实时显示编译出的风格提示词和样张。风格库页面与项目「画面风格」面板共用。
 */

const levelOptions = [
  { value: "low", label: "低" },
  { value: "mid", label: "中" },
  { value: "high", label: "高" },
] as const;
const strengthOptions = [
  { value: "light", label: "轻" },
  { value: "normal", label: "标准" },
  { value: "strong", label: "强" },
] as const;

export function StyleEditor({ value, onChange }: { value: VisualStyleInput; onChange: (next: VisualStyleInput) => void }) {
  const { templates } = useTemplates();
  const set = (patch: Partial<VisualStyleInput>) => onChange({ ...value, ...patch });
  const setScheme = (i: number, j: number, color: string) => set({ palette: { ...value.palette, schemes: value.palette.schemes.map((s, k) => (k === i ? (s.map((c, m) => (m === j ? color : c)) as [string, string, string]) : s)) } });
  return (
    <div className="space-y-6">
      <Group title="基本">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="名称">
            <input className="input" value={value.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="画风">
            <Select value={value.medium} onChange={(v) => set({ medium: v as VisualStyleInput["medium"] })}>
              {styleMediums.map((m) => (
                <option key={m} value={m}>
                  {styleMediumLabels[m]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="一句话描述">
          <input className="input" value={value.description} onChange={(e) => set({ description: e.target.value })} placeholder="适合什么题材" />
        </Field>
        <Field label="风格强度" hint="写实科普类内容建议「轻」，避免风格把信息画歪">
          <SegmentedControl value={value.strength} options={strengthOptions} onChange={(v) => set({ strength: v })} label="风格强度" />
        </Field>
      </Group>

      <Group title="动效" hint="代码画面（信息卡、标题卡）的节奏与质感。选一个基调，再按需微调">
        <Field label="动效基调">
          <Select
            value={value.motion.preset}
            onChange={(v) => set({ motion: motionProfile(v as MotionPresetId) })}
          >
            {motionPresetIds.map((id) => (
              <option key={id} value={id}>
                {motionPresetLabels[id]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="缓动">
            <Select value={value.motion.easing} onChange={(v) => set({ motion: { ...value.motion, easing: v as EasingName } })}>
              {easingNames.map((name) => (
                <option key={name} value={name}>
                  {easingLabels[name]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="入场方向">
            <Select value={value.motion.enterFrom} onChange={(v) => set({ motion: { ...value.motion, enterFrom: v as VisualStyleInput["motion"]["enterFrom"] } })}>
              <option value="below">自下而上</option>
              <option value="side">自侧滑入</option>
              <option value="scale">缩放浮现</option>
              <option value="none">原地淡入</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="幅度" hint="0.3 克制 — 2 张扬">
            <input
              className="input"
              type="number"
              min={0.3}
              max={2}
              step={0.05}
              value={value.motion.energy}
              onChange={(e) => set({ motion: { ...value.motion, energy: Math.max(0.3, Math.min(2, Number(e.target.value) || 0.85)) } })}
            />
          </Field>
          <Field label="圆角">
            <Select value={value.motion.corner} onChange={(v) => set({ motion: { ...value.motion, corner: v as VisualStyleInput["motion"]["corner"] } })}>
              <option value="sharp">直角</option>
              <option value="soft">微圆</option>
              <option value="round">圆润</option>
            </Select>
          </Field>
          <Field label="纹理">
            <Select value={value.motion.texture} onChange={(v) => set({ motion: { ...value.motion, texture: v as VisualStyleInput["motion"]["texture"] } })}>
              <option value="none">无</option>
              <option value="grain">颗粒</option>
              <option value="paper">纸纹</option>
              <option value="scanline">扫描线</option>
            </Select>
          </Field>
        </div>
      </Group>

      <Group title="推荐">
        <Field label="适合的解说风格" hint="新项目会优先推荐">
          <div className="flex flex-wrap gap-1.5">
            {templates.map((t) => {
              const on = value.suits.includes(t.id);
              return (
                <button key={t.id} type="button" className={`chip h-7 px-2.5 ${on ? "chip-on" : ""}`} onClick={() => set({ suits: on ? value.suits.filter((x) => x !== t.id) : [...value.suits, t.id] })}>
                  {t.name}
                </button>
              );
            })}
          </div>
        </Field>
      </Group>

      <Group title="色彩" hint="配色组同时用于信息卡、标题卡等代码画面，让它们和生成画面色调统一">
        <div className="space-y-2">
          {value.palette.schemes.map((scheme, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-12 text-xs text-white/40">配色 {i + 1}</span>
              {scheme.map((color, j) => (
                <ColorInput key={j} value={color} label={["深", "中", "浅"][j]} onChange={(c) => setScheme(i, j, c)} />
              ))}
              <span className="h-7 flex-1 rounded-md" style={{ background: `linear-gradient(130deg, ${scheme[0]}, ${scheme[1]} 65%, ${scheme[2]})` }} />
              {value.palette.schemes.length > 1 && (
                <button type="button" className="text-white/35 hover:text-red-300" aria-label="删除配色" onClick={() => set({ palette: { ...value.palette, schemes: value.palette.schemes.filter((_, k) => k !== i) } })}>
                  <Icon name="trash" className="size-3.5" />
                </button>
              )}
            </div>
          ))}
          {value.palette.schemes.length < 6 && (
            <button type="button" className="text-xs text-white/40 transition hover:text-white" onClick={() => set({ palette: { ...value.palette, schemes: [...value.palette.schemes, value.palette.schemes.at(-1)!] } })}>
              + 再加一组配色
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-12 text-xs text-white/40">强调色</span>
          <ColorInput value={value.palette.accent} label="强调" onChange={(accent) => set({ palette: { ...value.palette, accent } })} />
        </div>
        <Field label="调色">
          <input className="input" value={value.colorGrade} onChange={(e) => set({ colorGrade: e.target.value })} placeholder="如：冷青色调，暗部偏蓝" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="饱和度">
            <SegmentedControl value={value.saturation} options={levelOptions} onChange={(v) => set({ saturation: v })} label="饱和度" />
          </Field>
          <Field label="对比度">
            <SegmentedControl value={value.contrast} options={levelOptions} onChange={(v) => set({ contrast: v })} label="对比度" />
          </Field>
        </div>
      </Group>

      <Group title="光影与氛围">
        <Field label="光影基调">
          <AutoTextarea className="input" value={value.lighting} onChange={(e) => set({ lighting: e.target.value })} placeholder="如：硬朗的单一光源，强烈明暗对比" />
        </Field>
        <Field label="氛围">
          <input className="input" value={value.atmosphere} onChange={(e) => set({ atmosphere: e.target.value })} placeholder="如：神秘、压抑、不安" />
        </Field>
        <MoodTweaks value={value} onChange={set} />
      </Group>

      <Group title="质感与镜头">
        <Field label="渲染方式">
          <input className="input" value={value.rendering} onChange={(e) => set({ rendering: e.target.value })} placeholder="如：手绘插画，柔和的线条和色块" />
        </Field>
        <Field label="质感">
          <input className="input" value={value.texture} onChange={(e) => set({ texture: e.target.value })} placeholder="如：胶片颗粒、宣纸纹理" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="镜头">
            <input className="input" value={value.lens} onChange={(e) => set({ lens: e.target.value })} placeholder="如：35mm 电影镜头" />
          </Field>
          <Field label="景深">
            <SegmentedControl value={value.depthOfField} options={[{ value: "shallow", label: "浅景深" }, { value: "deep", label: "深景深" }] as const} onChange={(v) => set({ depthOfField: v })} label="景深" />
          </Field>
        </div>
        <Field label="构图偏好">
          <input className="input" value={value.composition} onChange={(e) => set({ composition: e.target.value })} placeholder="如：大量留白，主体偏于一角" />
        </Field>
      </Group>

      <Group title="约束">
        <Field label="负面词" hint="每行一条；文字、水印、畸形手等通用负面词会自动加上">
          <AutoTextarea
            className="input min-h-16"
            value={value.negative.join("\n")}
            onChange={(e) => set({ negative: e.target.value.split("\n") })}
            onBlur={(e) => set({ negative: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
          />
        </Field>
      </Group>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-t border-white/[0.06] pt-5 first:border-0 first:pt-0">
      <div>
        <p className="label">{title}</p>
        {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function ColorInput({ value, label, onChange }: { value: string; label: string; onChange: (c: string) => void }) {
  return (
    <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-white/15" title={`${label} ${value}`} style={{ background: value }}>
      <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={value} aria-label={`${label}色`} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** 情绪调制：每种情绪可以在风格范围内微调光影 / 调色 / 氛围，或标记为这个风格不承载 */
function MoodTweaks({ value, onChange }: { value: VisualStyleInput; onChange: (p: Partial<VisualStyleInput>) => void }) {
  const [open, setOpen] = useState<Mood | null>(null);
  const setTweak = (mood: Mood, key: "lighting" | "colorGrade" | "atmosphere", text: string) => {
    const tweak = { ...value.moodTweaks[mood], [key]: text || undefined };
    const empty = !tweak.lighting && !tweak.colorGrade && !tweak.atmosphere;
    const next = { ...value.moodTweaks };
    if (empty) delete next[mood];
    else next[mood] = tweak;
    onChange({ moodTweaks: next });
  };
  return (
    <Field label="情绪调制" hint="句子带有这种情绪时怎样调整光影；「不承载」的情绪会保持风格基调并提示冲突">
      <div className="flex flex-wrap gap-1.5">
        {moods
          .filter((m) => m !== "中性")
          .map((mood) => {
            const denied = value.deniedMoods.includes(mood);
            const tweaked = !!value.moodTweaks[mood];
            return (
              <button key={mood} type="button" className={`chip h-7 px-2.5 ${open === mood ? "chip-on" : ""} ${denied ? "line-through opacity-50" : ""}`} onClick={() => setOpen(open === mood ? null : mood)}>
                {mood}
                {tweaked && <span className="ml-1 size-1.5 rounded-full bg-accent" />}
              </button>
            );
          })}
      </div>
      {open && (
        <div className="mt-3 space-y-2 rounded-lg border border-white/10 p-3">
          <label className="flex items-center gap-2 text-xs text-white/60">
            <input type="checkbox" checked={value.deniedMoods.includes(open)} onChange={(e) => onChange({ deniedMoods: e.target.checked ? [...value.deniedMoods, open] : value.deniedMoods.filter((m) => m !== open) })} />
            这个风格不承载「{open}」
          </label>
          {!value.deniedMoods.includes(open) &&
            (["lighting", "colorGrade", "atmosphere"] as const).map((key) => (
              <input key={key} className="input h-8 py-1.5 text-xs" value={value.moodTweaks[open]?.[key] ?? ""} onChange={(e) => setTweak(open, key, e.target.value)} placeholder={{ lighting: "光影（留空沿用基调）", colorGrade: "调色（留空沿用基调）", atmosphere: "氛围（留空沿用基调）" }[key]} />
            ))}
        </div>
      )}
    </Field>
  );
}

/** 编译结果预览：同一个测试画面在这个风格和所选情绪下会发给模型什么 */
export function StylePromptPreview({ value }: { value: VisualStyleInput }) {
  const [mood, setMood] = useState<Mood>("中性");
  const compiled = useMemo(() => compilePrompt({ content: "一位中年人坐在窗边的旧沙发上低头看书", shotSize: "medium", style: { ...value, id: "preview" }, mood }), [value, mood]);
  const slot = (label: string, text: string, tone = "text-white/70") => text && (
    <p className="text-xs leading-5">
      <span className="text-white/35">{label} · </span>
      <span className={tone}>{text}</span>
    </p>
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="label">提示词预览</p>
        <Select value={mood} onChange={(v) => setMood(v as Mood)} className="h-8 w-36 py-1 text-xs">
          {moods.map((m) => (
            <option key={m} value={m}>
              情绪：{m}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5 rounded-lg border border-white/10 bg-black/20 p-3">
        {slot("内容", compiled.slots.content, "text-white")}
        {slot("镜头", compiled.slots.camera)}
        {slot("风格", compiled.slots.style, "text-accent/90")}
        {slot("情绪", compiled.slots.mood)}
        {slot("负面", compiled.negative.join("、"), "text-white/45")}
      </div>
      {compiled.moodConflict && <p className="text-xs text-amber-200/80">这个风格不承载「{compiled.moodConflict}」，会保持风格基调。</p>}
      <p className="text-[11px] text-white/35">内容由分镜决定（示例为「{shotSizeLabels.medium}」测试画面），风格只改变怎么画。</p>
    </div>
  );
}

/** 样张：3 个固定测试场景，同一风格卡 + 模型只生成一次 */
export function StyleSamples({ value, compact = false }: { value: VisualStyleInput; compact?: boolean }) {
  const models = useImageModels();
  const [modelId, setModelId] = useState("");
  const [assets, setAssets] = useState<string[] | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const model = modelId || models?.[0]?.id || "";
  // 风格改动后防抖查询已有样张（不花钱）
  const signature = JSON.stringify(value);
  const latest = useRef(signature);
  useEffect(() => {
    latest.current = signature;
    if (!model) return;
    const timer = setTimeout(() => {
      postJson<{ assets: string[] | null; job?: Job; lastError?: string | null }>("/api/visual-styles/preview", { style: value, modelId: model })
        .then((r) => {
          if (latest.current !== signature) return;
          setAssets(r.assets ?? null);
          setJob(r.job ?? null);
          setError(r.lastError ?? "");
        })
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, model]);
  // 任务进行中时轮询
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    const timer = setInterval(async () => {
      const next = (await fetch(`/api/jobs/${job.id}`).then((r) => r.json())) as Job;
      setJob(next);
      if (next.status === "succeeded") {
        const r = await postJson<{ assets: string[] | null }>("/api/visual-styles/preview", { style: value, modelId: model });
        setAssets(r.assets ?? null);
      } else if (next.status === "failed" || next.status === "canceled") setError(next.error || "样张生成失败");
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  async function generate() {
    setError("");
    try {
      const r = await postJson<{ assets: string[] | null; job?: Job }>("/api/visual-styles/preview", { style: value, modelId: model, generate: true });
      setAssets(r.assets ?? null);
      setJob(r.job ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const running = !!job && ["queued", "running"].includes(job.status);
  if (models && models.length === 0) return <p className="text-xs text-white/40">配置生图模型后可以生成样张。</p>;
  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex items-center justify-between gap-2">
          <p className="label">样张</p>
          {models && models.length > 1 && (
            <Select value={model} onChange={setModelId} className="h-8 max-w-48 py-1 text-xs">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="relative aspect-[4/3] overflow-hidden rounded-md border border-white/10 bg-white/[0.03]">
            {assets?.[i] ? <Image src={mediaUrl(assets[i])} alt="" fill sizes="200px" unoptimized className="object-cover" /> : <span className="grid h-full place-items-center text-[10px] text-white/25">{["人物中景", "城市全景", "静物特写"][i]}</span>}
          </div>
        ))}
      </div>
      {!assets && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={!model || running} onClick={generate}>
          {running ? <Spinner className="size-3" /> : <Icon name="sparkle" className="size-3.5" />}
          {running ? `生成中 · ${Math.round((job?.progress ?? 0) * 100)}%` : "生成 3 张样张"}
        </button>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}

/** 卡片封面：有样张显示样张，否则显示配色 */
export function StyleCover({ style }: { style: VisualStyleInput }) {
  const [assets, setAssets] = useState<string[] | null>(null);
  useEffect(() => {
    postJson<{ assets: string[] | null }>("/api/visual-styles/preview", { style })
      .then((r) => setAssets(r.assets ?? null))
      .catch(() => setAssets(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(style)]);
  return (
    <div className="grid h-28 grid-cols-3">
      {[0, 1, 2].map((i) =>
        assets?.[i] ? (
          <div key={i} className="relative">
            <Image src={mediaUrl(assets[i])} alt="" fill sizes="160px" unoptimized className="object-cover" />
          </div>
        ) : (
          <div key={i} style={{ background: (() => { const p = style.palette.schemes[i % style.palette.schemes.length]; return `linear-gradient(130deg, ${p[0]}, ${p[1]} 65%, ${p[2]})`; })() }} className="flex items-end p-2">
            {i === 2 && <span className="size-3 rounded-full" style={{ background: style.palette.accent }} />}
          </div>
        ),
      )}
    </div>
  );
}
