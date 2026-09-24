import { z } from "zod";
import { briefSchema } from "./types";
import { getTemplate } from "./templates/store";
import { resolveRate } from "./duration";
import { errorMessage } from "./llm";

export function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** 解析请求体；失败时抛出可直接返回的 Response */
export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw fail(parsed.error.issues[0]?.message ?? "参数错误");
  return parsed.data;
}

export const withBrief = z.object({ brief: briefSchema, modelId: z.string().min(1, "请选择模型") });

/** 出大纲和写稿需要概要；为空时前端应先走选题构思 */
export const withSummary = withBrief.refine((b) => b.brief.summary.length > 0, "请填写内容概要，或先让 AI 构思选题角度");

export async function loadStyle(brief: z.infer<typeof briefSchema>) {
  const template = await getTemplate(brief.templateId);
  if (!template) throw fail("风格模板不存在");
  return { template, rate: resolveRate(brief.rate, template) };
}

/** 统一异常出口：Response 原样返回，其它错误转成 500 */
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return fail(errorMessage(e), 500);
  }
}
