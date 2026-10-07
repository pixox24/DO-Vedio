import { describe, expect, it } from "vitest";
import { ui2vTemplateIds } from "./types";
import { activeUi2vTemplateOptions, defaultUi2vTemplateForShot, inferCardTemplate, ui2vTemplates } from "./ui2v";

const animation = { family: "none" as const, intensity: 1 as const, anchors: [], params: {} };

describe("卡片模板目录", () => {
  it("登记全部 11 张模板，外部样例仍待许可审计", () => {
    expect(Object.keys(ui2vTemplates).sort()).toEqual([...ui2vTemplateIds].sort());
    expect(ui2vTemplates["hero-spotlight-stage"].licenseStatus).toBe("pending");
    expect(ui2vTemplates["card-stat"].licenseStatus).toBe("original");
    expect(activeUi2vTemplateOptions.map((template) => template.id)).not.toEqual(expect.arrayContaining(["card-qa", "card-cta"]));
  });

  it("按镜头类型和卡片内容自动匹配", () => {
    expect(inferCardTemplate({ kind: "title", card: undefined })).toBe("hero-spotlight-stage");
    expect(inferCardTemplate({ kind: "quote", card: undefined })).toBe("creator-cinema-editorial-quote");
    expect(inferCardTemplate({ kind: "placeholder", mode: "motion", card: { variant: "split", sides: ["左", "右"] } })).toBe("hero-split-wipe");
    expect(inferCardTemplate({ kind: "placeholder", mode: "motion", card: { variant: "stat", stat: { value: "十三亿", label: "粮食" } } })).toBe("card-stat");
    expect(inferCardTemplate({ kind: "placeholder", mode: "motion", card: { variant: "list", items: ["成本", "效率"] } })).toBe("card-list");
    expect(inferCardTemplate({ kind: "placeholder", mode: "motion", card: { variant: "qa", qa: { question: "为什么？", answer: "养不起" } } })).toBeUndefined();
    expect(inferCardTemplate({ kind: "placeholder", mode: "motion", card: { variant: "cta", cta: { action: "现在就行动" } } })).toBeUndefined();
    expect(inferCardTemplate({ kind: "placeholder", mode: "motion", card: { variant: "alert", alert: { type: "info", content: "多喝水" } } })).toBe("card-alert");
    expect(inferCardTemplate({ kind: "placeholder", mode: "motion", card: { variant: "definition", definition: { term: "元宇宙", meaning: "虚实融合" } } })).toBe("card-definition");
    expect(inferCardTemplate({ kind: "placeholder", mode: "motion", card: { variant: "timeline", timeline: [{ time: "2018年", event: "立项" }] } })).toBe("card-timeline");
    expect(inferCardTemplate({ kind: "placeholder", mode: "motion", card: { variant: "profile", profile: { name: "张伟" } } })).toBe("card-profile");
    expect(inferCardTemplate({ kind: "placeholder", mode: "motion", card: { variant: "headline", headline: "幸存者偏差" } })).toBeUndefined();
  });

  it("生成画面不套全屏卡片，手动指定只在信息卡上生效", () => {
    expect(inferCardTemplate({ kind: "image", mode: "generate", card: { variant: "stat", stat: { value: "1", label: "" } } })).toBeUndefined();
    expect(defaultUi2vTemplateForShot({ kind: "placeholder", mode: "generate", card: { variant: "stat", stat: { value: "1", label: "" } }, animation })).toBeUndefined();
    expect(defaultUi2vTemplateForShot({ kind: "title", card: undefined, animation: { ...animation, templateId: "hero-split-wipe" } })).toBe("hero-split-wipe");
    expect(defaultUi2vTemplateForShot({ kind: "placeholder", mode: "motion", card: { variant: "stat", stat: { value: "十三亿", label: "粮食" } }, animation })).toBe("card-stat");
  });
});
