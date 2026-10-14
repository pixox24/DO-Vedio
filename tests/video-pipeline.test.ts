import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { evenChars } from "@/lib/core/align";
import { blankShot, stampShots } from "@/lib/core/shots";
import { emptyDoc, type ProjectDoc } from "@/lib/core/types";
import { castSourceHash } from "@/lib/core/cast";
import { sourceImageSnapshot, videoGenerationSnapshot } from "@/lib/core/video";

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@/lib/providers/registry", () => ({
  listTextModels: () => [{ id: "test-text", configured: true, enabled: true }],
  listProviderProfiles: () => [
    { kind: "image", providerId: "replicate", modelId: "test-image", configured: true, enabled: true, adapterStatus: "ready" },
    { kind: "video", providerId: "autodl", modelId: "minimax_h3_zm_u08", configured: true, enabled: true, adapterStatus: "ready" },
  ],
}));
vi.mock("@/lib/pipeline/media-gen", async (importOriginal) => ({ ...await importOriginal<object>(), generateMediaAssets: mocks.generate }));
let dir = "";
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "dovedio-video-pipeline-")); process.env.DATA_DIR = dir; });
afterAll(async () => { (await import("@/lib/server/db")).closeDb(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => { (await import("@/lib/server/db")).run("DELETE FROM jobs"); mocks.generate.mockReset(); });
const goal = { until: "compose" as const, aspects: ["16:9" as const], quality: "draft" as const };
async function fixture(count = 1) {
  const { createProject } = await import("@/lib/server/projects");
  const { cachePut } = await import("@/lib/server/cache");
  const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
  const doc = emptyDoc();
  doc.settings.visualPipeline = "video";
  doc.settings.modelId = "test-text";
  doc.settings.voice.instruction = "自然口播";
  doc.settings.video.referenceImageModelId = "replicate::test-image";
  doc.settings.assetFraming = "shared";
  doc.lines = Array.from({ length: count }, (_, index) => ({ id: `l${index}`, text: `这是第${index}段旁白。`, segmentIndex: 0, locked: true, spans: [], keywords: [] }));
  doc.segments = [{ title: "测试", text: doc.lines.map((line) => line.text).join("") }];
  doc.shots = stampShots(doc.lines.map((line, index) => ({ ...blankShot(`s${index}`, line.id), kind: "video" as const, mode: "generate" as const, groupId: "g", videoPlan: { startState: "A subject stands by a window", action: "The subject turns", camera: "Static camera", endState: "The subject faces the window" } })), doc.lines);
  doc.castAnalysis = { sourceHash: castSourceHash(doc), modes: [], skipped: [], issues: [] };
  const project = createProject(doc);
  for (const { key, line } of lineTtsKeys(doc, project.id)) cachePut(key, "tts", { assetId: `tts-${line.id}`, durationMs: 2000, speechStartMs: 0, speechEndMs: 2000, chars: evenChars(line.text, 0, 2000), aligned: true, spokenChars: line.text.length });
  return project;
}
async function reference(projectId: string, confirm = false) {
  const { mutateProject } = await import("@/lib/server/projects");
  const { videoFrame } = await import("@/lib/pipeline/video-generation");
  return mutateProject(projectId, (doc) => ({ ...doc, shots: doc.shots.map((shot) => {
    const next = { ...shot, sourceImageAssetId: "input-image", sourceImagePromptHash: "unknown" };
    return { ...next, sourceImageConfirmedHash: confirm ? sourceImageSnapshot(doc, next, videoFrame(doc)).hash : undefined };
  }) }))!;
}
function context(job: import("@/lib/core/types").Job) { return { job, signal: new AbortController().signal, current: () => true, progress: vi.fn(), spend: () => 0, log: vi.fn() }; }

it("default confirmation occupies no worker; valid confirmation wakes blocked goal; autoContinue bypasses only confirmation", async () => {
  const project = await fixture();
  const { planPipeline, setGoal, wakeCurrentGoal, getGoal } = await import("@/lib/pipeline/plan");
  const initial = planPipeline(project.id, project.doc, goal);
  expect(initial.steps.filter((step) => step.stage === "shot-reference")).toHaveLength(1);
  const chosen = await reference(project.id);
  const waiting = planPipeline(project.id, chosen.doc, goal);
  expect(waiting.steps.filter((step) => step.stage === "shot-generate")).toHaveLength(0);
  expect(waiting.waiting.join(" ")).toContain("等待确认");
  setGoal(project.id, goal);
  wakeCurrentGoal(project.id);
  expect(getGoal(project.id)?.blocked).toContain("等待确认");
  const { PATCH } = await import("@/app/api/projects/[id]/shots/[shotId]/reference/route");
  const { videoFrame } = await import("@/lib/pipeline/video-generation");
  const hash = sourceImageSnapshot(chosen.doc, chosen.doc.shots[0], videoFrame(chosen.doc)).hash;
  const stale = await PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify({ confirmHash: "old" }) }), { params: Promise.resolve({ id: project.id, shotId: "s0" }) });
  expect(stale.status).toBe(409);
  const valid = await PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify({ confirmHash: hash }) }), { params: Promise.resolve({ id: project.id, shotId: "s0" }) });
  expect(valid.status).toBe(200);
  expect(getGoal(project.id)?.blocked).toBeNull();
  const { projectJobs } = await import("@/lib/server/jobs");
  expect(projectJobs(project.id).filter((job) => job.stage === "shot-generate")).toHaveLength(1);
  chosen.doc.settings.video.autoContinue = true;
  expect(planPipeline(project.id, chosen.doc, goal).steps.some((step) => step.stage === "shot-generate")).toBe(true);
  chosen.doc.shots[0].sourceImageAssetId = undefined;
  expect(planPipeline(project.id, chosen.doc, goal).steps.some((step) => step.stage === "shot-generate")).toBe(false);
});

