import { describe, expect, it } from "vitest";
import { builtinTemplates } from "../templates/builtin";
import { visualStyleSchema } from "../core/types";
import { builtinVisualStyles, recommendVisualStyles } from "./builtin";

describe("内置视觉风格", () => {
  it("字段合法、id 唯一、适配的解说风格都存在", () => {
    expect(builtinVisualStyles.length).toBe(10);
    expect(new Set(builtinVisualStyles.map((s) => s.id)).size).toBe(builtinVisualStyles.length);
    const templateIds = new Set(builtinTemplates.map((t) => t.id));
    for (const s of builtinVisualStyles) {
      expect(() => visualStyleSchema.parse(s)).not.toThrow();
      for (const id of s.suits) expect(templateIds.has(id)).toBe(true);
    }
    // 每种解说风格都至少有一个推荐
    for (const t of builtinTemplates) expect(builtinVisualStyles.some((s) => s.suits.includes(t.id))).toBe(true);
  });

  it("按解说风格推荐排序", () => {
    expect(recommendVisualStyles("suspense", builtinVisualStyles)[0].id).toBe("noir-suspense");
    expect(recommendVisualStyles("unknown", builtinVisualStyles).map((s) => s.id)).toEqual(builtinVisualStyles.map((s) => s.id));
  });
});
