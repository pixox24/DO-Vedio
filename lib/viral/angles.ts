import { randomUUID } from "node:crypto";
import { z } from "zod";
import { validMaterialIds } from "./evidence";
import { contextBlock, generationRules, viralLLM, type ViralLLM } from "./prompts";
import type { ViralAngle, ViralGenerationContext } from "./types";

export const anglesOutputSchema = z.object({ angles: z.array(z.object({
  title: z.string().trim().min(1), coreQuestion: z.string().trim().min(1), coreClaim: z.string().trim().min(1), hook: z.string().trim().min(1),
  route: z.array(z.object({ claim: z.string().trim().min(1), materialIds: z.array(z.string()) })).min(1),
  materialIds: z.array(z.string()), missingEvidence: z.array(z.string()),
})).length(3) });

export function anglesPrompt(context: ViralGenerationContext, retry = false) {
  return {
    instructions: generationRules(context),
    prompt: `${contextBlock({ ...context, selectedAngle: null, outline: null })}\n构思三个新角度，核心问题、证据路线或展开方式须有实质差异，不能只换开头。每项给新主张、可朗读示例开头、证据步骤、真正使用的素材ID及缺失依据。
在每步claim中写清素材能支持什么，以及必要限定；不能只挂上一个素材ID就把该素材未记录的姓名、具体事件、错因或技术机制当成事实。结果记录只支持该样本观察，不能证明为什么发生；不支持原因时改问“应如何判断/操作”，不要编一个原因。方法的步骤编号或建议数量不是效果统计，不能由“做几步/检查几个样本”编出避免多少错误的比例；素材有某个数字也不意味着支持另一指标、对象或因果。构造测试和假设案例必须在hook及对应claim中明示性质，不得包装成实测、亲历或行业规律。材料说“可能、可选、尚未验证”时保留这些限定，不能写成必然结果、唯一方案或已经验证成功。没有素材也应提供可用的常识解释/观点路线，不能要求编造案例、数字或经历。缺失重要资料时改选不依赖资料的路线；仅确实不可替代的依据才写missingEvidence，内容写待补材料的具体描述，不填已经存在的素材ID。内容性质为auto时根据主题判断真实科普/观点，虚构仅story可用。${retry ? "上一批角度的问题和论证基本相同，这次分别尝试原因解释、行动决策、适用边界三条不同路线；原因解释仍必须有材料支持，不支持时改为不同的判断问题。" : ""}`,
  };
}

function distinctAngles(angles: z.infer<typeof anglesOutputSchema>["angles"]): boolean {
  const clean = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, "");
  return new Set(angles.map((angle) => clean(angle.coreQuestion))).size === 3
    && new Set(angles.map((angle) => clean(angle.coreClaim + angle.route.map((step) => step.claim).join("")))).size === 3;
}

export async function generateViralAngles(context: ViralGenerationContext, modelId: string, options: { signal?: AbortSignal; llm?: ViralLLM } = {}): Promise<{ angles: ViralAngle[]; selectedAngleId: string }> {
  if (!context.task.topic.trim() || !context.task.platform || !Number.isFinite(context.task.targetSeconds) || context.task.targetSeconds < 30 || context.task.targetSeconds > 1800) throw new Error("生成角度前请填写自己的主题、平台和30秒至30分钟的时长");
  const llm = options.llm ?? viralLLM;
  let raw = anglesOutputSchema.parse(await llm.json(modelId, anglesOutputSchema, anglesPrompt(context), options.signal));
  if (!distinctAngles(raw.angles)) raw = anglesOutputSchema.parse(await llm.json(modelId, anglesOutputSchema, anglesPrompt(context, true), options.signal));
  if (!distinctAngles(raw.angles)) throw new Error("三个角度仍缺少实质差异，请重试角度步骤");
  const angles: ViralAngle[] = raw.angles.map((angle) => ({
    ...angle, id: randomUUID(), materialIds: validMaterialIds(angle.materialIds, context.materials),
    route: angle.route.map((step) => ({ ...step, id: randomUUID(), materialIds: validMaterialIds(step.materialIds, context.materials) })),
    recommendedReason: "",
  }));
  const ranked = angles.map((angle, index) => ({ angle, index, score: validMaterialIds([...angle.materialIds, ...angle.route.flatMap((step) => step.materialIds)], context.materials).length * 3 - angle.missingEvidence.length * 5 - Math.max(0, angle.route.length - (context.task.targetSeconds <= 180 ? 3 : 6)) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const recommended = ranked[0].angle;
  recommended.recommendedReason = `${recommended.missingEvidence.length === 0 ? "该角度未列待补材料" : "该角度列有待补材料"}，${recommended.materialIds.length ? `关联本期 ${recommended.materialIds.length} 条素材` : "未关联具体素材，拟采用不依赖具体案例与统计的解释路线"}；按素材关联数、待补项和本期${context.task.targetSeconds <= 180 ? "短" : "中长"}口播的展开层数推荐，具体主张仍需成稿检查。`;
  return { angles, selectedAngleId: recommended.id };
}
