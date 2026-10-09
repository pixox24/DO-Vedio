import { describe, expect, it } from "vitest";
import { emptyDoc } from "./types";
import { jobBelongsToGoal, setupConfirmationMatches, setupFingerprint } from "./production";

describe("production safety helpers", () => {
  it("invalidates setup confirmation when a production setting changes", () => {
    const doc = emptyDoc();
    const fingerprint = setupFingerprint(doc.settings);
    expect(setupConfirmationMatches(fingerprint, doc.settings)).toBe(true);
    const changed = { ...doc.settings, budgetYuan: 10 };
    expect(setupConfirmationMatches(fingerprint, changed)).toBe(false);
  });

  it("keeps the fingerprint stable for equivalent settings", () => {
    const doc = emptyDoc();
    expect(setupFingerprint(doc.settings)).toBe(setupFingerprint({ ...doc.settings }));
  });

  it("keeps setup confirmation when only the preview aspect changes", () => {
    const doc = emptyDoc();
    doc.settings.aspects = ["16:9", "9:16"];
    doc.settings.previewAspect = "16:9";
    const fingerprint = setupFingerprint(doc.settings);
    expect(setupConfirmationMatches(fingerprint, { ...doc.settings, previewAspect: "9:16" })).toBe(true);
    expect(setupConfirmationMatches(fingerprint, { ...doc.settings, aspects: ["9:16"] })).toBe(false);
  });

  it("matches only jobs tagged with the active production goal", () => {
    expect(jobBelongsToGoal({ input: { goalId: "goal-1" } }, "goal-1")).toBe(true);
    expect(jobBelongsToGoal({ input: { goalId: "goal-2" } }, "goal-1")).toBe(false);
    expect(jobBelongsToGoal({ input: {} }, "goal-1")).toBe(false);
  });
});
