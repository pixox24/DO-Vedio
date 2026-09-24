import { describe, expect, it } from "vitest";
import { angleToSummary, briefSchema, styleTemplateSchema } from "./types";

const angle = { angle: "打工人的账本", hook: "月薪一万，房东拿走六千。", points: ["房租占比", "通勤成本"], kind: "story" as const, note: "" };

describe("angleToSummary", () => {
  it("写入角度、钩子、要点和内容性质约束", () => {
    const s = angleToSummary(angle);
    expect(s).toContain("切入角度：打工人的账本");
    expect(s).toContain("开场钩子：月薪一万，房东拿走六千。");
    expect(s).toContain("- 房租占比\n- 通勤成本");
    expect(s).toContain("虚构故事");
    expect(s).toContain("不要声称是真实事件");
    expect(s).not.toContain("创作方向");
  });
  it("保留用户原先填写的方向", () => {
    expect(angleToSummary(angle, "想聊房租")).toMatch(/^创作方向：想聊房租\n/);
  });
});

describe("schemas", () => {
  it("旧的自定义模板没有 ideation 字段也能加载", () => {
    const old = { id: "x", name: "旧模板", description: "", tone: "", speechRate: "fast", structureHints: "", dos: [], donts: [], sample: "" };
    expect(styleTemplateSchema.parse(old).ideation).toBe("");
  });
  it("内容概要可以留空", () => {
    const brief = { title: "标题", summary: "  ", minutes: 5, templateId: "humor", audience: "", perspective: "first", mustInclude: "", avoid: "", rate: "auto" };
    expect(briefSchema.parse(brief).summary).toBe("");
  });
});
