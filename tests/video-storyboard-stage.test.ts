import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { NoObjectGeneratedError } from "ai";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { evenChars } from "@/lib/core/align";
import { blankShot, stampShots } from "@/lib/core/shots";
import { emptyDoc, type Job, type Line } from "@/lib/core/types";
import type { StoryboardPayload } from "@/lib/prompts";

const llm = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/llm", () => ({ generateJson: llm.generateJson }));
let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-video-storyboard-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => { llm.generateJson.mockReset(); });

async function fixture(count: number, pipeline: "image" | "video" = "video") {
  const { createProject } = await import("@/lib/server/projects");
  const { cachePut } = await import("@/lib/server/cache");
  const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
  const doc = emptyDoc();
  doc.settings.visualPipeline = pipeline;
  doc.lines = Array.from({ length: count }, (_, index): Line => ({ id: `l${index}`, text: `这是第${index}句旁白。`, segmentIndex: 0, locked: true, spans: [], keywords: [] }));
  doc.segments = [{ title: "故事", text: doc.lines.map((line) => line.text).join("") }];
  // Reproduce an image project that has already completed its original storyboard.
  doc.shots = stampShots(doc.lines.map((line, index) => ({ ...blankShot(`old-${index}`, line.id), description: "旧图片分镜" })), doc.lines);
  const project = createProject(doc);
  for (const { key, line } of lineTtsKeys(doc, project.id)) {
    cachePut(key, "tts", { assetId: `tts-${line.id}`, durationMs: 2000, speechStartMs: 0, speechEndMs: 2000, chars: evenChars(line.text, 0, 2000), aligned: true, spokenChars: line.text.length });
  }
  return project;
}

const payloadOf = (prompt: { prompt: string }) => JSON.parse(prompt.prompt) as StoryboardPayload;
function output(payload: StoryboardPayload) {
  return { shots: payload.lines.map((line) => ({
    lineId: line.id, char: 0, intent: "转身", kind: "placeholder", mode: "generate", shotSize: "medium",
    description: "女人在窗边转身", motion: "none", importance: 1, groupId: "窗边", videoPlan: {
      startState: "A woman in a blue coat stands by the library window.", action: "She turns toward the desk.",
      camera: "Static medium shot.", endState: `She faces the desk after ${line.id}.`,
    },
  })) };
}
const parseError = () => new NoObjectGeneratedError({
  message: "No object generated: could not parse the response.", text: '{"shots":[', finishReason: "length",
  response: { id: "mock", timestamp: new Date(), modelId: "mock" },
  usage: { inputTokens: 100, outputTokens: 8192, totalTokens: 8292, inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, outputTokenDetails: { textTokens: 8192, reasoningTokens: 0 } },
});
function context() {
  return { job: { id: "storyboard-job" } as Job, signal: new AbortController().signal, current: () => true, progress: vi.fn(), spend: vi.fn(() => 0), log: vi.fn() };
}

it("converts a 34-line image storyboard in bounded calls, preserving TTS and adjacent video context", async () => {
  const project = await fixture(34);
  const { storyboardStage } = await import("@/lib/pipeline/stages/storyboard");
  const { getProject } = await import("@/lib/server/projects");
  const { loadArtifacts } = await import("@/lib/pipeline/artifacts");
  const before = loadArtifacts(project.doc, project.id);
  llm.generateJson.mockImplementation(async (_model, _schema, prompt) => output(payloadOf(prompt)));
  const ctx = context();
  const result = await storyboardStage.run({ projectId: project.id, modelId: "deepseek", mode: "stale" }, ctx);
  const doc = getProject(project.id)!.doc;
  expect(result).toEqual({ shots: 34, llmCalls: 6 });
  expect(doc.shots.map((shot) => shot.at.lineId)).toEqual(project.doc.lines.map((line) => line.id));
  expect(doc.shots.every((shot) => shot.kind === "video" && !!shot.videoPlan)).toBe(true);
  expect(loadArtifacts(doc, project.id)).toEqual(before);
  const payloads = llm.generateJson.mock.calls.map((call) => payloadOf(call[2]));
  expect(payloads.map((payload) => payload.lines.length)).toEqual([6, 6, 6, 6, 6, 4]);
  expect(payloads.every((payload) => payload.lines.every((line) => line.estimated === false))).toBe(true);
  expect(payloads[1].partial?.before?.shot).toContain("She faces the desk after l5.");
  expect(llm.generateJson.mock.calls.every((call) => call[4] === 0 && call[5].maxOutputTokens === 8192)).toBe(true);
  expect(ctx.progress).toHaveBeenLastCalledWith(1, "视频分镜 34/34 句");
});