it("reference failure does not submit video; edited/locked/old execution cannot adopt reference result", async () => {
  const project = await fixture();
  const { enqueueShotReference, videoFrame } = await import("@/lib/pipeline/video-generation");
  const { shotReferenceStage } = await import("@/lib/pipeline/stages/shot-reference");
  const { mutateProject, getProject } = await import("@/lib/server/projects");
  const job = enqueueShotReference(project.id, project.doc, project.doc.shots[0], videoFrame(project.doc));
  mocks.generate.mockRejectedValueOnce(new Error("reference failed"));
  await expect(shotReferenceStage.run(job.input as never, context(job))).rejects.toThrow("reference failed");
  expect(getProject(project.id)?.doc.shots[0].sourceImageAssetId).toBeUndefined();
  mocks.generate.mockImplementationOnce(async () => {
    mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => ({ ...shot, locked: true })) }));
    return { assets: ["generated-image"] };
  });
  await shotReferenceStage.run(job.input as never, context(job));
  expect(getProject(project.id)?.doc.shots[0].sourceImageAssetId).toBeUndefined();
  mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => ({ ...shot, locked: false })) }));
  mocks.generate.mockResolvedValueOnce({ assets: ["old-image"] });
  await shotReferenceStage.run(job.input as never, { ...context(job), current: () => false });
  expect(getProject(project.id)?.doc.shots[0].sourceImageAssetId).toBeUndefined();
});

it("single-shot API waits for reference confirmation then queues only the requested video and reaches the media adapter", async () => {
  const project = await fixture(3);
  await (await import("@/lib/visual-styles/store")).ensureProjectVisualStyle(project.id);
  const chosen = await reference(project.id);
  const { POST } = await import("@/app/api/projects/[id]/shots/[shotId]/generate/route");
  const { PATCH } = await import("@/app/api/projects/[id]/shots/[shotId]/reference/route");
  const { getProject } = await import("@/lib/server/projects");
  const { projectJobs } = await import("@/lib/server/jobs");
  const { videoFrame } = await import("@/lib/pipeline/video-generation");
  const params = { params: Promise.resolve({ id: project.id, shotId: "s1" }) };
  const generate = () => POST(new Request("http://test", { method: "POST", body: JSON.stringify({ kind: "video", operation: "generate", modelId: chosen.doc.settings.video.modelId, candidateCount: 1, outputSpecId: "landscape-1080p" }) }), params);
  const blocked = await generate();
  expect(blocked.status).toBe(409);
  expect((await blocked.json()).error).toContain("等待确认参考图");
  expect(projectJobs(project.id)).toHaveLength(0);
  expect(mocks.generate).not.toHaveBeenCalled();

  const hash = sourceImageSnapshot(chosen.doc, chosen.doc.shots[1], videoFrame(chosen.doc)).hash;
  const confirmed = await PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify({ confirmHash: hash }) }), params);
  expect(confirmed.status).toBe(200);
  expect(projectJobs(project.id)).toHaveLength(0);
  const response = await generate();
  expect(response.status).toBe(200);
  const { job, attemptId } = await response.json() as { job: import("@/lib/core/types").Job; attemptId: string };
  expect(projectJobs(project.id)).toHaveLength(1);
  expect(job).toMatchObject({ stage: "shot-generate", status: "queued", input: { shotId: "s1", kind: "video", attemptId, frame: { aspect: "16:9" } } });
  const untouched = [getProject(project.id)!.doc.shots[0], getProject(project.id)!.doc.shots[2]];
  mocks.generate.mockResolvedValueOnce({ assets: ["single-video-result"] });
  await (await import("@/lib/pipeline/stages/shot-generate")).shotGenerateStage.run(job.input as never, context(job));
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect(mocks.generate.mock.calls[0][0]).toMatchObject({ kind: "video", modelId: "autodl::minimax_h3_zm_u08", references: ["input-image"], targetDurationMs: 2250, requestDurationSeconds: 3, resolution: "768p", meta: { shotId: "s1" }, recovery: { attemptId } });
  const after = getProject(project.id)!.doc;
  expect(after.shots[1].candidates).toEqual([expect.objectContaining({ kind: "video", assetId: "single-video-result" })]);
  expect([after.shots[0], after.shots[2]]).toEqual(untouched);
});

