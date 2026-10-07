import type { Job } from "./types";

export type ProjectJobState = { projectId: string; jobs: Map<string, Job> };

/** Merge SSE updates without carrying the previous project's task snapshot across navigation. */
export function mergeProjectJobUpdates(state: ProjectJobState, projectId: string, updates: Job[]): ProjectJobState {
  const jobs = state.projectId === projectId ? new Map(state.jobs) : new Map<string, Job>();
  for (const job of updates) {
    if (job.projectId === projectId) jobs.set(job.key, job);
  }
  return { projectId, jobs };
}
