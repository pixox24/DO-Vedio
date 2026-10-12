import { describe, expect, it, vi } from "vitest";
import { analyzeViralReference } from "../../lib/viral/analysis";
import { generateViralAngles } from "../../lib/viral/angles";
import { generationMaterials } from "../../lib/viral/evidence";
import { viralMarkdown, viralPlainText } from "../../lib/viral/export";
import { generateViralScript, scriptStats } from "../../lib/viral/generation";
import { anglesSourceFingerprint, outlineSourceFingerprint, scriptFingerprint } from "../../lib/viral/invalidation";
import { buildGenerationContext, generationRules, type ViralLLM } from "../../lib/viral/prompts";
import { checkViralScript, reviewAndRepairViralScript } from "../../lib/viral/review";
import { viralReviewSchema, viralScriptVersionSchema } from "../../lib/viral/schemas";
import { createEmptyDraft, createTask, defaultViralInput, reviewIsCurrent } from "../../lib/viral/state";
import { captureViralStyle } from "../../lib/viral/style";
import type { ViralAnalysis, ViralAngle, ViralInput, ViralScriptVersion, ViralTaskSnapshot } from "../../lib/viral/types";
import { runViralStage } from "../../lib/pipeline/viral/stages";
import { builtinTemplates } from "../../lib/templates/builtin";

const distinctive = "把犹豫折成紫色纸鹤藏进宇宙冰箱";
const styleFact = "我带团队一年收入翻了19倍";
function setup() {
  const input: ViralInput = { ...defaultViralInput(), referenceText: `参考开头。${distinctive}。参考收束。`, topic: "如何选适合自己的学习工具", platform: "douyin", modelId: "user-configured-model", humanize: false };
  input.style.sample = styleFact;
  const draft = createEmptyDraft(input, "quick", "draft", "2026-10-11T00:00:00.000Z");
  const snapshot = createTask(draft, "quick", "task", "2026-10-11T00:00:00.000Z").snapshot;
  const angle: ViralAngle = { id: "angle", title: "按实际任务选择", coreQuestion: "何时需要换工具", coreClaim: "先验证使用任务", hook: "先看要解决的任务。", route: [{ id: "route", claim: "比较日常使用条件", materialIds: [] }], materialIds: [], missingEvidence: [], recommendedReason: "" };
  snapshot.selectedAngle = angle;
  snapshot.outline = { id: "outline", sourceFingerprint: outlineSourceFingerprint(snapshot), createdAt: "2026-10-11T00:00:00.000Z", sections: [{ id: "s1", title: "判断任务", function: "explanation", points: ["用户编辑后的要点"], seconds: 60, materialIds: [] }, { id: "s2", title: "适用边界", function: "ending", points: ["用户编辑后的限制条件"], seconds: 60, materialIds: [] }] };
  const analysis: ViralAnalysis = { id: "analysis", summary: distinctive, observations: [{ id: "observation", function: "hook", quote: distinctive, start: 5, end: 23, observation: distinctive, hypothesis: "可能引发好奇" }], mechanisms: [{ id: "mechanism", type: "hook", archetype: "curiosity_gap", description: distinctive, enabled: true }], distinctiveElements: [{ id: "distinctive", kind: "metaphor", text: distinctive, reason: "有辨识度" }], referenceFingerprint: input.referenceText, createdAt: "2026-10-11T00:00:00.000Z" };
  snapshot.mechanisms = analysis.mechanisms;
  return { input, draft, snapshot, analysis, angle };
}
function version(snapshot: ViralTaskSnapshot, text = "先看自己每天会用它解决什么问题。选择要贴合实际任务。", manuallyEdited = false): ViralScriptVersion {
  return { id: "version", revision: 1, title: "按自己的任务选择", segments: [{ id: "s1", title: "判断任务", text, materialIds: [] }, { id: "s2", title: "适用边界", text: "复杂需求可以分步骤试用。", materialIds: [] }], completedSegmentIds: ["s1", "s2"], complete: true, manuallyEdited, basedOn: { input: snapshot.input, mechanisms: snapshot.mechanisms, selectedAngle: snapshot.selectedAngle, outline: snapshot.outline }, createdAt: "2026-10-11T00:00:00.000Z", parentVersionId: null, origin: manuallyEdited ? "manual" : "generated" };
}
function llm(jsonOutput: unknown[] = [], streamText = "先根据自己每天的任务试用工具，再决定是否需要更换。") {
  const requests: { instructions: string; prompt: string }[] = [];
  const json = vi.fn(async (_model: string, _schema: unknown, prompt: { instructions: string; prompt: string }) => { requests.push(prompt); if (!jsonOutput.length) throw new Error("unexpected json call"); return jsonOutput.shift(); });
  const plain = vi.fn(async (_model: string, prompt: { instructions: string; prompt: string }) => { requests.push(prompt); return streamText; });
  const stream = vi.fn(async (_model: string, prompt: { instructions: string; prompt: string }, signal: AbortSignal | undefined, onText: (text: string) => Promise<void>) => { requests.push(prompt); signal?.throwIfAborted(); await onText(streamText.slice(0, 5)); await onText(streamText); return streamText; });
  return { driver: { json, plain, stream } as unknown as ViralLLM, json, plain, stream, requests };
}
const cleanReview = { claims: [], issues: [] };

