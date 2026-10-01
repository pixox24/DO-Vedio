import { describe, expect, it } from "vitest";
import { aixFixture } from "../aix/test-fixture";
import { blankShot } from "./shots";
import { assetStale, compilePrompt, compileShotPrompt, filterStyleWords, needsGeneratedImage, shotMood, shotReferenceIds } from "./prompt-compiler";
import { themeOf, defaultTheme } from "./theme";
import { characterCardSchema, emptyDoc, type Line, type VisualStyle } from "./types";

const style = (id: string): VisualStyle => {
  const base = aixFixture({ id, name: id, rendering: id });
  if (id === "ink-guofeng") return aixFixture({ ...base, medium: "ink", rendering: "水墨线条", strength: "strong" });
  if (id === "noir-suspense") return aixFixture({ ...base, lighting: "冷色环境光，高对比光影", colorGrade: "低饱和冷青色调", saturation: "low", contrast: "high", moodTweaks: { 温暖: { lighting: "冷色环境中只有一处暖色灯光" } }, deniedMoods: ["激昂"] });
  if (id === "cinematic-real") return aixFixture({ ...base, medium: "cinematic", lens: "电影镜头", texture: "真实胶片颗粒" });
  return base;
};
const line = (id: string, text: string, mood?: Line["mood"]): Line => ({ id, segmentIndex: 0, text, spans: [], keywords: [], locked: false, mood });

describe("画风词过滤", () => {
  it("去掉质量词和「XX风格」，保留画面内容", () => {
    expect(filterStyleWords("一只攥紧沙子的手，电影感，8K 超高清")).toEqual({ text: "一只攥紧沙子的手", removed: ["电影感", "8K", "超高清"] });
    expect(filterStyleWords("雨夜的街道，赛博朋克风格，霓虹灯").text).toBe("雨夜的街道，霓虹灯");
    expect(filterStyleWords("采用日系画风的少女坐在窗边").text).toBe("少女坐在窗边");
  });

  it("不误伤内容里的名词", () => {
    for (const text of ["墙上挂着一幅油画", "摄影师举起相机", "一阵风吹过麦田", "复古的咖啡馆里坐满了人"]) expect(filterStyleWords(text)).toEqual({ text, removed: [] });
  });
});

describe("提示词编译", () => {
  it("内容在前，风格不改内容；换风格只改风格槽", () => {
    const a = compilePrompt({ content: "清晨的港口", shotSize: "wide", style: style("cinematic-real") });
    const b = compilePrompt({ content: "清晨的港口", shotSize: "wide", style: style("ink-guofeng") });
    expect(a.prompt.startsWith("清晨的港口。全景")).toBe(true);
    expect(a.slots.content).toBe(b.slots.content);
    expect(a.slots.style).not.toBe(b.slots.style);
    expect(a.hash).not.toBe(b.hash);
    expect(b.slots.style).toContain("整体统一为水墨风格");
    expect(a.full).toContain("画面中不要出现：文字、字幕、水印");
    expect(a.negative).toContain("塑料磨皮");
  });

  it("情绪在风格范围内调制；风格不承载的情绪保持基调并提示", () => {
    const noir = style("noir-suspense");
    const warm = compilePrompt({ content: "一间小屋", style: noir, mood: "温暖" });
    expect(warm.slots.style).toContain("冷色环境中只有一处暖色灯光");
    expect(warm.slots.style).not.toContain(noir.lighting);
    expect(warm.slots.mood).toBe("");
    const hyped = compilePrompt({ content: "一间小屋", style: noir, mood: "激昂" });
    expect(hyped.moodConflict).toBe("激昂");
    expect(hyped.slots.style).toContain(noir.lighting);
    // 没定义调制的情绪用通用氛围提示
    expect(compilePrompt({ content: "一间小屋", style: noir, mood: "史诗" }).slots.mood).toBe("氛围宏大壮阔");
  });

  it("调色里已经写了饱和度、光影里写了对比就不重复追加", () => {
    const noir = compilePrompt({ content: "港口", style: style("noir-suspense") });
    expect(noir.slots.style).not.toContain("低饱和度");
    expect(noir.slots.style).not.toContain("高对比度");
    expect(compilePrompt({ content: "港口", style: { ...style("noir-suspense"), colorGrade: "冷青色调" } }).slots.style).toContain("低饱和度");
  });

  it("风格强度决定风格槽的详略", () => {
    const base = style("cinematic-real");
    const light = compilePrompt({ content: "港口", style: { ...base, strength: "light" } });
    const normal = compilePrompt({ content: "港口", style: base });
    expect(light.slots.style.length).toBeLessThan(normal.slots.style.length);
    expect(light.slots.style).not.toContain(base.texture);
    expect(light.slots.camera).not.toContain(base.lens);
  });

  it("没有风格时只有内容、镜头和负面词", () => {
    const c = compilePrompt({ content: "港口", shotSize: "close", style: null });
    expect(c.prompt).toBe("港口。近景");
  });
});

