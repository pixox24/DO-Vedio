import { randomUUID } from "crypto";
import { annotateKey, RENDER_OUTPUT_VERSION, renderKey } from "../core/keys";
import { acceptsFreeVoiceInstruction } from "../core/types";
import { stampShots } from "../core/shots";
import { renderMatches, type TimelineHashes } from "../core/output-flow";
import { animationHash, contentHash, timelineHash } from "../core/timeline";
import type { Aspect, Job, ProjectDoc } from "../core/types";
import { outputSpecForRequest } from "../core/output-spec";
import { cacheDelete, cacheGet, cacheHas, cacheMany, projectSpend } from "../server/cache";
import { all, get, run } from "../server/db";
import { cancelCatchUpJobs, enqueue, latestJobByKey } from "../server/jobs";
import { effectiveLexicon } from "../server/lexicon";
import { getProject, mutateProject } from "../server/projects";
import { lineTtsKeys, loadArtifacts, timelineFor } from "./artifacts";
import { pickTextModelId } from "../core/text-model";
import { subtitleTranslateKey, subtitleTranslateUnits } from "../core/subtitle/translate-plan";
import { listTextModels } from "../providers/registry";
import { estimateLlmCost } from "./pricing";
import { estimateSubtitleTranslateCost } from "./subtitle-translate";
import { ttsJobKeyOf, ttsSteps } from "./tts-jobs";
import type { Quality } from "./render";
import { staleRanges } from "./stages/storyboard";
import { autoPortraitPlan, isAutoPortraitInput } from "./auto-portrait";
import { castSourceHash } from "../core/cast";
import { voiceDirectionKey, type VoiceDirectionCache } from "./voice-direction";

/**
 * 对账式编排：比较「目标」和「现状」，补上缺的任务。可以反复调用，不会重复提交。
 *   文案 → 句子（同步，纯规则）
 *   句子没标注 → annotate；句子没配音 → tts；文案变了 → cast（识别角色）
 *   配音齐了且角色识别完：没分镜或分镜过期 → storyboard；没配乐 → music
 *   双语开着且有句子没译完 → subtitle-translate（与配音、分镜并行，不重复译已对上的句子）
 *   都齐了且目标是成片或样片 → 每个画幅一个 render。双语没译完时不排渲染
 *   compose（确认开工）停在渲染之前。生成成片把同一目标改成 render 后再排渲染
 */

export type Goal = { until: "preview" | "compose" | "render"; aspects: Aspect[]; quality: Quality; goalId?: string; forceRender?: boolean };

export type PlanStep = { stage: string; key: string; target: string; input: unknown; cost: number; priority: number };
export type Plan = { steps: PlanStep[]; currentKeys: string[]; waiting: string[]; ready: { preview: boolean; render: boolean }; costYuan: number };

export { syncLines } from "../core/sync";
import { syncLines } from "../core/sync";

export function textModelId(doc: ProjectDoc) {
  return pickTextModelId([doc.settings.modelId, doc.modelId], listTextModels());
}

/** 标注状态：记在 cache 里（按段落文本 + 词典 + 模型） */
function annotateSteps(doc: ProjectDoc, projectId: string): PlanStep[] {
  const lex = effectiveLexicon(projectId);
  const modelId = textModelId(doc);
  if (!modelId) return [];
  const steps: PlanStep[] = [];
  const bySeg = new Map<number, typeof doc.lines>();
  for (const l of doc.lines) bySeg.set(l.segmentIndex, [...(bySeg.get(l.segmentIndex) ?? []), l]);
  for (const [seg, lines] of bySeg) {
    const todo = lines.filter((l) => !l.locked);
    if (todo.length === 0) continue;
    const key = annotateKey(todo.map((l) => ({ id: l.id, text: l.text })), lex, modelId, projectId);
    if (cacheHas(key)) {
      // 缓存有但文档没写回（例如写回时被别处修改冲突），重跑一次写回，不花钱
      const needs = todo.some((l) => l.spans.length === 0 && l.keywords.length === 0 && !l.mood);
      if (!needs) continue;
    }
    const chars = todo.reduce((s, l) => s + l.text.length, 0);
    steps.push({
      stage: "annotate",
      key: `${key}:${projectId}`,
      target: `第 ${seg + 1} 章 · ${todo.length} 句`,
      input: { projectId, modelId, title: doc.brief.title, segmentTitle: doc.segments[seg]?.title ?? "", lines: todo.map((l) => ({ id: l.id, text: l.text })) },
      cost: cacheHas(key) ? 0 : estimateLlmCost(modelId, 1500 + chars, chars * 3),
      priority: 3,
    });
  }
  return steps;
}

