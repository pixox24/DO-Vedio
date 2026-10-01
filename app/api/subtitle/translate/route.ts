import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { generateJson } from "@/lib/llm";
import { bilingualTarget, detectSourceLanguage, type ScriptLanguage } from "@/lib/core/subtitle/language";
import { assessSecondaryQuality, primaryHash, TRANSLATE_BATCH_SIZE } from "@/lib/core/subtitle/secondary";

/**
 * 双语字幕翻译：把一句口播翻译成画面上的副行字幕（从 AI-Video 字幕模块移植）。
 * 方向按每条 unit 确定（unit.from > 顶层 from > mode > 逐句识别），低置信度直接拒绝；
 * 字幕级精简、ID 锚定、逐条过统一质量门；校验不过时用更严格的提示重试，宁缺毋滥。
 */

export const maxDuration = 120;

const languageSchema = z.enum(["zh", "en"]);

const body = z.object({
  modelId: z.string().min(1, "请选择模型"),
  from: languageSchema.optional(),
  to: languageSchema.optional(),
  mode: z.enum(["auto", "zh", "en"]).optional(),
  units: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().min(1),
        from: languageSchema.optional(),
        to: languageSchema.optional(),
      }),
    )
    .min(1, "没有需要翻译的句子")
    .max(200),
});

const translationSchema = z.object({
  items: z.array(z.object({ id: z.string(), text: z.string() })),
});

interface TranslateUnit {
  id: string;
  text: string;
  from: ScriptLanguage;
  to: ScriptLanguage;
  primaryHash: string;
}

const languageLabel = (language: ScriptLanguage) => (language === "en" ? "英文" : "中文");

export async function POST(req: Request) {
  return handle(async () => {
    const { modelId, from, to, mode, units } = await parseBody(req, body);

    const items: { id: string; text: string; primaryHash: string }[] = [];
    const failed: { id: string; reason: string }[] = [];
    const groups = new Map<string, TranslateUnit[]>();
    const seen = new Set<string>();

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

    const buildPrompt = (batch: TranslateUnit[], stricter: boolean) => {
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
${batch.map((u, i) => `${i + 1}. id=${u.id}（源语言：${languageLabel(u.from)}）\n${languageLabel(u.from)}：${u.text}`).join("\n\n")}

只输出 JSON。`;
    };

    const askOnce = async (batch: TranslateUnit[], stricter: boolean): Promise<Map<string, string>> => {
      const parsed = await generateJson(modelId, translationSchema, {
        instructions: "你是只输出合法 JSON 的字幕翻译器。",
        prompt: buildPrompt(batch, stricter),
      });
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
    const askSafely = async (batch: TranslateUnit[], stricter: boolean): Promise<Map<string, string>> => {
      try {
        return await askOnce(batch, stricter);
      } catch (e) {
        lastCallError = e instanceof Error ? e.message : "翻译模型调用失败";
        return new Map<string, string>();
      }
    };

    const passes = (unit: TranslateUnit, translated?: string) =>
      typeof translated === "string" && translated.length > 0 && assessSecondaryQuality(unit.text, translated, unit.from, unit.to).ok;

    let extraCalls = 0;
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += TRANSLATE_BATCH_SIZE) {
        const batch = group.slice(i, i + TRANSLATE_BATCH_SIZE);
        lastCallError = "";
        const best = await askSafely(batch, false);
        const needsSecond = batch.filter((unit) => !passes(unit, best.get(unit.id)));
        if (needsSecond.length > 0) {
          const stricter = await askSafely(needsSecond, true);
          for (const [id, translated] of stricter) best.set(id, translated);
        }
        for (const unit of batch) {
          while (!passes(unit, best.get(unit.id)) && extraCalls < 16) {
            extraCalls++;
            const single = await askSafely([unit], true);
            const translated = single.get(unit.id);
            if (translated) best.set(unit.id, translated);
          }
          const translated = best.get(unit.id);
          if (passes(unit, translated) && translated) {
            items.push({ id: unit.id, text: translated, primaryHash: unit.primaryHash });
          } else {
            failed.push({ id: unit.id, reason: lastCallError || "译文未通过质量校验" });
          }
        }
      }
    }

    return Response.json({ items, failed });
  });
}