describe("镜头编译", () => {
  const doc = { ...emptyDoc(), visualStyle: style("Aix0001"), lines: [line("a", "他推开门，屋里一个人都没有。", "悬疑"), line("b", "只有桌上一封信。", "忧伤"), line("c", "很短。", "忧伤")] };
  const shot = { ...blankShot("s", "a"), kind: "image" as const, mode: "generate" as const, shotSize: "wide" as const, description: "空荡荡的客厅，电影感" };
  doc.shots = [shot, blankShot("t", "c")];

  it("情绪取覆盖句子里字数最多的", () => {
    expect(shotMood(doc, shot)).toBe("悬疑");
  });

  it("分镜描述会过滤画风词；用户自定义内容原样保留", () => {
    expect(compileShotPrompt(doc, shot).slots.content).toBe("空荡荡的客厅");
    expect(compileShotPrompt(doc, { ...shot, prompt: "电影感的客厅" }).slots.content).toBe("电影感的客厅");
  });

  it("换风格后已生成的图片过期", () => {
    const generated = { ...shot, assetId: "img", assetPromptHash: compileShotPrompt(doc, shot).hash };
    expect(assetStale(doc, generated)).toBe(false);
    expect(assetStale({ ...doc, visualStyle: style("Aix0002") }, generated)).toBe(true);
    expect(assetStale(doc, { ...generated, motion: "pan-left" })).toBe(false);
    // 旧版本生成的素材没有指纹，不算过期
    expect(assetStale({ ...doc, visualStyle: null }, { ...generated, assetPromptHash: undefined })).toBe(false);
  });

  it("信息卡、标题卡、金句卡、上传图片不需要生图", () => {
    expect(needsGeneratedImage(shot)).toBe(true);
    expect(needsGeneratedImage({ ...shot, kind: "placeholder", mode: "motion" })).toBe(false);
    expect(needsGeneratedImage({ ...shot, kind: "title" })).toBe(false);
    expect(needsGeneratedImage({ ...shot, kind: "upload" })).toBe(false);
  });
});

describe("代码画面主题", () => {
  it("由风格卡的配色派生", () => {
    expect(themeOf(null)).toBe(defaultTheme);
    const t = themeOf(style("noir-suspense"));
    expect(t.accent).toBe(style("noir-suspense").palette.accent);
    expect(t.palettes[0]).toEqual(style("noir-suspense").palette.schemes[0]);
  });
});

describe("镜头里的角色", () => {
  const lin = characterCardSchema.parse({ id: "lin", name: "林夏", ageRange: "二十出头", gender: "女性", hair: "齐耳短发", signature: ["红色围巾"], looks: [{ id: "L1", name: "默认", wardrobe: "米色风衣" }, { id: "L2", name: "五年后", wardrobe: "深灰色西装", fromLineId: "b" }], referenceAssetIds: ["up1"], sheet: { portraitAssetId: "p1", turnaroundAssetIds: ["t1", "t2"] } });
  const wang = characterCardSchema.parse({ id: "wang", name: "老王", ageRange: "六十多岁", gender: "男性", sheet: { portraitAssetId: "p2" } });
  const doc = { ...emptyDoc(), visualStyle: style("Aix0001"), characters: [lin, wang], lines: [line("a", "第一句。"), line("b", "五年后。")] };
  const shot = { ...blankShot("s", "a"), kind: "image" as const, mode: "generate" as const, description: "林夏和老王在书店门口说话", characterIds: ["lin", "wang", "missing"] };

  it("人物槽紧跟内容，按镜头位置选造型", () => {
    const early = compileShotPrompt(doc, shot);
    expect(early.slots.characters).toBe("画面人物——林夏：二十出头女性，齐耳短发，红色围巾，穿着米色风衣；老王：六十多岁男性");
    expect(early.prompt.indexOf("画面人物")).toBeGreaterThan(early.prompt.indexOf("书店门口"));
    expect(early.prompt.indexOf("画面人物")).toBeLessThan(early.prompt.indexOf(early.slots.style));
    expect(compileShotPrompt(doc, { ...shot, at: { lineId: "b", char: 0 } }).slots.characters).toContain("深灰色西装");
  });

  it("已不在文案里出场的角色不带入；没有外貌信息只写名字", () => {
    const gone = { ...doc, characters: [{ ...lin, absent: true }, characterCardSchema.parse({ id: "wang", name: "老王" })] };
    expect(compileShotPrompt(gone, shot).slots.characters).toBe("画面人物——老王");
  });

  it("改角色外貌会让用到它的镜头过期", () => {
    const generated = { ...shot, assetId: "img", assetPromptHash: compileShotPrompt(doc, shot).hash };
    expect(assetStale({ ...doc, characters: [{ ...lin, hair: "长卷发" }, wang] }, generated)).toBe(true);
    expect(assetStale({ ...doc, characters: [{ ...lin, personality: "外向" }, wang] }, generated)).toBe(false);
  });

  it("参考图：镜头自己的在前，各角色交错（上传 > 立绘 > 三视图），保证每个角色都有", () => {
    expect(shotReferenceIds(doc, { ...shot, referenceAssetIds: ["own"] })).toEqual(["own", "up1", "p2", "p1", "t1", "t2"]);
    expect(shotReferenceIds(doc, shot, 2)).toEqual(["up1", "p2"]);
  });
});