/** 配音口吻：各章标注完、文本框仍空、且当前是 Qwen-Audio 时补一句。失败缓存让本次制作继续配音。 */
export function voiceDirectionPlanStep(doc: ProjectDoc, projectId: string): PlanStep | null {
  const modelId = textModelId(doc);
  const voice = doc.settings.voice;
  if (!modelId || !acceptsFreeVoiceInstruction(voice.model) || voice.instruction.trim()) return null;
  const key = voiceDirectionKey(doc, modelId);
  const cached = cacheGet<VoiceDirectionCache>(key);
  if (cached?.instruction === null) return null;
  const chars = doc.lines.reduce((sum, line) => sum + line.text.length, 0);
  return {
    stage: "voice-direction",
    key: `${key}:${projectId}`,
    target: "配音口吻",
    input: { projectId, modelId },
    cost: cached?.instruction ? 0 : estimateLlmCost(modelId, 800 + chars, 80),
    priority: 3,
  };
}

/** 用户再次开始制作时，允许上次失败的全片说明重试一次。 */
export function retryVoiceDirection(doc: ProjectDoc) {
  const modelId = textModelId(doc);
  if (!modelId || !acceptsFreeVoiceInstruction(doc.settings.voice.model) || doc.settings.voice.instruction.trim()) return;
  const key = voiceDirectionKey(doc, modelId);
  if (cacheGet<VoiceDirectionCache>(key)?.instruction === null) cacheDelete(key);
}

function currentAnnotateKeys(doc: ProjectDoc, projectId: string) {
  const modelId = textModelId(doc);
  if (!modelId) return [];
  const lex = effectiveLexicon(projectId);
  const bySeg = new Map<number, typeof doc.lines>();
  for (const line of doc.lines) bySeg.set(line.segmentIndex, [...(bySeg.get(line.segmentIndex) ?? []), line]);
  const keys: string[] = [];
  for (const lines of bySeg.values()) {
    const todo = lines.filter((line) => !line.locked);
    if (todo.length > 0) keys.push(`${annotateKey(todo.map((line) => ({ id: line.id, text: line.text })), lex, modelId, projectId)}:${projectId}`);
  }
  return keys;
}

