import { describe, expect, it } from "vitest";
import { renderEtaLabel } from "../lib/core/job-eta";

describe("renderEtaLabel", () => {
  it("uses startedAt instead of the heartbeat timestamp", () => {
    expect(renderEtaLabel({ status: "running", progress: 0.5, startedAt: 1_000 }, 11_000)).toBe("预计还需 00:10");
  });

  it("waits for a stable progress sample", () => {
    expect(renderEtaLabel({ status: "running", progress: 0.04, startedAt: 1_000 }, 11_000)).toBe("准备中");
    expect(renderEtaLabel({ status: "running", progress: 0.2 }, 11_000)).toBe("准备中");
  });

  it("falls back to elapsed time for an untrustworthy long estimate", () => {
    expect(renderEtaLabel({ status: "running", progress: 0.05, startedAt: 0 }, 31 * 60 * 1000)).toBe("已进行 31:00");
  });

  it("does not show an ETA after the task is no longer running", () => {
    expect(renderEtaLabel({ status: "succeeded", progress: 1, startedAt: 1_000 }, 11_000)).toBe("准备中");
  });
});
