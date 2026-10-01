import { describe, expect, it } from "vitest";
import { applyPresetToDoc, describePresetChanges, extractPresetPayload, presetPayloadSchema, type PresetApplySelection, type PresetPayload } from "./preset";
import { emptyDoc, type ProjectDoc } from "./types";

const allGroups: PresetApplySelection = { groups: ["output", "voice", "subtitle", "music", "style", "publish"] };

function sourceDoc(): ProjectDoc {
  const doc = emptyDoc();
  doc.modelId = "claude";
  doc.settings.modelId = "";
  doc.settings.aspects = ["9:16"];
  doc.settings.outputSpecIds = ["portrait-1080p"];
  doc.settings.previewAspect = "9:16";
  doc.settings.assetFraming = "shared";
  doc.settings.voice = { ...doc.settings.voice, provider: "google-gemini", model: "gemini-tts", voiceId: "Kore", rate: 1.2, granularity: "paragraph" };
  doc.settings.subtitle = { ...doc.settings.subtitle, preset: "neon-cyan", fontSize: 34, bilingual: true, fontId: "wuhan-yingxiong" };
  doc.settings.music = { ...doc.settings.music, enabled: false, gainDb: -6 };
  doc.settings.sfx = { enabled: false };
  doc.settings.aiLabel = { enabled: false, position: "top-left" };
  doc.settings.budgetYuan = 200;
  doc.settings.pauseAfterPreview = true;
  doc.visualStyle = {
    id: "style-neon",
    name: "霓虹夜城",
    description: "",
    medium: "cinematic",
    rendering: "",
    texture: "",
    palette: { schemes: [["#000000", "#111111", "#222222"]], accent: "#22d3ee" },
    colorGrade: "",
    saturation: "mid",
    contrast: "mid",
    lighting: "",
    atmosphere: "",
    moodTweaks: {},
    deniedMoods: [],
    lens: "",
    depthOfField: "shallow",
    composition: "",
    negative: [],
    strength: "normal",
    motion: undefined as never,
    suits: [],
  };
  return doc;
}

function payloadOf(doc: ProjectDoc): PresetPayload {
  return extractPresetPayload(doc);
}

describe("制作预设：提取", () => {
  it("包含 settings 与画面风格快照，顶层 modelId 同步进 settings", () => {
    const payload = payloadOf(sourceDoc());
    expect(payload.settings.aspects).toEqual(["9:16"]);
    expect(payload.settings.modelId).toBe("claude");
    expect(payload.settings.voice.voiceId).toBe("Kore");
    expect(payload.visualStyle?.name).toBe("霓虹夜城");
  });

  it("没有画面风格时快照为 null", () => {
    const doc = emptyDoc();
    expect(payloadOf(doc).visualStyle).toBeNull();
  });
});

describe("制作预设：分组应用", () => {
  it("只勾输出组时其他设置完全不动", () => {
    const target = emptyDoc();
    const payload = payloadOf(sourceDoc());
    const { doc } = applyPresetToDoc(target, payload, { groups: ["output"] });
    expect(doc.settings.aspects).toEqual(["9:16"]);
    expect(doc.settings.assetFraming).toBe("shared");
    expect(doc.settings.voice).toEqual(target.settings.voice);
    expect(doc.settings.subtitle).toEqual(target.settings.subtitle);
    expect(doc.visualStyle).toBeNull();
  });

  it("只勾字幕组时不换配音和风格", () => {
    const target = emptyDoc();
    const payload = payloadOf(sourceDoc());
    const { doc } = applyPresetToDoc(target, payload, { groups: ["subtitle"] });
    expect(doc.settings.subtitle.preset).toBe("neon-cyan");
    expect(doc.settings.subtitle.fontId).toBe("wuhan-yingxiong");
    expect(doc.settings.voice).toEqual(target.settings.voice);
    expect(doc.visualStyle).toBeNull();
  });

  it("全量应用覆盖六组；预算默认不覆盖", () => {
    const target = emptyDoc();
    target.settings.budgetYuan = 50;
    const payload = payloadOf(sourceDoc());
    const { doc } = applyPresetToDoc(target, payload, allGroups);
    expect(doc.settings.voice.voiceId).toBe("Kore");
    expect(doc.settings.subtitle.preset).toBe("neon-cyan");
    expect(doc.settings.music.enabled).toBe(false);
    expect(doc.settings.aiLabel.enabled).toBe(false);
    expect(doc.settings.pauseAfterPreview).toBe(true);
    expect(doc.modelId).toBe("claude");
    expect(doc.visualStyle?.name).toBe("霓虹夜城");
    expect(doc.settings.budgetYuan).toBe(50);
  });

  it("includeBudget 时才覆盖预算（新建项目用）", () => {
    const target = emptyDoc();
    target.settings.budgetYuan = 50;
    const { doc } = applyPresetToDoc(target, payloadOf(sourceDoc()), { groups: ["publish"], includeBudget: true });
    expect(doc.settings.budgetYuan).toBe(200);
  });

  it("画幅变化联动输出规格与预览画幅", () => {
    const target = emptyDoc();
    const payload = payloadOf(sourceDoc());
    const { doc } = applyPresetToDoc(target, payload, { groups: ["output"] });
    expect(doc.settings.outputSpecIds).toEqual(["portrait-1080p"]);
    expect(doc.settings.previewAspect).toBe("9:16");
  });

  it("应用是快照：改预设不影响已应用的文档", () => {
    const target = emptyDoc();
    const payload = payloadOf(sourceDoc());
    const { doc } = applyPresetToDoc(target, payload, { groups: ["subtitle", "style"] });
    payload.settings.subtitle.fontSize = 18;
    payload.visualStyle!.name = "被改掉";
    expect(doc.settings.subtitle.fontSize).toBe(34);
    expect(doc.visualStyle?.name).toBe("霓虹夜城");
  });
});