it("video worker uses one snapshot and original attempt across canceled jobs, preserving selected candidates", async () => {
  const project = await fixture();
  const chosen = await reference(project.id, true);
  const { enqueueVideoShot, videoFrame } = await import("@/lib/pipeline/video-generation");
  const { cancelJob } = await import("@/lib/server/jobs");
  const { shotGenerateStage } = await import("@/lib/pipeline/stages/shot-generate");
  const { getProject, mutateProject } = await import("@/lib/server/projects");
  const frame = videoFrame(chosen.doc);
  const first = enqueueVideoShot({ projectId: project.id, doc: chosen.doc, shot: chosen.doc.shots[0], frame });
  cancelJob(first.job.id);
  const resumed = enqueueVideoShot({ projectId: project.id, doc: chosen.doc, shot: chosen.doc.shots[0], frame, operation: "resume", resumeAttemptId: first.attemptId });
  expect(resumed.attemptId).toBe(first.attemptId);
  mocks.generate.mockResolvedValueOnce({ assets: ["video-one"] });
  await shotGenerateStage.run(resumed.job.input as never, context(resumed.job));
  const adopted = getProject(project.id)!.doc.shots[0];
  const snapshot = videoGenerationSnapshot(chosen.doc, chosen.doc.shots[0], (await import("@/lib/pipeline/artifacts")).timelineFor(chosen.doc, project.id, frame.aspect), frame);
  expect(adopted.assetPromptHash).toBe(snapshot.hash);
  expect(adopted.candidates[0]).toMatchObject({ kind: "video", promptHash: snapshot.hash, generationPromptHash: snapshot.hash });
  const mediaRequest = mocks.generate.mock.calls[0][0];
  expect(mediaRequest.recovery.attemptId).toBe(first.attemptId);
  expect(mediaRequest.recovery.requestHash).toBe(snapshot.hash);
  cancelJob(resumed.job.id);
  const changed = mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => ({ ...shot, videoPlan: { ...shot.videoPlan!, action: "The subject waves" } })) }))!;
  expect(() => enqueueVideoShot({ projectId: project.id, doc: changed.doc, shot: changed.doc.shots[0], frame, operation: "resume", resumeAttemptId: first.attemptId })).toThrow("不匹配");
  const next = enqueueVideoShot({ projectId: project.id, doc: changed.doc, shot: changed.doc.shots[0], frame, operation: "regenerate" });
  mocks.generate.mockResolvedValueOnce({ assets: ["video-two"] });
  await shotGenerateStage.run(next.job.input as never, context(next.job));
  expect(getProject(project.id)!.doc.shots[0].assetId).toBe("video-one");
  const plan = (await import("@/lib/pipeline/plan")).planPipeline(project.id, getProject(project.id)!.doc, goal);
  expect(plan.steps.some((step) => step.stage === "shot-generate")).toBe(false);
  expect(plan.waiting.join(" ")).toContain("请选择");
});

