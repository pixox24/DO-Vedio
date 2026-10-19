import { createHash } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { evenChars } from "@/lib/core/align";
import { castSourceHash } from "@/lib/core/cast";
import { blankShot, stampShots } from "@/lib/core/shots";
import { stockExclusions, stockFrame, stockSnapshot } from "@/lib/core/stock";
import { emptyDoc, type Job, type ProjectDoc, type Shot } from "@/lib/core/types";
import type { StockClip } from "@/lib/providers/stock";

/**
 * 素材管线（stock）端到端：分镜 → `shot-stock` → 写回 → 渲染门禁。
 *
 * 只打桩两处外部世界：Pexels 检索与 ffprobe 实测时长。其余（快照、缓存、
 * 写回、门禁、编排）全走真实代码——本文件要证明的正是这几层拼在一起能对上。
 */

const mocks = vi.hoisted(() => ({ search: vi.fn(), probe: vi.fn() }));

vi.mock("@/lib/providers/registry", () => ({
  listTextModels: () => [{ id: "test-text", configured: true, enabled: true }],
  listProviderProfiles: () => [],
}));

vi.mock("@/lib/providers/stock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/stock")>();
  return { ...actual, searchStock: mocks.search };
});

vi.mock("@/lib/server/ffmpeg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/ffmpeg")>();
  return { ...actual, probe: mocks.probe };
});

let dir = "";
/** 每次用例换一个字节内容，避免上一个用例下载过的文件被内容寻址去重。 */
let nonce = 0;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-video-stock-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  nonce += 1;
  process.env.PEXELS_API_KEY = "test-key";
  // 素材缓存按快照哈希命中，而「同样的文档」在用例之间是逐位相同的，
  // 不清掉的话第二个用例会直接复用上一个用例定下的素材。
  const { run } = await import("@/lib/server/db");
  run("DELETE FROM jobs");
  run("DELETE FROM cache");
  run("DELETE FROM generation_runs");
  mocks.search.mockReset();
  mocks.search.mockImplementation(async (query: string) => [clipFor(query)]);
  mocks.probe.mockReset();
  mocks.probe.mockResolvedValue(videoProbe(8000));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const goal = { until: "compose" as const, aspects: ["16:9" as const], quality: "draft" as const };

const downloadUrl = (key: string) => `https://videos.pexels.com/video-files/${encodeURIComponent(key)}/clip-hd.mp4`;
const bytesOf = (marker: number, url: string) => new TextEncoder().encode(`dovedio-stock-fixture:${marker}:${url}`);
const hashOf = (marker: number, url: string) => createHash("sha256").update(Buffer.from(bytesOf(marker, url))).digest("hex");

/** 一条合格素材：竖屏/横屏档都按目标画幅给，`pickFile` 的真实逻辑才能跑。 */
const clipFor = (key: string, opts: { id?: number; durationSec?: number; fileWidth?: number; fileHeight?: number } = {}): StockClip => {
  const width = opts.fileWidth ?? 1920;
  const height = opts.fileHeight ?? 1080;
  const id = opts.id ?? 1000 + key.length;
  return {
    id,
    pageUrl: `https://www.pexels.com/video/${encodeURIComponent(key)}/`,
    author: "Fixture Author",
    authorUrl: "https://www.pexels.com/@fixture",
    durationSec: opts.durationSec ?? 10,
    width,
    height,
    files: [{ id: id * 10, url: downloadUrl(key), width, height, quality: "hd", fileType: "video/mp4" }],
  };
};

const videoProbe = (durationMs: number) => ({
  durationMs, width: 1920, height: 1080, hasAudio: false, hasVideo: true,
  format: "mov,mp4,m4a,3gp,3g2,mj2", audioCodec: null, sampleRate: null, channels: null, bitRate: null,
});

