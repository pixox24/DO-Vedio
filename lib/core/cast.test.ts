import { describe, expect, it } from "vitest";
import { anchorText, castIssues, castSourceHash, decideCharacters, editCharacterField, lookAt, reconcileCharacters, sheetSourceHash, type CastDraft } from "./cast";
import { builtinVisualStyles } from "../visual-styles/builtin";
import { characterCardSchema, emptyDoc, type Line } from "./types";

const line = (id: string, text: string, segmentIndex = 0): Pick<Line, "id" | "text" | "segmentIndex"> => ({ id, text, segmentIndex });
const lines = [line("a", "林夏今年二十三岁，留着齐耳短发。"), line("b", "她又一次站在书店门口。"), line("c", "店主老王抬头看了她一眼。"), line("d", "五年后，林夏已经是出版社的编辑。", 1), line("e", "路过的行人都撑着伞。")];
type C = CastDraft["characters"][number];
const ch = (o: Partial<C>): C => ({ key: "", name: "", kind: "person", role: "supporting", real: false, mentions: [], needsCard: true, reason: "", ...o });

describe("建卡判定", () => {
  const draft: CastDraft = {
    modes: [{ segmentIndex: 0, mode: "story" }],
    characters: [
      ch({ key: "林夏", name: "林夏", role: "protagonist", mentions: ["a", "b", "d", "x"], ageRange: "二十出头", gender: "女性", hair: "齐耳黑色短发", signature: ["红色毛线围巾", "帆布包", "圆框眼镜", "多余的"], explicitFields: ["ageRange", "hair"], inferredFields: ["gender"], looks: [{ name: "默认", wardrobe: "米色风衣" }, { name: "五年后", wardrobe: "深灰色西装", fromLineId: "d" }] }),
      ch({ key: "老王", name: "老王", mentions: ["c"], needsCard: false, reason: "只出现一次" }),
      ch({ key: "行人", name: "行人们", kind: "group", mentions: ["e"] }),
      ch({ key: "路人甲", name: "路人甲", role: "extra", mentions: ["e"] }),
      ch({ key: "虚构", name: "不存在的人", mentions: ["zzz"] }),
      ch({ key: "蔡元培", name: "蔡元培", role: "real", real: true, mentions: ["c", "d"], presentation: "full" }),
    ],
  };
  const { cards, skipped } = decideCharacters(draft, lines);

  it("主角建卡，出场证据只取存在的句子，字段来源按原文 / 推断 / 补全标注", () => {
    const lin = cards.find((c) => c.key === "林夏")!;
    expect(lin.evidence.map((e) => e.lineId)).toEqual(["a", "b", "d"]);
    expect(lin.fieldSources).toMatchObject({ ageRange: "explicit", hair: "explicit", gender: "inferred", signature: "default" });
    expect(lin.signature).toHaveLength(3);
    expect(lin.looks.map((l) => [l.name, l.fromLineId])).toEqual([["默认", undefined], ["五年后", "d"]]);
  });

  it("单次出场的配角看大模型判断；路人、群体、找不到出场句的不建卡", () => {
    expect(cards.map((c) => c.key)).toEqual(["林夏", "蔡元培"]);
    expect(skipped.map((s) => s.name)).toEqual(["老王", "行人们", "路人甲", "不存在的人"]);
    expect(skipped.find((s) => s.name === "路人甲")?.reason).toBe("只出现一次的路人");
  });

  it("「不指定」「未知」这类占位值不当成外貌", () => {
    const { cards } = decideCharacters({ modes: [], characters: [ch({ key: "你", name: "你", role: "archetype", mentions: ["a", "b"], ageRange: "28岁", gender: "不指定", hair: "未知", signature: ["无", "黑色细绳手环"] })] }, lines);
    expect(cards[0]).toMatchObject({ ageRange: "28岁", gender: "", hair: "", signature: ["黑色细绳手环"] });
    expect(anchorText({ ...characterCardSchema.parse({ id: "x" }), ...cards[0] })).toBe("你：28岁，黑色细绳手环");
  });

  it("真实人物不拍正脸", () => {
    expect(cards.find((c) => c.key === "蔡元培")).toMatchObject({ real: true, role: "real", presentation: "back" });
  });
});

