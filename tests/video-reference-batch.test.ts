import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { evenChars } from "@/lib/core/align";
import { blankShot, stampShots } from "@/lib/core/shots";
import { castSourceHash } from "@/lib/core/cast";
import { emptyDoc } from "@/lib/core/types";
import { sourceImageSnapshot } from "@/lib/core/video";
import { videoDescriptionHash } from "@/lib/core/video-plan";

vi.mock("@/lib/providers/registry", () => ({
  listTextModels: () => [{ id: "test-text", configured: true, enabled: true }],
  listProviderProfiles: () => [
    { kind: "image", providerId: "replicate", modelId: "test-image", configured: true, enabled: true, adapterStatus: "ready" },
    { kind: "video", providerId: "autodl", modelId: "minimax_h3_zm_u08", configured: true, enabled: true, adapterStatus: "ready" },
  ],
}));
vi.mock("@/lib/pipeline/plan", async (original) => {
  const actual = await original<typeof import("@/lib/pipeline/plan")>();
  return { ...actual, wakeCurrentGoal: vi.fn(actual.wakeCurrentGoal) };
});
vi.mock("@/lib/pipeline/auto-portrait", async (original) => {
  const actual = await original<typeof import("@/lib/pipeline/auto-portrait")>();
  return { ...actual, enqueueAutoPortraits: vi.fn(actual.enqueueAutoPortraits), enqueueAutoScenes: vi.fn(actual.enqueueAutoScenes) };
});

let dir = "";
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "dovedio-reference-batch-")); process.env.DATA_DIR = dir; });
afterAll(async () => { (await import("@/lib/server/db")).closeDb(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => { (await import("@/lib/server/db")).run("DELETE FROM jobs"); vi.clearAllMocks(); });

async function fixture() {
  const { createProject } = await import("@/lib/server/projects");
  const { cachePut } = await import("@/lib/server/cache");
  const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
  const doc = emptyDoc();
  doc.settings.visualPipeline = "video";
  doc.settings.modelId = "test-text";
  doc.settings.voice.instruction = "自然口播";
  doc.settings.video.referenceImageModelId = "replicate::test-image";
  doc.settings.assetFraming = "shared";
  doc.lines = Array.from({ length: 3 }, (_, index) => ({ id: `l${index}`, text: `这是第${index}段旁白。`, segmentIndex: 0, locked: true, spans: [], keywords: [] }));
  doc.segments = [{ title: "测试", text: doc.lines.map((line) => line.text).join("") }];
  doc.shots = stampShots(doc.lines.map((line, index) => ({ ...blankShot(`s${index}`, line.id), kind: "video" as const, mode: "generate" as const,
    sourceImageAssetId: `reference-${index}`, sourceImagePromptHash: "unknown",
    videoPlan: { startState: "A subject by a window", action: "The subject turns", camera: "Static camera", endState: "The subject faces the window" },
  })), doc.lines);
  doc.castAnalysis = { sourceHash: castSourceHash(doc), modes: [], skipped: [], issues: [] };
  const project = createProject(doc);
  for (const { key, line } of lineTtsKeys(doc, project.id)) cachePut(key, "tts", { assetId: `tts-${line.id}`, durationMs: 2000, speechStartMs: 0, speechEndMs: 2000, chars: evenChars(line.text, 0, 2000), aligned: true, spokenChars: line.text.length });
  return project;
}

async function confirmation(projectId: string, shotIds = ["s0", "s1"]) {
  const doc = (await import("@/lib/server/projects")).getProject(projectId)!.doc;
  const { videoFrame } = await import("@/lib/pipeline/video-generation");
  return { references: shotIds.map((shotId) => ({ shotId, confirmHash: sourceImageSnapshot(doc, doc.shots.find((shot) => shot.id === shotId)!, videoFrame(doc)).hash })) };
}
async function request(projectId: string, method: "POST" | "PATCH", body: unknown) {
  const route = await import("@/app/api/projects/[id]/shots/reference/route");
  return route[method](new Request("http://test", { method, body: JSON.stringify(body) }), { params: Promise.resolve({ id: projectId }) });
}

it("incomplete standards block reference and video confirmation while mixed batches keep independent shots usable", async () => {
  const project = await fixture();
  const { sceneCardSchema } = await import("@/lib/core/types");
  const { mutateProject, getProject } = await import("@/lib/server/projects");
  const { projectJobs } = await import("@/lib/server/jobs");
  const single = await import("@/app/api/projects/[id]/shots/[shotId]/reference/route");
  const video = await import("@/app/api/projects/[id]/shots/[shotId]/generate/route");
  mutateProject(project.id, (doc) => ({ ...doc, scenes: [sceneCardSchema.parse({ id: "scene0" })], shots: doc.shots.map((shot) => shot.id === "s0" ? { ...shot, sceneId: "scene0" } : shot) }));
  const params = { params: Promise.resolve({ id: project.id, shotId: "s0" }) };
  const payload = await confirmation(project.id, ["s0"]);
  expect((await single.POST(new Request("http://test", { method: "POST", body: "{}" }), params)).status).toBe(409);
  expect((await single.PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify({ confirmHash: payload.references[0].confirmHash }) }), params)).status).toBe(409);
  expect((await request(project.id, "PATCH", payload)).status).toBe(409);
  expect((await video.POST(new Request("http://test", { method: "POST", body: JSON.stringify({ kind: "video", confirmHash: payload.references[0].confirmHash }) }), params)).status).toBe(409);
  expect(getProject(project.id)!.doc.shots[0].sourceImageConfirmedHash).toBeUndefined();
  expect(projectJobs(project.id)).toHaveLength(0);
  const mixed = await request(project.id, "POST", { shotIds: ["s0", "s1"] });
  expect(mixed.status).toBe(200);
  expect(await mixed.json()).toMatchObject({ count: 1, skipped: 1, jobs: [{ input: { shotId: "s1" } }] });
  expect((await request(project.id, "PATCH", await confirmation(project.id, ["s2"]))).status).toBe(200);
  expect(getProject(project.id)!.doc.shots[2].sourceImageConfirmedHash).toBeTruthy();
});

