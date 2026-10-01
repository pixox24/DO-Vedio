import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blankShot } from "@/lib/core/shots";
import { emptyDoc, type Line } from "@/lib/core/types";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-storyboard-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const line = (id: string, text: string, segmentIndex = 0): Line => ({ id, segmentIndex, text, spans: [], keywords: [], locked: false });
const lines = [line("a", "全世界每年浪费的粮食，高达十三亿吨。"), line("b", "焦虑，本质上是对失控的恐惧。"), line("c", "原因有三个：成本太高、效率太低、习惯难改。")];
const draft = (over: Record<string, unknown>) => ({ lineId: "a", intent: "", kind: "placeholder" as const, mode: "generate" as const, description: "", motion: "zoom-in" as const, importance: 1, ...over });

describe("分镜草稿转镜头", () => {
  it("信息卡按覆盖的旁白校验，生成画面带景别", async () => {
    const { toShots } = await import("@/lib/pipeline/stages/storyboard");
    const shots = toShots(
      [
        draft({ lineId: "c", mode: "motion", card: { variant: "list", headline: "三个原因", items: ["成本太高", "效率太低", "习惯难改"] } }),
        draft({ lineId: "a", intent: "让观众感到规模之大", mode: "motion", card: { variant: "stat", stat: { value: "十三亿", unit: "吨" } } }),
        draft({ lineId: "b", description: "一只攥紧沙子的手", shotSize: "close" }),
      ],
      lines,
    );
    expect(shots.map((s) => s.at.lineId)).toEqual(["a", "b", "c"]);
    expect(shots[0]).toMatchObject({ mode: "motion", intent: "让观众感到规模之大", card: { variant: "stat", stat: { value: "十三亿", unit: "吨", label: "" } } });
    expect(shots[0].shotSize).toBeUndefined();
    expect(shots[1]).toMatchObject({ mode: "generate", shotSize: "close", card: undefined });
    expect(shots[2].card?.items).toEqual(["成本太高", "效率太低", "习惯难改"]);
  });

  it("编造的数字被拒绝；标题卡和金句卡一律走代码画面", async () => {
    const { toShots } = await import("@/lib/pipeline/stages/storyboard");
    const [stat, title] = toShots([draft({ mode: "motion", card: { variant: "stat", stat: { value: "13", unit: "亿吨" } } }), draft({ lineId: "b", kind: "title", mode: "generate", shotSize: "wide", onScreenText: "焦虑" })], lines);
    expect(stat.card).toBeUndefined();
    expect(title).toMatchObject({ kind: "title", mode: "motion", shotSize: undefined });
  });
});

describe("分镜结果的文案快照", () => {
  it("文案在生成期间变化时不允许把旧范围当成新鲜结果", async () => {
    const { rangeMatchesCurrent } = await import("@/lib/pipeline/stages/storyboard");
    expect(rangeMatchesCurrent(lines, lines, { from: 0, to: 1 })).toBe(true);
    expect(rangeMatchesCurrent(lines, lines.map((line, i) => i === 1 ? { ...line, text: "改过的句子" } : line), { from: 0, to: 1 })).toBe(false);
    expect(rangeMatchesCurrent(lines, lines.map((line, i) => i === 1 ? { ...line, mood: "紧张" as const } : line), { from: 0, to: 1 })).toBe(false);
    expect(rangeMatchesCurrent(lines, [lines[0], lines[2], lines[1]], { from: 1, to: 2 })).toBe(false);
    expect(rangeMatchesCurrent(lines, [lines[0], lines[1], lines[2], line("new", "后来新增")], { from: 0, to: 1 })).toBe(true);
  });
});

describe("局部重做的前后文", () => {
  it("传相邻镜头的画面，而不是只传旁白", async () => {
    const { partialContext } = await import("@/lib/pipeline/stages/storyboard");
    const doc = emptyDoc();
    doc.lines = lines;
    doc.shots = [
      { ...blankShot("s1", "a"), mode: "generate", shotSize: "wide", description: "堆满粮食的仓库" },
      { ...blankShot("s2", "b") },
      { ...blankShot("s3", "c"), mode: "motion", card: { variant: "list", headline: "三个原因" } },
    ];
    expect(partialContext(doc, { from: 1, to: 1 })).toEqual({
      before: { text: "全世界每年浪费的粮食，高达十三亿吨。", shot: "全景，堆满粮食的仓库" },
      after: { text: "原因有三个：成本太高、效率太低、习惯难改。", shot: "信息卡（list：三个原因）" },
    });
  });
});

