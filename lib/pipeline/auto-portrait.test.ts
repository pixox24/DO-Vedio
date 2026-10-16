import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aixFixture } from "../aix/test-fixture";
import { castSourceHash, sheetSourceHash } from "../core/cast";
import { characterCardSchema, emptyDoc, type CharacterCard, type ProjectDoc } from "../core/types";

/**
 * 自动立绘：开关、范围、重生成判据、入队前的环境判定。
 * 生图模型在干净环境里不存在（内置图片模型默认关闭、没有自定义服务商），
 * 所以计划只覆盖「还没到入队那一步」的判定；入队与失败语义由 plan/settle 的既有用例覆盖。
 */

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-auto-portrait-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("../server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const card = (over: Partial<CharacterCard> = {}) => characterCardSchema.parse({ id: "c1", key: "林夏", name: "林夏", hair: "齐耳短发", signature: ["红围巾"], ...over });
const sheet = (over: Partial<CharacterCard["sheet"]> = {}): CharacterCard["sheet"] => ({ candidates: [], turnaroundAssetIds: [], expressionAssetIds: [], lookAssetIds: {}, ...over });

/** 一份「角色卡已对齐当前文案」的文档；传给 over 的 castAnalysis 会被覆盖回当前指纹 */
function docWith(characters: CharacterCard[], over: Partial<ProjectDoc> = {}): ProjectDoc {
  const base: ProjectDoc = { ...emptyDoc(), ...over, characters };
  return { ...base, castAnalysis: { sourceHash: castSourceHash(base), modes: [], skipped: [], issues: [] } };
}

describe("自动立绘的判定", () => {
  it("开关默认关闭，也不生成；显式关掉后同样为空", async () => {
    const { needsAutoPortrait, autoPortraitCards } = await import("./auto-portrait");
    const doc = docWith([card()]);
    expect(doc.settings.autoPortrait).toBe(false);
    expect(needsAutoPortrait(doc.characters[0], doc)).toBe(false);
    expect(autoPortraitCards(doc)).toEqual([]);
    expect(autoPortraitCards({ ...doc, settings: { ...doc.settings, autoPortrait: true } })).toHaveLength(1);
  });

  it("只给在场、露正脸、未锁定、非群体的角色生成", async () => {
    const { needsAutoPortrait } = await import("./auto-portrait");
    const doc = { ...docWith([]), settings: { ...emptyDoc().settings, autoPortrait: true } };
    const ok = (c: CharacterCard) => needsAutoPortrait(c, doc);
    expect(ok(card())).toBe(true);
    expect(ok(card({ absent: true }))).toBe(false);
    expect(ok(card({ locked: true }))).toBe(false);
    expect(ok(card({ presentation: "back" }))).toBe(false);
    expect(ok(card({ kind: "group" }))).toBe(false);
  });

  it("同一画面风格下已有立绘就跳过；换了画面风格或改了外貌字段要重新生成", async () => {
    const { needsAutoPortrait } = await import("./auto-portrait");
    const style = aixFixture();
    const doc: ProjectDoc = { ...docWith([], { visualStyle: style }), settings: { ...emptyDoc().settings, autoPortrait: true } };
    const fresh = card({ sheet: sheet({ candidates: ["old"], portraitAssetId: "old", sourceHash: sheetSourceHash(card(), style) }) });
    expect(needsAutoPortrait(fresh, doc)).toBe(false);
    // 换画面风格：指纹变了，重新生成（并覆盖标准形象）
    expect(needsAutoPortrait(fresh, { ...doc, visualStyle: aixFixture({ lighting: "另一套光" }) })).toBe(true);
    // 改外貌字段：同样算过期
    expect(needsAutoPortrait({ ...fresh, hair: "长发" }, doc)).toBe(true);
    // 没有指纹（老数据）也补一次
    expect(needsAutoPortrait(card({ sheet: sheet({ candidates: ["old"], portraitAssetId: "old" }) }), doc)).toBe(true);
  });

  it("识别结果还没对齐当前文案时不排：那时生成的是上一版人物", async () => {
    const { autoPortraitCards, autoPortraitPlan } = await import("./auto-portrait");
    const doc = docWith([card()], { settings: { ...emptyDoc().settings, autoPortrait: true } });
    const stale: ProjectDoc = { ...doc, castAnalysis: { ...doc.castAnalysis!, sourceHash: "旧的指纹" } };
    expect(autoPortraitCards(stale)).toEqual([]);
    expect(autoPortraitPlan(stale, "p1")).toEqual([]);
  });

  it("视频只补缺失或过期的已采用标准图，保留上传图，不把候选当成已采用", async () => {
    const { needsAutoPortrait } = await import("./auto-portrait");
    const doc = docWith([], { settings: { ...emptyDoc().settings, autoPortrait: true, visualPipeline: "video" } });
    const current = card({ sheet: sheet({ sourceHash: sheetSourceHash(card(), doc.visualStyle), candidates: ["candidate"] }) });
    expect(needsAutoPortrait(current, doc)).toBe(true);
    current.sheet.portraitAssetId = "adopted";
    expect(needsAutoPortrait(current, doc)).toBe(false);
    current.hair = "长发";
    expect(needsAutoPortrait(current, doc)).toBe(true);
    current.referenceAssetIds = ["uploaded"];
    expect(needsAutoPortrait(current, doc)).toBe(false);
  });

  it("没有可用的生图模型就不排任务，避免必然失败", async () => {
    const { autoPortraitPlan } = await import("./auto-portrait");
    const doc = docWith([card()], { settings: { ...emptyDoc().settings, autoPortrait: true } });
    expect(autoPortraitPlan(doc, "p1")).toEqual([]);
  });
});

describe("自动立绘的任务标记", () => {
  it("自动任务带 auto 标记，手动定妆任务不带", async () => {
    const { isAutoPortraitInput, isAutoPortraitJob } = await import("./auto-portrait");
    expect(isAutoPortraitInput({ characterId: "c1", auto: true })).toBe(true);
    expect(isAutoPortraitInput({ characterId: "c1" })).toBe(false);
    expect(isAutoPortraitInput(null)).toBe(false);
    expect(isAutoPortraitJob({ stage: "character-sheet", input: { auto: true } })).toBe(true);
    expect(isAutoPortraitJob({ stage: "character-sheet", input: { characterId: "c1", kind: "portrait" } })).toBe(false);
  });

  it("任务键跟角色与指纹绑定：同一个角色同一个指纹只有一个键", async () => {
    const { autoPortraitKey } = await import("./auto-portrait");
    expect(autoPortraitKey("p1", "c1", "h1")).toBe("auto-portrait:p1:c1:h1");
    expect(autoPortraitKey("p1", "c1", "h1")).toBe(autoPortraitKey("p1", "c1", "h1"));
    expect(autoPortraitKey("p1", "c1", "h1")).not.toBe(autoPortraitKey("p1", "c1", "h2"));
  });
});

/** 造一个可用「自定义生图服务商」，否则干净环境里没有生图模型，计划永远停在判定之前 */
describe("自动立绘进入制作计划", () => {
  const goal = { until: "compose" as const, aspects: ["16:9" as const], quality: "draft" as const };
  let providerId = "";

  beforeAll(async () => {
    process.env.PROVIDER_ENCRYPTION_KEY = "test-provider-secret";
    const { createCustomProvider, setCustomModelEnabled, setCustomModelKind, syncCustomModels } = await import("../providers/custom");
    providerId = createCustomProvider({ name: "测试生图网关", interfaceType: "openai-compatible", baseUrl: "http://localhost:8000/v1", apiKey: "sk-test" });
    syncCustomModels(providerId, [{ id: "image-x" }]);
    setCustomModelKind(providerId, "image-x", "image");
    setCustomModelEnabled(providerId, "image-x", true);
  });
  afterAll(async () => {
    (await import("../providers/custom")).deleteCustomProvider(providerId);
    delete process.env.PROVIDER_ENCRYPTION_KEY;
  });

  /** 每个用例一个干净项目：角色卡已识别到当前文案，文案来自一个章节 */
  async function newProject(over: { card?: Partial<CharacterCard>; autoPortrait?: boolean; sheet?: CharacterCard["sheet"] } = {}) {
    const { createProject, getProject, mutateProject } = await import("../server/projects");
    const { syncLines } = await import("../core/sync");
    const base = emptyDoc();
    const project = createProject({
      ...base,
      segments: [{ title: "第一章", text: "林夏站在书店门口，围巾被风吹起来。" }],
      characters: [card({ ...over.card, ...(over.sheet ? { sheet: over.sheet } : {}) })],
      settings: { ...base.settings, autoPortrait: over.autoPortrait ?? true },
    });
    // 先按章节生成句子，再把「已识别到当前文案」的指纹写在同步后的文档上
    const ready = mutateProject(project.id, (doc) => {
      const synced = syncLines(doc);
      return { ...synced, castAnalysis: { sourceHash: castSourceHash(synced), modes: [], skipped: [], issues: [] } };
    })!;
    return { id: ready.id, doc: getProject(ready.id)!.doc };
  }

  it("开关打开且角色缺立绘时，计划里排一个自动立绘步骤，并算作当前任务", async () => {
    const { autoPortraitKey } = await import("./auto-portrait");
    const { planPipeline } = await import("./plan");
    const { id, doc } = await newProject();
    const key = autoPortraitKey(id, doc.characters[0].id, sheetSourceHash(doc.characters[0], doc.visualStyle));
    const plan = planPipeline(id, doc, goal);
    const steps = plan.steps.filter((s) => s.stage === "character-sheet");
    expect(steps.map((s) => s.key)).toEqual([key]);
    expect(steps[0].target).toBe("立绘 林夏");
    expect(steps[0].input).toMatchObject({ characterId: doc.characters[0].id, kind: "portrait", count: 1, auto: true });
    expect(plan.currentKeys).toContain(key);
  });

  it("开关关闭时排不出任何生图任务", async () => {
    const { planPipeline } = await import("./plan");
    const { id, doc } = await newProject({ autoPortrait: false });
    expect(planPipeline(id, doc, goal).steps.filter((s) => s.stage === "character-sheet")).toEqual([]);
  });

  it("已经有当前画面风格立绘的角色不再排；换了风格才重新排", async () => {
    const { planPipeline } = await import("./plan");
    const style = aixFixture();
    const { id, doc } = await newProject({ sheet: sheet({ candidates: ["old"], portraitAssetId: "old", sourceHash: sheetSourceHash(card(), style) }) });
    const withStyle = { ...doc, visualStyle: style };
    expect(planPipeline(id, withStyle, goal).steps.filter((s) => s.stage === "character-sheet")).toEqual([]);
    const restyled = { ...withStyle, visualStyle: aixFixture({ lighting: "另一套光" }) };
    expect(planPipeline(id, restyled, goal).steps.filter((s) => s.stage === "character-sheet")).toHaveLength(1);
  });

  it("角色正在定妆时不重复入队，但它的键仍算当前任务", async () => {
    const { autoPortraitKey } = await import("./auto-portrait");
    const { planPipeline } = await import("./plan");
    const { enqueue } = await import("../server/jobs");
    const { id, doc } = await newProject();
    const characterId = doc.characters[0].id;
    enqueue({ projectId: id, stage: "character-sheet", key: `character-sheet:manual:${Date.now()}`, target: "定妆 林夏", input: { projectId: id, characterId, kind: "portrait", count: 4 }, priority: 6 });
    const plan = planPipeline(id, doc, goal);
    expect(plan.steps.filter((s) => s.stage === "character-sheet")).toEqual([]);
    expect(plan.currentKeys).toContain(autoPortraitKey(id, characterId, sheetSourceHash(doc.characters[0], doc.visualStyle)));
  });

  it("确认开工时真的入队一个带 auto 标记的定妆任务", async () => {
    const { produce } = await import("./plan");
    const { id, doc } = await newProject();
    const job = produce(id, goal).enqueued.find((j) => j.stage === "character-sheet");
    expect(job).toBeTruthy();
    expect(job!.input).toMatchObject({ characterId: doc.characters[0].id, kind: "portrait", count: 1, auto: true });
    expect(job!.target).toBe("立绘 林夏");
    expect(job!.costEstimate).toBe(0);
  });

  it("手动「重新识别角色」成功后也会补立绘，且这条任务不属于任何制作目标", async () => {
    const { isAutoPortraitInput } = await import("./auto-portrait");
    const { enqueue, projectJobs } = await import("../server/jobs");
    const { onSettled } = await import("./runtime");
    const { id, doc } = await newProject();
    const cast = enqueue({ projectId: id, stage: "cast", key: `cast:${id}:手动`, target: "识别角色", input: { projectId: id, modelId: "deepseek" }, priority: 4 });
    await onSettled(cast, true);
    const sheets = projectJobs(id).filter((j) => j.stage === "character-sheet");
    expect(sheets).toHaveLength(1);
    expect(isAutoPortraitInput(sheets[0].input)).toBe(true);
    expect(sheets[0].input).toMatchObject({ characterId: doc.characters[0].id, count: 1 });
    expect(sheets[0].input).not.toHaveProperty("goalId");
  });

  it("自动立绘失败不暂停自动推进，其它任务失败照旧暂停", async () => {
    const { getGoal, setGoal } = await import("./plan");
    const { enqueue } = await import("../server/jobs");
    const { run } = await import("../server/db");
    const { onSettled } = await import("./runtime");
    const { id } = await newProject();
    setGoal(id, goal);
    const fail = (jobId: string, message: string) => run("UPDATE jobs SET status = 'failed', error = ? WHERE id = ?", message, jobId);

    const portrait = enqueue({ projectId: id, stage: "character-sheet", key: "auto-portrait:x", target: "立绘 林夏", input: { projectId: id, characterId: "c1", kind: "portrait", count: 1, auto: true }, priority: 6 });
    fail(portrait.id, "服务商 500");
    await onSettled(portrait, false);
    expect(getGoal(id)?.blocked).toBeNull();

    const storyboard = enqueue({ projectId: id, stage: "storyboard", key: "storyboard:x", target: "全片", input: { projectId: id }, priority: 5 });
    fail(storyboard.id, "解析失败");
    await onSettled(storyboard, false);
    expect(getGoal(id)?.blocked).toContain("失败");
  });
});