it("batch confirmation wakes the current goal once and queues only the reviewed videos", async () => {
  const project = await fixture();
  const { setGoal, wakeCurrentGoal } = await import("@/lib/pipeline/plan");
  const { getProject } = await import("@/lib/server/projects");
  const { projectJobs } = await import("@/lib/server/jobs");
  setGoal(project.id, { until: "render", aspects: ["16:9"], quality: "final" });
  const payload = await confirmation(project.id);
  const beforeRevision = getProject(project.id)!.revision;
  const response = await request(project.id, "PATCH", payload);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ count: 2, continuing: true });
  expect(wakeCurrentGoal).toHaveBeenCalledExactlyOnceWith(project.id);
  const updated = getProject(project.id)!;
  expect(updated.revision).toBe(beforeRevision + 1);
  expect(updated.doc.shots.map((shot) => shot.sourceImageConfirmedHash)).toEqual([payload.references[0].confirmHash, payload.references[1].confirmHash, undefined]);
  expect(projectJobs(project.id)).toHaveLength(2);
  expect(projectJobs(project.id).map((job) => ({ stage: job.stage, shotId: (job.input as { shotId: string }).shotId }))).toEqual(expect.arrayContaining([
    { stage: "shot-generate", shotId: "s0" }, { stage: "shot-generate", shotId: "s1" },
  ]));
});

