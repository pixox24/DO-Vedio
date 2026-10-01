import { z } from "zod";
import { normalizeSettings } from "./output-spec";
import { settingsSchema, visualStyleSchema, type ProjectDoc, type Settings } from "./types";

/**
 * 制作预设 —— 把制作页的全部设置（settings + 画面风格快照）存成可复用的方案。
 *
 * 不变量：
 * - 应用即拷贝：项目保存的是值的快照，之后改预设不会回溯已有项目。
 * - 预设不含内容（文案/角色/分镜/配乐编排）和服务商密钥。
 * - 分组应用：只套用用户勾选的组；预算默认不覆盖，防止换预设意外改变花钱上限。
 * - 可用性降级：音色/模型/字体在当前环境不可用时保留项目原值并给出警告。
 */

export const presetGroupIds = ["output", "voice", "subtitle", "music", "style", "publish"] as const;
export type PresetGroup = (typeof presetGroupIds)[number];

export const presetGroupMeta: Record<PresetGroup, { label: string; hint: string }> = {
  output: { label: "输出与素材", hint: "画幅、预览画幅、素材策略" },
  voice: { label: "配音", hint: "服务商、音色、语速、合成粒度、表达指令" },
  subtitle: { label: "字幕", hint: "字幕样式、字体、动效、双语" },
  music: { label: "配乐与音效", hint: "配乐开关、音量、自动压低、转场音效" },
  style: { label: "画面风格", hint: "风格卡快照（画风、配色、动效基调）" },
  publish: { label: "发布与流程", hint: "AI 标识、预算、样片后暂停、文本模型" },
};

export const presetPayloadSchema = z.object({
  settings: settingsSchema,
  visualStyle: visualStyleSchema.nullable().default(null),
});
export type PresetPayload = z.infer<typeof presetPayloadSchema>;

export const productionPresetSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, "请填写预设名称"),
  description: z.string().default(""),
  payload: presetPayloadSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ProductionPreset = z.infer<typeof productionPresetSchema>;

/** 从项目文档提取预设快照；顶层 modelId 优先于 settings.modelId（文案页用的是顶层） */
export function extractPresetPayload(doc: Pick<ProjectDoc, "settings" | "visualStyle" | "modelId">): PresetPayload {
  const settings = { ...doc.settings };
  if (doc.modelId) settings.modelId = doc.modelId;
  return presetPayloadSchema.parse({ settings, visualStyle: doc.visualStyle });
}

export type PresetApplySelection = {
  groups: PresetGroup[];
  /** 发布组里的预算是否覆盖；默认 false，新建项目时传 true */
  includeBudget?: boolean;
};

export type PresetApplyContext = {
  /** 当前可用的音色：`provider::model::voiceId` */
  availableVoiceIds?: Set<string>;
  /** 当前可用的文本模型 id */
  availableModelIds?: Set<string>;
  /** 当前可用的字幕字体 id（含系统字体） */
  availableFontIds?: Set<string>;
};

export type PresetApplyResult = {
  doc: ProjectDoc;
  warnings: string[];
};

const voiceKey = (voice: Settings["voice"]) => `${voice.provider}::${voice.model}::${voice.voiceId}`;

/** 按勾选的组把预设应用到文档；返回新文档与降级警告，不改动未勾选的组 */
export function applyPresetToDoc(
  doc: ProjectDoc,
  payload: PresetPayload,
  selection: PresetApplySelection,
  context?: PresetApplyContext,
): PresetApplyResult {
  const groups = new Set(selection.groups);
  const warnings: string[] = [];
  let settings: Settings = { ...doc.settings };
  let visualStyle = doc.visualStyle;
  let modelId = doc.modelId;

  if (groups.has("output")) {
    settings = {
      ...settings,
      aspects: [...payload.settings.aspects],
      outputSpecIds: payload.settings.outputSpecIds ? [...payload.settings.outputSpecIds] : undefined,
      previewAspect: payload.settings.previewAspect,
      assetFraming: payload.settings.assetFraming,
    };
  }

  if (groups.has("voice")) {
    const voice = structuredClone(payload.settings.voice);
    if (context?.availableVoiceIds && !context.availableVoiceIds.has(voiceKey(voice))) {
      warnings.push(`预设音色「${voice.voiceId}」当前不可用，已保留项目原配音设置`);
    } else {
      settings = { ...settings, voice };
    }
  }

  if (groups.has("subtitle")) {
    const subtitle = structuredClone(payload.settings.subtitle);
    if (context?.availableFontIds && !context.availableFontIds.has(subtitle.fontId)) {
      warnings.push(`预设字幕字体「${subtitle.fontId}」当前不可用，已回退系统字体`);
      subtitle.fontId = "system-cjk";
      subtitle.fontFamily = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    }
    settings = { ...settings, subtitle };
  }

  if (groups.has("music")) {
    settings = { ...settings, music: structuredClone(payload.settings.music), sfx: { ...payload.settings.sfx } };
  }

  if (groups.has("style")) {
    visualStyle = payload.visualStyle ? structuredClone(payload.visualStyle) : null;
  }

  if (groups.has("publish")) {
    const presetModelId = payload.settings.modelId;
    let nextModelId = presetModelId;
    if (presetModelId && context?.availableModelIds && !context.availableModelIds.has(presetModelId)) {
      warnings.push(`预设文本模型「${presetModelId}」当前不可用，已保留项目原模型`);
      nextModelId = "";
    }
    settings = {
      ...settings,
      aiLabel: { ...payload.settings.aiLabel },
      pauseAfterPreview: payload.settings.pauseAfterPreview,
      ...(nextModelId ? { modelId: nextModelId } : {}),
      ...(selection.includeBudget ? { budgetYuan: payload.settings.budgetYuan } : {}),
    };
    if (nextModelId) modelId = nextModelId;
  }

  // 画幅变化后联动 outputSpecIds / previewAspect，避免出现指向已移除画幅的规格
  settings = normalizeSettings(settings);

  return { doc: { ...doc, settings, visualStyle, modelId }, warnings };
}