it("three shots invalidate locally and render gate checks duration/current hash/shared source aspect", async () => {
  const project = await fixture(3);
  const chosen = await reference(project.id, true);
  const { timelineFor } = await import("@/lib/pipeline/artifacts");
  const { videoRenderProblems, videoFrame } = await import("@/lib/pipeline/video-generation");
  const { putBuffer } = await import("@/lib/server/media");
  const { run } = await import("@/lib/server/db");
  const asset = await putBuffer(Buffer.from("video fixture"), { ext: "mp4", mime: "video/mp4", probe: false });
  run("UPDATE assets SET duration_ms = 10000 WHERE hash = ?", asset.hash);
  const doc: ProjectDoc = structuredClone(chosen.doc);
  const frame = videoFrame(doc);
  const timeline = timelineFor(doc, project.id, frame.aspect);
  for (const shot of doc.shots) {
    const snapshot = videoGenerationSnapshot(doc, shot, timeline, frame);
    shot.assetId = asset.hash; shot.assetPromptHash = snapshot.hash;
    shot.assetVariants["16:9"] = { aspect: "16:9", assetId: asset.hash, promptHash: snapshot.hash, width: 1920, height: 1080, source: "generated" };
    shot.assetVariants["9:16"] = { aspect: "9:16", assetId: asset.hash, promptHash: snapshot.hash, width: 1080, height: 1920, source: "shared", sourceAspect: "16:9" };
  }
  expect(videoRenderProblems(doc, timeline, frame)).toEqual([]);
  expect(videoRenderProblems(doc, timelineFor(doc, project.id, "9:16"), { aspect: "9:16", width: 1080, height: 1920 })).toEqual([]);
  doc.settings.previewAspect = "9:16";
  expect(videoFrame(doc).aspect).toBe("16:9");
  doc.shots[1].videoPlan!.action = "The subject sits";
  expect(videoRenderProblems(doc, timelineFor(doc, project.id, frame.aspect), frame)).toHaveLength(1);
  run("UPDATE assets SET duration_ms = 100 WHERE hash = ?", asset.hash);
  expect(videoRenderProblems(doc, timelineFor(doc, project.id, frame.aspect), frame)).toHaveLength(3);
});

it("claim limits running video jobs to two without reducing image concurrency and waits standard references", async () => {
  const { enqueue, claim, cancelJob } = await import("@/lib/server/jobs");
  const { run } = await import("@/lib/server/db");
  for (let i = 0; i < 3; i++) enqueue({ projectId: "p", stage: "shot-generate", key: `v${i}`, input: { kind: "video" } });
  expect(claim("w1", ["shot-generate"])).toBeTruthy();
  expect(claim("w2", ["shot-generate"])).toBeTruthy();
  expect(claim("w3", ["shot-generate"])).toBeUndefined();
  const image = enqueue({ projectId: "p", stage: "shot-generate", key: "image", input: { kind: "image" } });
  expect(claim("w4", ["shot-generate"])?.id).toBe(image.id);
  run("DELETE FROM jobs");
  const project = await fixture();
  (await import("@/lib/server/projects")).mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => ({ ...shot, sceneId: "scene" })) }));
  const standard = enqueue({ projectId: project.id, stage: "scene-reference", key: "standard", input: { sceneId: "scene" } });
  const reference = enqueue({ projectId: project.id, stage: "shot-reference", key: "ref", input: { shotId: "s0" } });
  expect(claim("w5", ["shot-reference"])).toBeUndefined();
  cancelJob(standard.id);
  expect(claim("w5", ["shot-reference"])?.id).toBe(reference.id);
});

