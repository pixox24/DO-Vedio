import { z } from "zod";
import { VIRAL_LIMITS, VIRAL_MECHANISM_ARCHETYPES, VIRAL_PLATFORMS } from "./types";

const id = z.string().min(1);
const timestamp = z.string();
const rate = z.enum(["slow", "medium", "fast"]);
const stage = z.enum(["analysis", "angles", "outline", "generation", "review"]);
const taskCommand = z.enum(["quick", "analyze", "angles", "outline", "generate", "rewrite", "calibrate", "review"]);
const aspectRatio = z.enum(["9:16", "16:9"]);
const contentKind = z.enum(["auto", "fact", "opinion", "story"]);
const materialIds = z.array(id);

export const viralMaterialSchema = z.object({
  id, text: z.string(), kind: z.enum(["point", "fact", "experience", "data", "testimonial"]),
  source: z.string(), verification: z.enum(["user_provided", "pending", "verified"]),
}).strict();
export const viralStyleSnapshotSchema = z.object({
  templateId: z.string(), templateName: z.string(), capturedAt: timestamp, tone: z.string(),
  dos: z.array(z.string()), donts: z.array(z.string()), rules: z.array(z.string()), sample: z.string(), speechRate: rate,
}).strict();
/** Saving a draft allows incomplete fields. Submission validates them separately; no text is silently trimmed. */
export const viralInputSchema = z.object({
  referenceText: z.string().max(VIRAL_LIMITS.reference, "参考稿最多 20000 字符"),
  referenceTitle: z.string(), referenceSource: z.string(), topic: z.string().max(VIRAL_LIMITS.topic, "主题最多 200 字符"),
  platform: z.enum(VIRAL_PLATFORMS).nullable(), targetSeconds: z.number().finite(), durationIsManual: z.boolean(),
  materials: z.array(viralMaterialSchema), audience: z.string(), coreClaim: z.string(), contentKind,
  style: viralStyleSnapshotSchema, perspective: z.enum(["first", "third"]), rate: z.enum(["auto", "slow", "medium", "fast"]),
  mustInclude: z.array(z.string()), avoid: z.array(z.string()), ending: z.enum(["natural", "discussion", "save", "business"]),
  modelId: z.string(), memes: z.array(z.object({ id, name: z.string(), text: z.string(), verified: z.boolean() }).strict()), humanize: z.boolean(),
  handoff: z.object({ aspectRatio, aspectRatioIsManual: z.boolean(), settingsVersion: z.number().int().nonnegative() }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.materials.reduce((total, item) => total + item.text.length, 0) > VIRAL_LIMITS.materials) ctx.addIssue({ code: "custom", path: ["materials"], message: "素材合计最多 10000 字符" });
  if (new Set(value.materials.map((item) => item.id)).size !== value.materials.length) ctx.addIssue({ code: "custom", path: ["materials"], message: "素材标识不能重复" });
});