it("recovers malformed JSON by dividing only the failed range and records its finish reason", async () => {
  const project = await fixture(6);
  const { storyboardStage } = await import("@/lib/pipeline/stages/storyboard");
  llm.generateJson.mockImplementation(async (_model, _schema, prompt) => {
    const payload = payloadOf(prompt);
    if (payload.lines.length > 3) throw parseError();
    return output(payload);
  });
  const result = await storyboardStage.run({ projectId: project.id, modelId: "deepseek", mode: "stale" }, context());
  expect(result).toEqual({ shots: 6, llmCalls: 2 });
  expect(llm.generateJson.mock.calls.map((call) => payloadOf(call[2]).lines.map((line) => line.id))).toEqual([
    ["l0", "l1", "l2", "l3", "l4", "l5"], ["l0", "l1", "l2"], ["l3", "l4", "l5"],
  ]);
  const { listGenerationRuns } = await import("@/lib/providers/runs");
  expect(listGenerationRuns(project.id).find((run) => run.status === "failed")?.params).toMatchObject({ finishReason: "length", responseChars: 10, recovery: "split-range" });
});

it("stops a malformed single-line response without job retries and keeps existing shots intact", async () => {
  const project = await fixture(1);
  const { storyboardStage } = await import("@/lib/pipeline/stages/storyboard");
  const { isRetryable } = await import("@/lib/pipeline/stage");
  const { getProject } = await import("@/lib/server/projects");
  llm.generateJson.mockRejectedValue(parseError());
  const error = await storyboardStage.run({ projectId: project.id, modelId: "deepseek", mode: "stale" }, context()).catch((error) => error);
  expect(error.message).toContain("输出达到长度上限");
  expect(isRetryable(error)).toBe(false);
  expect(llm.generateJson).toHaveBeenCalledOnce();
  expect(getProject(project.id)!.doc.shots).toEqual(project.doc.shots);
});

it("resumes cached successful ranges after a transport failure without repeating those model calls", async () => {
  const project = await fixture(12);
  const { storyboardStage } = await import("@/lib/pipeline/stages/storyboard");
  const { getProject } = await import("@/lib/server/projects");
  llm.generateJson.mockImplementation(async (_model, _schema, prompt) => {
    const payload = payloadOf(prompt);
    if (payload.lines[0].id === "l6") throw Object.assign(new Error("service unavailable"), { statusCode: 503 });
    return output(payload);
  });
  const input = { projectId: project.id, modelId: "deepseek", mode: "stale" as const };
  await expect(storyboardStage.run(input, context())).rejects.toThrow("service unavailable");
  expect(getProject(project.id)!.doc.shots).toEqual(project.doc.shots);
  llm.generateJson.mockClear();
  llm.generateJson.mockImplementation(async (_model, _schema, prompt) => output(payloadOf(prompt)));
  await expect(storyboardStage.run(input, context())).resolves.toEqual({ shots: 12, llmCalls: 1 });
  expect(payloadOf(llm.generateJson.mock.calls[0][2]).lines[0].id).toBe("l6");
});

it("rejects adoption if the pipeline changes while video chunks are being generated", async () => {
  const project = await fixture(7);
  const { storyboardStage } = await import("@/lib/pipeline/stages/storyboard");
  const { mutateProject, getProject } = await import("@/lib/server/projects");
  llm.generateJson.mockImplementation(async (_model, _schema, prompt) => {
    const payload = payloadOf(prompt);
    if (payload.lines[0].id === "l6") mutateProject(project.id, (doc) => ({ ...doc, settings: { ...doc.settings, visualPipeline: "image" } }));
    return output(payload);
  });
  await storyboardStage.run({ projectId: project.id, modelId: "deepseek", mode: "stale" }, context());
  expect(getProject(project.id)!.doc.shots).toEqual(project.doc.shots);
});

it("resumes a divided range directly after one half succeeds and the other half is interrupted", async () => {
  const project = await fixture(6);
  const { storyboardStage } = await import("@/lib/pipeline/stages/storyboard");
  llm.generateJson.mockImplementation(async (_model, _schema, prompt) => {
    const payload = payloadOf(prompt);
    if (payload.lines.length === 6) throw parseError();
    if (payload.lines[0].id === "l3") throw Object.assign(new Error("service unavailable"), { statusCode: 503 });
    return output(payload);
  });
  const input = { projectId: project.id, modelId: "deepseek", mode: "stale" as const };
  await expect(storyboardStage.run(input, context())).rejects.toThrow("service unavailable");
  llm.generateJson.mockClear();
  llm.generateJson.mockImplementation(async (_model, _schema, prompt) => output(payloadOf(prompt)));
  await expect(storyboardStage.run(input, context())).resolves.toEqual({ shots: 6, llmCalls: 1 });
  expect(llm.generateJson.mock.calls.map((call) => payloadOf(call[2]).lines.map((line) => line.id))).toEqual([["l3", "l4", "l5"]]);
});