it.each(["old-hash", "locked", "pending-plan", "missing-image", "stale-image", "missing-shot", "nonvideo", "active-reference", "wrong-pipeline"])("confirmation rejects %s atomically", async (change) => {
  const project = await fixture();
  const { getProject, mutateProject } = await import("@/lib/server/projects");
  const { enqueue } = await import("@/lib/server/jobs");
  const { wakeCurrentGoal } = await import("@/lib/pipeline/plan");
  const payload = await confirmation(project.id);
  if (change === "old-hash") payload.references[1].confirmHash = "old";
  if (change === "missing-shot") payload.references[1].shotId = "missing";
  if (change === "active-reference") enqueue({ projectId: project.id, stage: "shot-reference", key: "active-reference", input: { shotId: "s1" } });
  if (["locked", "pending-plan", "missing-image", "stale-image", "nonvideo", "wrong-pipeline"].includes(change)) mutateProject(project.id, (doc) => ({ ...doc,
    settings: change === "wrong-pipeline" ? { ...doc.settings, visualPipeline: "image" } : doc.settings,
    shots: doc.shots.map((shot) => shot.id !== "s1" ? shot : { ...shot,
      ...(change === "locked" ? { locked: true } : {}),
      ...(change === "pending-plan" ? { description: "新的中文要求", videoPlanDescriptionHash: videoDescriptionHash("旧要求") } : {}),
      ...(change === "missing-image" ? { sourceImageAssetId: undefined } : {}),
      ...(change === "stale-image" ? { sourceImagePromptHash: "stale" } : {}),
      ...(change === "nonvideo" ? { kind: "image" as const } : {}),
    }),
  }));
  const before = getProject(project.id);
  expect((await request(project.id, "PATCH", payload)).status).toBe(409);
  expect(getProject(project.id)).toEqual(before);
  expect(wakeCurrentGoal).not.toHaveBeenCalled();
});

it("ready references continue while a missing failed peer remains untouched", async () => {
  const project = await fixture();
  const { mutateProject } = await import("@/lib/server/projects");
  const { setGoal } = await import("@/lib/pipeline/plan");
  const { enqueue, projectJobs } = await import("@/lib/server/jobs");
  const { run } = await import("@/lib/server/db");
  const { referenceJobKey, videoFrame } = await import("@/lib/pipeline/video-generation");
  const changed = mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => shot.id === "s2" ? { ...shot, sourceImageAssetId: undefined } : shot) }))!;
  const failed = enqueue({ projectId: project.id, stage: "shot-reference", key: referenceJobKey(changed.doc, changed.doc.shots[2], videoFrame(changed.doc)), input: { shotId: "s2" } });
  run("UPDATE jobs SET status = 'failed', error = 'model unavailable' WHERE id = ?", failed.id);
  setGoal(project.id, { until: "render", aspects: ["16:9"], quality: "final" });
  const response = await request(project.id, "PATCH", await confirmation(project.id));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ count: 2, continuing: true });
  expect(projectJobs(project.id).filter((job) => job.stage === "shot-generate").map((job) => (job.input as { shotId: string }).shotId).sort()).toEqual(["s0", "s1"]);
  expect(projectJobs(project.id).find((job) => job.id === failed.id)?.status).toBe("failed");
});

it("batch confirmation without a running goal tells the caller to start production", async () => {
  const project = await fixture();
  const response = await request(project.id, "PATCH", await confirmation(project.id));
  expect(await response.json()).toEqual({ count: 2, continuing: false });
  expect((await import("@/lib/server/jobs")).projectJobs(project.id)).toEqual([]);
});

it("single confirmation and generation submits only the selected shot despite a failed peer and an existing goal", async () => {
  const project = await fixture();
  await (await import("@/lib/visual-styles/store")).ensureProjectVisualStyle(project.id);
  const { mutateProject, getProject } = await import("@/lib/server/projects");
  const { setGoal, wakeCurrentGoal } = await import("@/lib/pipeline/plan");
  const { POST } = await import("@/app/api/projects/[id]/shots/[shotId]/generate/route");
  const { projectJobs } = await import("@/lib/server/jobs");
  const { references } = await confirmation(project.id);
  mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => shot.id === "s2" ? { ...shot, sourceImageAssetId: undefined } : shot.id === "s1" ? { ...shot, sourceImageConfirmedHash: references[1].confirmHash } : shot) }));
  const before = getProject(project.id)!;
  setGoal(project.id, { until: "render", aspects: ["16:9"], quality: "final" });
  const req = () => POST(new Request("http://test", { method: "POST", body: JSON.stringify({ kind: "video", confirmHash: references[0].confirmHash }) }), { params: Promise.resolve({ id: project.id, shotId: "s0" }) });
  const response = await req();
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.job.input).toMatchObject({ shotId: "s0", kind: "video" });
  expect(projectJobs(project.id)).toHaveLength(1);
  expect(wakeCurrentGoal).not.toHaveBeenCalled();
  expect(getProject(project.id)!.doc.settings.video.autoContinue).toBe(false);
  expect(getProject(project.id)!.doc.shots[0].sourceImageConfirmedHash).toBe(references[0].confirmHash);
  expect(getProject(project.id)!.doc.shots.slice(1)).toEqual(before.doc.shots.slice(1));
  expect((await req()).status).toBe(200);
  expect(projectJobs(project.id)).toHaveLength(1);
});