/** 把下载地址换成可控字节流；返回这个 stub 以便断言「下过几次」。 */
function serveDownloads() {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const bytes = bytesOf(nonce, url);
    return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.byteLength) } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function fixture(count = 1) {
  const { createProject } = await import("@/lib/server/projects");
  const { cachePut } = await import("@/lib/server/cache");
  const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
  const doc = emptyDoc();
  doc.settings.visualPipeline = "stock";
  doc.settings.modelId = "test-text";
  doc.settings.voice.instruction = "自然口播";
  doc.settings.assetFraming = "shared";
  doc.lines = Array.from({ length: count }, (_, index) => ({ id: `l${index}`, text: `这是第${index}段旁白。`, segmentIndex: 0, locked: true, spans: [], keywords: [] }));
  doc.segments = [{ title: "测试", text: doc.lines.map((line) => line.text).join("") }];
  doc.shots = stampShots(doc.lines.map((line, index) => ({
    ...blankShot(`s${index}`, line.id),
    kind: "video" as const,
    mode: "generate" as const,
    groupId: "g",
    stockQuery: `window subject ${index}`,
    videoPlan: { startState: "A subject stands by a window", action: "The subject turns", camera: "Static camera", endState: "The subject faces the window" },
  })), doc.lines);
  doc.castAnalysis = { sourceHash: castSourceHash(doc), modes: [], skipped: [], issues: [] };
  const project = createProject(doc);
  for (const { key, line } of lineTtsKeys(doc, project.id)) {
    cachePut(key, "tts", { assetId: `tts-${line.id}`, durationMs: 2000, speechStartMs: 0, speechEndMs: 2000, chars: evenChars(line.text, 0, 2000), aligned: true, spokenChars: line.text.length });
  }
  return project;
}

function context(job: Job) {
  return { job, signal: new AbortController().signal, current: () => true, progress: vi.fn(), spend: () => 0, log: vi.fn() };
}

/** 按真实编排入口排队并执行一次检索。 */
async function runStockShot(projectId: string, doc: ProjectDoc, shot: Shot, frame: ReturnType<typeof stockFrame>, extra: { excludeAssetIds?: string[] } = {}) {
  const { enqueueStockShot, shotStockStage } = await import("@/lib/pipeline/stages/shot-stock");
  const queued = enqueueStockShot(projectId, doc, shot, frame, extra);
  const result = await shotStockStage.run(queued.job.input as never, context(queued.job));
  return { ...queued, result };
}

it("素材管线：逐镜检索写回双哈希后，渲染门禁放行且不再排检索", async () => {
  const project = await fixture(3);
  serveDownloads();
  const { planPipeline } = await import("@/lib/pipeline/plan");
  const { timelineFor } = await import("@/lib/pipeline/artifacts");
  const { getProject } = await import("@/lib/server/projects");
  const { run } = await import("@/lib/server/db");
  const { videoRenderProblems } = await import("@/lib/pipeline/video-generation");
  const { getAsset } = await import("@/lib/server/media");
  const { allStages } = await import("@/lib/pipeline/stages");

  const frame = stockFrame(project.doc);
  const plan = planPipeline(project.id, project.doc, goal);
  const steps = plan.steps.filter((step) => step.stage === "shot-stock");
  expect(steps).toHaveLength(3);
  // 编排必须把这些键当成「当前任务」，否则进度条会把它当成上一轮的旧任务。
  expect(plan.currentKeys).toEqual(expect.arrayContaining(steps.map((step) => step.key)));
  expect(allStages.map((stage) => stage.name)).toContain("shot-stock");

  for (const shot of project.doc.shots) {
    const { result } = await runStockShot(project.id, project.doc, shot, frame);
    expect(result.assetId).toMatch(/^[a-f0-9]{64}$/);
  }

  const doc = getProject(project.id)!.doc;
  const timeline = timelineFor(doc, project.id, frame.aspect);
  expect(videoRenderProblems(doc, timeline, frame)).toEqual([]);
  for (const shot of doc.shots) {
    const hash = stockSnapshot(doc, shot, timeline, frame).hash;
    const selected = shot.candidates.find((candidate) => candidate.selected)!;
    // 两个哈希都要等于快照哈希：只填一个会让变体指纹落到 "unknown"，门禁永远报过期。
    expect(selected).toMatchObject({ kind: "video", promptHash: hash, generationPromptHash: hash });
    expect(shot.assetId).toBe(selected.assetId);
    expect(shot.assetPromptHash).toBe(hash);
    expect(shot.assetVariants[frame.aspect]).toMatchObject({ assetId: selected.assetId, promptHash: hash });
    expect(getAsset(selected.assetId)?.kind).toBe("video");
  }
  expect(planPipeline(project.id, doc, goal).steps.filter((step) => step.stage === "shot-stock")).toHaveLength(0);
  // 素材齐了就该排得出渲染：门禁放行不等于编排愿意渲。
  const rendering = planPipeline(project.id, doc, { ...goal, until: "render" });
  expect(rendering.steps.filter((step) => step.stage === "render")).toHaveLength(1);
  expect(rendering.waiting).toEqual([]);

  // 手工把一条素材改短（模拟「换了一条比镜头短的视频」），门禁必须点名报出来。
  run("UPDATE assets SET duration_ms = 100 WHERE hash = ?", doc.shots[1].assetId!);
  expect(videoRenderProblems(doc, timeline, frame)).toEqual([`镜头 s1 视频时长不足或尚未探测`]);
  expect(planPipeline(project.id, doc, { ...goal, until: "render" }).steps.filter((step) => step.stage === "render")).toHaveLength(0);
});

