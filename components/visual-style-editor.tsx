"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Alert, AutoTextarea, Button, Field, Icon, SegmentedControl, Select, Spinner } from "@/components/ui";
import { postJson, useImageModels, useTemplates } from "@/lib/client";
import { compilePrompt } from "@/lib/core/prompt-compiler";
import { easingLabels, easingNames, motionPresetIds, motionPresetLabels, motionProfile, type EasingName, type MotionPresetId } from "@/lib/core/motion";
import { resolveStyleCover, type StyleCoverMode, type StyleThumbnail } from "@/lib/core/style-cover";
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

      <Group title="动效" hint="转场和仍由代码绘制的画面会跟着换节奏。重点文字使用镜头上的排版动效">
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

      <Group title="色彩" hint="写进生图提示词，决定画面的调色、饱和度和对比">
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

/**
 * 编译结果预览：同一个测试画面在这个风格和所选情绪下会发给模型什么。
 * 标签与内容分栏对齐；风格段是本面板要看的重点，内容与负面词降低亮度作为背景信息。
 */
export function StylePromptPreview({ value }: { value: VisualStyleInput }) {
  const [mood, setMood] = useState<Mood>("中性");
  const compiled = useMemo(() => compilePrompt({ content: "一位中年人坐在窗边的旧沙发上低头看书", shotSize: "medium", style: { ...value, id: "preview" }, mood }), [value, mood]);
  const rows = [
    { label: "内容", text: compiled.slots.content, tone: "text-white/90" },
    { label: "镜头", text: compiled.slots.camera, tone: "text-white/65" },
    { label: "风格", text: compiled.slots.style, tone: "text-white" },
    { label: "情绪", text: compiled.slots.mood, tone: "text-white/65" },
    { label: "负面", text: compiled.negative.join("、"), tone: "text-white/40" },
  ].filter((row) => row.text);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="label">提示词预览</p>
        <Select aria-label="预览情绪" value={mood} onChange={(v) => setMood(v as Mood)} className="h-8 w-36 py-1 text-xs">
          {moods.map((m) => (
            <option key={m} value={m}>
              情绪：{m}
            </option>
          ))}
        </Select>
      </div>
      <dl className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-surface border border-line bg-black/25 p-4 text-sm leading-6">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="pt-px text-xs text-text-faint">{row.label}</dt>
            <dd className={`min-w-0 break-words ${row.tone}`}>{row.text}</dd>
          </div>
        ))}
      </dl>
      {compiled.moodConflict && (
        <Alert tone="warn" size="sm" role="status">
          这个风格不承载「{compiled.moodConflict}」，会保持风格基调。
        </Alert>
      )}
      <p className="text-xs leading-5 text-text-muted">内容由分镜决定（示例为「{shotSizeLabels.medium}」测试画面），风格只改变怎么画。</p>
    </section>
  );
}

