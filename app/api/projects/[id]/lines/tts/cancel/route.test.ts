import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "dovedio-tts-cancel-"));
beforeAll(() => { process.env.DATA_DIR = dir; });
afterAll(async () => {
  (await import("../../../../../../../lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

it("只取消指定批次的逐句和段落任务", async () => {
  const { emptyDoc } = await import("../../../../../../../lib/core/types");
  const { createProject } = await import("../../../../../../../lib/server/projects");
  const { enqueue, getJob } = await import("../../../../../../../lib/server/jobs");
  const { POST: enqueueTts } = await import("../route");
  const { POST: cancelTts } = await import("./route");
  const doc = emptyDoc();
  doc.segments = [{ title: "测试", text: "第一句。第二句。" }];
  doc.lines = ["第一句。", "第二句。"].map((text, index) => ({ id: `line-${index}`, segmentIndex: 0, text, spans: [], keywords: [], locked: true }));
  const project = createProject(doc);
  const queued = await enqueueTts(new Request(`http://localhost/api/projects/${project.id}/lines/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "all" }) }), { params: Promise.resolve({ id: project.id }) });
  expect(queued.status).toBe(200);
  const data = await queued.json() as { batchId: string; jobs: number; items: { id: string }[] };
  const sameBatchBlock = enqueue({ projectId: project.id, stage: "tts-block", key: "same-batch-block", input: { batchId: data.batchId } });
  const unrelated = enqueue({ projectId: project.id, stage: "tts", key: "unrelated", input: { batchId: "00000000-0000-4000-8000-000000000000" } });
  const canceled = await cancelTts(new Request(`http://localhost/api/projects/${project.id}/lines/tts/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: data.batchId }) }), { params: Promise.resolve({ id: project.id }) });
  expect(canceled.status).toBe(200);
  expect((await canceled.json()).canceled).toBe(data.items.length + 1);
  expect(getJob(sameBatchBlock.id)?.status).toBe("canceled");
  expect(getJob(unrelated.id)?.status).toBe("queued");
});