export const viralMechanismSchema = z.object({ id, type: z.enum(["hook", "progression", "pacing", "ending"]), archetype: z.enum(VIRAL_MECHANISM_ARCHETYPES), description: z.string(), enabled: z.boolean() }).strict();
export const viralAnalysisSchema = z.object({
  id, summary: z.string(), observations: z.array(z.object({ id, function: z.enum(["hook", "progression", "pacing", "ending"]), quote: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), observation: z.string(), hypothesis: z.string() }).strict().refine((item) => item.end >= item.start, "原文定位无效")),
  mechanisms: z.array(viralMechanismSchema), distinctiveElements: z.array(z.object({ id, kind: z.enum(["metaphor", "case", "phrase", "data", "argument"]), text: z.string(), reason: z.string() }).strict()), referenceFingerprint: z.string(), createdAt: timestamp,
}).strict();
export const viralAngleSchema = z.object({
  id, title: z.string(), coreQuestion: z.string(), coreClaim: z.string(), hook: z.string(),
  route: z.array(z.object({ id, claim: z.string(), materialIds }).strict()).min(1, "至少保留一项论证路线"), materialIds, missingEvidence: z.array(z.string()), recommendedReason: z.string(),
}).strict();
export const viralOutlineSchema = z.object({
  id, sections: z.array(z.object({ id, title: z.string(), function: z.string(), points: z.array(z.string()), seconds: z.number().positive("每段预计时长须为正数"), materialIds }).strict()).min(1, "至少保留一段大纲"), sourceFingerprint: z.string(), createdAt: timestamp,
}).strict();
export const viralInputSnapshotSchema = z.object({ input: viralInputSchema, mechanisms: z.array(viralMechanismSchema), selectedAngle: viralAngleSchema.nullable(), outline: viralOutlineSchema.nullable() }).strict();
export const viralSegmentSchema = z.object({ id, title: z.string(), text: z.string(), materialIds }).strict();
export const viralScriptVersionSchema = z.object({
  id, revision: z.number().int().nonnegative(), title: z.string(), segments: z.array(viralSegmentSchema), completedSegmentIds: z.array(id), complete: z.boolean(), manuallyEdited: z.boolean(), basedOn: viralInputSnapshotSchema, createdAt: timestamp, parentVersionId: id.nullable(), origin: z.enum(["generated", "manual", "rewrite", "calibrated", "auto_repair"]),
}).strict().superRefine((value, ctx) => {
  if (value.complete && (!value.title.trim() || !value.segments.length || value.segments.some((item) => !item.text.trim()))) ctx.addIssue({ code: "custom", message: "完整稿件必须包含标题和全部段落正文" });
  if (new Set(value.segments.map((item) => item.id)).size !== value.segments.length) ctx.addIssue({ code: "custom", path: ["segments"], message: "段落标识不能重复" });
  if (value.completedSegmentIds.some((segmentId) => !value.segments.some((item) => item.id === segmentId)) || new Set(value.completedSegmentIds).size !== value.completedSegmentIds.length) ctx.addIssue({ code: "custom", path: ["completedSegmentIds"], message: "已完成段落必须对应唯一正文段落" });
  if (value.complete && value.completedSegmentIds.length !== value.segments.length) ctx.addIssue({ code: "custom", path: ["complete"], message: "仍有未完成段落" });
});
export const viralIssueResolutionSchema = z.object({ issueId: id, action: z.enum(["evidence", "revised", "citation"]), note: z.string().trim().min(1, "请说明问题处理依据"), materialIds }).strict();
export const viralReviewRulesSchema = z.object({ avoid: z.array(z.string()), mustInclude: z.array(z.string()), contentKind, perspective: z.enum(["first", "third"]), materials: z.array(viralMaterialSchema), style: viralStyleSnapshotSchema, targetSeconds: z.number(), rate: z.enum(["auto", "slow", "medium", "fast"]) }).strict();
export const viralReviewIssueSchema = z.object({ id, severity: z.enum(["blocker", "judgment", "suggestion"]), category: z.enum(["fact", "originality", "style", "constraint", "duration", "complete"]), segmentId: id.nullable(), excerpt: z.string(), reason: z.string(), suggestion: z.string(), materialIds, resolved: z.boolean() }).strict();
export const viralReviewSchema = z.object({ id, versionId: id, scriptFingerprint: z.string(), rules: viralReviewRulesSchema, referenceFingerprint: z.string(), issues: z.array(viralReviewIssueSchema), resolutions: z.array(viralIssueResolutionSchema), checkedAt: timestamp, autoRepairCount: z.number().int().min(0).max(1) }).strict();
export const viralTaskSnapshotSchema = viralInputSnapshotSchema.extend({ command: taskCommand, modelId: z.string(), versionId: id.nullable(), scriptFingerprint: z.string().nullable(), rewrite: z.object({ segmentId: id, instruction: z.string().trim().min(1) }).strict().nullable() }).strict();
export const viralTaskSchema = z.object({
  id, generation: z.number().int().positive(), status: z.enum(["queued", "running", "stopping", "completed", "needs_changes", "failed", "stopped"]), command: taskCommand,
  plan: z.array(stage).min(1), stage: stage.nullable(), completedStages: z.array(stage), snapshot: viralTaskSnapshotSchema, workingVersionId: id.nullable(), cancelRequested: z.boolean(), error: z.object({ code: z.string(), message: z.string(), stage: stage.nullable() }).strict().nullable(), createdAt: timestamp, updatedAt: timestamp,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.plan).size !== value.plan.length || new Set(value.completedStages).size !== value.completedStages.length || value.completedStages.some((item) => !value.plan.includes(item))) ctx.addIssue({ code: "custom", path: ["completedStages"], message: "任务阶段必须属于既定计划且不能重复" });
  if (value.stage && !value.plan.includes(value.stage)) ctx.addIssue({ code: "custom", path: ["stage"], message: "当前阶段不在既定计划中" });
  if (value.command !== value.snapshot.command) ctx.addIssue({ code: "custom", path: ["command"], message: "任务与快照命令必须一致" });
});
export const viralHandoffSettingsSchema = z.object({ version: z.number().int().nonnegative(), aspectRatio, platform: z.enum(VIRAL_PLATFORMS), targetSeconds: z.number().min(VIRAL_LIMITS.minSeconds).max(VIRAL_LIMITS.maxSeconds), rate, perspective: z.enum(["first", "third"]), style: viralStyleSnapshotSchema }).strict();
export const viralAdoptionSchema = z.object({ id, projectId: id, versionId: id, settings: viralHandoffSettingsSchema, adoptedScript: z.object({ title: z.string(), segments: z.array(viralSegmentSchema) }).strict(), createdAt: timestamp }).strict();
export const viralDraftSchema = z.object({
  id, revision: z.number().int().nonnegative(), mode: z.enum(["quick", "workbench"]), input: viralInputSchema, analysis: viralAnalysisSchema.nullable(), angles: z.array(viralAngleSchema), anglesSourceFingerprint: z.string().nullable(), selectedAngleId: id.nullable(), outline: viralOutlineSchema.nullable(), versions: z.array(viralScriptVersionSchema), currentVersionId: id.nullable(), candidateVersionId: id.nullable(), review: viralReviewSchema.nullable(), task: viralTaskSchema.nullable(), adoptions: z.array(viralAdoptionSchema), inputHistory: z.array(z.object({ id, snapshot: viralInputSnapshotSchema, savedAt: timestamp }).strict()), issueResolutions: z.array(viralIssueResolutionSchema), createdAt: timestamp, updatedAt: timestamp,
}).strict().superRefine((value, ctx) => {
  if (value.selectedAngleId && !value.angles.some((item) => item.id === value.selectedAngleId)) ctx.addIssue({ code: "custom", path: ["selectedAngleId"], message: "所选角度不存在" });
  if (value.currentVersionId && !value.versions.some((item) => item.id === value.currentVersionId)) ctx.addIssue({ code: "custom", path: ["currentVersionId"], message: "当前稿件版本不存在" });
  if (value.candidateVersionId && !value.versions.some((item) => item.id === value.candidateVersionId)) ctx.addIssue({ code: "custom", path: ["candidateVersionId"], message: "待采用候选版本不存在" });
  if (value.review && !value.versions.some((item) => item.id === value.review?.versionId)) ctx.addIssue({ code: "custom", path: ["review", "versionId"], message: "检查对应稿件不存在" });
  if (value.adoptions.some((item) => !value.versions.some((version) => version.id === item.versionId))) ctx.addIssue({ code: "custom", path: ["adoptions"], message: "采用对应稿件不存在" });
  for (const key of ["angles", "versions"] as const) if (new Set(value[key].map((item) => item.id)).size !== value[key].length) ctx.addIssue({ code: "custom", path: [key], message: "标识不能重复" });
});
export const viralCreateSchema = z.object({ input: viralInputSchema, mode: z.enum(["quick", "workbench"]).optional() }).strict();
export const viralPatchSchema = z.object({ expectedRevision: z.number().int().nonnegative(), input: viralInputSchema.optional(), mode: z.enum(["quick", "workbench"]).optional(), angles: z.array(viralAngleSchema).optional(), enabledMechanismIds: z.array(id).optional(), selectedAngleId: id.nullable().optional(), outline: viralOutlineSchema.nullable().optional(), manualScript: z.object({ title: z.string(), segments: z.array(viralSegmentSchema) }).strict().optional(), currentVersionId: id.optional(), adoptCandidateVersionId: id.optional(), restoreVersionId: id.optional(), issueResolutions: z.array(viralIssueResolutionSchema).optional() }).strict();
export const viralCommandSchema = z.object({ expectedRevision: z.number().int().nonnegative(), command: z.enum(["quick", "analyze", "angles", "outline", "generate", "rewrite", "calibrate", "review", "stop", "resume"]), expectedTaskId: id.optional(), rewrite: z.object({ segmentId: id, instruction: z.string().trim().min(1) }).strict().optional() }).strict().refine((value) => value.command !== "rewrite" || Boolean(value.rewrite), { path: ["rewrite"], message: "请指定段落与修改要求" }).refine((value) => value.command !== "stop" || Boolean(value.expectedTaskId?.trim()), { path: ["expectedTaskId"], message: "请指定要停止的任务" });
export const viralAdoptSchema = z.object({ expectedRevision: z.number().int().nonnegative(), versionId: id, settingsVersion: z.number().int().nonnegative() }).strict();
export const viralSyncSchema = viralAdoptSchema.extend({ projectId: id, strategy: z.enum(["replace", "new_project"]), expectedProjectScript: z.string() }).strict();
/** A strict schema makes accidental reference-side additions a validation error, rather than silently forwarding them. */
export const viralGenerationContextSchema = z.object({
  mechanisms: z.array(z.object({ type: z.enum(["hook", "progression", "pacing", "ending"]), archetype: z.enum(VIRAL_MECHANISM_ARCHETYPES), description: z.string() }).strict()),
  task: z.object({ topic: z.string(), platform: z.enum(VIRAL_PLATFORMS).nullable(), targetSeconds: z.number(), audience: z.string(), coreClaim: z.string(), contentKind, perspective: z.enum(["first", "third"]), rate: z.enum(["auto", "slow", "medium", "fast"]), mustInclude: z.array(z.string()), avoid: z.array(z.string()), ending: z.enum(["natural", "discussion", "save", "business"]), memes: z.array(z.object({ id, name: z.string(), text: z.string(), verified: z.boolean() }).strict()), humanize: z.boolean() }).strict(),
  style: viralStyleSnapshotSchema, materials: z.array(viralMaterialSchema), selectedAngle: viralAngleSchema.nullable(), outline: viralOutlineSchema.nullable(),
}).strict();