describe("viral engine request boundaries and provenance", () => {
  it("A05/A16 projects mechanisms and omits source/private analysis/style facts on every writing request", async () => {
    const { snapshot, analysis } = setup();
    const context = buildGenerationContext(snapshot, analysis);
    const mock = llm([{ title: "选择适合自己的工具" }]);
    const result = await generateViralScript(context, snapshot, null, { llm: mock.driver });
    expect(result.complete).toBe(true);
    expect(result.completedSegmentIds).toEqual(["s1", "s2"]);
    expect(viralScriptVersionSchema.safeParse(result).success).toBe(true);
    expect(mock.requests.length).toBe(3);
    for (const request of mock.requests) {
      const content = JSON.stringify(request);
      expect(content).not.toContain(distinctive);
      expect(content).not.toContain(styleFact);
      expect(content).not.toContain("referenceText");
      expect(content).toContain("用户编辑后的");
    }
    expect(mock.stream.mock.calls[0][0]).toBe("user-configured-model");
  });

  it("A07 analysis accepts reference alone, locates quotes and rejects invented quotations", async () => {
    const { input } = setup(); input.topic = ""; input.platform = null;
    const mock = llm([{ summary: "观察到开头提出形象表达", observations: [{ function: "hook", quote: distinctive, observation: "使用比喻", hypothesis: "可能引发好奇" }, { function: "ending", quote: "原文根本没有的句子", observation: "x", hypothesis: "x" }], mechanisms: [{ type: "hook", archetype: "curiosity_gap", description: "提出一个问题" }], distinctiveElements: [{ kind: "metaphor", text: distinctive, reason: "独特比喻" }, { kind: "case", text: "编造原文案例", reason: "x" }] }]);
    const analysis = await analyzeViralReference(input, { llm: mock.driver });
    expect(analysis.observations).toHaveLength(1);
    expect(input.referenceText.slice(analysis.observations[0].start, analysis.observations[0].end)).toBe(distinctive);
    expect(analysis.distinctiveElements).toHaveLength(1);
    expect(mock.requests[0].prompt).toContain(distinctive);
  });

  it("A02/A08 requires own task and produces three different route cards without inventing evidence IDs", async () => {
    const { snapshot, analysis } = setup();
    const context = buildGenerationContext(snapshot, analysis);
    const mock = llm([{ angles: ["原因", "行动", "边界"].map((kind) => ({ title: kind, coreQuestion: `${kind}的问题`, coreClaim: `${kind}的主张`, hook: `${kind}开头`, route: [{ claim: `${kind}路线`, materialIds: ["invented"] }], materialIds: ["invented"], missingEvidence: [] })) }]);
    const result = await generateViralAngles(context, snapshot.modelId, { llm: mock.driver });
    expect(result.angles).toHaveLength(3);
    expect(new Set(result.angles.map((angle) => angle.coreQuestion)).size).toBe(3);
    expect(result.angles.every((angle) => angle.materialIds.length === 0 && angle.route[0].materialIds.length === 0)).toBe(true);
    expect(result.angles.find((angle) => angle.id === result.selectedAngleId)?.recommendedReason).toContain("不依赖具体案例与统计");
    expect(JSON.stringify(mock.requests)).not.toContain(distinctive);
    await expect(generateViralAngles({ ...context, task: { ...context.task, topic: " " } }, snapshot.modelId, { llm: mock.driver })).rejects.toThrow("自己的主题");
  });

  it("angle recommendation describes recorded links without claiming that valid material IDs prove the proposal", async () => {
    const { snapshot, analysis } = setup();
    snapshot.input.materials = [{ id: "m1", kind: "data", text: "构造示例：20段片段中18段需要校对，不是行业统计，未记录错因。", source: "构造验收素材", verification: "user_provided" }];
    const mock = llm([{ angles: ["校对操作", "判断依据", "限定范围"].map((name) => ({ title: name, coreQuestion: `${name}如何做`, coreClaim: `${name}是本期提案`, hook: `先看${name}`, route: [{ claim: `${name}的提案`, materialIds: ["m1"] }], materialIds: ["m1"], missingEvidence: [] })) }]);
    const result = await generateViralAngles(buildGenerationContext(snapshot, analysis), snapshot.modelId, { llm: mock.driver });
    const reason = result.angles.find((angle) => angle.id === result.selectedAngleId)!.recommendedReason;
    expect(reason).toContain("未列待补材料");
    expect(reason).toContain("具体主张仍需成稿检查");
    expect(reason).not.toMatch(/无需补充关键依据|证据充分|已经验证/);
    expect(mock.json).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mock.requests)).toContain(snapshot.input.materials[0].text);
  });

  it("preserves source verification and style snapshot copies", () => {
    const { input } = setup();
    input.materials = [{ id: "m1", text: "用户提供了20次试用结果", kind: "data", source: "内部笔记", verification: "user_provided" }];
    expect(generationMaterials(input.materials)[0].verification).toBe("user_provided");
    const source = structuredClone(builtinTemplates[0]);
    const snapshot = captureViralStyle(source);
    source.dos.push("后加规则");
    expect(snapshot.dos).not.toContain("后加规则");
  });
});

