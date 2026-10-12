import { quickHash } from "../hash";
import type { Line } from "../types";
import { detectSourceLanguage } from "./language";
import { pendingTranslateUnits, type SecondaryUnit } from "./secondary";

/**
 * 双语成片要交给模型的句子。
 * 无法判断语言的句子（纯数字、符号）不进队列，也不挡住渲染。
 */
export function subtitleTranslateUnits(lines: Line[]): SecondaryUnit[] {
  return pendingTranslateUnits(lines).filter((unit) => detectSourceLanguage(unit.text));
}

/**
 * 任务键只跟口播原文走。
 * 译文写回后键不变，同一批失败的任务不会在自动推进里被再次提交。
 */
export function subtitleTranslateKey(projectId: string, lines: Pick<Line, "id" | "text">[]): string {
  return `subtitle-translate:${projectId}:${quickHash(lines.map((line) => [line.id, line.text]))}`;
}