const SAMPLE_SCENES = ["人物中景", "城市全景", "静物特写"] as const;

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
  const percent = Math.round((job?.progress ?? 0) * 100);
  if (models && models.length === 0) return <p className="text-xs text-text-muted">配置生图模型后可以生成样张。</p>;
  return (
    <section className="space-y-3">
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="label">样张</p>
          {models && models.length > 1 && (
            <Select aria-label="生图模型" value={model} onChange={setModelId} className="h-8 w-64 py-1 text-xs">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
      {/* 样张按生图输出的真实画幅（16:9 横屏）排列，不再裁成 4:3 */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {SAMPLE_SCENES.map((scene, i) => (
          <figure key={scene} className="min-w-0">
            <div className="relative aspect-video overflow-hidden rounded-surface border border-line bg-white/[0.03]">
              {assets?.[i] ? (
                <Image src={mediaUrl(assets[i])} alt={`${scene}样张`} fill sizes="(min-width: 640px) 260px, 30vw" unoptimized className="object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-[11px] text-text-faint">{running ? <Spinner className="size-4" /> : "待生成"}</div>
              )}
            </div>
            <figcaption className="mt-1.5 truncate text-xs text-text-muted">{scene}</figcaption>
          </figure>
        ))}
      </div>
      {running && (
        <div className="h-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
        </div>
      )}
      {!assets && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-5 text-text-faint">调用所选生图模型，会产生服务商费用。风格不变时不会重复生成。</p>
          <Button variant="primary" size="sm" icon={<Icon name="sparkle" className="size-3.5" />} loading={running} disabled={!model} onClick={generate}>
            {running ? `生成中 · ${percent}%` : "生成 3 张样张"}
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </section>
  );
}

/**
 * 卡片封面：Aix 官方缩略图优先，否则用已生成样张，都没有则是中性底。
 * frame="portrait" 是 2:3 竖版画框，与 Aix 缩略图（427×640）同比例，用于项目面板首屏；
 * 默认的宽版横条保留给风格库卡片。
 */
export function StyleCover({ style, thumbnail, frame = "wide" }: { style: VisualStyleInput; thumbnail?: StyleThumbnail | null; frame?: "wide" | "portrait" }) {
  const thumbSrc = thumbnail?.src.trim() ?? "";
  const [assets, setAssets] = useState<string[] | null>(null);
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  const signature = JSON.stringify(style);
  useEffect(() => {
    if (thumbSrc) return;
    let cancelled = false;
    postJson<{ assets: string[] | null }>("/api/visual-styles/preview", { style })
      .then((r) => {
        if (cancelled) return;
        setAssets(r.assets ?? null);
        setFetchedFor(signature);
      })
      .catch(() => {
        if (cancelled) return;
        setAssets(null);
        setFetchedFor(signature);
      });
    return () => {
      cancelled = true;
    };
    // 封面只跟风格内容和缩略图走；palette 色值不再决定外观
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, thumbSrc]);
  const ready = !!thumbSrc || fetchedFor === signature;
  const mode = resolveStyleCover({ thumbnail: thumbSrc ? thumbnail : null, samples: ready && !thumbSrc ? assets : null });
  if (frame === "portrait") return <PortraitCover mode={mode} loading={!ready && mode.kind === "neutral"} />;
  if (!ready && mode.kind === "neutral") return <div className="h-28 bg-white/[0.03]" aria-busy="true" />;
  if (mode.kind === "thumbnail") {
    return (
      <div className="relative h-44 bg-white/[0.03]">
        <Image src={mode.src} alt={mode.alt} fill sizes="480px" unoptimized className="object-cover" />
      </div>
    );
  }
  if (mode.kind === "neutral") return <div className="grid h-28 place-items-center bg-white/[0.03] text-xs text-white/30">尚无样张</div>;
  return (
    <div className="grid h-28 grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="relative bg-white/[0.03]">
          {mode.assets[i] ? <Image src={mediaUrl(mode.assets[i])} alt="" fill sizes="160px" unoptimized className="object-cover" /> : null}
        </div>
      ))}
    </div>
  );
}

/** 竖版封面：2:3 画框。没有 Aix 缩略图时，用第一张样张居中裁切（样张本身是横屏 16:9） */
function PortraitCover({ mode, loading }: { mode: StyleCoverMode; loading: boolean }) {
  const frame = "relative aspect-[2/3] w-full overflow-hidden rounded-surface border border-line bg-white/[0.03]";
  if (loading) return <div className={`${frame} animate-pulse motion-reduce:animate-none`} aria-busy="true" />;
  if (mode.kind === "thumbnail") {
    return (
      <div className={frame}>
        <Image src={mode.src} alt={mode.alt} fill sizes="160px" unoptimized className="object-cover" />
      </div>
    );
  }
  if (mode.kind === "samples") {
    return (
      <div className={frame}>
        <Image src={mediaUrl(mode.assets[0])} alt="" fill sizes="160px" unoptimized className="object-cover object-center" />
      </div>
    );
  }
  return <div className={`${frame} grid place-items-center border-dashed text-xs text-text-faint`}>尚无样张</div>;
}