describe("viral generation resumes and candidate protection", () => {
  it("a new topic selects a new angle and actually uses it in outline and generation requests", async () => {
    const { snapshot, analysis, angle } = setup();
    const oldSource = anglesSourceFingerprint(snapshot);
    angle.title = "旧主题咖啡路线"; angle.coreClaim = "咖啡适合早晨喝";
    snapshot.input.topic = "AI字幕工具如何选择";
    const mock = llm([
      { angles: ["转写准确", "字幕流程", "适用边界"].map((name) => ({ title: name, coreQuestion: `${name}如何判断`, coreClaim: `${name}要按素材条件评估`, hook: `${name}先看自己的需求。`, route: [{ claim: `${name}的证据路线`, materialIds: [] }], materialIds: [], missingEvidence: [] })) },
      { sections: [{ title: "新主题AI字幕段落", function: "explanation", points: ["比较字幕转写的适用条件"], seconds: 120, materialIds: [] }] },
      { title: "AI字幕选择" },
    ]);
    const artifacts = { analysis, angles: [angle], selectedAngleId: angle.id, anglesSourceFingerprint: oldSource, outline: snapshot.outline, version: null, review: null };
    const angles = await runViralStage("angles", snapshot, artifacts, { llm: mock.driver });
    if (angles.stage !== "angles") throw new Error("wrong stage");
    expect(angles.selectedAngleId).not.toBe(angle.id);
    expect(angles.angles).toHaveLength(3);
    artifacts.angles = angles.angles; artifacts.selectedAngleId = angles.selectedAngleId!;
    snapshot.selectedAngle = angles.angles.find((item) => item.id === angles.selectedAngleId)!;
    snapshot.outline = null;
    const outline = await runViralStage("outline", snapshot, artifacts, { llm: mock.driver });
    if (outline.stage !== "outline") throw new Error("wrong stage");
    snapshot.outline = outline.outline; artifacts.outline = outline.outline;
    const generated = await runViralStage("generation", snapshot, artifacts, { llm: mock.driver });
    expect(generated.stage).toBe("generation");
    for (const request of mock.requests.slice(1)) {
      expect(request.prompt).toContain("AI字幕");
      expect(request.prompt).toContain(snapshot.selectedAngle.coreClaim);
      expect(request.prompt).not.toContain("旧主题咖啡路线");
      expect(request.prompt).not.toContain("咖啡适合早晨喝");
    }
  });

  it("only platform and duration adaptation retains the selected route", async () => {
    const { snapshot, analysis, angle } = setup();
    const oldSource = anglesSourceFingerprint(snapshot);
    snapshot.input.platform = "bilibili"; snapshot.input.targetSeconds = 300;
    const mock = llm([{ angles: ["原因", "行动", "边界"].map((kind) => ({ title: kind, coreQuestion: `${kind}的问题`, coreClaim: `${kind}的主张`, hook: `${kind}开头`, route: [{ claim: `${kind}路线`, materialIds: [] }], materialIds: [], missingEvidence: [] })) }]);
    const result = await runViralStage("angles", snapshot, { analysis, angles: [angle], selectedAngleId: angle.id, anglesSourceFingerprint: oldSource, outline: snapshot.outline, version: null, review: null }, { llm: mock.driver });
    expect(result.stage).toBe("angles");
    if (result.stage !== "angles") throw new Error("wrong stage");
    expect(result.selectedAngleId).toBe(angle.id);
    expect(result.angles.some((item) => item.id === angle.id)).toBe(true);
  });

  it("A14 resumes only missing/incomplete segments, preserving completed text", async () => {
    const { snapshot, analysis } = setup();
    const previous = version(snapshot);
    previous.complete = false; previous.completedSegmentIds = ["s1"];
    previous.segments[1].text = "半段不能当作完成";
    const mock = llm(); const checkpoints: ViralScriptVersion[] = [];
    const result = await generateViralScript(buildGenerationContext(snapshot, analysis), snapshot, previous, { llm: mock.driver, onVersion: (working) => { checkpoints.push(working); } });
    expect(mock.stream).toHaveBeenCalledTimes(1);
    expect(result.id).toBe(previous.id);
    expect(result.segments[0].text).toBe(previous.segments[0].text);
    expect(result.segments[1].text).not.toBe(previous.segments[1].text);
    expect(checkpoints.some((working) => !working.complete && !working.completedSegmentIds.includes("s2") && working.segments[1].text.length > 0)).toBe(true);
    expect(checkpoints.at(-1)?.complete).toBe(true);
  });

  it("A18/A32 rewrite returns candidate, keeps human protection and old provenance", async () => {
    const { snapshot, analysis } = setup();
    const previous = version(snapshot, `${distinctive}。人工内容。`, true);
    snapshot.command = "rewrite"; snapshot.rewrite = { segmentId: "s1", instruction: "更简洁" };
    const old = structuredClone(previous);
    const mock = llm();
    const artifacts = { analysis, angles: [snapshot.selectedAngle!], selectedAngleId: snapshot.selectedAngle!.id, outline: snapshot.outline, version: previous, review: null };
    const result = await runViralStage("generation", snapshot, artifacts, { llm: mock.driver });
    expect(result.stage).toBe("generation");
    if (result.stage !== "generation") throw new Error("wrong stage");
    expect(result.version).toEqual(old);
    expect(result.candidateVersion?.id).not.toBe(previous.id);
    expect(result.candidateVersion?.manuallyEdited).toBe(true);
    expect(result.candidateVersion?.segments[1]).toEqual(previous.segments[1]);
    expect(previous).toEqual(old);
    expect(JSON.stringify(mock.requests)).not.toContain(distinctive);
  });

  it("A19 four platform instructions differ and respect explicit endings", () => {
    const { snapshot } = setup();
    const requests = ["douyin", "xiaohongshu", "bilibili", "xigua"].map((platform) => generationRules(buildGenerationContext({ ...snapshot, input: { ...snapshot.input, platform: platform as typeof snapshot.input.platform } })));
    expect(new Set(requests).size).toBe(4);
    expect(requests[0]).toContain("短口播");
    expect(requests[2]).toContain("中长口播");
    expect(requests[2]).toContain("不要默认要求投币");
    expect(requests[1]).toContain("避免无依据的种草承诺");
  });

  it("A20/A27 uses narration counting and exports selected title/body only", () => {
    const { snapshot } = setup();
    const script = version(snapshot, "汉字 ABC 123。");
    const exported = viralMarkdown(script);
    expect(exported).toContain(`# ${script.title}`);
    expect(exported).not.toContain("materialIds");
    expect(exported).not.toContain(distinctive);
    expect(viralPlainText(script).startsWith(script.title)).toBe(true);
    expect(scriptStats(script, buildGenerationContext(snapshot)).needsCalibration).toBe(true);
  });
});

