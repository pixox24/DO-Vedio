import { describe, expect, it } from "vitest";
import { alignLines, applyLexicon, mergeSpans, rebuildLines, ruleSpans, spansValid, splitSentences, spokenText } from "./lines";
import type { Line } from "./types";

describe("断句", () => {
  it("在句末标点断开，原文一字不改", () => {
    const text = "你好。今天我们聊点什么？就聊“AI”吧！";
    const s = splitSentences(text);
    expect(s).toEqual(["你好。", "今天我们聊点什么？", "就聊“AI”吧！"]);
    expect(s.join("")).toBe(text);
  });

  it("过长的句子在逗号处拆开", () => {
    const long = "这是一个非常非常长的句子，它包含了很多很多的内容和信息，我们需要在合适的位置把它拆成两半，这样配音和分镜都会更自然一些。";
    const s = splitSentences(long);
    expect(s.length).toBeGreaterThan(1);
    expect(s.join("")).toBe(long);
    for (const x of s) expect(x.replace(/[，。]/g, "").length).toBeLessThanOrEqual(40);
  });

  it("碎句并入上一句，段落换行处断开", () => {
    expect(splitSentences("你知道吗？对。\n\n第二段开始了。")).toEqual(["你知道吗？对。", "第二段开始了。"]);
  });
});

describe("句子 ID 继承", () => {
  let n = 0;
  const id = () => `new${++n}`;
  it("文本不变的句子保留原 ID", () => {
    const prev = [
      { id: "a", text: "一。" },
      { id: "b", text: "二。" },
      { id: "c", text: "三。" },
    ];
    const r = alignLines(prev, ["一。", "二改了。", "三。", "四。"], id);
    expect(r.map((x) => x.id)).toEqual(["a", "new1", "c", "new2"]);
  });

  it("rebuildLines 保留标注和锁定", () => {
    const prev: Line[] = [{ id: "a", segmentIndex: 0, text: "银行行长来了。", spans: [{ text: "银行" }, { text: "行长", say: "航长" }, { text: "来了。" }], keywords: ["行长"], voiceTag: "sad", locked: true }];
    const r = rebuildLines(prev, [{ text: "银行行长来了。新的一句。" }], id);
    expect(r[0]).toMatchObject({ id: "a", locked: true, keywords: ["行长"], voiceTag: "sad" });
    expect(r[1].id).toMatch(/^new/);
  });
});

describe("读音", () => {
  it("词典最长匹配", () => {
    const s = applyLexicon("银行行长说行", [
      { word: "行长", say: "航掌" },
      { word: "行", say: "形" },
    ]);
    expect(s.map((x) => x.text).join("")).toBe("银行行长说行");
    expect(s).toContainEqual({ text: "行长", say: "航掌" });
  });

  it("朗读文本映射回原文位置", () => {
    const text = "2025年到了";
    const spans = ruleSpans(text);
    expect(spansValid(text, spans)).toBe(true);
    const { spoken, map } = spokenText(text, spans);
    expect(spoken).toBe("二零二五年到了");
    expect(map.length).toBe(spoken.length);
    expect(map[4]).toBe(4); // “年”
    expect(map[0]).toBe(0);
    expect(map[3]).toBe(3);
  });

  it("百分数", () => {
    expect(spokenText("涨了12.5%！", ruleSpans("涨了12.5%！")).spoken).toBe("涨了百分之12.5！");
  });

  it("非法标注被丢弃", () => {
    expect(mergeSpans("原文", [{ text: "被改过" }], [])).toEqual([]);
  });

  it("新词典规则覆盖旧读音标注且保留其余读法", () => {
    expect(mergeSpans("苹果和香蕉", [{ text: "苹果", say: "旧读法" }, { text: "和" }, { text: "香蕉", say: "xiangjiao" }], [{ word: "苹果", say: "pingguo" }])).toEqual([
      { text: "苹果", say: "pingguo" }, { text: "和" }, { text: "香蕉", say: "xiangjiao" },
    ]);
  });
});
