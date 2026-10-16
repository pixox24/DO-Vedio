import { castSourceHash, currentCharacterReferenceIds, sheetSourceHash } from "../core/cast";
import { needsAutoScene, sceneSourceHash } from "../core/scenes";
import type { CharacterCard, Job, ProjectDoc } from "../core/types";
import { all } from "../server/db";
import { enqueue, latestJobByKey } from "../server/jobs";
import { getProject } from "../server/projects";
import { resolveImageModel } from "./image-models";

/**
 * 自动立绘：`cast`（识别角色）完成后，为每个还没有「当前画面风格 + 当前外貌」立绘的角色
 * 排一个定妆任务（立绘 1 张），生成后直接作为这个角色的标准形象。
 *
 * - 由项目设置 `settings.autoPortrait` 控制，默认关闭；关闭时不排任何生图任务。
 * - 与配音、分镜并行；图片驱动允许缺图继续，AI 视频须等关联的有效标准图被采用。
 * - 是否需要重生成沿用定妆指纹 `sheetSourceHash`：画面风格或角色外貌字段变了才算过期，
 *   过期会重新生成并覆盖标准形象，旧图仍留在候选里。
 */

/** 自动立绘的步骤：结构上兼容 plan.ts 的 PlanStep，避免两个模块互相 import */
export type AutoPortraitStep = {
  stage: "character-sheet";
  key: string;
  target: string;
  input: Record<string, unknown>;
  cost: number;
  priority: number;
};

export type AutoPortraitTarget = { card: CharacterCard; key: string; step: AutoPortraitStep; busy: boolean };

/** 自动立绘的任务标记：失败不自动重提；AI 视频的依赖门禁由当前标准图决定。 */
export function isAutoPortraitInput(input: unknown): boolean {
  return !!input && typeof input === "object" && (input as { auto?: unknown }).auto === true;
}

export function isAutoPortraitJob(job: Pick<Job, "stage" | "input">) {
  return (job.stage === "character-sheet" || job.stage === "scene-reference") && isAutoPortraitInput(job.input);
}

/** 每个角色 + 每个定妆指纹一个稳定键：任务在跑时不会重复提交，失败过的不再自动重提 */
export function autoPortraitKey(projectId: string, characterId: string, sourceHash: string) {
  return `auto-portrait:${projectId}:${characterId}:${sourceHash}`;
}

/**
 * 需要自动立绘的角色：在场、露正脸、未锁定、不是群体，且没有当前风格/外貌的立绘。
 * 锁定角色在定妆阶段会直接报错，群体角色不需要单独的立绘，都不排。
 */
export function needsAutoPortrait(card: CharacterCard, doc: ProjectDoc): boolean {
  if (!doc.settings.autoPortrait) return false;
  if (card.absent || card.locked || card.kind === "group" || card.presentation !== "full") return false;
  if (doc.settings.visualPipeline === "video") return currentCharacterReferenceIds(card, doc.visualStyle).length === 0;
  return card.sheet.sourceHash !== sheetSourceHash(card, doc.visualStyle);
}

/** 正在或即将定妆的角色：避免自动立绘和手动「生成」同时提交同一个角色（重复计费） */
function busyCharacterIds(projectId: string): Set<string> {
  const rows = all<{ characterId: string | null }>(
    "SELECT DISTINCT json_extract(input, '$.characterId') AS characterId FROM jobs WHERE project_id = ? AND stage = 'character-sheet' AND status IN ('queued', 'running')",
    projectId,
  );
  return new Set(rows.map((row) => row.characterId).filter((x): x is string => !!x));
}

/** 当前该自动生成立绘的角色（纯判定，不看环境）：角色卡已对齐当前文案，且角色还缺当前风格的立绘 */
export function autoPortraitCards(doc: ProjectDoc): CharacterCard[] {
  // 角色卡还没对到当前文案时不排：那时生成的是上一版人物，等重新识别完再说
  if (doc.castAnalysis?.sourceHash !== castSourceHash(doc)) return [];
  return doc.characters.filter((card) => needsAutoPortrait(card, doc));
}