export function planPipeline(projectId: string, doc: ProjectDoc, goal: Goal): Plan {
  const steps: PlanStep[] = [];
  const waiting: string[] = [];
  if (doc.lines.length === 0) return { steps, currentKeys: [], waiting: ["还没有文案"], ready: { preview: false, render: false }, costYuan: 0 };

  // 1) 标注（先于配音，因为读音会影响朗读文本）
  const ann = annotateSteps(doc, projectId);
  steps.push(...ann);
  const annotating = ann.length > 0;
  if (annotating) waiting.push("等待断句标注完成");

  const direction = annotating ? null : voiceDirectionPlanStep(doc, projectId);
  if (direction) {
    steps.push(direction);
    waiting.push("等待配音口吻");
  }

  // 2) 配音（等标注和全片说明写完，说明才会进缓存键）
  const keys = lineTtsKeys(doc, projectId);
  const hits = cacheMany(keys.map((k) => k.key));
  const missing = keys.filter((k) => !hits.has(k.key));
  const voicingBlocked = annotating || !!direction;
  // 第一个缺失的配音优先，让预览尽快有声音
  if (!voicingBlocked) steps.push(...ttsSteps(doc, projectId, missing).map((s, idx) => ({ ...s, priority: 4 + Math.min(idx, 1) })));
  const voiced = !voicingBlocked && missing.length === 0;
  if (!voiced && !voicingBlocked) waiting.push(`还有 ${missing.length} 句没有配音`);

  // 3) 选角（只依赖文案，和配音并行；分镜要知道有哪些角色）
  const modelId = textModelId(doc);
  const castHash = castSourceHash(doc);
  const castReady = !modelId || doc.castAnalysis?.sourceHash === castHash;
  if (!castReady) {
    const chars = doc.lines.reduce((s, l) => s + l.text.length, 0);
    steps.push({ stage: "cast", key: `cast:${projectId}:${castHash}`, target: "识别角色", input: { projectId, modelId }, cost: estimateLlmCost(modelId, 3500 + chars, 2000), priority: 4 });
  }

  // 3.5) 自动立绘（默认关闭）：识别角色完成后，为每个还没有当前风格立绘的角色排一张。
  // 与分镜、渲染并行；正在定妆的角色不入队，但要留在 currentKeys 里，否则会被当成「上一轮旧任务」。
  const portraits = autoPortraitPlan(doc, projectId);
  steps.push(...portraits.filter((p) => !p.busy).map((p) => p.step));

  // 4) 分镜（配音齐了才做，因为节奏依赖真实时长）
  let shotsReady = doc.shots.length > 0 && staleRanges(doc).length === 0;
  if (voiced && !castReady && !shotsReady) waiting.push("等待识别角色");
  if (voiced && castReady && !shotsReady && modelId) {
    const mode = doc.shots.length === 0 ? "full" : "stale";
    const sig = JSON.stringify(doc.lines.map((l) => l.id + l.text)) + JSON.stringify(doc.shots.map((s) => s.id + s.sourceHash + s.locked));
    const chars = doc.lines.reduce((s, l) => s + l.text.length, 0);
    steps.push({
      stage: "storyboard",
      key: `storyboard:${projectId}:${hashStr(sig)}`,
      target: mode === "full" ? "全片" : "改动部分",
      input: { projectId, modelId, mode },
      cost: estimateLlmCost(modelId, 2500 + chars * 1.3, chars * 2),
      priority: 5,
    });
  }
  if (voiced && !modelId) {
    waiting.push("没有可用文本模型，请在模型中心配置并启用");
    shotsReady = doc.shots.length > 0;
  }
  if (!shotsReady && voiced) waiting.push("等待分镜");

  // 双语开着才翻译。译文已对上口播时不再调用模型。关着时不排这一步。
  const translateUnits = doc.settings.subtitle.bilingual ? subtitleTranslateUnits(doc.lines) : [];
  const translationsReady = translateUnits.length === 0;
  if (!translationsReady && modelId) {
    steps.push({
      stage: "subtitle-translate",
      key: subtitleTranslateKey(projectId, doc.lines),
      target: `翻译 ${translateUnits.length} 句`,
      input: { projectId, modelId },
      cost: estimateSubtitleTranslateCost(modelId, translateUnits),
      priority: 4,
    });
    waiting.push(`还有 ${translateUnits.length} 句没有翻译`);
  } else if (!translationsReady && !waiting.includes("没有可用文本模型，请在模型中心配置并启用")) {
    waiting.push("没有可用文本模型，请在模型中心配置并启用");
  }

  // 配乐由用户在面板里选定，不选也不挡住预览和成片。
  // 双语没译完时不排渲染：渲染键在入队时就按当前文稿算好，译文还没写回会做出没有副行的成片。
  const preview = voiced && shotsReady && translationsReady;

  // 6) 渲染。确认开工（compose）不排这一步。
  const scheduleRender = goal.until === "preview" || goal.until === "render";
  if (preview && scheduleRender) {
    // preview 目标也要生成一条 draft，完成后自动暂停；render 目标使用用户选择的画质。
    const renderQuality = goal.until === "preview" ? "draft" : goal.quality;
    for (const aspect of goal.aspects) {
      const spec = outputSpecForRequest(doc.settings, undefined, aspect);
      const t = timelineFor(doc, projectId, spec.id);
      const th = timelineHash(t);
      const ch = contentHash(t);
      const ah = animationHash(t);
      const current: TimelineHashes = { contentHash: ch, animationHash: ah, timelineHash: th };
      if (!goal.forceRender && hasCurrentRender(projectId, aspect, renderQuality, current)) continue;
      steps.push({ stage: "render", key: `${renderKey(th, renderQuality, spec)}:${spec.id}`, target: `${aspect} ${renderQuality === "final" ? "成片" : "样片"}`, input: { projectId, aspect, outputSpecId: spec.id, quality: renderQuality, force: goal.forceRender === true }, cost: 0, priority: 7 });
    }
  }

  const currentKeys = currentAnnotateKeys(doc, projectId);
  if (direction) currentKeys.push(direction.key);
  // 必须用任务键（段落模式是块键），不能用成员句键：任务是以块为单位提交的，
  // 用句键会导致 JobStrip 匹配不到任何任务——进度显示 0、没有取消入口，
  // 且 running 判定漏掉配音（主按钮不禁用、「停止」不出现）。
  // 同块的多句共享一个块键，需去重，否则进度分母按句数虚高。
  currentKeys.push(...new Set(keys.map((item) => ttsJobKeyOf(item))));
  if (modelId) currentKeys.push(`cast:${projectId}:${castHash}`);
  currentKeys.push(...portraits.map((p) => p.key));
  if (voiced && modelId) {
    const sig = JSON.stringify(doc.lines.map((line) => line.id + line.text)) + JSON.stringify(doc.shots.map((shot) => shot.id + shot.sourceHash + shot.locked));
    currentKeys.push(`storyboard:${projectId}:${hashStr(sig)}`);
  }
  if (doc.settings.subtitle.bilingual) currentKeys.push(subtitleTranslateKey(projectId, doc.lines));
  if (preview && scheduleRender) {
    const renderQuality = goal.until === "preview" ? "draft" : goal.quality;
    for (const aspect of goal.aspects) {
      const spec = outputSpecForRequest(doc.settings, undefined, aspect);
      // 与上面的入队键相同，用时间轴哈希。内容哈希不含动效，对不上正在跑的渲染，进度会把它当成旧任务。
      currentKeys.push(`${renderKey(timelineHash(timelineFor(doc, projectId, spec.id)), renderQuality, spec)}:${spec.id}`);
    }
  }
  return { steps, currentKeys, waiting, ready: { preview, render: preview && goal.until === "render" }, costYuan: steps.reduce((s, x) => s + x.cost, 0) };
}

