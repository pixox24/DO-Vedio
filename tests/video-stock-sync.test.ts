import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { evenChars } from "@/lib/core/align";
import { castSourceHash } from "@/lib/core/cast";
import { blankShot, stampShots } from "@/lib/core/shots";
import { emptyDoc, type Job, type VideoPlan } from "@/lib/core/types";
import { videoDescriptionHash, videoPlanNeedsSync } from "@/lib/core/video-plan";
import { staleRanges } from "@/lib/pipeline/stages/storyboard";

const llm = vi.hoisted(() => ({ generateJson: vi.fn() }));
vi.mock("@/lib/llm", () => ({ generateJson: llm.generateJson }));
vi.mock("@/lib/providers/registry", () => ({
  listTextModels: () => [{ id: "deepseek", configured: true, enabled: true }],
  listProviderProfiles: () => [],
}));

let dir = "";
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "dovedio-stock-sync-")); process.env.DATA_DIR = dir; });
afterAll(async () => { (await import("@/lib/server/db")).closeDb(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => { llm.generateJson.mockReset(); (await import("@/lib/server/db")).run("DELETE FROM jobs"); });

const plan: VideoPlan = { startState: "A woman stands by the window in a medium wide composition.", action: "She turns toward the door.", camera: "Static medium wide camera.", endState: "She faces the door." };
const context = () => ({ job: { id: "stock-sync-test" } as Job, signal: new AbortController().signal, current: () => true, progress: vi.fn(), spend: vi.fn(() => 0), log: vi.fn() });

/** 一个「刚切到素材管线、中文描述已改过」的项目：镜头有旧计划但没有检索词。 */
async function fixture() {
  const { createProject } = await import("@/lib/server/projects");
  const { cachePut } = await import("@/lib/server/cache");
  const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
  const doc = emptyDoc();
  doc.settings.visualPipeline = "stock";
  doc.settings.modelId = "deepseek";
  doc.settings.budgetYuan = null;
  doc.lines = [{ id: "line", text: "她看向门口。", segmentIndex: 0, locked: true, spans: [], keywords: [] }];
  doc.segments = [{ title: "测试", text: doc.lines[0].text }];
  doc.shots = stampShots([{
    ...blankShot("shot", "line"), kind: "video", description: "女人转头看向门口",
    videoPlan: { ...plan, startState: "An extreme close-up of a woman's face." },
    videoPlanDescriptionHash: videoDescriptionHash("女人面部特写"),
  }], doc.lines);
  doc.castAnalysis = { sourceHash: castSourceHash(doc), modes: [], skipped: [], issues: [] };
  const project = createProject(doc);
  for (const { key, line } of lineTtsKeys(doc, project.id)) cachePut(key, "tts", { assetId: "tts", durationMs: 2000, speechStartMs: 0, speechEndMs: 2000, chars: evenChars(line.text, 0, 2000), aligned: true, spokenChars: line.text.length });
  return project;
}

it("素材管线缺检索词时按整段过期处理，补齐后不再要求重做分镜", async () => {
  const project = await fixture();
  expect(videoPlanNeedsSync(project.doc.shots[0])).toBe(true);
  expect(staleRanges(project.doc)).toEqual([{ from: 0, to: 0 }]);

  const { mutateProject, getProject } = await import("@/lib/server/projects");
  mutateProject(project.id, (doc) => ({ ...doc, shots: doc.shots.map((shot) => ({ ...shot, stockQuery: "woman standing by window" })) }));
  expect(staleRanges(getProject(project.id)!.doc)).toEqual([]);
});

it("AI 视频管线不会因为缺少检索词而被判过期", async () => {
  const project = await fixture();
  const { mutateProject, getProject } = await import("@/lib/server/projects");
  mutateProject(project.id, (doc) => ({ ...doc, settings: { ...doc.settings, visualPipeline: "video" } }));
  expect(staleRanges(getProject(project.id)!.doc)).toEqual([]);
});

it("改了中文描述后同步：执行计划与检索词在同一次调用里一起写回", async () => {
  const project = await fixture();
  const { syncVideoShotPlan } = await import("@/lib/pipeline/video-plan-sync");
  const { getProject } = await import("@/lib/server/projects");
  llm.generateJson.mockResolvedValueOnce({ ...plan, stockQuery: "woman standing by window" });

  expect(await syncVideoShotPlan({ projectId: project.id, modelId: "deepseek", shotId: "shot" }, context())).toEqual({ shots: 1, llmCalls: 1 });

  const shot = getProject(project.id)!.doc.shots[0];
  // 归一化会剔掉虚词（"by"），主体与动作都还在。
  expect(shot.stockQuery).toBe("woman standing window");
  expect(shot.videoPlan).toEqual(plan);
  expect(shot.videoPlanDescriptionHash).toBe(videoDescriptionHash(shot.description));
  expect(videoPlanNeedsSync(shot)).toBe(false);
  // 提示词必须显式索要检索词，否则模型只会输出四项执行计划。
  expect(llm.generateJson.mock.calls[0][2].instructions).toContain("stockQuery");
  expect(llm.generateJson.mock.calls[0][2].instructions).toContain("2–4 个单词");
});

it("AI 视频模式的同一次调用不索要检索词，写回也不产生该字段", async () => {
  const project = await fixture();
  const { mutateProject, getProject } = await import("@/lib/server/projects");
  mutateProject(project.id, (doc) => ({ ...doc, settings: { ...doc.settings, visualPipeline: "video" } }));
  const { syncVideoShotPlan } = await import("@/lib/pipeline/video-plan-sync");
  llm.generateJson.mockResolvedValueOnce(plan);

  expect(await syncVideoShotPlan({ projectId: project.id, modelId: "deepseek", shotId: "shot" }, context())).toEqual({ shots: 1, llmCalls: 1 });
  expect(llm.generateJson.mock.calls[0][2].instructions).not.toContain("stockQuery");
  expect(getProject(project.id)!.doc.shots[0].stockQuery).toBeUndefined();
});

it("模型漏掉检索词时同步失败；写坏（中文）时退到按执行计划派生的英文词", async () => {
  const project = await fixture();
  const { syncVideoShotPlan } = await import("@/lib/pipeline/video-plan-sync");
  const { getProject } = await import("@/lib/server/projects");

  // 完全没有该字段：模型没按契约输出，重试是唯一正确的反应。
  llm.generateJson.mockResolvedValueOnce(plan);
  await expect(syncVideoShotPlan({ projectId: project.id, modelId: "deepseek", shotId: "shot" }, context())).rejects.toThrow();
  expect(getProject(project.id)!.doc.shots[0].stockQuery).toBeUndefined();

  // 写了中文：不写回一个搜不出素材的值，也不让整次同步失败——
  // 英文执行计划已经在手，按它派生的检索词是确定可用的。
  llm.generateJson.mockResolvedValueOnce({ ...plan, stockQuery: "女人 站在 窗边" });
  expect(await syncVideoShotPlan({ projectId: project.id, modelId: "deepseek", shotId: "shot" }, context())).toEqual({ shots: 1, llmCalls: 1 });
  const written = getProject(project.id)!.doc.shots[0].stockQuery!;
  expect(written).toMatch(/^[a-z]+(?: [a-z]+)*$/);
  expect(written).not.toMatch(/[\u3400-\u9fff]/);
});

it("保存后自动排队：素材管线也走同一条同步链路，不会被静默跳过", async () => {
  const project = await fixture();
  const { enqueueVideoPlanSyncs } = await import("@/lib/pipeline/video-plan-sync");
  const { projectJobs } = await import("@/lib/server/jobs");
  expect(enqueueVideoPlanSyncs(project.id)).toEqual([expect.objectContaining({ stage: "storyboard", input: expect.objectContaining({ shotId: "shot" }) })]);
  expect(projectJobs(project.id)).toHaveLength(1);
});
