import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { translateSubtitleUnits } from "@/lib/pipeline/subtitle-translate";

/**
 * 双语字幕翻译：把一句口播翻译成画面上的副行字幕。
 * 方向按每条 unit 确定（unit.from > 顶层 from > mode > 逐句识别），低置信度直接拒绝。
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

export async function POST(req: Request) {
  return handle(async () => {
    const input = await parseBody(req, body);
    const result = await translateSubtitleUnits(input.modelId, input.units, {
      from: input.from,
      to: input.to,
      mode: input.mode,
      signal: req.signal,
    });
    return Response.json({ items: result.items, failed: result.failed });
  });
}
