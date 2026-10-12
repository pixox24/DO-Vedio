import { describe, expect, it } from "vitest";
import { focusVisualWidth } from "./focus";
import { cameraCatalog, filterMotionCatalog, motionCatalog, motionChoices, transitionCatalog } from "./motion-library";
import { motionNoteInputSchema } from "./motion-notes";
import { focusPresetIds, motions, transitionIns } from "./types";

describe("动画库目录", () => {
  it("和渲染用的是同一批配方", () => {
    expect(motionCatalog.map((item) => item.id)).toEqual([...focusPresetIds]);
    expect(motionCatalog.every((item) => item.fit && item.rhythm && item.name)).toBe(true);
  });

  it("样句落在这条动画的字宽里", () => {
    for (const item of motionCatalog) {
      const width = focusVisualWidth(item.sampleText);
      expect(width, item.name).toBeGreaterThanOrEqual(item.width[0]);
      expect(width, item.name).toBeLessThanOrEqual(item.width[1]);
    }
  });

  it("英文小字只有虚焦逐词和墨线压印", () => {
    expect(filterMotionCatalog("english").map((item) => item.id)).toEqual(["blur-slide", "ink-press"]);
  });

  it("短词含竖排，不含虚焦逐词；长句含虚焦逐词", () => {
    const short = filterMotionCatalog("short").map((item) => item.id);
    expect(short).toContain("vertical-arc");
    expect(short).not.toContain("blur-slide");
    expect(filterMotionCatalog("long").map((item) => item.id)).toContain("blur-slide");
  });

  it("数字筛选含数字与留白，不含墨线压印", () => {
    const ids = filterMotionCatalog("number").map((item) => item.id);
    expect(ids).toEqual(["number-space", "time-scale", "three-dots"]);
  });

  it("一个字时，竖排排在虚焦逐词前面，虚焦逐词标字宽不合", () => {
    const choices = motionChoices("见");
    const arc = choices.findIndex((choice) => choice.item.id === "vertical-arc");
    const blurIndex = choices.findIndex((choice) => choice.item.id === "blur-slide");
    expect(arc).toBeGreaterThanOrEqual(0);
    expect(arc).toBeLessThan(blurIndex);
    expect(choices[blurIndex]?.mismatch).toBe(true);
  });

  it("没有文字时不标字宽不合，并且仍是全部", () => {
    const choices = motionChoices("");
    expect(choices.every((choice) => !choice.mismatch)).toBe(true);
    expect(choices).toHaveLength(motionCatalog.length);
  });

  it("运镜和转场用的是现在这几条", () => {
    expect(cameraCatalog.map((item) => item.id)).toEqual([...motions]);
    expect(transitionCatalog.map((item) => item.id)).toEqual([...transitionIns]);
    expect(cameraCatalog.every((item) => item.name && item.fit && item.rhythm)).toBe(true);
    expect(transitionCatalog.every((item) => item.name && item.fit && item.rhythm)).toBe(true);
  });

  it("待做成要求名称和一句话", () => {
    expect(motionNoteInputSchema.safeParse({ name: "  ", summary: "一句", shelf: "text", energy: "low" }).success).toBe(false);
    const parsed = motionNoteInputSchema.safeParse({ name: "推近", summary: "镜头慢慢靠近。", shelf: "camera", energy: "high" });
    expect(parsed.success && parsed.data.link).toBe("");
    expect(motionNoteInputSchema.safeParse({ name: "推近", summary: "镜头慢慢靠近。", link: "x".repeat(501), shelf: "text", energy: "mid" }).success).toBe(false);
  });
});