it("素材管线：来源声明的时长不算数，实测比镜头短就换下一条", async () => {
  const project = await fixture(1);
  const fetchMock = serveDownloads();
  const { getProject } = await import("@/lib/server/projects");
  const { getAsset } = await import("@/lib/server/media");

  const short = clipFor("short", { id: 1, durationSec: 10 });
  const long = clipFor("long", { id: 2, durationSec: 10 });
  mocks.search.mockResolvedValue([short, long]);
  // 来源两条都声称 10s；实测第一条只有 1.2s（镜头要 2000ms）。
  mocks.probe.mockReset();
  mocks.probe.mockResolvedValueOnce(videoProbe(1200)).mockResolvedValue(videoProbe(8000));

  const frame = stockFrame(project.doc);
  const { result } = await runStockShot(project.id, project.doc, project.doc.shots[0], frame);

  expect(fetchMock).toHaveBeenCalledTimes(2);
  // 短的确实下下来了，只是没被采用——不是「没搜到」。
  expect(getAsset(hashOf(nonce, downloadUrl("short")))?.durationMs).toBe(1200);
  expect(result.assetId).toBe(hashOf(nonce, downloadUrl("long")));
  expect(getProject(project.id)!.doc.shots[0].assetId).toBe(result.assetId);
});

it("素材管线：找不到够长的素材时报错，不写回也不留缓存", async () => {
  const project = await fixture(1);
  serveDownloads();
  const { shotStockStage } = await import("@/lib/pipeline/stages/shot-stock");
  const { getProject } = await import("@/lib/server/projects");
  const { cachedStockAsset } = await import("@/lib/pipeline/stock-cache");
  const { timelineFor } = await import("@/lib/pipeline/artifacts");

  mocks.search.mockResolvedValue([clipFor("only", { id: 1 })]);
  mocks.probe.mockReset();
  mocks.probe.mockResolvedValue(videoProbe(800));

  const frame = stockFrame(project.doc);
  const { enqueueStockShot } = await import("@/lib/pipeline/stages/shot-stock");
  const queued = enqueueStockShot(project.id, project.doc, project.doc.shots[0], frame);
  await expect(shotStockStage.run(queued.job.input as never, context(queued.job))).rejects.toThrow("都不合适");

  const doc = getProject(project.id)!.doc;
  expect(doc.shots[0].assetId).toBeUndefined();
  expect(doc.shots[0].candidates).toEqual([]);
  // 空结果/失败都不缓存，否则用户改完描述还得手动清。
  expect(cachedStockAsset(stockSnapshot(doc, doc.shots[0], timelineFor(doc, project.id, frame.aspect), frame).hash)).toBeUndefined();
});

it("素材管线：单条素材超体积上限时换下一条，而不是把整镜判死", async () => {
  const project = await fixture(1);
  const fetchMock = serveDownloads();
  const { getProject } = await import("@/lib/server/projects");
  const { getAsset } = await import("@/lib/server/media");
  const { cachedStockFile } = await import("@/lib/pipeline/stock-cache");

  mocks.search.mockResolvedValue([clipFor("huge", { id: 1 }), clipFor("fine", { id: 2 })]);
  // 第一条声明 300MB：被 content-length 预检直接挡下，不用真的搬 300MB。
  fetchMock.mockImplementationOnce(async () => new Response(new Uint8Array(0), {
    status: 200, headers: { "content-length": String(300 * 1024 * 1024) },
  }));

  const frame = stockFrame(project.doc);
  const { result } = await runStockShot(project.id, project.doc, project.doc.shots[0], frame);

  // 第二条正常入库并被采用——超大的那条只是被跳过。
  expect(result.assetId).toBe(hashOf(nonce, downloadUrl("fine")));
  expect(getProject(project.id)!.doc.shots[0].assetId).toBe(result.assetId);
  expect(getAsset(result.assetId)?.kind).toBe("video");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  // 超大的那条没有 URL 缓存：它从未成功入库，缓存反而会让重搜把它当「已试过」跳过。
  expect(cachedStockFile("pexels", downloadUrl("huge"))).toBeUndefined();
});