it.each(["changed-image", "stale-image", "missing-image", "pending-plan", "locked", "active-reference"])("single confirm-and-generate rejects %s without confirming or submitting a video", async (change) => {
  const project = await fixture();
  await (await import("@/lib/visual-styles/store")).ensureProjectVisualStyle(project.id);
  const { references } = await confirmation(project.id);
  const { mutateProject, getProject } = await import("@/lib/server/projects");
  const { enqueue, projectJobs } = await import("@/lib/server/jobs");
  const { POST } = await import("@/app/api/projects/[id]/shots/[shotId]/generate/route");
  mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => shot.id !== "s0" ? shot : { ...shot,
    ...(change === "changed-image" ? { sourceImageAssetId: "replacement" } : {}),
    ...(change === "stale-image" ? { sourceImagePromptHash: "stale" } : {}),
    ...(change === "missing-image" ? { sourceImageAssetId: undefined } : {}),
    ...(change === "pending-plan" ? { description: "新要求", videoPlanDescriptionHash: videoDescriptionHash("旧要求") } : {}),
    ...(change === "locked" ? { locked: true } : {}),
  }) }));
  if (change === "active-reference") enqueue({ projectId: project.id, stage: "shot-reference", key: "redo", input: { shotId: "s0" } });
  const before = getProject(project.id);
  const jobs = projectJobs(project.id);
  const response = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ kind: "video", confirmHash: references[0].confirmHash }) }), { params: Promise.resolve({ id: project.id, shotId: "s0" }) });
  expect(response.status).toBe(409);
  expect(getProject(project.id)).toEqual(before);
  expect(projectJobs(project.id)).toEqual(jobs);
});

it("strict batch schemas reject duplicates, overrides, unknown fields and empty or oversized lists", async () => {
  const project = await fixture();
  const payload = await confirmation(project.id);
  const { getProject } = await import("@/lib/server/projects");
  const { projectJobs } = await import("@/lib/server/jobs");
  const before = getProject(project.id);
  for (const body of [{ references: [] }, { references: [payload.references[0], payload.references[0]] }, { ...payload, assetId: "manual" }, { references: [{ ...payload.references[0], description: "manual" }] }, { references: Array.from({ length: 501 }, (_, index) => ({ shotId: `s${index}`, confirmHash: "hash" })) }]) {
    expect((await request(project.id, "PATCH", body)).status).toBe(400);
  }
  for (const body of [{ shotIds: [] }, { shotIds: ["s0", "s0"] }, { shotIds: ["s0"], modelId: "other" }, { shotIds: Array.from({ length: 501 }, (_, index) => `s${index}`) }]) {
    expect((await request(project.id, "POST", body)).status).toBe(400);
  }
  expect(getProject(project.id)).toEqual(before);
  expect(projectJobs(project.id)).toEqual([]);
});

it("batch redo submits only requested references using the project model and reuses active jobs", async () => {
  const project = await fixture();
  const { enqueueShotReference, videoFrame } = await import("@/lib/pipeline/video-generation");
  const { enqueueAutoPortraits, enqueueAutoScenes } = await import("@/lib/pipeline/auto-portrait");
  const { projectJobs } = await import("@/lib/server/jobs");
  const { getProject } = await import("@/lib/server/projects");
  const active = enqueueShotReference(project.id, project.doc, project.doc.shots[0], videoFrame(project.doc));
  const before = getProject(project.id);
  const response = await request(project.id, "POST", { shotIds: ["s0", "s2"] });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.count).toBe(2);
  expect(result.jobs[0].id).toBe(active.id);
  expect(enqueueAutoPortraits).not.toHaveBeenCalled();
  expect(enqueueAutoScenes).not.toHaveBeenCalled();
  expect(projectJobs(project.id)).toHaveLength(2);
  expect(projectJobs(project.id)).toEqual(expect.arrayContaining(["s0", "s2"].map((shotId) => expect.objectContaining({ stage: "shot-reference", input: expect.objectContaining({ shotId, modelId: "test-image" }) }))));
  expect(getProject(project.id)).toEqual(before);
});

