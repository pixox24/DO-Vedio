import { describe, expect, it } from "vitest";
import { cleanSelectedWord } from "./selection";

describe("选区词语", () => {
  it("清掉首尾空白并拒绝空值、HTML 和控制字符", () => {
    expect(cleanSelectedWord("  同名词语  ")).toBe("同名词语");
    expect(cleanSelectedWord("  ")).toBe("");
    expect(cleanSelectedWord("<b>词</b>")).toBe("");
    expect(cleanSelectedWord("词\n语")).toBe("");
  });
});