it("素材管线：所有素材都超体积上限时报错并说明原因", async () => {
  const project = await fixture(1);
  const fetchMock = serveDownloads();
  const { shotStockStage } = await import("@/lib/pipeline/stages/shot-stock");
  const { getProject } = await import("@/lib/server/projects");
  const { cachedStockAsset } = await import("@/lib/pipeline/stock-cache");
  const { timelineFor } = await import("@/lib/pipeline/artifacts");

  mocks.search.mockResolvedValue([clipFor("huge-a", { id: 1 }), clipFor("huge-b", { id: 2 })]);
  fetchMock.mockImplementation(async () => new Response(new Uint8Array(0), {
    status: 200, headers: { "content-length": String(300 * 1024 * 1024) },
  }));

  const frame = stockFrame(project.doc);
  const { enqueueStockShot } = await import("@/lib/pipeline/stages/shot-stock");
  const queued = enqueueStockShot(project.id, project.doc, project.doc.shots[0], frame);
  await expect(shotStockStage.run(queued.job.input as never, context(queued.job))).rejects.toThrow("超过 200MB");

  const doc = getProject(project.id)!.doc;
  expect(doc.shots[0].assetId).toBeUndefined();
  expect(cachedStockAsset(stockSnapshot(doc, doc.shots[0], timelineFor(doc, project.id, frame.aspect), frame).hash)).toBeUndefined();
});

it("素材管线：素材 meta 只留人可点的 pageUrl，不落下载地址", async () => {
  const project = await fixture(1);
  serveDownloads();
  const { getAsset } = await import("@/lib/server/media");

  const frame = stockFrame(project.doc);
  const { result } = await runStockShot(project.id, project.doc, project.doc.shots[0], frame);
  const meta = getAsset(result.assetId)!.meta;

  expect(meta).toMatchObject({ source: "pexels", stage: "shot-stock", projectId: project.id, shotId: "s0", author: "Fixture Author" });
  expect(meta.pageUrl).toBe(clipFor("window subject 0").pageUrl);
  expect(meta).not.toHaveProperty("url");
  // Pexels 的下载地址可能带签名，绝不能进 assets 表（putStream 会把 meta 永久落盘）。
  expect(JSON.stringify(meta)).not.toContain("videos.pexels.com");
});

it("素材管线：带游标重搜换一条素材，快照哈希逐位不变", async () => {
  const project = await fixture(1);
  serveDownloads();
  const { run } = await import("@/lib/server/db");
  const { getProject } = await import("@/lib/server/projects");
  const { timelineFor } = await import("@/lib/pipeline/artifacts");
  const { enqueueStockShot, shotStockStage } = await import("@/lib/pipeline/stages/shot-stock");

  const first = clipFor("first", { id: 1 });
  const second = clipFor("second", { id: 2 });
  mocks.search.mockResolvedValue([first, second]);

  const frame = stockFrame(project.doc);
  const before = stockSnapshot(project.doc, project.doc.shots[0], timelineFor(project.doc, project.id, frame.aspect), frame).hash;
  const initial = await runStockShot(project.id, project.doc, project.doc.shots[0], frame);
  expect(initial.result.assetId).toBe(hashOf(nonce, downloadUrl("first")));
  run("UPDATE jobs SET status = 'succeeded' WHERE id = ?", initial.job.id);

  const current = getProject(project.id)!;
  const queued = enqueueStockShot(project.id, current.doc, current.doc.shots[0], frame);
  // 游标只走任务 input，不进快照哈希——否则候选池截断会让正在用的素材被判过期。
  expect(queued.requestHash).toBe(before);
  expect((queued.job.input as { excludeAssetIds: string[] }).excludeAssetIds).toContain(initial.result.assetId);
  expect(stockExclusions(current.doc.shots[0])).toContain(initial.result.assetId);

  const rerun = await shotStockStage.run(queued.job.input as never, context(queued.job));
  expect(rerun.assetId).not.toBe(initial.result.assetId);
  expect(rerun.assetId).toBe(hashOf(nonce, downloadUrl("second")));

  const doc = getProject(project.id)!.doc;
  const timeline = timelineFor(doc, project.id, frame.aspect);
  expect(stockSnapshot(doc, doc.shots[0], timeline, frame).hash).toBe(before);
  expect(doc.shots[0].assetId).toBe(rerun.assetId);
  expect(doc.shots[0].candidates.map((candidate) => candidate.assetId)).toEqual(expect.arrayContaining([initial.result.assetId, rerun.assetId]));
  // 显式重搜必须采用新素材，不能沿用「当前选中」。
  expect(doc.shots[0].candidates.find((candidate) => candidate.selected)?.assetId).toBe(rerun.assetId);
  expect(doc.shots[0].assetVariants[frame.aspect]?.promptHash).toBe(before);
});

