import { describe, expect, it } from "vitest";
import { humanizePrompt, memeSearchPrompt, memeStructurePrompt, normalizeOutlineMemes, outlinePrompt, rewritePrompt, sectionPrompt } from "../prompts";
import { builtinTemplates } from "../templates/builtin";
import type { Brief } from "../types";

const brief: Brief = { title: "测试", summary: "概要", minutes: 3, templateId: "serious", audience: "", perspective: "first", mustInclude: "", avoid: "", rate: "auto", slang: "auto", memes: null };
const t = builtinTemplates[0];

const memes = [{ term: "破防了", variants: [], meaning: "情绪被击中", usage: "当谓语", example: "看到这里我直接破防了", where: "结尾" }];

describe("用梗提示词", () => {
  const sections = [{ title: "开场", points: "a", minutes: 2 }];
  it("网感开启且挑过梗时，写稿提示词只给挑中的梗并限定用量", () => {
    const { instructions } = sectionPrompt({ ...brief, templateId: "humor", slang: "medium", memes }, t, "medium", sections, 0, "");
    expect(instructions).toContain("本章可用的流行梗");
    expect(instructions).toContain("破防了");
    expect(instructions).toContain("本章加起来最多用 1 处梗");
    expect(instructions).toContain("列表外的网络流行语和梗一律不用");
  });
  it("网感关闭、没挑梗或梗已用够次数时不给梗", () => {
    expect(sectionPrompt({ ...brief, slang: "off", memes }, t, "medium", sections, 0, "").instructions).not.toContain("可用的流行梗");
    expect(sectionPrompt({ ...brief, slang: "medium", memes: [] }, t, "medium", sections, 0, "").instructions).not.toContain("流行梗");
    expect(sectionPrompt({ ...brief, slang: "medium", memes }, t, "medium", sections, 0, "", { 破防了: 2 }).instructions).toContain("都已经用够次数了");
  });
  it("写稿只给大纲分给本章的梗", () => {
    const two = [...memes, { term: "班味", variants: [], meaning: "职场习气", usage: "当结论", example: "", where: "" }];
    const b = { ...brief, templateId: "humor", slang: "heavy" as const, memes: two };
    const assigned = sectionPrompt(b, t, "medium", [{ title: "开场", points: "a", minutes: 2, memes: ["班味"] }], 0, "").instructions;
    expect(assigned).toContain("班味");
    expect(assigned).not.toContain("破防了");
    expect(sectionPrompt(b, t, "medium", [{ title: "开场", points: "a", minutes: 2, memes: [] }], 0, "").instructions).toContain("大纲没有给本章分配梗");
  });
  it("大纲提示词让模型分配梗，返回后清洗", () => {
    const b = { ...brief, slang: "medium" as const, memes };
    expect(outlinePrompt(b, t, "medium").prompt).toContain("memes：把下面这些用户选好的梗分配到最搭的章节");
    expect(outlinePrompt({ ...b, slang: "off" }, t, "medium").prompt).not.toContain("memes：");
    expect(normalizeOutlineMemes([{ memes: ["破防了", "乱写的"] }, { memes: ["破防了"] }], b, t, "medium").map((s) => s.memes)).toEqual([["破防了"], []]);
  });
  it("加点梗、去掉梗", () => {
    const b = { ...brief, slang: "medium" as const, memes };
    const add = rewritePrompt(b, t, { action: "addMemes", text: "周一的地铁太挤了。", before: "", after: "" }).prompt;
    expect(add).toContain("自然地用上下面的梗");
    expect(add).toContain("破防了");
    expect(rewritePrompt(b, t, { action: "addMemes", text: "周一。", before: "", after: "", memeUsage: { 破防了: 2 } }).prompt).toContain("本期没有可用的梗");
    const drop = rewritePrompt(b, t, { action: "dropMemes", text: "我直接破防了。", before: "", after: "" }).prompt;
    expect(drop).toContain("换成正常、朴素的说法");
    expect(drop).not.toContain("改写时保留");
  });
  it("去 AI 味把梗库里的过气梗交给检测器", () => {
    expect(humanizePrompt(brief, t, { text: "这招真是早就过气。", before: "", after: "", staleMemes: ["早就过气"] }).prompt).toContain("硬凹网感：「早就过气」");
  });
  it("去 AI 味和改写都要保留原文里用到的梗", () => {
    const b = { ...brief, slang: "medium" as const, memes };
    expect(humanizePrompt(b, t, { text: "我直接破防了。", before: "", after: "" }).instructions).toContain("必须原样保留）：破防了");
    expect(rewritePrompt(b, t, { action: "shrink", text: "我直接破防了。", before: "", after: "" }).prompt).toContain("改写时保留：破防了");
    const serious = { ...t, slang: "off" as const };
    expect(rewritePrompt(b, t, { action: "restyle", restyle: serious, text: "我直接破防了。", before: "", after: "" }).prompt).toContain("去掉这些梗");
  });
});

describe("搜梗提示词", () => {
  it("带上已收录的梗和圈层，整理时要求归圈层", () => {
    const p = memeSearchPrompt("2026年9月28日", { circle: "职场", exclude: ["班味", "摸鱼自洽"] }).prompt;
    expect(p).toContain("「职场」圈层");
    expect(p).toContain("盘点");
    expect(p).toContain("已经收录过了，不要再列：班味、摸鱼自洽");
    expect(memeSearchPrompt("2026年9月28日").prompt).not.toContain("已经收录过了");
    expect(memeStructurePrompt("笔记", "2026年9月28日").prompt).toContain("circle：主要流行的圈层");
  });
});

describe("去 AI 味提示词", () => {
  it("写稿提示词带上预防约束和反矫枉过正清单", () => {
    const { instructions } = sectionPrompt(brief, t, "medium", [{ title: "开场", points: "a", minutes: 3 }], 0, "");
    expect(instructions).toContain("避开 AI 高频写法");
    expect(instructions).toContain("设问、反问");
    expect(instructions).toContain("以风格模板为准");
  });

  it("去 AI 味走白名单规则，并附上检测器定位", () => {
    const { instructions, prompt } = humanizePrompt(brief, t, { text: "说白了，答案是——专注。", before: "", after: "" });
    expect(instructions).toContain("白名单式改写");
    expect(instructions).toContain("信息守恒");
    expect(instructions).toContain("### 1. 翻案腔");
    expect(instructions).toContain("### 11. 段首零主语评论");
    expect(prompt).toContain("「——」");
    expect(prompt).toContain("「说白了」");
  });

  it("rewritePrompt 的 humanize 动作转给去 AI 味提示词", () => {
    const p = rewritePrompt(brief, t, { action: "humanize", text: "这件事没那么复杂。", before: "", after: "" });
    expect(p.instructions).toContain("白名单式改写");
    expect(p.prompt).toContain("没有定位到明显的触发标记");
  });
});
