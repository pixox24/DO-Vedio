import { describe, expect, it } from "vitest";
import { applySubtitlePreset, DEFAULT_SUBTITLE_CONFIG, SUBTITLE_PRESETS, subtitlePresetMatches, subtitlePresetUpdates } from "./presets";
import { subtitleConfigSchema, type SubtitleConfig, type SubtitlePreset } from "./types";

const presetIds: SubtitlePreset[] = ["viral-yellow", "cinematic-bilingual", "glow-capsule", "neon-cyan", "retro-typewriter", "classic-contrast"];

const expectedUpdates: Record<SubtitlePreset, Partial<SubtitleConfig>> = {
  "viral-yellow": {
    primaryColor: "#ffffff",
    highlightColor: "#facc15",
    showBackground: true,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    showStroke: true,
    strokeColor: "#000000",
    animation: "pop",
    bilingual: false,
  },
  "cinematic-bilingual": {
    primaryColor: "#ffffff",
    highlightColor: "#38bdf8",
    showBackground: false,
    showStroke: true,
    strokeColor: "#000000",
    animation: "fade",
    bilingual: true,
  },
  "glow-capsule": {
    primaryColor: "#ffffff",
    highlightColor: "#34d399",
    showBackground: true,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    showStroke: false,
    animation: "pop",
    bilingual: false,
  },
  "neon-cyan": {
    primaryColor: "#22d3ee",
    highlightColor: "#f43f5e",
    showBackground: true,
    backgroundColor: "rgba(5, 5, 16, 0.85)",
    showStroke: true,
    strokeColor: "#083344",
    animation: "karaoke",
    bilingual: false,
  },
  "retro-typewriter": {
    primaryColor: "#ffedd5",
    highlightColor: "#fb923c",
    showBackground: true,
    backgroundColor: "rgba(41, 20, 5, 0.8)",
    showStroke: false,
    animation: "fade",
    bilingual: false,
  },
  "classic-contrast": {
    primaryColor: "#ffffff",
    highlightColor: "#ffffff",
    showBackground: true,
    backgroundColor: "rgba(0, 0, 0, 0.9)",
    showStroke: false,
    animation: "none",
    bilingual: false,
  },
};

function presetMeta(id: SubtitlePreset) {
  const meta = SUBTITLE_PRESETS.find((item) => item.id === id);
  if (!meta) throw new Error(`missing preset meta: ${id}`);
  return meta;
}

function configFor(preset: SubtitlePreset): SubtitleConfig {
  return applySubtitlePreset(DEFAULT_SUBTITLE_CONFIG, preset);
}

