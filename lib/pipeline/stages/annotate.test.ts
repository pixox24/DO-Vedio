import { describe, expect, it } from "vitest";
import type { Line } from "@/lib/core/types";
import { annotatePrompt } from "@/lib/prompts";
import { applyAnnotations, sanitize, type Annotation } from "./annotate";

function line(partial: Partial<Line> & Pick<Line, "id" | "text">): Line {
  return { segmentIndex: 0, spans: [], keywords: [], locked: false, ...partial };
}

const raw = {
  lines: [
    { id: "a", spans: [], keywords: ["原文"], mood: "激昂" as const, delivery: "excited" },
    { id: "b", spans: [], keywords: [], mood: "忧伤" as const, delivery: "大声" },
  ],
};

describe("断句标注的表演标签", () => {
  it("提示词把内容情绪和念法分开", () => {
    const prompt = annotatePrompt([{ id: "a", text: "开始。" }], { title: "标题", segmentTitle: "章", lexicon: [] });
    expect(prompt.instructions).toContain("它给分镜和字幕用，不是念法");
    expect(prompt.instructions).toContain("不要因为内容情绪是激昂、忧伤或悬疑就选标签");
  });

  it("列表以外的念法记成不加标签", () => {
    const [first, second] = sanitize([{ id: "a", text: "原文" }, { id: "b", text: "另一句" }], raw);
    expect(first?.delivery).toBe("excited");
    expect(second?.delivery).toBe("none");
  });

  it("只给还没选过的句子写旁白表达", () => {
    const ann: Annotation[] = [
      { id: "a", spans: [], keywords: [], mood: "激昂", delivery: "whispers" },
      { id: "b", spans: [], keywords: [], mood: "忧伤", delivery: "sad" },
      { id: "c", spans: [], keywords: [], mood: "中性", delivery: "serious" },
    ];
    const source = [{ id: "a", text: "甲" }, { id: "b", text: "乙" }, { id: "c", text: "丙" }];
    const next = applyAnnotations([
      line({ id: "a", text: "甲", voiceTag: "auto" }),
      line({ id: "b", text: "乙", voiceTag: "excited" }),
      line({ id: "c", text: "丙", voiceTag: "auto", locked: true }),
    ], ann, source);
    expect(next.map((item) => item.voiceTag)).toEqual(["whispers", "excited", "auto"]);
    expect(next[2]?.mood).toBeUndefined();
  });
});