export type PresetChange = { group: PresetGroup; label: string; changes: string[] };

const onOff = (value: boolean) => (value ? "开" : "关");

/**
 * 应用前的差异摘要：只列用户看得懂的关键字段变化。
 * 与 applyPresetToDoc 使用同一套分组与降级规则，避免"摘要说会变、实际没变"。
 */
export function describePresetChanges(
  doc: ProjectDoc,
  payload: PresetPayload,
  selection: PresetApplySelection,
  context?: PresetApplyContext,
): PresetChange[] {
  const groups = new Set(selection.groups);
  const out: PresetChange[] = [];

  if (groups.has("output")) {
    const changes: string[] = [];
    const currentAspects = [...doc.settings.aspects].sort().join(" + ");
    const nextAspects = [...payload.settings.aspects].sort().join(" + ");
    if (currentAspects !== nextAspects) changes.push(`画幅 ${currentAspects} → ${nextAspects}`);
    if (doc.settings.assetFraming !== payload.settings.assetFraming) {
      changes.push(`素材策略 ${doc.settings.assetFraming} → ${payload.settings.assetFraming}`);
    }
    if (changes.length) out.push({ group: "output", label: presetGroupMeta.output.label, changes });
  }

  if (groups.has("voice")) {
    const changes: string[] = [];
    const next = payload.settings.voice;
    const unavailable = context?.availableVoiceIds && !context.availableVoiceIds.has(voiceKey(next));
    if (unavailable) {
      changes.push(`音色「${next.voiceId}」不可用，将保留当前设置`);
    } else if (voiceKey(next) !== voiceKey(doc.settings.voice)) {
      changes.push(`音色 ${doc.settings.voice.voiceId} → ${next.voiceId}`);
    }
    if (!unavailable && doc.settings.voice.rate !== next.rate) changes.push(`语速 ${doc.settings.voice.rate}x → ${next.rate}x`);
    if (!unavailable && doc.settings.voice.granularity !== next.granularity) {
      changes.push(`合成粒度 ${doc.settings.voice.granularity === "paragraph" ? "段落" : "逐句"} → ${next.granularity === "paragraph" ? "段落" : "逐句"}`);
    }
    if (changes.length) out.push({ group: "voice", label: presetGroupMeta.voice.label, changes });
  }

  if (groups.has("subtitle")) {
    const changes: string[] = [];
    const next = payload.settings.subtitle;
    if (doc.settings.subtitle.preset !== next.preset) changes.push(`字幕预设 ${doc.settings.subtitle.preset} → ${next.preset}`);
    if (doc.settings.subtitle.fontSize !== next.fontSize) changes.push(`基准字号 ${doc.settings.subtitle.fontSize} → ${next.fontSize}`);
    if (doc.settings.subtitle.animation !== next.animation) changes.push(`动效 ${doc.settings.subtitle.animation} → ${next.animation}`);
    if (doc.settings.subtitle.bilingual !== next.bilingual) changes.push(`双语字幕 ${onOff(doc.settings.subtitle.bilingual)} → ${onOff(next.bilingual)}`);
    if (changes.length) out.push({ group: "subtitle", label: presetGroupMeta.subtitle.label, changes });
  }

  if (groups.has("music")) {
    const changes: string[] = [];
    if (doc.settings.music.enabled !== payload.settings.music.enabled) changes.push(`配乐 ${onOff(doc.settings.music.enabled)} → ${onOff(payload.settings.music.enabled)}`);
    if (doc.settings.music.gainDb !== payload.settings.music.gainDb) changes.push(`配乐音量 ${doc.settings.music.gainDb}dB → ${payload.settings.music.gainDb}dB`);
    if (doc.settings.sfx.enabled !== payload.settings.sfx.enabled) changes.push(`转场音效 ${onOff(doc.settings.sfx.enabled)} → ${onOff(payload.settings.sfx.enabled)}`);
    if (changes.length) out.push({ group: "music", label: presetGroupMeta.music.label, changes });
  }

  if (groups.has("style")) {
    const currentName = doc.visualStyle?.name ?? "未选择";
    const nextName = payload.visualStyle?.name ?? "不指定（沿用推荐）";
    if (currentName !== nextName) out.push({ group: "style", label: presetGroupMeta.style.label, changes: [`画面风格 ${currentName} → ${nextName}`] });
  }

  if (groups.has("publish")) {
    const changes: string[] = [];
    if (doc.settings.aiLabel.enabled !== payload.settings.aiLabel.enabled) changes.push(`AI 标识 ${onOff(doc.settings.aiLabel.enabled)} → ${onOff(payload.settings.aiLabel.enabled)}`);
    if (doc.settings.pauseAfterPreview !== payload.settings.pauseAfterPreview) changes.push(`样片后暂停 ${onOff(doc.settings.pauseAfterPreview)} → ${onOff(payload.settings.pauseAfterPreview)}`);
    if (selection.includeBudget && doc.settings.budgetYuan !== payload.settings.budgetYuan) {
      changes.push(`预算 ${doc.settings.budgetYuan ?? "不设上限"} → ${payload.settings.budgetYuan ?? "不设上限"}`);
    }
    if (changes.length) out.push({ group: "publish", label: presetGroupMeta.publish.label, changes });
  }

  return out;
}