/** 已有成片同时对上内容、动画和输出版本时，不再排一次渲染。强制重渲由调用方跳过这里。 */
function hasCurrentRender(projectId: string, aspect: string, quality: Quality, current: TimelineHashes) {
  const rows = all<{ content_hash: string; animation_hash: string; timeline_hash: string; output_version: number }>(
    "SELECT content_hash, animation_hash, timeline_hash, output_version FROM renders WHERE project_id = ? AND aspect = ? AND quality = ? AND output_version = ?",
    projectId,
    aspect,
    quality,
    RENDER_OUTPUT_VERSION,
  );
  return rows.some((row) => renderMatches({ outputVersion: row.output_version, contentHash: row.content_hash, animationHash: row.animation_hash, timelineHash: row.timeline_hash }, current));
}

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export type ProduceResult = { plan: Plan; enqueued: Job[]; blocked?: string; spentYuan: number };

function goalJobKey(key: string, goalId?: string) {
  return goalId ? `${key}:goal:${goalId}` : key;
}

/** 页面读取的计划和真正入队的任务必须使用同一套键，否则当前任务会被当成旧任务。 */
function planForGoal(plan: Plan, goalId?: string): Plan {
  if (!goalId) return plan;
  return {
    ...plan,
    steps: plan.steps.map((step) => ({ ...step, key: goalJobKey(step.key, goalId) })),
    currentKeys: plan.currentKeys.map((key) => goalJobKey(key, goalId)),
  };
}

