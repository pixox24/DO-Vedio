import { describe, expect, it } from "vitest";
import { emptyDoc } from "@/lib/core/types";
import { voiceDirectionPrompt } from "@/lib/prompts";
import { sanitizeVoiceInstruction, voiceDirectionKey, voiceDirectionMaterial } from "./voice-direction";

describe("全片朗读说明", () => {
  it("收成一句，并去掉方括号标签", () => {
    expect(sanitizeVoiceInstruction("  [serious]沉稳、老练，语重心长。后面这句不要。")).toBe("沉稳、老练，语重心长。");
    expect(sanitizeVoiceInstruction("[excited]")).toBe("");
    expect([...sanitizeVoiceInstruction("很".repeat(100))]).toHaveLength(80);
  });

  it("材料带上风格、情绪分布和已经换念法的句子", () => {
    const doc = emptyDoc();
    doc.brief.templateId = "serious";
    doc.lines = [
      { id: "a", segmentIndex: 0, text: "第一句。", spans: [], keywords: [], mood: "中性", voiceTag: "none", locked: false },
      { id: "b", segmentIndex: 0, text: "放慢这一句。", spans: [], keywords: [], mood: "忧伤", voiceTag: "very slowly", locked: false },
    ];
    const material = voiceDirectionMaterial(doc);
    expect(material.style?.name).toBe("严肃权威");
    expect(material.moods).toEqual([{ mood: "中性", count: 1 }, { mood: "忧伤", count: 1 }]);
    expect(material.tagged).toEqual([{ text: "放慢这一句。", tag: "非常缓慢" }]);
    expect(voiceDirectionPrompt(material).instructions).toContain("不要模仿任何具体的人");
    expect(voiceDirectionKey(doc, "deepseek")).not.toBe(voiceDirectionKey({ ...doc, lines: doc.lines.slice(0, 1) }, "deepseek"));
  });
});
