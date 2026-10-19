import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { ProjectDoc } from "@/lib/core/types";

/**
 * 单镜「重新搜索素材」。
 *
 * 这个入口是用户点按钮的直接后果，所以它必须把「该不该搜」拦在排队之前——
 * 排队之后再失败，任务会重试、卡片会红，用户看到的是「生成失败」而不是
 * 「你还缺检索词」。这里逐条拦一遍。
 */

const dir = mkdtempSync(path.join(tmpdir(), "dovedio-shot-stock-"));
beforeAll(() => {
  process.env.DATA_DIR = dir;
  process.env.PEXELS_API_KEY = "test-key";
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  process.env.PEXELS_API_KEY = "test-key";
  const { run } = await import("@/lib/server/db");
  run("DELETE FROM jobs");
});

async function project(patch: (doc: import("@/lib/core/types").ProjectDoc) => void = () => {}) {
  const { evenChars } = await import("@/lib/core/align");
  const { castSourceHash } = await import("@/lib/core/cast");
  const { blankShot, stampShots } = await import("@/lib/core/shots");
  const { emptyDoc } = await import("@/lib/core/types");
  const { createProject } = await import("@/lib/server/projects");
  const { cachePut } = await import("@/lib/server/cache");
  const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
  const doc = emptyDoc();
  doc.settings.visualPipeline = "stock";
  doc.lines = [{ id: "l0", text: "这是第一段旁白。", segmentIndex: 0, locked: true, spans: [], keywords: [] }];
  doc.segments = [{ title: "测试", text: doc.lines[0].text }];
  doc.shots = stampShots([{
    ...blankShot("s0", "l0"),
    kind: "video", mode: "generate", groupId: "g",
    stockQuery: "window morning light",
    videoPlan: { startState: "A subject stands", action: "The subject turns", camera: "Static camera", endState: "The subject faces out" },
  }], doc.lines);
  doc.castAnalysis = { sourceHash: castSourceHash(doc), modes: [], skipped: [], issues: [] };
  patch(doc);
  const created = createProject(doc);
  for (const { key, line } of lineTtsKeys(doc, created.id)) {
    cachePut(key, "tts", { assetId: `tts-${line.id}`, durationMs: 2000, speechStartMs: 0, speechEndMs: 2000, chars: evenChars(line.text, 0, 2000), aligned: true, spokenChars: line.text.length });
  }
  return created;
}

const post = (id: string, shotId: string, body?: unknown) => import("./route").then((m) => m.POST(
  new Request(`http://localhost/api/projects/${id}/shots/${shotId}/stock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  }),
  { params: Promise.resolve({ id, shotId }) },
));

const get = (id: string, shotId: string) => import("./route").then((m) => m.GET(new Request(`http://localhost/api/projects/${id}/shots/${shotId}/stock`), { params: Promise.resolve({ id, shotId }) }));

it("素材齐全时排队检索，并返回快照指纹", async () => {
  const created = await project();
  const { stockFrame, stockSnapshot } = await import("@/lib/core/stock");
  const { timelineFor } = await import("@/lib/pipeline/artifacts");
  const response = await post(created.id, "s0");
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.reused).toBe(false);
  expect(data.job.stage).toBe("shot-stock");
  expect(data.job.input.shotId).toBe("s0");
  const frame = stockFrame(created.doc);
  const timeline = timelineFor(created.doc, created.id, frame.aspect);
  expect(data.snapshotHash).toBe(stockSnapshot(created.doc, created.doc.shots[0], timeline, frame).hash);
  expect(data.job.input.requestHash).toBe(data.snapshotHash);
});

it("同一指纹重复提交复用任务，不重复扣额度", async () => {
  const created = await project();
  const first = await (await post(created.id, "s0")).json();
  const second = await (await post(created.id, "s0")).json();
  expect(second.reused).toBe(true);
  expect(second.job.id).toBe(first.job.id);
  const { projectJobs } = await import("@/lib/server/jobs");
  expect(projectJobs(created.id).filter((job) => job.stage === "shot-stock")).toHaveLength(1);
});

it("重新搜索会把已有素材放进排除集，换一条新的", async () => {
  const created = await project();
  await post(created.id, "s0");
  const { mutateProject } = await import("@/lib/server/projects");
  const { run } = await import("@/lib/server/db");
  const oldAsset = "a".repeat(64);
  mutateProject(created.id, (doc) => ({
    ...doc,
    shots: doc.shots.map((shot) => shot.id === "s0" ? {
      ...shot, assetId: oldAsset,
      candidates: [...shot.candidates, { id: "s0:0", assetId: oldAsset, selected: true, kind: "video" as const, promptHash: "h", generationPromptHash: "h" }],
    } : shot),
  }));
  run("DELETE FROM jobs");
  const data = await (await post(created.id, "s0")).json();
  expect(data.job.input.excludeAssetIds).toContain(oldAsset);
  // 游标不能进快照：否则排队那一刻指纹就变了，正在用的素材会被判成过期。
  expect(data.snapshotHash).toBe((await (await get(created.id, "s0")).json()).snapshotHash);
});

it("锁定镜头、缺检索词、非素材管线、缺 Key 都在排队前被拦下", async () => {
  const locked = await project((doc) => { doc.shots[0].locked = true; });
  expect((await post(locked.id, "s0")).status).toBe(409);

  const noQuery = await project((doc) => { doc.shots[0].stockQuery = undefined; });
  const noQueryResponse = await post(noQuery.id, "s0");
  expect(noQueryResponse.status).toBe(409);
  expect((await noQueryResponse.json()).error).toBe("等待分镜补齐素材检索词");

  const image = await project((doc) => { doc.settings.visualPipeline = "image"; });
  expect((await post(image.id, "s0")).status).toBe(409);

  const { projectJobs } = await import("@/lib/server/jobs");
  for (const created of [locked, noQuery, image]) {
    expect(projectJobs(created.id).filter((job) => job.stage === "shot-stock")).toHaveLength(0);
  }
});

it("没配 PEXELS_API_KEY 时给出可操作的提示，而不是排队后失败", async () => {
  vi.stubEnv("PEXELS_API_KEY", "");
  const created = await project();
  const response = await post(created.id, "s0");
  expect(response.status).toBe(409);
  expect((await response.json()).error).toBe("未配置 PEXELS_API_KEY，请在模型中心配置后再制作");
  vi.unstubAllEnvs();
});

it("镜头不存在时返回 404", async () => {
  const created = await project();
  expect((await post(created.id, "nope")).status).toBe(404);
  expect((await get(created.id, "nope")).status).toBe(404);
});

it("只读接口报出检索词、指纹与拦截原因", async () => {
  const created = await project();
  const response = await get(created.id, "s0");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    pipeline: "stock", query: "window morning light", attempts: 0, blocker: null,
  });

  const blocked = await project((doc) => { doc.shots[0].stockQuery = undefined; });
  expect((await (await get(blocked.id, "s0")).json()).blocker).toBe("等待分镜补齐素材检索词");
});