it("素材管线：已经对上的素材让编排不再提交检索", async () => {
  const project = await fixture(1);
  const { putBuffer } = await import("@/lib/server/media");
  const { run } = await import("@/lib/server/db");
  const { getProject, mutateProject } = await import("@/lib/server/projects");
  const { timelineFor } = await import("@/lib/pipeline/artifacts");
  const { produce } = await import("@/lib/pipeline/plan");
  const { videoRenderProblems } = await import("@/lib/pipeline/video-generation");

  const asset = await putBuffer(Buffer.from("already-current-stock"), { ext: "mp4", mime: "video/mp4", probe: false });
  run("UPDATE assets SET duration_ms = 8000 WHERE hash = ?", asset.hash);

  const frame = stockFrame(project.doc);
  const hash = stockSnapshot(project.doc, project.doc.shots[0], timelineFor(project.doc, project.id, frame.aspect), frame).hash;
  mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => ({
    ...shot,
    assetId: asset.hash,
    assetPromptHash: hash,
    assetVariants: { "16:9": { aspect: "16:9" as const, assetId: asset.hash, promptHash: hash, width: 1920, height: 1080, source: "generated" as const } },
    candidates: [{ id: "stock-candidate", assetId: asset.hash, selected: true, kind: "video" as const, promptHash: hash, generationPromptHash: hash }],
  })) }));

  const doc = getProject(project.id)!.doc;
  expect(videoRenderProblems(doc, timelineFor(doc, project.id, frame.aspect), frame)).toEqual([]);
  const result = produce(project.id, goal);
  expect(result.plan.steps.some((step) => step.stage === "shot-stock")).toBe(false);
  expect(result.enqueued.some((job) => job.stage === "shot-stock")).toBe(false);
  expect(mocks.search).not.toHaveBeenCalled();
});

it("素材管线：没配 Key 时只提示一次，一条检索任务都不排", async () => {
  const project = await fixture(2);
  vi.stubEnv("PEXELS_API_KEY", "");
  const { planPipeline } = await import("@/lib/pipeline/plan");

  const plan = planPipeline(project.id, project.doc, goal);
  expect(plan.steps.filter((step) => step.stage === "shot-stock")).toHaveLength(0);
  expect(plan.waiting.filter((hint) => hint.includes("PEXELS_API_KEY"))).toHaveLength(1);
});

it("素材管线：下载期间检索词被改动时不写回旧素材", async () => {
  const project = await fixture(1);
  const { mutateProject, getProject } = await import("@/lib/server/projects");
  const { shotStockStage } = await import("@/lib/pipeline/stages/shot-stock");

  const url = downloadUrl("window subject 0");
  const bytes = bytesOf(nonce, url);
  vi.stubGlobal("fetch", vi.fn(async () => {
    mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => ({ ...shot, stockQuery: "another subject entirely" })) }));
    return new Response(bytes, { status: 200 });
  }));

  const frame = stockFrame(project.doc);
  const { enqueueStockShot } = await import("@/lib/pipeline/stages/shot-stock");
  const queued = enqueueStockShot(project.id, project.doc, project.doc.shots[0], frame);
  await expect(shotStockStage.run(queued.job.input as never, context(queued.job))).rejects.toThrow("素材输入已变化");

  const shot = getProject(project.id)!.doc.shots[0];
  expect(shot.stockQuery).toBe("another subject entirely");
  expect(shot.assetId).toBeUndefined();
  expect(shot.candidates).toEqual([]);
});

it("素材管线：任务取消后不写回", async () => {
  const project = await fixture(1);
  serveDownloads();
  const { getProject } = await import("@/lib/server/projects");
  const { enqueueStockShot, shotStockStage } = await import("@/lib/pipeline/stages/shot-stock");

  const frame = stockFrame(project.doc);
  const queued = enqueueStockShot(project.id, project.doc, project.doc.shots[0], frame);
  await expect(shotStockStage.run(queued.job.input as never, { ...context(queued.job), current: () => false })).rejects.toThrow();

  const shot = getProject(project.id)!.doc.shots[0];
  expect(shot.assetId).toBeUndefined();
  expect(shot.candidates).toEqual([]);
});