describe("分镜提示词", () => {
  it("带上概要、解说风格、本章要点和每句情绪", async () => {
    const { storyboardPrompt } = await import("@/lib/prompts");
    const p = storyboardPrompt({
      title: "粮食去哪了",
      brief: { summary: "内容性质：真实科普", audience: "大学生", perspective: "third" },
      style: { name: "硬核科普", description: "讲清原理", tone: "冷静" },
      segments: [{ index: 0, title: "开场", points: "浪费的规模；原因" }],
      lines: [{ id: "a", segmentIndex: 0, text: lines[0].text, ms: 3200, keywords: [], mood: "紧张" }],
    });
    for (const x of ["内容性质：真实科普", "硬核科普", "本章要点：浪费的规模；原因", "(3.2s · 紧张)", "目标受众：大学生"]) expect(p.prompt).toContain(x);
    expect(p.instructions).toContain("先理解，再设计");
  });
});

describe("分镜里的角色", () => {
  it("只保留生成画面里的已知角色，最多 3 个", async () => {
    const { toShots } = await import("@/lib/pipeline/stages/storyboard");
    const known = new Set(["c1", "c2", "c3", "c4"]);
    const [gen, card] = toShots([draft({ lineId: "a", characters: ["c1", "ghost", "c2", "c3", "c4", "c1"] }), draft({ lineId: "b", mode: "motion", characters: ["c1"] })], lines, known);
    expect(gen.characterIds).toEqual(["c1", "c2", "c3"]);
    expect(card.characterIds).toEqual([]);
  });

  it("角色表只给摘要，真实人物注明呈现方式，缺席的不给", async () => {
    const { castForStoryboard } = await import("@/lib/pipeline/stages/storyboard");
    const { characterCardSchema } = await import("@/lib/core/types");
    const doc = emptyDoc();
    doc.characters = [
      characterCardSchema.parse({ id: "c1", name: "林夏", role: "protagonist", ageRange: "二十出头", gender: "女性", signature: ["红色围巾"], hair: "短发" }),
      characterCardSchema.parse({ id: "c2", name: "蔡元培", role: "real", real: true, presentation: "silhouette" }),
      characterCardSchema.parse({ id: "c3", name: "旧角色", absent: true }),
    ];
    expect(castForStoryboard(doc)).toEqual([
      { id: "c1", name: "林夏", role: "主角", brief: "二十出头，女性，红色围巾", presentation: undefined },
      { id: "c2", name: "蔡元培", role: "真实人物", brief: "外貌见角色卡", presentation: "只拍剪影" },
    ]);
  });
});

describe("定妆提示词", () => {
  it("立绘套用风格与身份锚；后续定妆以选定立绘为参考", async () => {
    const { sheetPrompts, sheetReferences } = await import("@/lib/pipeline/stages/character-sheet");
    const { characterCardSchema } = await import("@/lib/core/types");
    const { aixFixture } = await import("@/lib/aix/test-fixture");
    const card = characterCardSchema.parse({ id: "c1", name: "林夏", hair: "短发", looks: [{ id: "L1", name: "默认", wardrobe: "风衣" }, { id: "L2", name: "婚礼", wardrobe: "白色婚纱" }], referenceAssetIds: ["up"] });
    const doc = { visualStyle: aixFixture({ medium: "illustration" }) };
    const portraits = sheetPrompts(doc, card, "portrait", undefined, 4);
    expect(portraits).toHaveLength(4);
    expect(portraits[0].slots.characters).toBe("画面人物——林夏：短发，穿着风衣");
    expect(portraits[0].slots.style).toContain("插画");
    // 定妆照不继承构图、镜头和光影氛围，保证背景干净
    expect(portraits[0].slots.style).not.toContain(aixFixture().lighting);
    expect(portraits[0].slots.style).not.toContain(aixFixture().atmosphere);
    expect(portraits[0].slots.camera).toBe("中景");
    expect(sheetPrompts(doc, card, "turnaround").map((p) => p.name)).toEqual(["正面", "侧面", "背面"]);
    expect(sheetPrompts(doc, card, "look", "L2")[0].slots.characters).toContain("白色婚纱");
    expect(sheetReferences(card, "portrait")).toEqual(["up"]);
    expect(() => sheetReferences(card, "turnaround")).toThrow("请先生成并选定立绘");
    expect(sheetReferences({ ...card, sheet: { ...card.sheet, portraitAssetId: "p" } }, "expressions")).toEqual(["p", "up"]);
  });
});
