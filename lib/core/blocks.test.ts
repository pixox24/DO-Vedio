import { describe, expect, it } from "vitest";
import { blockLimitsFor, paragraphIndexes, planBlocks } from "./blocks";
import { rebuildLines } from "./lines";

let n = 0;
const makeLines = (segments: { text: string }[]) => rebuildLines([], segments, () => `l${++n}`);
const texts = (blocks: { text: string }[][]) => blocks.map((b) => b.map((l) => l.text));
const limits = { maxLines: 8, maxChars: 300 };

describe("自然段识别", () => {
  it("按换行计算每句所在的自然段", () => {
    const segments = [{ text: "第一段第一句。第一段第二句。\n\n第二段第一句。" }, { text: "另一章。" }];
    expect(paragraphIndexes(makeLines(segments), segments)).toEqual([0, 0, 1, 0]);
  });

  it("碎句跨换行并入上一句时仍能定位", () => {
    const segments = [{ text: "这是上一段的结尾。\n对。\n新的一段开始了。" }];
    const lines = makeLines(segments);
    expect(lines.map((l) => l.text)).toEqual(["这是上一段的结尾。对。", "新的一段开始了。"]);
    expect(paragraphIndexes(lines, segments)).toEqual([0, 2]);
  });

  it("文案与句子不同步时标记为 -1", () => {
    const lines = makeLines([{ text: "旧的句子。" }]);
    expect(paragraphIndexes(lines, [{ text: "完全不同的文案。" }])).toEqual([-1]);
  });
});

describe("分块", () => {
  it("不跨章节、在自然段处断开", () => {
    const segments = [{ text: "甲段第一句。甲段第二句。\n乙段第一句。乙段第二句。" }, { text: "丙段第一句。丙段第二句。" }];
    expect(texts(planBlocks(makeLines(segments), segments, limits))).toEqual([["甲段第一句。", "甲段第二句。"], ["乙段第一句。", "乙段第二句。"], ["丙段第一句。", "丙段第二句。"]]);
  });

  it("超长自然段按上限拆成均衡的几块，不超过句数上限", () => {
    const text = Array.from({ length: 12 }, (_, k) => `这是第${k + 1}句比较完整的旁白内容。`).join("");
    const segments = [{ text }];
    const blocks = planBlocks(makeLines(segments), segments, limits);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.length)).toEqual([6, 6]);
  });

  it("不超过字数上限", () => {
    const text = Array.from({ length: 10 }, () => "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十。").join("");
    const segments = [{ text }];
    const blocks = planBlocks(makeLines(segments), segments, { maxLines: 8, maxChars: 100 });
    for (const b of blocks) expect(b.reduce((s, l) => s + l.text.length - 1, 0)).toBeLessThanOrEqual(100);
    expect(blocks.flat()).toHaveLength(10);
  });

  it("单独录制的句子自成一块，kind 变化处断开", () => {
    const segments = [{ text: "第一句话。第二句话。第三句话。第四句话。第五句话。" }];
    const lines = makeLines(segments);
    const blocks = planBlocks(lines, segments, { ...limits, alone: (l) => l.text === "第二句话。", kind: (l) => (l.text === "第五句话。" ? "ssml" : "plain") });
    expect(texts(blocks)).toEqual([["第一句话。"], ["第二句话。"], ["第三句话。", "第四句话。"], ["第五句话。"]]);
  });

  it("Gemini 使用更保守的上限", () => {
    expect(blockLimitsFor("google-gemini").maxChars).toBeLessThan(blockLimitsFor("dashscope").maxChars);
  });
});

describe("超长自然段的拆分", () => {
  it("用最少的块数按字数均衡拆分，不留孤零零的最后一句（阿波罗段 6 句，Gemini 每块最多 5 句）", () => {
    const text = "一九六九年七月二十日，阿波罗十一号的登月舱缓缓降落在静海。舱内的警报灯却在最后几分钟接连亮起。导航计算机过载了，所有人都屏住了呼吸。地面控制中心只有几秒钟来决定：继续，还是放弃。一个年仅二十六岁的工程师给出了答案。他说，继续。";
    const segments = [{ text }];
    const blocks = planBlocks(makeLines(segments), segments, blockLimitsFor("google-gemini"));
    // 旧的贪心算法会拆成 2 + 3 + 1，把「他说，继续。」单独合成
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.length)).toEqual([2, 4]);
  });

  it("拆分点优先落在句号而不是逗号", () => {
    const segments = [{ text: "这是一句比较长的开头，这里只是逗号拆开的后半句。第二句完整的话在这里。第三句完整的话在这里。" }];
    const lines = makeLines(segments);
    const blocks = planBlocks(lines, segments, { maxLines: 2, maxChars: 300 });
    expect(blocks.every((b) => /。$/.test(b[b.length - 1].text))).toBe(true);
  });
});
