import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "dovedio-batch-images-"));
beforeAll(() => {
  process.env.DATA_DIR = dir;
  process.env.PROVIDER_ENCRYPTION_KEY = "test-batch-provider-secret";
});
afterAll(async () => {
  (await import("../../../../../../lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.PROVIDER_ENCRYPTION_KEY;
});

it("全量生图只提交缺图且未锁定的镜头", async () => {
  const { createCustomProvider, syncCustomModels, setCustomModelKind, setCustomModelEnabled } = await import("../../../../../../lib/providers/custom");
  const { emptyDoc } = await import("../../../../../../lib/core/types");
  const { blankShot } = await import("../../../../../../lib/core/shots");
  const { createProject } = await import("../../../../../../lib/server/projects");
  const { POST } = await import("./route");
  const providerId = createCustomProvider({ name: "图片服务商", interfaceType: "openai-compatible", baseUrl: "https://images.example.com/v1", apiKey: "secret" });
  syncCustomModels(providerId, [{ id: "image-model" }]);
  setCustomModelKind(providerId, "image-model", "image");
  setCustomModelEnabled(providerId, "image-model", true);
  const doc = emptyDoc();
  doc.lines = [{ id: "line-1", segmentIndex: 0, text: "测试句子", spans: [], keywords: [], locked: false }];
  doc.shots = [blankShot("missing", "line-1"), { ...blankShot("locked", "line-1"), locked: true }, { ...blankShot("ready", "line-1"), assetId: "existing-image" }];
  const project = createProject(doc);
  const response = await POST(new Request(`http://localhost/api/projects/${project.id}/shots/generate`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelId: `custom-${providerId}::image-model`, candidateCount: 1 }),
  }), { params: Promise.resolve({ id: project.id }) });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.count).toBe(1);
  expect(data.jobs[0].input.shotId).toBe("missing");
  expect(data.batchId).toEqual(expect.any(String));
  const duplicate = await POST(new Request(`http://localhost/api/projects/${project.id}/shots/generate`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelId: `custom-${providerId}::image-model`, candidateCount: 1 }),
  }), { params: Promise.resolve({ id: project.id }) });
  expect(duplicate.status).toBe(409);
  const { claim, enqueue, getJob, isCurrentExecution } = await import("../../../../../../lib/server/jobs");
  const running = claim("image-worker", ["shot-generate"]);
  expect(running?.id).toBe(data.jobs[0].id);
  const single = enqueue({ projectId: project.id, stage: "shot-generate", key: "single-shot", input: { projectId: project.id, shotId: "other", kind: "image" } });
  const { POST: cancel } = await import("./cancel/route");
  const cancelResponse = await cancel(new Request(`http://localhost/api/projects/${project.id}/shots/generate/cancel`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: data.batchId }),
  }), { params: Promise.resolve({ id: project.id }) });
  expect(cancelResponse.status).toBe(200);
  expect((await cancelResponse.json()).canceled).toBe(1);
  expect(isCurrentExecution(running!.id, running!.lockToken)).toBe(false);
  expect(getJob(single.id)?.status).toBe("queued");
  const resumed = await POST(new Request(`http://localhost/api/projects/${project.id}/shots/generate`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelId: `custom-${providerId}::image-model`, candidateCount: 1 }),
  }), { params: Promise.resolve({ id: project.id }) });
  expect(resumed.status).toBe(200);
  expect((await resumed.json()).batchId).not.toBe(data.batchId);
});
