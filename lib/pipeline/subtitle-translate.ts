import { generateJson } from "../llm";
import { bilingualTarget, detectSourceLanguage, type ScriptLanguage } from "../core/subtitle/language";
import { assessSecondaryQuality, primaryHash, TRANSLATE_BATCH_SIZE } from "../core/subtitle/secondary";
import { z } from "zod";
import { estimateLlmCost } from "./pricing";

/**
 * 双语字幕翻译。画面上的副行：中文口播译成英文，英文口播译成中文。
 * 低置信度不猜方向；质量不过关的条目不返回。调用方决定是否因此停住成片。
 */

const translationSchema = z.object({
  items: z.array(z.object({ id: z.string(), text: z.string() })),
});

export interface SubtitleTranslateUnit {
  id: string;
  text: string;
  from?: ScriptLanguage;
  to?: ScriptLanguage;
}

export interface SubtitleTranslateItem {
  id: string;
  text: string;
  primaryHash: string;
}

export interface SubtitleTranslateFailure {
  id: string;
  reason: string;
}

interface ResolvedUnit {
  id: string;
  text: string;
  from: ScriptLanguage;
  to: ScriptLanguage;
  primaryHash: string;
}

const languageLabel = (language: ScriptLanguage) => (language === "en" ? "英文" : "中文");

export function estimateSubtitleTranslateCost(modelId: string, units: { text: string }[]) {
  const chars = units.reduce((sum, unit) => sum + unit.text.length, 0);
  return estimateLlmCost(modelId, 600 + chars * 2, Math.max(chars, 1));
}

export async function translateSubtitleUnits(
  modelId: string,
  units: SubtitleTranslateUnit[],
  options: { from?: ScriptLanguage; to?: ScriptLanguage; mode?: "auto" | "zh" | "en"; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ items: SubtitleTranslateItem[]; failed: SubtitleTranslateFailure[]; aborted: boolean; inputChars: number; outputChars: number }> {
  const { from, to, mode, signal } = options;
  const items: SubtitleTranslateItem[] = [];
  const failed: SubtitleTranslateFailure[] = [];
  const groups = new Map<string, ResolvedUnit[]>();
  const seen = new Set<string>();
  let inputChars = 0;
  let outputChars = 0;
  let aborted = signal?.aborted === true;

  for (const unit of units) {
    if (seen.has(unit.id)) continue;
    seen.add(unit.id);
    const text = unit.text.trim();
    const forced = unit.from ?? from ?? (mode === "zh" || mode === "en" ? mode : undefined);
    const source = forced ?? detectSourceLanguage(text);
    if (!source) {
      failed.push({ id: unit.id, reason: "无法判断语言方向" });
      continue;
    }
    const target: ScriptLanguage = unit.to ?? to ?? bilingualTarget(source);
    const key = `${source}:${target}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push({ id: unit.id, text, from: source, to: target, primaryHash: primaryHash(text) });
  }

  const total = Array.from(groups.values()).reduce((sum, group) => sum + group.length, 0);
  let done = 0;

  const buildPrompt = (batch: ResolvedUnit[], stricter: boolean) => {
    const toLabel = languageLabel(batch[0].to);
    return `把下面的口播切片逐条翻译成短视频画面上的${toLabel}字幕。
硬规则：
- 输出 JSON {"items":[{"id":输入里的id,"text":"${toLabel}字幕"}]}，id 必须与输入一一对应，一条不多、一条不少。
- 字幕级精简：口语自然；${batch[0].to === "en" ? "单条尽量不超过 45 个英文字符，最多两句。" : "单条尽量不超过 22 个汉字，最多两句。"}
- 不加引号，不夹杂另一种语言；专有名词可保留原文，数字用阿拉伯数字。
- 只翻译给定的句子，不要翻译别的句子，也不要合并或拆分条目。
- 每条已标注源语言，必须按标注的源语言翻译成${toLabel}。
${stricter ? "- 上一轮有的条目缺失、过长或可疑。这次每条务必更短，宁可简化也不要超长。\n" : ""}
【待翻译】
${batch.map((unit, index) => `${index + 1}. id=${unit.id}（源语言：${languageLabel(unit.from)}）\n${languageLabel(unit.from)}：${unit.text}`).join("\n\n")}

只输出 JSON。`;
  };

  const askOnce = async (batch: ResolvedUnit[], stricter: boolean): Promise<Map<string, string>> => {
    const prompt = {
      instructions: "你是只输出合法 JSON 的字幕翻译器。",
      prompt: buildPrompt(batch, stricter),
    };
    inputChars += prompt.instructions.length + prompt.prompt.length;
    const parsed = await generateJson(modelId, translationSchema, prompt, signal);
    outputChars += JSON.stringify(parsed).length;
    const available = new Set(batch.map((unit) => unit.id));
    const out = new Map<string, string>();
    const returned = new Set<string>();
    for (const row of parsed.items) {
      const id = typeof row.id === "string" ? row.id.trim() : "";
      if (!id || !available.has(id) || returned.has(id)) continue;
      returned.add(id);
      const translated = row.text.trim().replace(/^["'`]+|["'`]+$/g, "");
      if (translated) out.set(id, translated);
    }
    return out;
  };

  let lastCallError = "";
  const askSafely = async (batch: ResolvedUnit[], stricter: boolean): Promise<Map<string, string>> => {
    try {
      return await askOnce(batch, stricter);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      lastCallError = error instanceof Error ? error.message : "翻译模型调用失败";
      return new Map<string, string>();
    }
  };

  const passes = (unit: ResolvedUnit, translated?: string) =>
    typeof translated === "string" && translated.length > 0 && assessSecondaryQuality(unit.text, translated, unit.from, unit.to).ok;

  let extraCalls = 0;
  groupLoop: for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += TRANSLATE_BATCH_SIZE) {
      if (signal?.aborted) {
        aborted = true;
        break groupLoop;
      }
      const batch = group.slice(i, i + TRANSLATE_BATCH_SIZE);
      try {
        lastCallError = "";
        const best = await askSafely(batch, false);
        const needsSecond = batch.filter((unit) => !passes(unit, best.get(unit.id)));
        if (needsSecond.length > 0) {
          const stricter = await askSafely(needsSecond, true);
          for (const [id, translated] of stricter) best.set(id, translated);
        }
        for (const unit of batch) {
          while (!passes(unit, best.get(unit.id)) && extraCalls < 16) {
            if (signal?.aborted) {
              aborted = true;
              break groupLoop;
            }
            extraCalls++;
            const single = await askSafely([unit], true);
            const translated = single.get(unit.id);
            if (translated) best.set(unit.id, translated);
          }
          const translated = best.get(unit.id);
          if (passes(unit, translated) && translated) items.push({ id: unit.id, text: translated, primaryHash: unit.primaryHash });
          else failed.push({ id: unit.id, reason: lastCallError || "译文未通过质量校验" });
        }
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
          aborted = true;
          break groupLoop;
        }
        throw error;
      }
      done += batch.length;
      options.onProgress?.(done, total);
    }
  }

  return { items, failed, aborted, inputChars, outputChars };
}