describe("制作预设：可用性降级", () => {
  it("音色不可用时保留原值并警告", () => {
    const target = emptyDoc();
    const originalVoice = { ...target.settings.voice };
    const { doc, warnings } = applyPresetToDoc(target, payloadOf(sourceDoc()), { groups: ["voice"] }, { availableVoiceIds: new Set(["dashscope::cosyvoice-v3-flash::longanyang"]) });
    expect(doc.settings.voice).toEqual(originalVoice);
    expect(warnings[0]).toContain("音色");
  });

  it("字体不可用时回退系统字体并警告", () => {
    const target = emptyDoc();
    const { doc, warnings } = applyPresetToDoc(target, payloadOf(sourceDoc()), { groups: ["subtitle"] }, { availableFontIds: new Set(["system-cjk"]) });
    expect(doc.settings.subtitle.fontId).toBe("system-cjk");
    expect(warnings[0]).toContain("字体");
  });

  it("文本模型不可用时保留原模型并警告", () => {
    const target = emptyDoc();
    target.modelId = "deepseek";
    const { doc, warnings } = applyPresetToDoc(target, payloadOf(sourceDoc()), { groups: ["publish"] }, { availableModelIds: new Set(["deepseek"]) });
    expect(doc.modelId).toBe("deepseek");
    expect(doc.settings.modelId).toBe(target.settings.modelId);
    expect(warnings[0]).toContain("模型");
  });

  it("不传可用性上下文时不做降级（服务端新建项目场景）", () => {
    const target = emptyDoc();
    const { doc, warnings } = applyPresetToDoc(target, payloadOf(sourceDoc()), allGroups);
    expect(doc.settings.voice.voiceId).toBe("Kore");
    expect(warnings).toEqual([]);
  });
});

describe("制作预设：差异摘要", () => {
  it("只列勾选组的变化", () => {
    const target = emptyDoc();
    const payload = payloadOf(sourceDoc());
    const changes = describePresetChanges(target, payload, { groups: ["subtitle"] });
    expect(changes).toHaveLength(1);
    expect(changes[0].group).toBe("subtitle");
    expect(changes[0].changes.join(" ")).toContain("字幕预设");
  });

  it("预算未勾选时不显示预算变化，勾选后显示", () => {
    const target = emptyDoc();
    const payload = payloadOf(sourceDoc());
    const without = describePresetChanges(target, payload, { groups: ["publish"] });
    expect(without.flatMap((item) => item.changes).join(" ")).not.toContain("预算");
    const withBudget = describePresetChanges(target, payload, { groups: ["publish"], includeBudget: true });
    expect(withBudget.flatMap((item) => item.changes).join(" ")).toContain("预算");
  });

  it("音色不可用时摘要说明会保留当前设置", () => {
    const target = emptyDoc();
    const changes = describePresetChanges(target, payloadOf(sourceDoc()), { groups: ["voice"] }, { availableVoiceIds: new Set<string>() });
    expect(changes[0].changes.join(" ")).toContain("不可用");
  });
});

describe("制作预设：payload schema", () => {
  it("旧预设缺少新字段时补默认值", () => {
    const payload = presetPayloadSchema.parse({ settings: {}, visualStyle: null });
    expect(payload.settings.subtitle.enabled).toBe(true);
    expect(payload.settings.aspects.length).toBeGreaterThan(0);
    expect(payload.visualStyle).toBeNull();
  });
});
