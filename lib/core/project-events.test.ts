import { describe, expect, it } from "vitest";
import type { Job } from "./types";
import { mergeProjectJobUpdates } from "./project-events";

const job = (projectId: string, key: string) => ({ projectId, key, status: "running" }) as Job;

describe("project event task isolation", () => {
  it("starts a fresh snapshot when the active project changes", () => {
    const previous = { projectId: "project-a", jobs: new Map([["old-key", job("project-a", "old-key")]]) };
    const next = mergeProjectJobUpdates(previous, "project-b", []);

    expect(next.projectId).toBe("project-b");
    expect(next.jobs.size).toBe(0);
  });

  it("ignores late updates from another project and keeps current project tasks", () => {
    const previous = { projectId: "project-b", jobs: new Map([["current-key", job("project-b", "current-key")]]) };
    const next = mergeProjectJobUpdates(previous, "project-b", [
      job("project-a", "late-old-key"),
      { ...job("project-b", "current-key"), status: "succeeded" } as Job,
      job("project-b", "new-key"),
    ]);

    expect([...next.jobs.keys()]).toEqual(["current-key", "new-key"]);
    expect(next.jobs.get("current-key")?.status).toBe("succeeded");
  });
});