it("status distinguishes an idle ready shot and stopped original polling from active work", async () => {
  const project = await fixture();
  const chosen = await reference(project.id, true);
  const { GET } = await import("@/app/api/projects/[id]/shots/status/route");
  const read = async () => (await GET(new Request("http://test"), { params: Promise.resolve({ id: project.id }) })).json();
  expect((await read()).s0.state).toBe("ready-to-generate");
  const { enqueueVideoShot, videoFrame } = await import("@/lib/pipeline/video-generation");
  const { beginGenerationRun } = await import("@/lib/providers/runs");
  const { cancelJob, claim, failJob } = await import("@/lib/server/jobs");
  const first = enqueueVideoShot({ projectId: project.id, doc: chosen.doc, shot: chosen.doc.shots[0], frame: videoFrame(chosen.doc) });
  beginGenerationRun({ projectId: project.id, jobId: first.job.id, kind: "video", modelId: "autodl::minimax_h3_zm_u08", providerId: "autodl", inputHash: (first.job.input as { requestHash: string }).requestHash,
    params: { shotId: "s0", attemptId: first.attemptId, requestHash: (first.job.input as { requestHash: string }).requestHash, candidateIndex: 0, phase: "polling", taskId: "original-task", submissionStarted: true, costStatus: "unknown" } });
  expect((await read()).s0.state).toBe("queued");
  cancelJob(first.job.id);
  expect((await read()).s0).toMatchObject({ state: "canceled", attemptId: first.attemptId, providerTaskId: "original-task" });
  const resume = enqueueVideoShot({ projectId: project.id, doc: chosen.doc, shot: chosen.doc.shots[0], frame: videoFrame(chosen.doc), operation: "resume", resumeAttemptId: first.attemptId });
  claim("w", ["shot-generate"]);
  failJob(resume.job.id, "w", "poll failed", false);
  expect((await read()).s0).toMatchObject({ state: "failed", attemptId: first.attemptId });
});

it("standard reference completion without goalId and a new goal reusing active media both advance", async () => {
  const project = await fixture();
  const chosen = await reference(project.id, true);
  const { enqueue, projectJobs, cancelJob } = await import("@/lib/server/jobs");
  const { mutateProject } = await import("@/lib/server/projects");
  const { setGoal, wakeCurrentGoal, getGoal, advance, drive } = await import("@/lib/pipeline/plan");
  mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => ({ ...shot, sceneId: "scene" })) }));
  const standard = enqueue({ projectId: project.id, stage: "scene-reference", key: "unscoped-standard", input: { sceneId: "scene" } });
  setGoal(project.id, goal);
  wakeCurrentGoal(project.id);
  cancelJob(standard.id);
  advance({ ...standard, status: "succeeded" });
  // Changing references invalidates confirmation, so explicitly confirm the current source.
  await reference(project.id, true);
  wakeCurrentGoal(project.id);
  expect(projectJobs(project.id).some((job) => job.stage === "shot-generate")).toBe(true);
  drive(project.id, goal);
  expect(getGoal(project.id)?.blocked).toBeNull();
  expect(projectJobs(project.id).filter((job) => job.stage === "shot-generate")).toHaveLength(1);
  void chosen;
});

it("default smart-dual generates one source video and shares variants across both outputs", async () => {
  const project = await fixture();
  await reference(project.id, true);
  const { mutateProject, getProject } = await import("@/lib/server/projects");
  const current = mutateProject(project.id, (doc) => ({ ...doc, settings: { ...doc.settings, assetFraming: "smart-dual", aspects: ["16:9", "9:16"], outputSpecIds: ["landscape-1080p", "portrait-1080p"] } }))!;
  const { planPipeline } = await import("@/lib/pipeline/plan");
  const { enqueueVideoShot, videoFrame, videoRenderProblems } = await import("@/lib/pipeline/video-generation");
  const { timelineFor } = await import("@/lib/pipeline/artifacts");
  const plan = planPipeline(project.id, current.doc, { ...goal, aspects: ["16:9", "9:16"] });
  expect(plan.steps.filter((step) => step.stage === "shot-generate")).toHaveLength(1);
  const { putBuffer } = await import("@/lib/server/media");
  const asset = await putBuffer(Buffer.from("dual-output-video"), { ext: "mp4", mime: "video/mp4", probe: false });
  (await import("@/lib/server/db")).run("UPDATE assets SET duration_ms = 10000 WHERE hash = ?", asset.hash);
  const job = enqueueVideoShot({ projectId: project.id, doc: current.doc, shot: current.doc.shots[0], frame: videoFrame(current.doc) });
  mocks.generate.mockResolvedValueOnce({ assets: [asset.hash] });
  await (await import("@/lib/pipeline/stages/shot-generate")).shotGenerateStage.run(job.job.input as never, context(job.job));
  const doc = getProject(project.id)!.doc;
  expect(doc.shots[0].assetVariants["9:16"]).toMatchObject({ assetId: asset.hash, source: "shared", sourceAspect: "16:9" });
  const { PATCH } = await import("@/app/api/projects/[id]/shots/[shotId]/generate/route");
  const selected = await PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify({ candidateId: doc.shots[0].candidates[0].id, aspect: "9:16" }) }), { params: Promise.resolve({ id: project.id, shotId: "s0" }) });
  expect(selected.status).toBe(200);
  expect(getProject(project.id)!.doc.shots[0].assetVariants["9:16"]).toMatchObject({ source: "shared", sourceAspect: "16:9" });
  expect(videoRenderProblems(doc, timelineFor(doc, project.id, "9:16"), { aspect: "9:16", width: 1080, height: 1920 })).toEqual([]);
  const { renderStage } = await import("@/lib/pipeline/stages/render");
  (await import("@/lib/server/db")).run("UPDATE assets SET duration_ms = 100 WHERE hash = ?", asset.hash);
  await expect(renderStage.run({ projectId: project.id, aspect: "9:16", quality: "draft" }, context(job.job))).rejects.toThrow("视频时长不足");
});

