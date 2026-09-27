import { describe, expect, it } from "vitest";
import { assignMemes, classifyImport, countMemeUses, findMemeUses, groundCandidate, memeInputSchema, parseSinceMonth, parseVerdict, sinceBucket, toCircle, effectiveHeat, isCandidate, lostMemes, memeBudget, memesForSection, mergeFetched, resolveSlang, STALE_DAYS, type MemeInput, type MemeRef } from "./memes";
import { briefSchema, styleTemplateSchema } from "./types";

const DAY = 86_400_000;
const input = (term: string, extra: Partial<MemeInput> = {}): MemeInput => ({
  term, variants: [], kind: "word", meaning: "含义", usage: "用法", example: "例句", tone: "", platform: "B站", since: "2026 年 8 月", heat: "peak", risk: "safe", say: "", circle: "", ...extra,
});

describe("网感档位", () => {
  it("auto 跟随风格模板，旧模板默认关", () => {
    expect(resolveSlang("auto", { slang: "medium" })).toBe("medium");
    expect(resolveSlang("auto", {})).toBe("off");
    expect(resolveSlang("light", { slang: "heavy" })).toBe("light");
  });
  it("按字数换算用梗上限", () => {
    expect(memeBudget(1200, "light")).toBe(2);
    expect(memeBudget(1200, "medium")).toBe(3);
    expect(memeBudget(1000, "heavy")).toBe(4);
    expect(memeBudget(300, "medium")).toBe(0);
    expect(memeBudget(5000, "off")).toBe(0);
  });
  it("旧模板和旧 brief 没有新字段也能加载", () => {
    const old = { id: "x", name: "旧", description: "", tone: "", speechRate: "fast", structureHints: "", dos: [], donts: [], sample: "" };
    expect(styleTemplateSchema.parse(old).slang).toBe("off");
    const brief = briefSchema.parse({ title: "t", summary: "", minutes: 5, templateId: "humor", audience: "", perspective: "first", mustInclude: "", avoid: "", rate: "auto" });
    expect(brief.slang).toBe("auto");
    expect(brief.memes).toBeNull();
  });
});

describe("热度与候选", () => {
  const now = Date.UTC(2026, 8, 27);
  it("超过期限没被确认的高峰梗降为退潮", () => {
    expect(effectiveHeat("peak", now - (STALE_DAYS + 1) * DAY, now)).toBe("fading");
    expect(effectiveHeat("peak", now - 10 * DAY, now)).toBe("peak");
    expect(effectiveHeat("dead", now, now)).toBe("dead");
  });
  it("只有安全且仍在流行的进候选", () => {
    expect(isCandidate({ risk: "safe", heat: "rising", verifiedAt: now }, now)).toBe(true);
    expect(isCandidate({ risk: "caution", heat: "peak", verifiedAt: now }, now)).toBe(false);
    expect(isCandidate({ risk: "safe", heat: "dead", verifiedAt: now }, now)).toBe(false);
    expect(isCandidate({ risk: "safe", heat: "peak", verifiedAt: now - 90 * DAY }, now)).toBe(false);
  });
});

describe("mergeFetched", () => {
  const existing = [{ id: "a", term: "破防了", variants: ["破大防"] }];
  it("按原写法和变体去重：已有的续期，新的插入", () => {
    const r = mergeFetched(existing, [input("破大防"), input("City不City", { variants: ["city不city"] })]);
    expect(r.updates.map((u) => u.id)).toEqual(["a"]);
    expect(r.inserts.map((m) => m.term)).toEqual(["City不City"]);
  });
  it("屏蔽过的梗任何写法都跳过，单独计数", () => {
    const blocked = new Set(["破大防"]);
    const r = mergeFetched([], [input("破防了", { variants: ["破大防"] }), input("显眼包")], { blocked });
    expect(r.inserts.map((m) => m.term)).toEqual(["显眼包"]);
    expect(r).toMatchObject({ blocked: 1, dropped: 0 });
  });
  it("模型给出列表外的类型、热度、风险时单条保守兜底，不让整批作废", () => {
    const m = memeInputSchema.parse({ ...input("甲"), kind: "phrase", heat: "hot", risk: "unknown" });
    expect(m).toMatchObject({ kind: "word", heat: "fading", risk: "caution" });
  });
  it("圈层只认固定列表，其余归为未分类", () => {
    expect(toCircle(" 职场 ")).toBe("职场");
    expect(toCircle("打工")).toBe("");
  });
  it("手动添加和粘贴导入不要求写明流行时间和平台，但仍然不收禁用的", () => {
    const r = mergeFetched([], [input("甲", { since: "", platform: "" }), input("乙", { risk: "banned" })], { requireProvenance: false });
    expect(r.inserts.map((m) => m.term)).toEqual(["甲"]);
    expect(r.dropped).toBe(1);
  });
  it("丢弃禁用的、没写流行时间或平台的、同批重复的", () => {
    const r = mergeFetched([], [input("甲", { risk: "banned" }), input("乙", { since: "" }), input("丙", { platform: " " }), input("丁"), input("丁 ")]);
    expect(r.inserts.map((m) => m.term)).toEqual(["丁"]);
    expect(r.dropped).toBe(4);
  });
});

