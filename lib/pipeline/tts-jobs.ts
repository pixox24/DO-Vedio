import type { ProjectDoc, VoiceSettings } from "../core/types";
import { all } from "../server/db";
import { cancelJob, enqueue } from "../server/jobs";
import type { lineTtsKeys } from "./artifacts";
import type { PlanStep } from "./plan";
import { billedCharsOf, estimateTtsCost } from "./pricing";
import type { TtsBlockInput } from "./stages/tts-block";

/**
 * 配音任务的唯一构造入口：自动编排、全部重录 / 补齐、单句重录、换音色都走这里。
 * 段落模式下同一块的句子合并成一个 tts-block 任务（块内哪怕只缺一句也整块提交）。
 */

export type TtsKeyItem = ReturnType<typeof lineTtsKeys>[number];

export type TtsStepOptions = {
  /** 换音色时用目标音色，缺省为项目当前音色 */
  voice?: VoiceSettings;
  /** 重录：忽略缓存命中，新音频成功后覆盖 */
  force?: boolean;
  /** 任务键前缀：换音色的任务与自动编排的任务分开计数、分开取消 */
  keyPrefix?: string;
};

/** 这句的配音由哪个任务键负责（段落模式是块键） */
export const ttsJobKeyOf = (item: Pick<TtsKeyItem, "key" | "block">) => item.block?.key ?? item.key;

export function ttsSteps(doc: ProjectDoc, projectId: string, items: TtsKeyItem[], opts: TtsStepOptions = {}): PlanStep[] {
  const voice = opts.voice ?? doc.settings.voice;
  const order = new Map(doc.lines.map((line, k) => [line.id, k + 1]));
  const cost = (spoken: string) => estimateTtsCost(voice.provider, voice.model, billedCharsOf(spoken));
  const seen = new Set<string>();
  const steps: PlanStep[] = [];
  for (const item of items) {
    const key = `${opts.keyPrefix ?? ""}${ttsJobKeyOf(item)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.block) {
      const { members, joiner } = item.block;
      const input: TtsBlockInput = { projectId, blockKey: item.block.key, joiner, lines: members, voice, ...(opts.force ? { force: true } : {}) };
      steps.push({ stage: "tts-block", key, target: `第 ${order.get(members[0].lineId) ?? "?"}–${order.get(members[members.length - 1].lineId) ?? "?"} 句`, input, cost: cost(members.map((m) => m.spoken).join(joiner)), priority: 4 });
      continue;
    }
    steps.push({
      stage: "tts",
      key,
      target: `第 ${order.get(item.line.id) ?? "?"} 句`,
      input: { projectId, lineId: item.line.id, text: item.line.text, spoken: item.spoken, ttsText: item.ttsText, textType: item.textType, map: item.map, voice, ...(opts.force ? { force: true } : {}) },
      cost: cost(item.spoken),
      priority: 4,
    });
  }
  return steps;
}

/** 提交配音任务。replace：先取消同键排队 / 运行中的任务，保证重录用的是最新参数 */
export function enqueueTtsSteps(projectId: string, steps: PlanStep[], opts: { replace?: boolean } = {}) {
  return steps.map((step) => {
    if (opts.replace) for (const active of all<{ id: string }>("SELECT id FROM jobs WHERE project_id = ? AND key = ? AND status IN ('queued', 'running')", projectId, step.key)) cancelJob(active.id);
    return enqueue({ projectId, stage: step.stage, key: step.key, target: step.target, input: step.input, priority: step.priority, costEstimate: step.cost });
  });
}
