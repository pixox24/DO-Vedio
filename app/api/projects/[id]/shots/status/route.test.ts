import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { evenChars } from "@/lib/core/align";
import { castSourceHash } from "@/lib/core/cast";
import { blankShot, stampShots } from "@/lib/core/shots";
import { stockFrame, stockSnapshot } from "@/lib/core/stock";
import { emptyDoc, type ProjectDoc } from "@/lib/core/types";

/**
 * 镜头状态接口在素材管线下的分支。
 *
 * 素材管线没有参考图、没有标准图、没有确认点，但面板复用了同一套 `VideoState`
 * 词表。这里要证明的是**判据换了**：同一个 `ready`，在 AI 视频里意味着
 * 「参考图确认过 + 视频对得上快照」，在这里只意味着「素材够长且对得上快照」。
 */

const dir = mkdtempSync(path.join(tmpdir(), "dovedio-shot-status-stock-"));
beforeAll(() => {
  process.env.DATA_DIR = dir;
  process.env.PEXELS_API_KEY = "test-key";
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  const { run } = await import("@/lib/server/db");
  run("DELETE FROM jobs");
});

async function project(patch: (doc: ProjectDoc) => void = () => {}) {
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

const ask = (id: string) => import("./route").then((m) => m.GET(new Request(`http://localhost/api/projects/${id}/shots/status`), { params: Promise.resolve({ id }) }));

/**
 * 直接塞一条够长的视频进媒体库。
 * 时长门禁读的是 `assets.duration_ms`，所以不跑 ffprobe 也能把门禁喂对。
 */
async function seedVideo(durationMs: number) {
  const { putBuffer, getAsset } = await import("@/lib/server/media");
  const { run } = await import("@/lib/server/db");
  const asset = await putBuffer(new TextEncoder().encode(`status-fixture:${Math.random()}`), { ext: "mp4", mime: "video/mp4", probe: false });
  run("UPDATE assets SET duration_ms = ?, width = 1920, height = 1080 WHERE hash = ?", durationMs, asset.hash);
  return getAsset(asset.hash)!;
}

it("缺检索词时先让镜头等分镜，不显示可生成", async () => {
  const created = await project((doc) => { doc.shots[0].stockQuery = undefined; });
  const data = await (await ask(created.id)).json();
  expect(data.s0.state).toBe("waiting-plan");
});

it("素材对上快照就是就绪，且带出镜头时长", async () => {
  const created = await project();
  const { mutateProject } = await import("@/lib/server/projects");
  const { timelineFor } = await import("@/lib/pipeline/artifacts");
  const { getProject } = await import("@/lib/server/projects");
  const frame = stockFrame(created.doc);
  const before = getProject(created.id)!.doc;
  const timeline = timelineFor(before, created.id, frame.aspect);
  const hash = stockSnapshot(before, before.shots[0], timeline, frame).hash;
  const assetId = (await seedVideo(8000)).hash;
  mutateProject(created.id, (doc) => ({
    ...doc,
    shots: doc.shots.map((shot) => shot.id === "s0" ? {
      ...shot, assetId,
      assetVariants: { [frame.aspect]: { assetId, promptHash: hash, aspect: frame.aspect } },
      candidates: [{ id: "s0:0", assetId, selected: true, kind: "video" as const, promptHash: hash, generationPromptHash: hash }],
    } : shot),
  }));
  const data = await (await ask(created.id)).json();
  expect(data.s0.state).toBe("ready");
  expect(data.s0.status).toBe("succeeded");
  expect(data.s0.snapshotHash).toBe(hash);
  expect(data.s0.targetDurationMs).toBeGreaterThan(0);
});

it("检索词改了之后已落库的素材报需要更新", async () => {
  const created = await project();
  const { mutateProject, getProject } = await import("@/lib/server/projects");
  const { timelineFor } = await import("@/lib/pipeline/artifacts");
  const frame = stockFrame(created.doc);
  const before = getProject(created.id)!.doc;
  const timeline = timelineFor(before, created.id, frame.aspect);
  const hash = stockSnapshot(before, before.shots[0], timeline, frame).hash;
  const assetId = (await seedVideo(8000)).hash;
  mutateProject(created.id, (doc) => ({
    ...doc,
    shots: doc.shots.map((shot) => shot.id === "s0" ? { ...shot, assetId, assetVariants: { [frame.aspect]: { assetId, promptHash: hash, aspect: frame.aspect } } } : shot),
  }));
  expect((await (await ask(created.id)).json()).s0.state).toBe("ready");
  // 改检索词 → 快照变了 → 老素材过期。面板据此把按钮从「已就绪」换成「重新检索素材」。
  mutateProject(created.id, (doc) => ({
    ...doc,
    shots: doc.shots.map((shot) => shot.id === "s0" ? { ...shot, stockQuery: "mountain road drive" } : shot),
  }));
  expect((await (await ask(created.id)).json()).s0.state).toBe("stale");
});

it("有排队中的检索任务时显示正在保存，指纹不符的旧任务不算", async () => {
  const created = await project();
  const { enqueueStockShot } = await import("@/lib/pipeline/stages/shot-stock");
  enqueueStockShot(created.id, created.doc, created.doc.shots[0], stockFrame(created.doc));
  expect((await (await ask(created.id)).json()).s0.state).toBe("downloading");
  // 改检索词：旧任务还在队列里，但指纹对不上，不能顶上来当成当前状态。
  const { mutateProject } = await import("@/lib/server/projects");
  mutateProject(created.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => shot.id === "s0" ? { ...shot, stockQuery: "mountain road drive" } : shot) }));
  const data = await (await ask(created.id)).json();
  expect(data.s0.state).toBe("ready-to-generate");
  expect(data.s0.status).toBe("queued");
});