describe("对账", () => {
  const base = characterCardSchema.parse({ id: "c1", key: "林夏", name: "林夏", hair: "长发", build: "瘦", fieldSources: { hair: "default" }, looks: [{ id: "L1", name: "默认", wardrobe: "旧" }], sheet: { portraitAssetId: "p" } });
  const decided = decideCharacters({ modes: [], characters: [ch({ key: "林夏", name: "林夏", role: "protagonist", mentions: ["a"], hair: "短发", build: "高挑", looks: [{ name: "默认", wardrobe: "风衣" }] }), ch({ key: "老王", name: "老王", mentions: ["b", "c"] })] }, lines).cards;
  let n = 0;

  it("同一角色更新推断字段，保留用户改过的字段、定妆和造型 ID；新角色追加；消失的标记未出场", () => {
    const edited = editCharacterField(base, "build", "微胖");
    const gone = characterCardSchema.parse({ id: "c2", key: "旧角色", name: "旧角色" });
    const out = reconcileCharacters([edited, gone], decided, () => `new${++n}`);
    const lin = out.find((c) => c.id === "c1")!;
    expect(lin).toMatchObject({ hair: "短发", build: "微胖", absent: false });
    expect(lin.fieldSources.build).toBe("user");
    expect(lin.sheet.portraitAssetId).toBe("p");
    expect(lin.looks[0]).toMatchObject({ id: "L1", wardrobe: "风衣" });
    expect(out.find((c) => c.id === "c2")?.absent).toBe(true);
    expect(out.find((c) => c.key === "老王")?.id).toMatch(/^new/);
  });

  it("锁定的角色原样保留", () => {
    const locked = { ...base, locked: true };
    expect(reconcileCharacters([locked], decided, () => "x")[0]).toEqual(locked);
  });

  it("改掉原文写明的字段会被记住", () => {
    const explicit = { ...base, fieldSources: { hair: "explicit" as const } };
    expect(editCharacterField(explicit, "hair", "长发").overriddenExplicit).toEqual(["hair"]);
    expect(editCharacterField(base, "hair", "卷发").overriddenExplicit).toEqual([]);
  });
});

describe("身份锚", () => {
  const card = characterCardSchema.parse({ id: "c", name: "林夏", ageRange: "二十出头", gender: "女性", hair: "齐耳黑色短发", signature: ["红色毛线围巾"], personality: "内向", looks: [{ id: "L1", name: "默认", wardrobe: "米色风衣" }, { id: "L2", name: "五年后", wardrobe: "深灰色西装", fromLineId: "d" }] });
  const all = lines.map((l) => ({ id: l.id }));

  it("只写可见特征，不写性格；造型随剧情切换", () => {
    expect(anchorText(card, lookAt(card, "b", all))).toBe("林夏：二十出头女性，齐耳黑色短发，红色毛线围巾，穿着米色风衣");
    expect(anchorText(card, lookAt(card, "e", all))).toContain("穿着深灰色西装");
    expect(anchorText(card, card.looks[0])).not.toContain("内向");
  });

  it("不露脸的角色注明呈现方式", () => {
    expect(anchorText({ ...card, presentation: "back" })).toMatch(/^林夏：只拍背影，不出现可辨认的正脸/);
  });

  it("外貌或风格变了，定妆指纹就变", () => {
    const h = sheetSourceHash(card, builtinVisualStyles[0]);
    expect(sheetSourceHash({ ...card, hair: "长发" }, builtinVisualStyles[0])).not.toBe(h);
    expect(sheetSourceHash(card, builtinVisualStyles[1])).not.toBe(h);
    expect(sheetSourceHash({ ...card, personality: "外向" }, builtinVisualStyles[0])).toBe(h);
  });
});

describe("检查", () => {
  it("外貌太接近、没有识别锚点会提示", () => {
    const a = characterCardSchema.parse({ id: "a", name: "甲", hair: "黑色短发", build: "瘦", signature: ["围巾"] });
    const b = characterCardSchema.parse({ id: "b", name: "乙", hair: "黑色短发", build: "瘦" });
    const issues = castIssues([a, b]);
    expect(issues.some((x) => x.includes("「甲」和「乙」"))).toBe(true);
    expect(issues.some((x) => x.includes("「乙」没有识别锚点"))).toBe(true);
    expect(castIssues([a])).toEqual([]);
  });

  it("几乎没有外貌信息时提示先补充", () => {
    const empty = characterCardSchema.parse({ id: "u", name: "UP主" });
    expect(castIssues([empty]).some((x) => x.includes("「UP主」几乎没有外貌信息"))).toBe(true);
    expect(castIssues([{ ...empty, referenceAssetIds: ["photo"] }]).some((x) => x.includes("几乎没有外貌信息"))).toBe(false);
  });

  it("换装角色的识别锚点和职业不能是某套造型专属的", () => {
    const wolf = characterCardSchema.parse({ id: "w", name: "大灰狼", occupation: "外卖骑手 / 心理咨询师", signature: ["蓝色外卖骑手头盔", "左耳缺一角"], looks: [{ id: "1", name: "外卖骑手", wardrobe: "蓝色外卖骑手制服" }, { id: "2", name: "心理咨询师", wardrobe: "米色针织开衫" }] });
    const issues = castIssues([wolf]);
    expect(issues.some((x) => x.includes("「蓝色外卖骑手头盔」像是「外卖骑手」造型专属的"))).toBe(true);
    expect(issues.some((x) => x.includes("左耳缺一角"))).toBe(false);
    expect(issues.some((x) => x.includes("职业写了多个"))).toBe(true);
  });

  it("文案指纹只随文案和概要变化", () => {
    const doc = { ...emptyDoc(), lines: lines.map((l) => ({ ...l, spans: [], keywords: [], locked: false })) };
    const h = castSourceHash(doc);
    expect(castSourceHash({ ...doc, lines: doc.lines.map((l) => ({ ...l, mood: "悬疑" as const })) })).toBe(h);
    expect(castSourceHash({ ...doc, lines: doc.lines.slice(1) })).not.toBe(h);
  });
});
