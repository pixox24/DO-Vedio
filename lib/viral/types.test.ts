import { describe, expect, it } from "vitest";
import { VIRAL_CONTRACT_VERSION, VIRAL_LIMITS, VIRAL_PLATFORMS, VIRAL_STAGES } from "./types";
import { createEmptyDraft, defaultViralInput } from "./state";
import { viralDraftSchema } from "./schemas";

describe("共享契约 v1", () => {
  it("新草稿无预选平台，不使用编码Agent模型配置作为产品模型", () => {
    const input = defaultViralInput();
    expect(input.platform).toBeNull(); expect(input.modelId).toBe("");
    expect(input.style.templateId).toBe("science"); expect(input.memes).toEqual([]);
    expect(input.humanize).toBe(true); expect(input.perspective).toBe("third");
    expect(viralDraftSchema.safeParse(createEmptyDraft(input, "quick", "d1", "")).success).toBe(true);
    expect(VIRAL_CONTRACT_VERSION).toBe(1); expect(VIRAL_PLATFORMS).toHaveLength(4);
    expect(VIRAL_STAGES).toEqual(["analysis", "angles", "outline", "generation", "review"]);
    expect(VIRAL_LIMITS.maxSeconds).toBe(1_800);
  });
});