it("an existing reference job survives standard-reference changes without a duplicate reference request", async () => {
  const project = await fixture();
  const { mutateProject } = await import("@/lib/server/projects");
  const { sceneCardSchema } = await import("@/lib/core/types");
  const { enqueueShotReference, videoFrame } = await import("@/lib/pipeline/video-generation");
  const { planPipeline } = await import("@/lib/pipeline/plan");
  const before = mutateProject(project.id, (doc) => ({ ...doc, scenes: [sceneCardSchema.parse({ id: "scene", name: "Window room", description: "A bright room" })], shots: doc.shots.map((shot) => ({ ...shot, sceneId: "scene" })) }))!;
  const job = enqueueShotReference(project.id, before.doc, before.doc.shots[0], videoFrame(before.doc));
  const updated = mutateProject(project.id, (doc) => ({ ...doc, scenes: doc.scenes.map((scene) => ({ ...scene, referenceAssetIds: ["standard-image"] })) }))!;
  const plan = planPipeline(project.id, updated.doc, goal);
  expect(plan.steps.filter((step) => step.stage === "shot-reference")).toHaveLength(0);
  expect(plan.currentKeys).toContain(job.key);
  expect(enqueueShotReference(project.id, updated.doc, updated.doc.shots[0], videoFrame(updated.doc)).id).toBe(job.id);
});