/**
 * 执行对账。dryRun 只返回计划；超过预算且未确认时不提交。
 * 同一个 key 失败过的任务不会自动重提（避免反复扣费），需要用户点重试。
 */
export function produce(projectId: string, goal: Goal, opts: { dryRun?: boolean; confirmBudget?: boolean; retryFailed?: boolean; goalId?: string } = {}): ProduceResult {
  let p = getProject(projectId);
  if (!p) throw new Error("项目不存在");
  // 文案和句子保持同步
  const synced = syncLines(p.doc);
  if (synced !== p.doc && !opts.dryRun) p = mutateProject(projectId, (d) => syncLines(d))!;
  const doc = opts.dryRun ? synced : p.doc;
  const plan = planForGoal(planPipeline(projectId, doc, goal), opts.goalId);
  const spent = projectSpend(projectId).costYuan;
  if (opts.dryRun) return { plan, enqueued: [], spentYuan: spent };
  const budget = doc.settings.budgetYuan;
  if (budget !== null && spent + plan.costYuan > budget && !opts.confirmBudget && plan.costYuan > 0) {
    return { plan, enqueued: [], blocked: `预计再花 ¥${plan.costYuan.toFixed(2)}，将超出项目预算 ¥${budget}（已花 ¥${spent.toFixed(2)}）`, spentYuan: spent };
  }
  const enqueued: Job[] = [];
  for (const s of plan.steps) {
    const last = latestJobByKey(s.key, projectId);
    // 自动推进时不重提失败过的任务（避免反复扣费）；用户主动点开始时重试
    if (last && (last.status === "failed" || last.status === "canceled") && !opts.retryFailed) continue;
    const input = opts.goalId && typeof s.input === "object" && s.input !== null
      ? { ...(s.input as Record<string, unknown>), goalId: opts.goalId }
      : s.input;
    enqueued.push(enqueue({ projectId, stage: s.stage, key: s.key, target: s.target, input, priority: s.priority, costEstimate: s.cost }));
  }
  return { plan, enqueued, spentYuan: spent };
}

// ---------- 自动推进 ----------
// 目标存在数据库里：web 进程点「一键成片」写入，Worker 每完成一个任务读出来继续推进

export type GoalState = { goal: Goal; confirmBudget: boolean; blocked: string | null };

export function setGoal(projectId: string, goal: Goal | null, confirmBudget = false): Goal | null {
  if (goal) {
    const persisted = goal.goalId ? goal : { ...goal, goalId: randomUUID() };
    run("INSERT OR REPLACE INTO project_goals (project_id, goal, confirm_budget, blocked, updated_at) VALUES (?, ?, ?, NULL, ?)", projectId, JSON.stringify(persisted), confirmBudget ? 1 : 0, Date.now());
    return persisted;
  }
  else run("DELETE FROM project_goals WHERE project_id = ?", projectId);
  return null;
}

export function getGoal(projectId: string): GoalState | undefined {
  const r = get<{ goal: string; confirm_budget: number; blocked: string | null }>("SELECT * FROM project_goals WHERE project_id = ?", projectId);
  return r ? { goal: JSON.parse(r.goal) as Goal, confirmBudget: !!r.confirm_budget, blocked: r.blocked } : undefined;
}

