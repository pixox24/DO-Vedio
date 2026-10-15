import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { evenChars } from "@/lib/core/align";
import { castSourceHash } from "@/lib/core/cast";
import { blankShot, stampShots } from "@/lib/core/shots";
import { emptyDoc, type Job, type VideoPlan } from "@/lib/core/types";
import { videoDescriptionHash, videoPlanNeedsSync, videoPlanSyncFingerprint } from "@/lib/core/video-plan";
import { sourceImageSnapshot, sourceImageStale, videoGenerationSnapshot } from "@/lib/core/video";

const llm = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/llm", () => ({ generateJson: llm.generateJson }));
vi.mock("@/lib/providers/registry", () => ({
  listTextModels: () => [{ id: "deepseek", configured: true, enabled: true }],
  listProviderProfiles: () => [{ kind: "image", providerId: "replicate", modelId: "test-image", configured: true, enabled: true, adapterStatus: "ready" }, { kind: "video", providerId: "autodl", modelId: "minimax_h3_zm_u08", configured: true, enabled: true, adapterStatus: "ready" }],
}));
let dir = "";
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "dovedio-video-plan-")); process.env.DATA_DIR = dir; });
afterAll(async () => { (await import("@/lib/server/db")).closeDb(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => { llm.generateJson.mockReset(); (await import("@/lib/server/db")).run("DELETE FROM jobs"); });
const frame = { aspect: "16:9" as const, width: 1920, height: 1080, fps: 30 };
const goal = { until: "render" as const, aspects: ["16:9" as const], quality: "final" as const };
const nextPlan: VideoPlan = { startState: "A woman stands by the window in a medium wide composition.", action: "She turns toward the door.", camera: "Static medium wide camera.", endState: "She faces the door." };
const context = () => ({ job: { id: "sync-test" } as Job, signal: new AbortController().signal, current: () => true, progress: vi.fn(), spend: vi.fn(() => 0), log: vi.fn() });

async function fixture() {
  const { createProject } = await import("@/lib/server/projects");
  const { cachePut } = await import("@/lib/server/cache");
  const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
  const doc = emptyDoc();
  doc.settings.visualPipeline = "video";
  doc.settings.video.referenceImageModelId = "replicate::test-image";
  doc.settings.modelId = "deepseek";
  doc.settings.voice.instruction = "自然旁白";
  doc.settings.budgetYuan = null;
  doc.lines = [{ id: "line", text: "她看向门口。", segmentIndex: 0, locked: true, spans: [], keywords: [] }];
  doc.segments = [{ title: "测试", text: doc.lines[0].text }];
  doc.shots = stampShots([{ ...blankShot("shot", "line"), kind: "video", description: "女人面部特写", sourceImageAssetId: "old-reference", sourceImagePromptHash: "unknown", sourceImageConfirmedHash: "old-confirmation", assetId: "old-video", candidates: [{ id: "old", assetId: "old-video", kind: "video", selected: true }], videoPlan: { ...nextPlan, startState: "An extreme close-up of a woman's face." } }], doc.lines);
  doc.castAnalysis = { sourceHash: castSourceHash(doc), modes: [], skipped: [], issues: [] };
  const project = createProject(doc);
  for (const { key, line } of lineTtsKeys(doc, project.id)) cachePut(key, "tts", { assetId: "tts", durationMs: 2000, speechStartMs: 0, speechEndMs: 2000, chars: evenChars(line.text, 0, 2000), aligned: true, spokenChars: line.text.length });
  return project;
}
async function edit(id: string, description = "保持中景，女人转头看向门口") {
  const { getProject, saveProject } = await import("@/lib/server/projects");
  const before = getProject(id)!;
  return saveProject(id, { ...before.doc, shots: before.doc.shots.map((shot) => ({ ...shot, description })) }, before.revision)!;
}

it.each(["PUT", "PATCH"])("%s saves Chinese edits and queues synchronization without calling the model", async (method) => {
  const project = await fixture();
  const routes = await import("@/app/api/projects/[id]/route");
  const { getProject } = await import("@/lib/server/projects");
  const { projectJobs } = await import("@/lib/server/jobs");
  const shots = project.doc.shots.map((shot) => ({ ...shot, description: "全景，女人走到窗边" }));
  const body = method === "PUT" ? { revision: project.revision, doc: { ...project.doc, shots } } : { revision: project.revision, patch: { shots } };
  const response = await routes[method as "PUT" | "PATCH"](new Request("http://test", { method, body: JSON.stringify(body) }), { params: Promise.resolve({ id: project.id }) });
  expect(response.status).toBe(200);
  expect(videoPlanNeedsSync(getProject(project.id)!.doc.shots[0])).toBe(true);
  expect(projectJobs(project.id)).toEqual([expect.objectContaining({ stage: "storyboard", input: expect.objectContaining({ shotId: "shot" }) })]);
  expect(llm.generateJson).not.toHaveBeenCalled();
});

it("Chinese edits invalidate old execution immediately and save queues only a deduplicated plan sync", async () => {
  const project = await fixture();
  const { timelineFor } = await import("@/lib/pipeline/artifacts");
  const { getProject, saveProject } = await import("@/lib/server/projects");
  const { enqueueVideoPlanSyncs } = await import("@/lib/pipeline/video-plan-sync");
  const { planPipeline, drive } = await import("@/lib/pipeline/plan");
  const { videoPrerequisite, enqueueShotReference } = await import("@/lib/pipeline/video-generation");
  const { projectJobs } = await import("@/lib/server/jobs");
  expect(videoPlanNeedsSync(project.doc.shots[0])).toBe(false);
  const oldHash = videoGenerationSnapshot(project.doc, project.doc.shots[0], timelineFor(project.doc, project.id, frame.aspect), frame).hash;
  const current = await edit(project.id);
  expect(videoPlanNeedsSync(current.doc.shots[0])).toBe(true);
  expect(current.doc.shots[0].videoPlan).toEqual(project.doc.shots[0].videoPlan);
  expect(videoGenerationSnapshot(current.doc, current.doc.shots[0], timelineFor(current.doc, project.id, frame.aspect), frame).hash).not.toBe(oldHash);
  expect(videoPrerequisite(current.doc, current.doc.shots[0], timelineFor(current.doc, project.id, frame.aspect))).toContain("同步");
  expect(() => enqueueShotReference(project.id, current.doc, current.doc.shots[0], frame)).toThrow("同步");
  const plan = planPipeline(project.id, current.doc, goal);
  expect(plan.steps.map((step) => step.stage)).toEqual(["storyboard"]);
  expect(plan.steps[0].input).toMatchObject({ shotId: "shot" });
  enqueueVideoPlanSyncs(project.id);
  enqueueVideoPlanSyncs(project.id);
  drive(project.id, goal);
  expect(projectJobs(project.id)).toHaveLength(1);
  expect(projectJobs(project.id)[0].maxAttempts).toBe(1);
  // An old client saving again cannot erase the server's pending marker.
  const latest = getProject(project.id)!;
  const withoutMarker = { ...latest.doc, shots: latest.doc.shots.map((shot) => ({ ...shot, videoPlanDescriptionHash: undefined })) };
  expect(videoPlanNeedsSync(saveProject(project.id, withoutMarker, latest.revision)!.doc.shots[0])).toBe(true);
  expect(llm.generateJson).not.toHaveBeenCalled();
});

it("sync keeps shot identity, timing, history and old media while updating English and expiring the old reference", async () => {
  const project = await fixture();
  const current = await edit(project.id);
  const { storyboardStage } = await import("@/lib/pipeline/stages/storyboard");
  const { getProject } = await import("@/lib/server/projects");
  llm.generateJson.mockResolvedValue({ ...nextPlan, action: 'She turns toward the door and whispers "Your turn".' });
  await expect(storyboardStage.run({ projectId: project.id, modelId: "deepseek", mode: "stale", shotId: "shot", planFingerprint: videoPlanSyncFingerprint(current.doc, current.doc.shots[0]) }, context())).resolves.toEqual({ shots: 1, llmCalls: 1 });
  const shot = getProject(project.id)!.doc.shots[0];
  expect(shot).toMatchObject({ id: "shot", at: project.doc.shots[0].at, description: current.doc.shots[0].description, assetId: "old-video", sourceImageAssetId: "old-reference", candidates: project.doc.shots[0].candidates });
  expect(shot.videoPlan!.startState).toBe(nextPlan.startState);
  expect(shot.videoPlan!.action).not.toMatch(/whisper|Your turn/i);
  expect(shot.videoPlanDescriptionHash).toBe(videoDescriptionHash(shot.description));
  expect(videoPlanNeedsSync(shot)).toBe(false);
  expect(shot.sourceImageConfirmedHash).toBeUndefined();
  expect(sourceImageStale(getProject(project.id)!.doc, shot, frame)).toBe(true);
  const prompt = llm.generateJson.mock.calls[0][2];
  expect(JSON.parse(prompt.prompt).description).toBe(current.doc.shots[0].description);
  expect(prompt.instructions).toContain("最高依据");
});

it.each(["edit", "lock", "pipeline"])("an in-flight sync cannot overwrite a concurrent %s", async (change) => {
  const project = await fixture();
  await edit(project.id);
  const { syncVideoShotPlan } = await import("@/lib/pipeline/video-plan-sync");
  const { getProject, mutateProject } = await import("@/lib/server/projects");
  llm.generateJson.mockImplementationOnce(async () => {
    if (change === "edit") await edit(project.id, "改成全景，女人走出房间");
    else mutateProject(project.id, (doc) => change === "pipeline" ? { ...doc, settings: { ...doc.settings, visualPipeline: "image" } } : { ...doc, shots: doc.shots.map((shot) => ({ ...shot, locked: true })) });
    return nextPlan;
  });
  expect(await syncVideoShotPlan({ projectId: project.id, modelId: "deepseek", shotId: "shot" }, context())).toEqual({ shots: 0, llmCalls: 1 });
  expect(getProject(project.id)!.doc.shots[0].videoPlan).toEqual(project.doc.shots[0].videoPlan);
});

it("superseded queued syncs do not call the model, and a failed sync leaves media blocked", async () => {
  const project = await fixture();
  const old = await edit(project.id);
  const fingerprint = videoPlanSyncFingerprint(old.doc, old.doc.shots[0]);
  const current = await edit(project.id, "改成全景，女人走出房间");
  const { syncVideoShotPlan } = await import("@/lib/pipeline/video-plan-sync");
  const { videoPrerequisite } = await import("@/lib/pipeline/video-generation");
  const { timelineFor } = await import("@/lib/pipeline/artifacts");
  expect(await syncVideoShotPlan({ projectId: project.id, modelId: "deepseek", shotId: "shot", planFingerprint: fingerprint }, context())).toEqual({ shots: 0, llmCalls: 0 });
  expect(llm.generateJson).not.toHaveBeenCalled();
  llm.generateJson.mockRejectedValueOnce(new Error("model unavailable"));
  await expect(syncVideoShotPlan({ projectId: project.id, modelId: "deepseek", shotId: "shot" }, context())).rejects.toThrow("model unavailable");
  expect(videoPrerequisite(current.doc, current.doc.shots[0], timelineFor(current.doc, project.id, frame.aspect))).toContain("同步");
});

it("automatic save sync obeys a zero budget; explicit continuation returns the usual budget gate", async () => {
  const project = await fixture();
  await edit(project.id);
  const { mutateProject } = await import("@/lib/server/projects");
  mutateProject(project.id, (doc) => ({ ...doc, settings: { ...doc.settings, budgetYuan: 0 } }));
  const { enqueueVideoPlanSyncs } = await import("@/lib/pipeline/video-plan-sync");
  const { drive } = await import("@/lib/pipeline/plan");
  const { projectJobs } = await import("@/lib/server/jobs");
  expect(enqueueVideoPlanSyncs(project.id)).toEqual([]);
  expect(drive(project.id, goal).blocked).toContain("超出项目预算");
  expect(projectJobs(project.id)).toHaveLength(0);
});

it("silent static requests and their hashes use the same cleaned opening state", async () => {
  const project = await fixture();
  const { sanitizeVideoPlan } = await import("@/lib/core/video-plan");
  const { compileVideoReferencePrompt } = await import("@/lib/core/video-prompt-compiler");
  const raw = { ...project.doc.shots[0], videoPlan: { ...nextPlan, startState: 'A woman stands by the window and whispers "Your turn".' } };
  const clean = { ...raw, videoPlan: sanitizeVideoPlan(raw.videoPlan) };
  expect(compileVideoReferencePrompt(project.doc, raw).full).toBe(compileVideoReferencePrompt(project.doc, clean).full);
  expect(sourceImageSnapshot(project.doc, raw, frame).promptHash).toBe(sourceImageSnapshot(project.doc, clean, frame).promptHash);
});