describe("用梗计数", () => {
  const memes = [{ term: "破防了", variants: ["破大防"] }, { term: "显眼包", variants: [] }];
  it("原写法和变体都算", () => {
    expect(countMemeUses("我直接破防了，后来又破大防。", memes)).toEqual(new Map([["破防了", 2]]));
  });
  it("位置按原文偏移返回；长写法优先，不重复计数", () => {
    const text = "身上的班味浓度超标，一身班味。";
    const uses = findMemeUses(text, [{ term: "班味", variants: ["班味浓度"] }]);
    expect(uses.map((u) => text.slice(u.start, u.end))).toEqual(["班味浓度", "班味"]);
    expect(countMemeUses(text, [{ term: "班味", variants: ["班味浓度"] }]).get("班味")).toBe(2);
  });
  it("改写后丢掉的梗能认出来", () => {
    expect(lostMemes("他就是个显眼包，我破防了。", "他很爱出风头，我破防了。", memes)).toEqual(["显眼包"]);
  });
});

describe("章节分配", () => {
  const ref = (term: string, variants: string[] = []): MemeRef => ({ term, variants, meaning: "", usage: "", example: "", where: "" });
  const picked = [ref("破防了", ["破大防"]), ref("显眼包"), ref("班味")];
  it("只留选中的梗（认变体），同一个梗只分一章，每章最多 2 个，总数不超限", () => {
    const out = assignMemes(
      [{ memes: ["破大防", "瞎编的梗", "显眼包", "班味"] }, { memes: ["破防了", "班味"] }, {}],
      picked,
      3,
    );
    expect(out.map((s) => s.memes)).toEqual([["破防了", "显眼包"], ["班味"], []]);
    expect(assignMemes([{ memes: ["破防了"] }, { memes: ["显眼包"] }], picked, 1).map((s) => s.memes)).toEqual([["破防了"], []]);
  });
  it("网感关闭或没选梗时去掉分配", () => {
    expect(assignMemes([{ memes: ["破防了"] }], null, 3)[0].memes).toBeUndefined();
  });
  it("本章可用的梗：分配过按分配，旧大纲给全部", () => {
    expect(memesForSection(picked, ["班味"]).map((m) => m.term)).toEqual(["班味"]);
    expect(memesForSection(picked, [])).toEqual([]);
    expect(memesForSection(picked, undefined)).toHaveLength(3);
  });
});

describe("流行时间", () => {
  it("从自由文本解析年-月，只有年份保留年份", () => {
    expect(parseSinceMonth("2026年9月1日")).toBe("2026-09");
    expect(parseSinceMonth("2023年9月")).toBe("2023-09");
    expect(parseSinceMonth("2026-08")).toBe("2026-08");
    expect(parseSinceMonth("2026年8月下旬")).toBe("2026-08");
    expect(parseSinceMonth("2024年")).toBe("2024");
    expect(parseSinceMonth("今年夏天")).toBe("");
  });
  it("按流行起始时间分档", () => {
    const now = new Date(2026, 8, 28);
    expect(sinceBucket("2026-08", now)).toBe("m3");
    expect(sinceBucket("2026-04", now)).toBe("m6");
    expect(sinceBucket("2025-11", now)).toBe("y1");
    expect(sinceBucket("2023-09", now)).toBe("older");
    expect(sinceBucket("2026", now)).toBe("m3");
    expect(sinceBucket("", now)).toBe("unknown");
  });
});

