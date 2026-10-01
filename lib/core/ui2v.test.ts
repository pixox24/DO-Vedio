import { describe, expect, it } from "vitest";
import { defaultUi2vTemplateForShot, ui2vTemplates } from "./ui2v";

describe("ui2v quick validation catalog", () => {
  it("contains the three installed templates with pending audit status", () => {
    expect(Object.keys(ui2vTemplates).sort()).toEqual([
      "creator-cinema-editorial-quote",
      "hero-split-wipe",
      "hero-spotlight-stage",
    ]);
    expect(Object.values(ui2vTemplates).every((template) => template.licenseStatus === "pending")).toBe(true);
  });

  it("maps title, quote, and split cards to the intended defaults", () => {
    expect(defaultUi2vTemplateForShot({ kind: "title", card: undefined, animation: undefined })).toBe("hero-spotlight-stage");
    expect(defaultUi2vTemplateForShot({ kind: "quote", card: undefined, animation: undefined })).toBe("creator-cinema-editorial-quote");
    expect(defaultUi2vTemplateForShot({ kind: "placeholder", card: { variant: "split", sides: ["左", "右"] }, animation: undefined })).toBe("hero-split-wipe");
  });

  it("preserves an explicit template override", () => {
    expect(defaultUi2vTemplateForShot({ kind: "title", card: undefined, animation: { family: "none", templateId: "hero-split-wipe", intensity: 1, anchors: [], params: {} } })).toBe("hero-split-wipe");
  });
});