describe("viral final review and bounded repair", () => {
  it("A05 specifics need content-backed evidence, common facts and opinions remain allowed", async () => {
    const { snapshot, analysis } = setup();
    snapshot.input.materials = [{ id: "m1", text: "进行了10次试用", kind: "data", source: "用户笔记", verification: "user_provided" }];
    const script = version(snapshot, "试用了99次。学习工具要匹配任务。");
    const mock = llm([{ claims: [{ segmentId: "s1", excerpt: "试用了99次", kind: "specific_fact", materialIds: ["m1"], supported: true, reason: "模型误认" }, { segmentId: "s1", excerpt: "学习工具要匹配任务", kind: "opinion", materialIds: [], supported: true, reason: "观点" }], issues: [] }]);
    const review = await checkViralScript(snapshot, script, analysis, { llm: mock.driver });
    expect(review.issues.filter((finding) => finding.severity === "blocker")).toHaveLength(1);
    expect(review.issues.find((finding) => finding.category === "fact")?.reason).toContain("具体数值");
    expect(viralReviewSchema.safeParse(review).success).toBe(true);
    expect(review.scriptFingerprint).toBe(scriptFingerprint(script));
  });

  it("A17 does not infer a blocker solely from a public-topic match; locates distinctive exact overlap as judgment", async () => {
    const { snapshot, analysis } = setup();
    const ordinary = version(snapshot);
    const clean = await checkViralScript(snapshot, ordinary, analysis, { llm: llm([cleanReview]).driver });
    expect(clean.issues.filter((finding) => finding.severity !== "suggestion")).toEqual([]);
    const copied = version(snapshot, distinctive);
    const report = await checkViralScript(snapshot, copied, analysis, { llm: llm([cleanReview]).driver });
    expect(report.issues.find((finding) => finding.category === "originality")).toMatchObject({ severity: "judgment", excerpt: distinctive });
  });

  it("rejects fabricated source passages and misassigned element IDs instead of blocking a new commonplace analogy", async () => {
    const { snapshot, analysis } = setup();
    const excerpt = "自动识别像查字典时遇到生僻字。";
    const script = version(snapshot, excerpt);
    for (const sourceEvidence of [undefined, { excerpt: "查字典时遇到生僻字", start: 0, distinctiveElementId: analysis.distinctiveElements[0].id, relationType: "distinctive_expression", relation: "参考也有这句" }, { excerpt: "参考开头", start: 0, distinctiveElementId: analysis.distinctiveElements[0].id, relationType: "distinctive_expression", relation: "误把一般开头对应到独特比喻" }]) {
      const mock = llm([{ claims: [], issues: [{ severity: "blocker", category: "originality", segmentId: "s1", excerpt, reason: "参考里存在同一个查字典比喻", suggestion: "换一个比喻", materialIds: [], sourceEvidence, resolutionAccepted: false }] }]);
      const result = await reviewAndRepairViralScript(snapshot, script, analysis, { llm: mock.driver });
      expect(result.review.issues.filter((finding) => finding.category === "originality")).toEqual([]);
      expect(result.repairedVersion).toBeUndefined();
      expect(mock.stream).not.toHaveBeenCalled();
    }
  });

  it("accepts inspectable source evidence for a nonliteral distinctive relation only as human judgment; common function alone is ignored", async () => {
    const { snapshot, analysis } = setup();
    const excerpt = "把不确定的想法折作紫色飞鸟，放到星际冷柜。";
    const script = version(snapshot, excerpt);
    const sourceEvidence = { excerpt: distinctive, start: snapshot.input.referenceText.indexOf(distinctive), distinctiveElementId: analysis.distinctiveElements[0].id, relationType: "distinctive_expression", relation: "折叠犹豫、紫色鸟、宇宙冷藏的组合对应" };
    const finding = { severity: "blocker", category: "originality", segmentId: "s1", excerpt, reason: "模型宣称确定照搬", suggestion: "按自己的素材重新解释", materialIds: [], sourceEvidence, resolutionAccepted: false };
    const review = await checkViralScript(snapshot, script, analysis, { llm: llm([{ claims: [], issues: [finding] }]).driver });
    expect(review.issues.find((item) => item.category === "originality")).toMatchObject({ severity: "judgment", excerpt });
    expect(review.issues.find((item) => item.category === "originality")?.reason).toContain(distinctive);
    const generic = await checkViralScript(snapshot, script, analysis, { llm: llm([{ claims: [], issues: [{ ...finding, sourceEvidence: { ...sourceEvidence, relationType: "generic_mechanism", relation: "都是用类比帮助解释" } }] }]).driver });
    expect(generic.issues.filter((item) => item.category === "originality")).toEqual([]);
  });

  it("requires constructed data to remain an explicit example even when the reviewer says the numbers are supported", async () => {
    const { snapshot, analysis } = setup();
    snapshot.input.materials = [{ id: "m1", kind: "data", text: "人工构造测试记录：20段录音中18段需要校对；只是测试样本，不是行业统计。", source: "构造验收素材", verification: "user_provided" }];
    const excerpt = "我们自己做的测试发现，20段录音里18段需要校对。";
    const claims = [{ segmentId: "s1", excerpt, kind: "specific_fact", materialIds: ["m1"], supported: true, reason: "数字均有相同素材ID" }];
    const report = await checkViralScript(snapshot, version(snapshot, excerpt), analysis, { llm: llm([{ claims, issues: [] }]).driver });
    expect(report.issues.find((item) => item.category === "fact")).toMatchObject({ severity: "blocker", excerpt });
    const explicit = "这里是一份人工构造的测试记录：20段录音中18段需要校对，只代表该示例，不是行业统计。";
    const accepted = await checkViralScript(snapshot, version(snapshot, explicit), analysis, { llm: llm([{ claims: [{ ...claims[0], excerpt: explicit }], issues: [] }]).driver });
    expect(accepted.issues.filter((item) => item.category === "fact")).toEqual([]);
  });

  it("fact repair rebuilds from this task and materials, without recycling unsupported hooks, route claims, titles or outline points", async () => {
    const { snapshot, analysis } = setup();
    const unsupportedCause = "李泽言被认成李泽轩，因为系统训练词库从未收录这个名字";
    snapshot.input.topic = "自动字幕发布前如何校对";
    snapshot.input.coreClaim = "先校对专有名词和否定词再发布";
    snapshot.input.materials = [{ id: "m1", kind: "data", text: "人工构造的测试记录：20段片段中18段至少有一处专有名词需校对，未记录错因，不是行业统计。", source: "构造验收", verification: "user_provided" }];
    snapshot.selectedAngle = { ...snapshot.selectedAngle!, title: unsupportedCause, hook: unsupportedCause, coreClaim: unsupportedCause, route: [{ id: "old-route", claim: unsupportedCause, materialIds: ["m1"] }] };
    snapshot.outline!.sections[0] = { ...snapshot.outline!.sections[0], title: unsupportedCause, points: [unsupportedCause], materialIds: ["m1"] };
    const script = version(snapshot, unsupportedCause); script.title = unsupportedCause; script.segments[0].title = unsupportedCause;
    const original = structuredClone(script);
    const diagnostic = "检查诊断说素材没有训练词库证据，不能把原因限定到本次测试就放行";
    const repairedText = "先听原音核对专有名词，再检查否定词。这里的人工构造示例只提醒我们需要校对，不代表行业统计，也没有证明错误原因。";
    const mock = llm([{ claims: ["s1", null].map((segmentId) => ({ segmentId, excerpt: unsupportedCause, kind: "specific_fact", materialIds: ["m1"], supported: false, reason: diagnostic })), issues: [] }, { title: "字幕发布前先做校对" }, cleanReview], repairedText);
    const result = await reviewAndRepairViralScript(snapshot, script, analysis, { llm: mock.driver });
    expect(result.repairedVersion?.segments[0].text).toBe(repairedText);
    expect(result.repairedVersion?.title).toBe("字幕发布前先做校对");
    expect(result.repairedVersion?.segments[1]).toEqual(script.segments[1]);
    expect(script).toEqual(original);
    const writing = mock.stream.mock.calls[0][1];
    const titleWriting = mock.json.mock.calls[1][2];
    expect(JSON.stringify(titleWriting)).not.toContain(unsupportedCause);
    expect(JSON.stringify(writing)).not.toContain(unsupportedCause);
    expect(JSON.stringify(writing)).not.toContain(diagnostic);
    expect(JSON.stringify(writing)).not.toContain(distinctive);
    const payload = JSON.parse(writing.prompt.split("\n")[0]);
    expect(payload.selectedAngle).toBeNull();
    expect(payload.outline).toBeNull();
    expect(payload.task.topic).toBe(snapshot.input.topic);
    expect(payload.materials).toEqual(snapshot.input.materials);
    expect(writing.prompt).toContain('"function":"explanation"');
    expect(writing.prompt).toContain('"seconds":60');
    expect(result.review.versionId).toBe(result.repairedVersion?.id);
  });

  it("A18 binds current title+body+rules and checks final processed text", async () => {
    const { snapshot, analysis, draft } = setup();
    const script = version(snapshot);
    const review = await checkViralScript(snapshot, script, analysis, { llm: llm([cleanReview]).driver });
    draft.versions = [script]; draft.currentVersionId = script.id; draft.review = review;
    expect(reviewIsCurrent(draft)).toBe(true);
    script.title += "新的标题";
    expect(reviewIsCurrent(draft)).toBe(false);
  });

  it("A32 automatic draft repairs once, rechecks new version, and stops even if still blocked", async () => {
    const { snapshot, analysis } = setup();
    snapshot.input.avoid = ["禁用词"];
    const script = version(snapshot, "禁用词。需要修改。");
    const mock = llm([cleanReview, cleanReview], "禁用词。仍然有问题。");
    const result = await reviewAndRepairViralScript(snapshot, script, analysis, { llm: mock.driver });
    expect(result.repairedVersion?.id).not.toBe(script.id);
    expect(result.review.versionId).toBe(result.repairedVersion?.id);
    expect(result.review.autoRepairCount).toBe(1);
    expect(result.review.issues.some((finding) => finding.severity === "blocker")).toBe(true);
    expect(mock.stream).toHaveBeenCalledTimes(1);
    const recheck = llm([cleanReview]);
    await reviewAndRepairViralScript(snapshot, result.repairedVersion!, analysis, { llm: recheck.driver, previousReview: result.review });
    expect(recheck.stream).not.toHaveBeenCalled();
  });

  it("A32 human edited draft is never replaced; candidate preserves parent and dirty provenance", async () => {
    const { snapshot, analysis } = setup();
    snapshot.input.avoid = ["禁用词"];
    const script = version(snapshot, "禁用词。人工文字。", true);
    const old = structuredClone(script);
    const mock = llm([cleanReview]);
    const result = await reviewAndRepairViralScript(snapshot, script, analysis, { llm: mock.driver });
    expect(result.repairedVersion).toBeUndefined();
    expect(result.candidateVersion?.parentVersionId).toBe(script.id);
    expect(result.candidateVersion?.manuallyEdited).toBe(true);
    expect(result.review.versionId).toBe(script.id);
    expect(script).toEqual(old);
    expect(mock.json).toHaveBeenCalledTimes(1);
  });

  it("A16 repair writing requests do not contain copied source phrase or review diagnostics", async () => {
    const { snapshot, analysis } = setup();
    const script = version(snapshot, distinctive);
    const issue = { severity: "blocker", category: "originality", segmentId: "s1", excerpt: distinctive, reason: `沿用参考金句${distinctive}`, suggestion: `不要抄${distinctive}`, materialIds: [], resolutionAccepted: false };
    const mock = llm([{ claims: [], issues: [issue] }, cleanReview]);
    await reviewAndRepairViralScript(snapshot, script, analysis, { llm: mock.driver });
    expect(mock.requests[0].prompt).toContain(distinctive);
    const writing = mock.stream.mock.calls[0][1];
    expect(JSON.stringify(writing)).not.toContain(distinctive);
    expect(JSON.stringify(writing)).not.toContain("沿用参考金句");
  });

  it("A25/A32 saves a completed repair before a failed recheck, allowing check-only retry", async () => {
    const { snapshot, analysis } = setup();
    snapshot.input.avoid = ["禁用词"];
    const script = version(snapshot, "禁用词。需要修改。");
    const mock = llm([cleanReview]);
    const saved: ViralScriptVersion[] = [];
    await expect(reviewAndRepairViralScript(snapshot, script, analysis, { llm: mock.driver, onVersion: (working) => { saved.push(working); } })).rejects.toThrow("unexpected json call");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ complete: true, origin: "auto_repair" });
    const retry = llm([cleanReview]);
    const result = await reviewAndRepairViralScript(snapshot, saved[0], analysis, { llm: retry.driver });
    expect(result.review.autoRepairCount).toBe(1);
    expect(retry.stream).not.toHaveBeenCalled();
  });

  it("checks humanized final text rather than the generated pre-processing body", async () => {
    const { snapshot, analysis } = setup();
    snapshot.input.humanize = true;
    const generated = "说白了，工具要匹配每天的任务。选择时可以先按实际需求试用。";
    const mock = llm([{ title: "按实际任务选择" }, cleanReview], generated);
    mock.plain.mockImplementation(async (_model, prompt) => { mock.requests.push(prompt); return generated.replace("说白了，", ""); });
    const final = await generateViralScript(buildGenerationContext(snapshot, analysis), snapshot, null, { llm: mock.driver });
    expect(final.segments[0].text).not.toContain("说白了");
    const report = await checkViralScript(snapshot, final, analysis, { llm: mock.driver });
    expect(report.scriptFingerprint).toBe(scriptFingerprint(final));
    expect(mock.requests.at(-1)?.prompt).not.toContain("说白了");
  });
});