describe("字幕预设配置", () => {
  it.each(presetIds)("%s 的关键字段与配置一致", (preset) => {
    expect(subtitlePresetUpdates(preset)).toMatchObject({ preset, ...expectedUpdates[preset] });
  });

  it("预设不覆盖开关、字体与位置等用户偏好字段", () => {
    for (const preset of presetIds) {
      const updates = subtitlePresetUpdates(preset);
      for (const key of ["enabled", "burnIn", "fontId", "secondaryFontId", "fontSize", "positionY"] as const) {
        expect(updates, `${preset}.${key}`).not.toHaveProperty(key);
      }
    }
  });

  it("六套预设的元数据完整且 id/name 唯一", () => {
    expect(SUBTITLE_PRESETS).toHaveLength(6);
    expect(new Set(SUBTITLE_PRESETS.map((preset) => preset.id)).size).toBe(6);
    expect(new Set(SUBTITLE_PRESETS.map((preset) => preset.name)).size).toBe(6);
    for (const preset of SUBTITLE_PRESETS) {
      expect(preset.name.trim().length).toBeGreaterThan(0);
      expect(preset.desc.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("预设文案与效果一致", () => {
  it("赛博霓虹不再承诺无法兑现的外发光，描述与实际配色一致", () => {
    const neon = presetMeta("neon-cyan");
    expect(neon.name).not.toMatch(/发光/);
    expect(neon.desc).not.toMatch(/发光/);
    expect(neon.desc).toContain("青色");
    expect(neon.desc).toContain("粉");
    expect(subtitlePresetUpdates("neon-cyan")).toMatchObject({ primaryColor: "#22d3ee", highlightColor: "#f43f5e", backgroundColor: "rgba(5, 5, 16, 0.85)" });
  });

  it("复古打字机不再承诺等宽字体，描述与实际底衬一致", () => {
    const retro = presetMeta("retro-typewriter");
    expect(retro.desc).not.toMatch(/等宽|机械/);
    expect(retro.desc).toContain("暖橙");
    expect(subtitlePresetUpdates("retro-typewriter")).toMatchObject({ showBackground: true, backgroundColor: "rgba(41, 20, 5, 0.8)", showStroke: false });
  });

  it("保留的预设文案与配置一致", () => {
    expect(presetMeta("viral-yellow").desc).toContain("明黄");
    expect(subtitlePresetUpdates("viral-yellow").highlightColor).toBe("#facc15");
    expect(presetMeta("cinematic-bilingual").desc).toContain("副行");
    expect(subtitlePresetUpdates("cinematic-bilingual").bilingual).toBe(true);
    expect(presetMeta("glow-capsule").desc).toContain("药丸");
    expect(subtitlePresetUpdates("glow-capsule").showBackground).toBe(true);
    expect(presetMeta("classic-contrast").name).toContain("黑底白字");
    expect(presetMeta("classic-contrast").desc).toContain("纯黑底衬");
    expect(subtitlePresetUpdates("classic-contrast").backgroundColor).toBe("rgba(0, 0, 0, 0.9)");
  });
});

describe("subtitlePresetMatches", () => {
  it.each(presetIds)("%s：应用预设后完全匹配", (preset) => {
    expect(subtitlePresetMatches(configFor(preset), preset)).toBe(true);
  });

  it.each(presetIds)("%s：手动改动预设覆盖的颜色/背景/动画后失配", (preset) => {
    const base = configFor(preset);
    const updates = subtitlePresetUpdates(preset);
    const patches: Partial<SubtitleConfig>[] = [
      { primaryColor: "#123456" },
      { highlightColor: "#654321" },
      { animation: base.animation === "none" ? "pop" : "none" },
    ];
    if (updates.showBackground) patches.push({ backgroundColor: "rgba(1, 2, 3, 0.5)" });
    if (updates.showStroke) patches.push({ strokeColor: "#abcdef" });
    for (const patch of patches) {
      expect(subtitlePresetMatches({ ...base, ...patch }, preset)).toBe(false);
    }
  });

  it.each(presetIds)("%s：改动开关/字体/位置等用户偏好仍匹配", (preset) => {
    const base = configFor(preset);
    const tweaked: Partial<SubtitleConfig> = {
      ...base,
      enabled: !base.enabled,
      burnIn: !base.burnIn,
      fontId: "wuhan-yingxiong",
      fontSize: base.fontSize === 40 ? 20 : 40,
      positionY: base.positionY === 30 ? 60 : 30,
      showShadow: !base.showShadow,
    };
    expect(subtitlePresetMatches(tweaked, preset)).toBe(true);
  });

  it("缺失预设覆盖字段（undefined）视为不匹配", () => {
    const partial: Partial<SubtitleConfig> = { ...subtitlePresetUpdates("neon-cyan") };
    delete partial.backgroundColor;
    expect(subtitlePresetMatches(partial, "neon-cyan")).toBe(false);
    expect(subtitlePresetMatches({ ...subtitlePresetUpdates("neon-cyan"), backgroundColor: undefined }, "neon-cyan")).toBe(false);
    expect(subtitlePresetMatches({}, "neon-cyan")).toBe(false);
  });

  it("预设未覆盖的字段不参与比较", () => {
    const base = configFor("cinematic-bilingual");
    expect(subtitlePresetMatches({ ...base, backgroundColor: "rgba(1, 2, 3, 0.9)", showShadow: false }, "cinematic-bilingual")).toBe(true);
    const neon = configFor("neon-cyan");
    expect(subtitlePresetMatches({ ...neon, fontFamily: "custom, sans-serif", maxLines: 2 }, "neon-cyan")).toBe(true);
  });

  it("全新项目的 schema 默认配置匹配 viral-yellow，不会一开局就显示自定义", () => {
    expect(subtitlePresetMatches(subtitleConfigSchema.parse({}), "viral-yellow")).toBe(true);
    expect(subtitlePresetMatches(DEFAULT_SUBTITLE_CONFIG, "viral-yellow")).toBe(true);
  });

  it("跨预设配置不会误判为匹配", () => {
    expect(subtitlePresetMatches(configFor("classic-contrast"), "viral-yellow")).toBe(false);
    expect(subtitlePresetMatches(configFor("retro-typewriter"), "glow-capsule")).toBe(false);
  });
});
