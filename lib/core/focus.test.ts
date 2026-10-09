import { describe, expect, it } from "vitest";
import { focusNumbersMatchSource, focusTextFromLegacy, focusVisualWidth, normalizeFocusText, presetWidths, resolveFocusText, selectFocusPreset } from "./focus";
import { blankShot, distributeMotionCards } from "./shots";
import { animationSpecSchema, emptyDoc, focusPresetIds, type FocusPresetId } from "./types";
import { animationHash, buildTimeline } from "./timeline";

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
  });
});
