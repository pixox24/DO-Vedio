import { z } from "zod";

/** 中文口播语速（字/分钟） */
export const speechRates = { slow: 200, medium: 250, fast: 300 } as const;
export const speechRateLabels = { slow: "舒缓", medium: "适中", fast: "紧凑" } as const;
export type SpeechRate = keyof typeof speechRates;
const rateEnum = z.enum(["slow", "medium", "fast"]);

export const templateInputSchema = z.object({
  name: z.string().trim().min(1, "请填写模板名称"),
  description: z.string(),
  tone: z.string(),
  speechRate: rateEnum,
  structureHints: z.string(),
  /** 选题偏好：这种风格倾向从什么角度切题；旧模板没有该字段，默认为空 */
  ideation: z.string().default(""),
  dos: z.array(z.string()),
  donts: z.array(z.string()),
  sample: z.string(),
});
export const styleTemplateSchema = templateInputSchema.extend({
  id: z.string(),
  builtin: z.boolean().optional(),
});
export type TemplateInput = z.infer<typeof templateInputSchema>;
export type StyleTemplate = z.infer<typeof styleTemplateSchema>;

export const briefSchema = z.object({
  title: z.string().trim().min(1, "请填写视频标题"),
  /** 可留空：留空时先由 AI 构思选题角度，再填入这里 */
  summary: z.string().trim(),
  minutes: z.number().min(0.5).max(30),
  templateId: z.string(),
  audience: z.string(),
  perspective: z.enum(["first", "third"]),
  mustInclude: z.string(),
  avoid: z.string(),
  /** auto = 跟随风格模板 */
  rate: z.enum(["auto", "slow", "medium", "fast"]),
});
export type Brief = z.infer<typeof briefSchema>;

export const contentKinds = {
  fact: { label: "真实科普", rule: "只使用可靠的常识性事实，不要编造具体数据、人名和出处" },
  opinion: { label: "观点评论", rule: "观点要有论据支撑，涉及事实的部分不要编造" },
  story: { label: "虚构故事", rule: "人物和情节为虚构创作，不要声称是真实事件" },
} as const;
export type ContentKind = keyof typeof contentKinds;

export const angleSchema = z.object({
  angle: z.string().describe("一句话切入角度"),
  hook: z.string().describe("开场第一句台词"),
  points: z.array(z.string()).min(1).describe("3-5 个核心要点"),
  kind: z.enum(["fact", "opinion", "story"]).describe("内容性质"),
  note: z.string().describe("题材与风格冲突时的提醒和处理建议，没有则为空字符串"),
});
export const anglesSchema = z.object({ angles: z.array(angleSchema).min(1) });
export type Angle = z.infer<typeof angleSchema>;

/** 把选中的角度写成内容概要；direction 是用户原先填的方向 */
export function angleToSummary(a: Angle, direction = "") {
  return [
    direction && `创作方向：${direction}`,
    `切入角度：${a.angle}`,
    `开场钩子：${a.hook}`,
    `核心要点：\n${a.points.map((p) => `- ${p}`).join("\n")}`,
    `内容性质：${contentKinds[a.kind].label}（${contentKinds[a.kind].rule}）`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const sectionSchema = z.object({
  title: z.string(),
  points: z.string(),
  minutes: z.number().positive(),
});
export const outlineSchema = z.object({ sections: z.array(sectionSchema).min(1) });
export type Section = z.infer<typeof sectionSchema>;

export const segmentSchema = z.object({ title: z.string(), text: z.string() });
export type Segment = z.infer<typeof segmentSchema>;

export const metadataSchema = z.object({
  titles: z.array(z.string()).min(1),
  description: z.string(),
  tags: z.array(z.string()),
});
export type Metadata = z.infer<typeof metadataSchema>;

export const rewriteActions = {
  expand: "扩写",
  shrink: "缩写",
  colloquial: "更口语化",
  restyle: "换风格",
  custom: "自定义",
  fit: "校准时长",
} as const;
export type RewriteAction = keyof typeof rewriteActions;

export type ModelInfo = { id: string; label: string; model: string };

/** 流式文本中出现该标记，表示其后是错误信息 */
export const STREAM_ERROR_MARK = "\u0000ERROR:";
