import { describe, expect, it } from "vitest";
import { focusColumnUnits, focusNumbersMatchSource, focusSmallCopy, focusStaggerUnits, focusTextFromLegacy, focusVisualWidth, normalizeFocusText, palettePresetIds, presetWidths, recommendedMotionPalette, resolveFocusCaption, resolveFocusText, selectFocusPreset } from "./focus";
import { blankShot, distributeMotionCards } from "./shots";
import { primaryHash } from "./subtitle/secondary";
import { animationSpecSchema, emptyDoc, focusPresetIds, type FocusPresetId } from "./types";
import { animationHash, buildTimeline } from "./timeline";
import { applyLiveTimeline } from "./live-timeline";

describe("统一重点文字", () => {
  it("保留完整短语，不机械截断超长文字", () => {
    expect(normalizeFocusText(" 方向比速度重要。 ")).toBe("方向比速度重要");
    expect(normalizeFocusText("这是一个无法完整显示的观点")).toBeUndefined();
    expect(focusTextFromLegacy({ card: { variant: "quote", headline: "这是一个无法完整显示的观点" } }, ["方向"])?.text).toBe("方向");
    expect(focusTextFromLegacy({ focusText: { text: "人工输入的完整超长观点", layoutMode: "auto" } })?.text).toBe("人工输入的完整超长观点");
    expect(focusVisualWidth("85%")).toBeLessThan(3);
  });

  it("历史卡片变为一个重点，保留数字单位和旧模板 ID", () => {
    expect(focusTextFromLegacy({ card: { variant: "stat", stat: { value: "85", unit: "%", label: "用户留存" } } })).toEqual({ text: "85%", support: "用户留存", layoutMode: "auto" });
    expect(focusTextFromLegacy({ card: { variant: "qa", qa: { question: "为什么", answer: "成本太高" } } })?.text).toBe("成本太高");
    expect(animationSpecSchema.parse({ templateId: "card-qa" }).templateId).toBe("card-qa");
  });

  it("数字必须与原文一致，不匹配相似的数值或丢失单位", () => {
    expect(focusNumbersMatchSource("85%", "留存提高到85%。")).toBe(true);
    expect(focusNumbersMatchSource("95%", "留存提高到85%。")).toBe(false);
    expect(focusNumbersMatchSource("85", "留存提高到85%。")).toBe(false);
    expect(focusNumbersMatchSource("1,000", "有1000人参加")).toBe(true);
  });

  it("探索只匹配合适字宽，结果稳定并避开最近三种方案", () => {
    for (const text of ["见", "留白", "看见不同", "方向比速度重要", "每一次选择都重要", "85%"]) {
      const recent: FocusPresetId[] = [];
      for (let seed = 0; seed < 30; seed++) {
        const context = { text, seed, hasNumber: /\d/.test(text), mode: "shuffle" as const, recentPresetIds: [...recent] };
        const id = selectFocusPreset(context);
        expect(selectFocusPreset(context)).toBe(id);
        expect(recent).not.toContain(id);
        expect(focusPresetIds).toContain(id);
        expect(focusVisualWidth(text)).toBeGreaterThanOrEqual(presetWidths[id][0]);
        expect(focusVisualWidth(text)).toBeLessThanOrEqual(presetWidths[id][1]);
        recent.push(id);
        if (recent.length > 3) recent.shift();
      }
    }
  });

  it("动画盘只在指定的几条里匹配，手动锁定不受限制", () => {
    const palette = recommendedMotionPalette;
    expect(palettePresetIds(null, "见", 0)).toBeUndefined();
    expect(resolveFocusText({ focusText: { text: "过度思考", layoutMode: "auto" } }, [], "", { palette, startMs: 0 })?.presetId).toBe("ink-press");
    expect(resolveFocusText({ focusText: { text: "方向比速度重要", layoutMode: "auto" } }, [], "", { palette, startMs: 16_000 })?.presetId).toBe("blur-slide");
    expect(resolveFocusText({ focusText: { text: "85%", layoutMode: "auto" } }, [], "", { palette, startMs: 0 })?.presetId).toBe("number-space");
    expect(resolveFocusText({ focusText: { text: "见", layoutMode: "auto" } }, [], "", { palette: { opening: ["ink-press"], statement: [], number: [] }, startMs: 1000 })?.presetId).toBe("ink-press");
    expect(resolveFocusText({ focusText: { text: "留白", layoutMode: "auto" } }, [], "", { palette: { opening: [], statement: ["pill"], number: [] }, startMs: 0 })?.presetId).toBe("pill");
    for (let seed = 0; seed < 12; seed++) {
      expect(["pill", "focus"]).toContain(selectFocusPreset({ text: "记住这点", seed, mode: "shuffle", allowedIds: ["pill", "focus"] }));
    }
    expect(resolveFocusText({ focusText: { text: "看见不同", layoutMode: "manual", presetId: "diamond" } }, [], "", { palette, startMs: 0 })?.presetId).toBe("diamond");
  });

  it("手动锁定排版，强调只能选原文片段", () => {
    const shot = { focusText: { text: "看见不同", layoutMode: "manual" as const, presetId: "diamond" as const, emphasis: "不存在" } };
    expect(resolveFocusText(shot, [], "", { seed: 30 })).toMatchObject({ presetId: "diamond", emphasis: undefined });
  });

  it("分散连续文字，只修改本轮生成且未锁定的镜头", () => {
    const shots = Array.from({ length: 5 }, (_, i) => ({ ...blankShot(String(i), String(i)), mode: "motion" as const, focusText: { text: "重点", layoutMode: "auto" as const } }));
    expect(distributeMotionCards(shots).map((shot) => shot.mode)).toEqual(["motion", "generate", "motion", "generate", "motion"]);
    const spaced = distributeMotionCards(shots, new Set(["1", "4"]));
    expect(spaced[0]).toBe(shots[0]);
    expect(spaced[2]).toBe(shots[2]);
    expect(spaced[1].focusText).toBeUndefined();
    expect(distributeMotionCards([shots[0], { ...shots[1], locked: true }])[1].mode).toBe("motion");
  });

  it("旧章节进入统一时间轴，预览与成片同方案，编辑触发渲染哈希变化", () => {
    const doc = emptyDoc();
    doc.lines = [{ id: "a", text: "方向比速度重要。", segmentIndex: 0, spans: [], keywords: ["方向"], locked: false }];
    doc.shots = [{ ...blankShot("s", "a"), kind: "title", onScreenText: "方向" }];
    const artifacts = { tts: new Map(), tracks: new Map(), media: (id: string) => id };
    const t = buildTimeline(doc, artifacts, "16:9");
    expect(t.shots[0].focusText?.text).toBe("方向");
    expect(buildTimeline(doc, artifacts, "9:16").shots[0].focusText?.presetId).toBe(t.shots[0].focusText?.presetId);
    expect(animationHash({ ...t, shots: [{ ...t.shots[0], focusText: { text: "速度", layoutMode: "auto" } }] })).not.toBe(animationHash(t));
    doc.motionPalette = recommendedMotionPalette;
    expect(buildTimeline(doc, artifacts, "16:9").shots[0].focusText?.presetId).toBe("ink-press");
  });

  it("中文按词分组，短句和纯数字保持一段", () => {
    expect(focusStaggerUnits("方向")).toEqual(["方向"]);
    expect(focusStaggerUnits("85%")).toEqual(["85%"]);
    expect(focusStaggerUnits("方向比速度重要")).toEqual(["方向比", "速度", "重要"]);
    expect(focusStaggerUnits("方向比速度重要", "速度")).toEqual(["方向比", "速度", "重要"]);
    expect(focusStaggerUnits("方向比速度重要", "方向")).toEqual(["方向", "比速度重要"]);
    expect(focusColumnUnits("Direction matters more")).toEqual(["Direction", "matters", "more"]);
  });

  it("英文小字只取可用的一行拉丁译文，否则回到中文辅助字", () => {
    const line = { text: "方向比速度重要。", secondaryText: "Direction matters more", secondaryHash: primaryHash("方向比速度重要。") };
    expect(resolveFocusCaption({ presetId: "blur-slide", bilingual: true, line, frameWidth: 1920 })).toBe("Direction matters more");
    expect(resolveFocusCaption({ presetId: "focus", bilingual: true, line, frameWidth: 1920 })).toBeUndefined();
    expect(resolveFocusCaption({ presetId: "blur-slide", bilingual: false, line, frameWidth: 1920 })).toBeUndefined();
    expect(resolveFocusCaption({ presetId: "blur-slide", bilingual: true, line: { ...line, secondaryHash: primaryHash("旧文本") }, frameWidth: 1920 })).toBeUndefined();
    expect(resolveFocusCaption({ presetId: "blur-slide", bilingual: true, line: { text: "方向比速度重要。", secondaryText: "方向更重要", secondaryHash: primaryHash("方向比速度重要。") }, frameWidth: 1920 })).toBeUndefined();
    expect(resolveFocusCaption({ presetId: "ink-press", bilingual: true, line: { text: "Keep the name.", secondaryText: "保留这个名字", secondaryHash: primaryHash("Keep the name.") }, frameWidth: 1920 })).toBeUndefined();
    expect(resolveFocusCaption({ presetId: "ink-press", bilingual: true, line: { ...line, secondaryText: "A".repeat(33) }, frameWidth: 1920 })).toBeUndefined();
    expect(resolveFocusCaption({ presetId: "blur-slide", bilingual: true, line: { ...line, secondaryText: "word ".repeat(16).trim() }, frameWidth: 1920 })).toBeUndefined();
    expect(resolveFocusCaption({ presetId: "blur-slide", bilingual: true, line: { text: "方向比速度重要。", secondaryText: "Direction matters more" }, frameWidth: 1920 })).toBe("Direction matters more");
    expect(focusSmallCopy(undefined, "用户留存")).toBe("用户留存");
    expect(focusSmallCopy("Direction matters more", "用户留存")).toBe("Direction matters more");
  });

  it("双语开着才把译文放进这两条排版，关掉后预览去掉英文小字", () => {
    const doc = emptyDoc();
    doc.settings.subtitle.bilingual = true;
    doc.lines = [{ id: "a", text: "方向比速度重要。", segmentIndex: 0, spans: [], keywords: ["方向"], locked: false, secondaryText: "Direction matters more", secondaryHash: primaryHash("方向比速度重要。") }];
    doc.shots = [{ ...blankShot("s", "a"), mode: "motion", focusText: { text: "方向比速度重要", layoutMode: "manual", presetId: "blur-slide", support: "速度" } }];
    const artifacts = { tts: new Map(), tracks: new Map(), media: (id: string) => id };
    const translated = buildTimeline(doc, artifacts, "16:9");
    expect(translated.shots[0].focusCaption).toBe("Direction matters more");
    expect(translated.shots[0].focusText?.support).toBe("速度");
    const withoutCaption = { ...translated, shots: translated.shots.map((shot) => { const next = { ...shot }; delete next.focusCaption; return next; }) };
    expect(animationHash(translated)).not.toBe(animationHash(withoutCaption));
    doc.shots = [{ ...blankShot("s", "a"), mode: "motion", focusText: { text: "方向比速度重要", layoutMode: "manual", presetId: "focus" } }];
    expect(buildTimeline(doc, artifacts, "16:9").shots[0].focusCaption).toBeUndefined();
    doc.shots = [{ ...blankShot("s", "a"), mode: "motion", focusText: { text: "方向比速度重要", layoutMode: "manual", presetId: "blur-slide", support: "速度" } }];
    doc.settings.subtitle.bilingual = false;
    const hidden = applyLiveTimeline(translated, doc, []);
    expect(hidden.shots[0].focusCaption).toBeUndefined();
    expect(hidden.shots[0].focusText?.support).toBe("速度");
  });
});