describe("parseVerdict", () => {
  const forms = ["班味", "班味浓度"];
  const reply = (conclusion: string, sources: number, evidence: string) =>
    `结论：${conclusion}\n独立来源：${sources}\n流行起始：2024-03\n当前热度：在退潮\n原文：${evidence}`;
  it("真实、多个来源、原句里有这个词 → 已核实，带上流行时间和热度", () => {
    expect(parseVerdict(reply("真实", 6, "下班回家，一身班味。"), forms)).toMatchObject({ trust: "verified", found: true, sinceMonth: "2024-03", heat: "fading" });
  });
  it("来源不足或原句里没有这个词 → 待核实", () => {
    expect(parseVerdict(reply("真实", 1, "一身班味"), forms).trust).toBe("doubtful");
    expect(parseVerdict(reply("真实", 5, "上班好累"), forms).trust).toBe("doubtful");
    expect(parseVerdict(reply("存疑", 3, "一身班味"), forms).trust).toBe("doubtful");
  });
  it("查不到 → found = false（新梗直接丢弃）；格式乱了 → 存疑但保留", () => {
    expect(parseVerdict(reply("查不到", 0, "无"), forms)).toMatchObject({ trust: "doubtful", found: false });
    expect(parseVerdict("我不太确定这个词。", forms)).toMatchObject({ trust: "doubtful", found: true });
  });
});

describe("可信度与候选", () => {
  it("待核实的不进候选，未核实的旧数据照常", () => {
    const now = Date.now();
    expect(isCandidate({ risk: "safe", heat: "peak", verifiedAt: now, trust: "doubtful" }, now)).toBe(false);
    expect(isCandidate({ risk: "safe", heat: "peak", verifiedAt: now, trust: "unchecked" }, now)).toBe(true);
  });
});

describe("粘贴导入：用原文校验", () => {
  const text = "最近很火的“班味”是什么梗？简单说就是上班久了身上的疲惫气质。\n评论区：下班回家一身班味，City不City都不重要了。";
  const cand = (term: string, extra = {}) => ({ ...input(term), explained: true, ...extra });
  it("原文里出现的梗保留，并截取所在的那句话", () => {
    const g = groundCandidate(text, cand("班味", { example: "下班回家一身班味" }))!;
    expect(g.context).toBe("最近很火的“班味”是什么梗？");
    expect(g.input.example).toBe("下班回家一身班味");
    expect(g.inferred).toBe(false);
  });
  it("原文里没有的词丢弃（模型顺手编的）", () => {
    expect(groundCandidate(text, cand("班味超标人格"))).toBeNull();
  });
  it("英文忽略大小写；例句不在原文里时换成原文的句子；没解释含义标为推测", () => {
    const g = groundCandidate(text, cand("city不city", { example: "我自己造的句子", explained: false }))!;
    expect(g.context).toBe("评论区：下班回家一身班味，City不City都不重要了。");
    expect(g.input.example).toBe(g.context);
    expect(g.inferred).toBe(true);
  });
  it("长句以梗为中心截断", () => {
    const long = "字".repeat(200) + "显眼包" + "字".repeat(200) + "。";
    const g = groundCandidate(long, cand("显眼包"))!;
    expect(g.context.length).toBeLessThanOrEqual(92);
    expect(g.context).toContain("显眼包");
  });
  it("和梗库对照：新梗 / 库里已有（认变体）/ 屏蔽过", () => {
    const existing = [{ term: "破防了", variants: ["破大防"] }];
    expect(classifyImport(existing, new Set(), input("破大防"))).toEqual({ status: "existing", existingTerm: "破防了" });
    expect(classifyImport(existing, new Set(["显眼包"]), input("显眼包"))).toEqual({ status: "blocked" });
    expect(classifyImport(existing, new Set(), input("班味"))).toEqual({ status: "new" });
  });
});
