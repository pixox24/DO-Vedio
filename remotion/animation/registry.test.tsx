import { describe, expect, it } from "vitest";
import { animationRenderers } from "./registry";
import { animationFamilies } from "@/lib/core/types";

describe("animation renderer registry", () => {
  it("registers every closed animation family", () => {
    for (const family of ["editorial", "kinetic", "stat", "compare", "process", "callout"] as const) {
      expect(animationRenderers[family]).toBeTypeOf("function");
    }
    for (const family of ["timeline", "collage", "hud", "ink"] as const) expect(animationRenderers[family]).toBeTypeOf("function");
  });

  it("covers every closed family so new recipes require an explicit renderer decision", () => {
    expect(Object.keys(animationRenderers).sort()).toEqual([...animationFamilies].sort());
  });
});