it.each(["locked", "pending-plan", "nonvideo", "missing-shot", "missing-model", "unavailable-model", "wrong-pipeline"])("batch redo validates %s before enqueuing any task", async (change) => {
  const project = await fixture();
  const { getProject, mutateProject } = await import("@/lib/server/projects");
  const { projectJobs } = await import("@/lib/server/jobs");
  const { enqueueAutoPortraits, enqueueAutoScenes } = await import("@/lib/pipeline/auto-portrait");
  mutateProject(project.id, (doc) => ({ ...doc, settings: { ...doc.settings,
    ...(change === "wrong-pipeline" ? { visualPipeline: "image" as const } : {}),
    video: { ...doc.settings.video, ...(change === "missing-model" ? { referenceImageModelId: "" } : {}), ...(change === "unavailable-model" ? { referenceImageModelId: "missing-model" } : {}) },
  }, shots: doc.shots.map((shot) => shot.id !== "s1" ? shot : { ...shot,
    ...(change === "locked" ? { locked: true } : {}),
    ...(change === "pending-plan" ? { description: "新的中文要求", videoPlanDescriptionHash: videoDescriptionHash("旧要求") } : {}),
    ...(change === "nonvideo" ? { kind: "image" as const } : {}),
  }) }));
  const before = getProject(project.id);
  expect((await request(project.id, "POST", { shotIds: ["s0", change === "missing-shot" ? "missing" : "s1"] })).status).toBe(409);
  expect(projectJobs(project.id)).toEqual([]);
  expect(getProject(project.id)).toEqual(before);
  expect(enqueueAutoPortraits).not.toHaveBeenCalled();
  expect(enqueueAutoScenes).not.toHaveBeenCalled();
});

it("reference retry uses the current project model and skips results that became ready", async () => {
  const project = await fixture();
  const { mutateProject } = await import("@/lib/server/projects");
  const { enqueue, projectJobs } = await import("@/lib/server/jobs");
  const { run } = await import("@/lib/server/db");
  const old = enqueue({ projectId: project.id, stage: "shot-reference", key: "old-model-request", input: { shotId: "s1", modelId: "old-image" } });
  run("UPDATE jobs SET status = 'failed', error = 'Model not found' WHERE id = ?", old.id);
  mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => shot.id === "s1" ? { ...shot, sourceImageAssetId: undefined } : shot) }));
  const response = await request(project.id, "POST", { shotIds: ["s0", "s1"], operation: "retry" });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ count: 1, skipped: 1 });
  expect(result.jobs[0].input).toMatchObject({ shotId: "s1", modelId: "test-image" });
  expect(projectJobs(project.id).filter((job) => job.status === "queued")).toHaveLength(1);
  expect(projectJobs(project.id).find((job) => job.id === old.id)?.status).toBe("failed");
});

it("shot status clears historical video errors when a current reference is ready", async () => {
  const project = await fixture();
  const { GET } = await import("@/app/api/projects/[id]/shots/status/route");
  const { enqueue } = await import("@/lib/server/jobs");
  const { run } = await import("@/lib/server/db");
  const old = enqueue({ projectId: project.id, stage: "shot-generate", key: "old-video", input: { shotId: "s0", requestHash: "old-input", frame: { aspect: "16:9" } } });
  run("UPDATE jobs SET status = 'failed', error = 'old video error' WHERE id = ?", old.id);
  const response = await GET(new Request("http://test"), { params: Promise.resolve({ id: project.id }) });
  expect((await response.json()).s0).toMatchObject({ state: "waiting-confirmation", error: null });
});
