import { describe, expect, it } from "vitest";
import { alignWords, toOriginal } from "./align";
import { ruleSpans, spokenText } from "./lines";

// 实测 CosyVoice 返回（“2025年，银行行长说：AI来了！”）
const real = [
  { text: "二", startMs: 320, endMs: 480 },
  { text: "零", startMs: 520, endMs: 600 },
  { text: "二", startMs: 640, endMs: 760 },
  { text: "五", startMs: 760, endMs: 880 },
  { text: "年", startMs: 880, endMs: 1080 },
  { text: "，", startMs: 1080, endMs: 1160 },
  { text: "银", startMs: 1200, endMs: 1360 },
  { text: "行", startMs: 1400, endMs: 1600 },
  { text: "行", startMs: 1640, endMs: 1840 },
  { text: "长", startMs: 1840, endMs: 2000 },
  { text: "说", startMs: 2040, endMs: 2240 },
  { text: "：A", startMs: 2240, endMs: 2360 },
  { text: " I", startMs: 2800, endMs: 2920 },
  { text: "来", startMs: 3000, endMs: 3240 },
  { text: "了", startMs: 3240, endMs: 3320 },
];

describe("字级时间戳对齐", () => {
  it("服务商自己把数字读成汉字：挂起后均分到原文数字上", () => {
    const text = "2025年，银行行长说：AI来了！";
    const { spoken, map } = spokenText(text, []);
    const chars = toOriginal(text, alignWords(spoken, real), map);
    const at = (ch: string) => chars.find((c) => text[c.i] === ch)!;
    // “2025”四个字符分到 320–880
    expect(chars[0].startMs).toBe(320);
    expect(chars[3].endMs).toBe(880);
    expect(at("年").startMs).toBe(880);
    expect(at("说").startMs).toBe(2040);
    expect(at("I").startMs).toBe(2800);
    expect(chars[chars.length - 1].endMs).toBe(3320);
  });

  it("我们先替换了读法：直接对上，再映射回原文", () => {
    const text = "2025年，银行行长说：AI来了！";
    const { spoken, map } = spokenText(text, ruleSpans(text));
    expect(spoken.startsWith("二零二五年")).toBe(true);
    const chars = toOriginal(text, alignWords(spoken, real), map);
    expect(chars[0]).toMatchObject({ i: 0, startMs: 320 });
    expect(chars.find((c) => c.i === 4)!.startMs).toBe(880); // 年
    for (let k = 1; k < chars.length; k++) expect(chars[k].startMs).toBeGreaterThanOrEqual(chars[k - 1].startMs);
  });

  it("词表缺失尾部：剩余字不越界", () => {
    const text = "你好世界";
    const chars = toOriginal(text, alignWords(text, [{ text: "你", startMs: 0, endMs: 100 }]), [0, 1, 2, 3]);
    expect(chars).toHaveLength(4);
    expect(chars[3].startMs).toBe(100);
  });
});