function block(projectId: string, reason: string) {
  run("UPDATE project_goals SET blocked = ?, updated_at = ? WHERE project_id = ?", reason, Date.now(), projectId);
}

/** 开始或继续自动推进 */
export function drive(projectId: string, goal: Goal, confirmBudget = false) {
  cancelCatchUpJobs(projectId);
  const project = getProject(projectId);
  if (project) retryVoiceDirection(project.doc);
  // 强制重渲只作用于这一次提交。写进目标的话，每完成一步都会再渲一遍。
  const { forceRender, ...stored } = goal;
  // 开工已经在跑时，生成成片只把目标改成渲染，沿用原来的目标编号，避免整条流水线再提交一遍。
  const existing = getGoal(projectId);
  const carried = existing?.goal.goalId && existing.goal.until === "compose" && stored.until === "render" ? existing.goal.goalId : undefined;
  const persisted = setGoal(projectId, carried ? { ...stored, goalId: carried } : stored, confirmBudget)!;
  const r = produce(projectId, forceRender ? { ...persisted, forceRender: true } : persisted, { confirmBudget, retryFailed: true, goalId: persisted.goalId });
  settle(projectId, r);
  return r;
}

/** 自动立绘失败不计入「有任务失败」：它是支线，不该拦住断句、配音、分镜和成片 */
const NOT_AUTO_PORTRAIT = "NOT (stage = 'character-sheet' AND json_extract(input, '$.auto') = 1)";

function settle(projectId: string, r: ProduceResult) {
  if (r.blocked) return block(projectId, r.blocked);
  const goalId = getGoal(projectId)?.goal.goalId;
  const active = goalId
    ? get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND status IN ('queued', 'running') AND json_extract(input, '$.goalId') = ?", projectId, goalId)?.n ?? 0
    : get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND status IN ('queued', 'running')", projectId)?.n ?? 0;
  if (active > 0) return;
  if (r.plan.steps.length === 0) return r.plan.waiting.length ? block(projectId, r.plan.waiting[0]) : setGoal(projectId, null);
  // 自动立绘失败过就不再自动重提。只剩这类任务时直接收掉目标：一张立绘不该把已经做完的流水线停在「无法继续」。
  const left = r.plan.steps.filter((s) => isAutoPortraitInput(s.input));
  if (left.length === r.plan.steps.length && left.every((s) => ["failed", "canceled"].includes(latestJobByKey(s.key, projectId)?.status ?? ""))) return setGoal(projectId, null);
  // 还有步骤但都没法提交（之前失败过），等待用户重试
  const failed = goalId
    ? all<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND status = 'failed' AND ${NOT_AUTO_PORTRAIT} AND json_extract(input, '$.goalId') = ?`, projectId, goalId)[0]?.n ?? 0
    : all<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND status = 'failed' AND ${NOT_AUTO_PORTRAIT}`, projectId)[0]?.n ?? 0;
  block(projectId, failed ? "有任务失败，请处理后点「重试」" : r.plan.waiting[0] ?? "无法继续");
}

/** Worker 每完成一个任务后调用 */
export function advance(job: Job) {
  if (!job.projectId) return;
  const g = getGoal(job.projectId);
  if (!g || g.blocked) return;
  if (g.goal.goalId && (typeof job.input !== "object" || job.input === null || (job.input as { goalId?: unknown }).goalId !== g.goal.goalId)) return;
  if (!getProject(job.projectId)) return setGoal(job.projectId, null);
  settle(job.projectId, produce(job.projectId, g.goal, { confirmBudget: g.confirmBudget, goalId: g.goal.goalId }));
}

/** 分镜变化后刷新 sourceHash（用户手动编辑镜头后调用） */
export function restamp(doc: ProjectDoc) {
  return { ...doc, shots: stampShots(doc.shots, doc.lines) };
}

export { loadArtifacts };