it("per-output status tracks the requested output and keeps source confirmation on the primary frame", async () => {
  const project = await fixture();
  await reference(project.id, true);
  const { mutateProject, getProject } = await import("@/lib/server/projects");
  const current = mutateProject(project.id, (doc) => ({ ...doc, settings: { ...doc.settings, assetFraming: "per-output", aspects: ["16:9", "9:16"], outputSpecIds: ["landscape-1080p", "portrait-1080p"] } }))!;
  const { enqueueVideoShot, videoFrame } = await import("@/lib/pipeline/video-generation");
  const { outputSpecForRequest } = await import("@/lib/core/output-spec");
  const { shotGenerateStage } = await import("@/lib/pipeline/stages/shot-generate");
  const { GET } = await import("@/app/api/projects/[id]/shots/status/route");
  const { PATCH } = await import("@/app/api/projects/[id]/shots/[shotId]/generate/route");
  const { putBuffer } = await import("@/lib/server/media");
  const { run } = await import("@/lib/server/db");
  const { cancelJob } = await import("@/lib/server/jobs");
  const { beginGenerationRun } = await import("@/lib/providers/runs");
  const mainAsset = await putBuffer(Buffer.from("per-output-main"), { ext: "mp4", mime: "video/mp4", probe: false });
  const secondAsset = await putBuffer(Buffer.from("per-output-second"), { ext: "mp4", mime: "video/mp4", probe: false });
  run("UPDATE assets SET duration_ms = 10000 WHERE hash IN (?, ?)", mainAsset.hash, secondAsset.hash);
  const read = async (spec: string) => (await GET(new Request(`http://test?outputSpecId=${spec}`), { params: Promise.resolve({ id: project.id }) })).json();
  const main = enqueueVideoShot({ projectId: project.id, doc: current.doc, shot: current.doc.shots[0], frame: videoFrame(current.doc) });
  mocks.generate.mockResolvedValueOnce({ assets: [mainAsset.hash] });
  await shotGenerateStage.run(main.job.input as never, context(main.job));
  run("UPDATE jobs SET status = 'succeeded' WHERE id = ?", main.job.id);
  expect((await read("landscape-1080p")).s0.state).toBe("ready");
  expect((await read("portrait-1080p")).s0.state).toBe("stale");
  expect((await read("portrait-1080p")).s0.snapshotHash).toBe((await read("landscape-1080p")).s0.snapshotHash);
  const primary = getProject(project.id)!;
  const second = enqueueVideoShot({ projectId: project.id, doc: primary.doc, shot: primary.doc.shots[0], frame: outputSpecForRequest(primary.doc.settings, "portrait-1080p") });
  const requestHash = (second.job.input as { requestHash: string }).requestHash;
  beginGenerationRun({ projectId: project.id, jobId: second.job.id, kind: "video", modelId: "autodl::minimax_h3_zm_u08", providerId: "autodl", inputHash: requestHash,
    params: { shotId: "s0", attemptId: second.attemptId, requestHash, candidateIndex: 0, phase: "polling", taskId: "portrait-task", submissionStarted: true, costStatus: "unknown" } });
  cancelJob(second.job.id);
  expect((await read("portrait-1080p")).s0).toMatchObject({ state: "canceled", attemptId: second.attemptId, providerTaskId: "portrait-task" });
  expect((await read("landscape-1080p")).s0.state).toBe("ready");
  mocks.generate.mockResolvedValueOnce({ assets: [secondAsset.hash] });
  await shotGenerateStage.run(second.job.input as never, context(second.job));
  run("UPDATE jobs SET status = 'succeeded' WHERE id = ?", second.job.id);
  expect((await read("portrait-1080p")).s0.state).toBe("ready");
  const adopted = getProject(project.id)!.doc.shots[0];
  const mainCandidate = adopted.candidates.find((candidate) => candidate.assetId === mainAsset.hash)!;
  const secondCandidate = adopted.candidates.find((candidate) => candidate.assetId === secondAsset.hash)!;
  expect(secondCandidate.frame?.aspect).toBe("9:16");
  const select = (candidateId: string) => PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify({ candidateId, aspect: "9:16" }) }), { params: Promise.resolve({ id: project.id, shotId: "s0" }) });
  expect((await select(mainCandidate.id)).status).toBe(409);
  mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => ({ ...shot, candidates: [...shot.candidates, { ...mainCandidate, id: "legacy-video", frame: undefined }] })) }));
  expect((await select("legacy-video")).status).toBe(409);
  expect((await select(secondCandidate.id)).status).toBe(200);
  expect(getProject(project.id)!.doc.shots[0].assetVariants["16:9"]?.assetId).toBe(mainAsset.hash);
});

it.each(["edit", "lock", "lost-execution"])("video completion cannot adopt after %s during provider callbacks", async (change) => {
  const project = await fixture();
  const chosen = await reference(project.id, true);
  const { enqueueVideoShot, videoFrame } = await import("@/lib/pipeline/video-generation");
  const { shotGenerateStage } = await import("@/lib/pipeline/stages/shot-generate");
  const { mutateProject, getProject } = await import("@/lib/server/projects");
  const job = enqueueVideoShot({ projectId: project.id, doc: chosen.doc, shot: chosen.doc.shots[0], frame: videoFrame(chosen.doc) });
  let current = true;
  mocks.generate.mockImplementationOnce(async (request: import("@/lib/pipeline/media-gen").MediaRequest) => {
    await request.onRecovery?.({ runId: "mock-run", attemptId: job.attemptId!, phase: "polling", providerTaskId: "mock-task", costStatus: "unknown" });
    if (change === "lost-execution") current = false;
    else mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => change === "lock" ? { ...shot, locked: true } : { ...shot, videoPlan: { ...shot.videoPlan!, action: "The subject starts a new action" } }) }));
    await request.onRecovery?.({ runId: "mock-run", attemptId: job.attemptId!, phase: "ready", providerTaskId: "mock-task", costStatus: "unknown" });
    return { assets: ["old-video-result"] };
  });
  await shotGenerateStage.run(job.job.input as never, { ...context(job.job), current: () => current });
  expect(mocks.generate).toHaveBeenCalledTimes(1);
  const shot = getProject(project.id)!.doc.shots[0];
  expect(shot.assetId).toBeUndefined();
  expect(shot.assetPromptHash).toBeUndefined();
  expect(shot.candidates).toEqual([]);
  expect(shot.assetVariants).toEqual({});
  if (change === "edit") expect(shot.videoPlan!.action).toBe("The subject starts a new action");
  if (change === "lock") expect(shot.locked).toBe(true);
});