/** 这个项目当前该自动生成哪些立绘；返回的 busy 项用于计划页的「当前任务」匹配，不入队 */
export function autoPortraitPlan(doc: ProjectDoc, projectId: string): AutoPortraitTarget[] {
  const cards = autoPortraitCards(doc);
  if (cards.length === 0) return [];
  // 没有可用的生图模型就不排任务（角色面板会提示去配置），避免必然失败的任务
  const modelId = resolveImageModel();
  if (!modelId) return [];
  const busy = busyCharacterIds(projectId);
  return cards.map((card) => {
    const key = autoPortraitKey(projectId, card.id, sheetSourceHash(card, doc.visualStyle));
    return {
      card,
      key,
      busy: busy.has(card.id),
      step: {
        stage: "character-sheet" as const,
        key,
        target: `立绘 ${card.name}`,
        input: { projectId, characterId: card.id, kind: "portrait", modelId, count: 1, auto: true },
        // 生图单价没有接入计费（config/pricing.json 只有文本与配音），所以预估为 0，开工确认里另有费用提示
        cost: 0,
        priority: 6,
      },
    };
  });
}

/**
 * 手动「重新识别角色」也走这条路：cast 成功后补一次入队。
 * 这里的任务不带 goalId —— 手动识别不属于任何制作目标，失败也不会拦住正在跑的自动推进。
 */
export function enqueueAutoPortraits(projectId: string): Job[] {
  const project = getProject(projectId);
  if (!project) return [];
  const jobs: Job[] = [];
  for (const item of autoPortraitPlan(project.doc, projectId)) {
    if (item.busy) continue;
    // 与 produce() 一致：上次失败或取消的任务不自动重提，等用户自己点重试
    const last = latestJobByKey(item.key, projectId);
    if (last && (last.status === "failed" || last.status === "canceled")) continue;
    jobs.push(enqueue({ projectId, stage: item.step.stage, key: item.key, target: item.step.target, input: item.step.input, priority: item.step.priority, costEstimate: item.step.cost }));
  }
  return jobs;
}

/** 场景共用自动立绘开关、模型选择与队列；每个场景每个来源指纹仅一张。 */
export function autoScenePlan(doc: ProjectDoc, projectId: string) {
  if (doc.castAnalysis?.sourceHash !== castSourceHash(doc)) return [];
  const cards = doc.scenes.filter((scene) => needsAutoScene(scene, doc));
  const modelId = cards.length ? resolveImageModel() : undefined;
  if (!modelId) return [];
  const busy = new Set(all<{ sceneId: string }>(
    "SELECT json_extract(input, '$.sceneId') AS sceneId FROM jobs WHERE project_id = ? AND stage = 'scene-reference' AND status IN ('queued', 'running')", projectId,
  ).map((row) => row.sceneId));
  return cards.map((card) => {
    const sourceHash = sceneSourceHash(card, doc.visualStyle);
    const key = `auto-scene:${projectId}:${card.id}:${sourceHash}`;
    return { card, key, busy: busy.has(card.id), step: {
      stage: "scene-reference", key, target: `场景图 ${card.name}`,
      input: { projectId, sceneId: card.id, modelId, sourceHash, auto: true }, cost: 0, priority: 6,
    } };
  });
}

export function enqueueAutoScenes(projectId: string, onlyGenerated = false): Job[] {
  const project = getProject(projectId);
  if (!project) return [];
  const jobs: Job[] = [];
  for (const item of autoScenePlan(project.doc, projectId)) {
    if (onlyGenerated && !item.card.referenceSourceHash) continue;
    if (item.busy) continue;
    const last = latestJobByKey(item.key, projectId);
    if (last && ["failed", "canceled", "succeeded"].includes(last.status)) continue;
    jobs.push(enqueue({ projectId, stage: item.step.stage, key: item.key, target: item.step.target, input: item.step.input, priority: item.step.priority }));
  }
  return jobs;
}
