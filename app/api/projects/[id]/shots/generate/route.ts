import { z } from "zod";
import { randomUUID } from "crypto";
import { fail, handle, parseBody } from "@/lib/api";
import { shotGenerationKey } from "@/lib/core/keys";
import { listProviderProfiles } from "@/lib/providers/registry";
import { enqueue, latestJobByKey, projectJobs } from "@/lib/server/jobs";
import { getProject } from "@/lib/server/projects";
import { assetStale, compileShotPrompt, needsGeneratedImage } from "@/lib/core/prompt-compiler";
import { quickHash } from "@/lib/core/hash";
import { ensureProjectVisualStyle } from "@/lib/visual-styles/store";
import { outputSpecForRequest, type GenerationFrame } from "@/lib/core/output-spec";
import { outputSpecsFor } from "@/lib/core/output-spec";
import type { Aspect, OutputSpecId } from "@/lib/core/types";

const body = z.object({ modelId: z.string().min(1), candidateCount: z.number().int().min(1).max(4).default(1), outputSpecId: z.enum(["landscape-1080p", "portrait-1080p"]).optional(), aspect: z.enum(["16:9", "9:16"]).optional(), assetFraming: z.enum(["smart-dual", "per-output", "shared"]).optional() });

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/shots/generate">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const project = (await ensureProjectVisualStyle(id)) ?? getProject(id);
    if (!project) return fail("项目不存在", 404);
    const input = await parseBody(req, body);
    const model = listProviderProfiles().find((p) => p.kind === "image" && p.configured && p.enabled && `${p.providerId}::${p.modelId}` === input.modelId);
    if (!model) return fail("图片模型不可用，请在模型中心检查配置", 409);
    if (projectJobs(id).some((job) => job.stage === "shot-generate" && (job.status === "queued" || job.status === "running") && typeof job.input === "object" && job.input !== null && "batchId" in job.input)) {
      return fail("已有全量生图任务正在执行，请先停止本次生成", 409);
    }
    const selectedId = model.custom ? input.modelId : model.modelId;
    const selectedSpec = outputSpecForRequest(project.doc.settings, input.outputSpecId as OutputSpecId | undefined, input.aspect as Aspect | undefined);
    const specs = input.outputSpecId || input.aspect ? [selectedSpec] : outputSpecsFor(project.doc.settings);
    const framing = input.assetFraming ?? project.doc.settings.assetFraming;
    // 缺素材或素材已过期（描述、景别、风格改过）的生成画面镜头；信息卡、标题卡、金句卡不生图
    const shots = project.doc.shots.filter((shot) => !shot.locked && needsGeneratedImage(shot));
    const tasks = shots.flatMap((shot) => {
      const separate = framing === "per-output" || (framing === "smart-dual" && specs.length > 1 && (shot.importance === 3 || shot.characterIds.length > 0 || !!shot.onScreenText));
      const targetSpecs = separate ? specs : [specs[0]];
      return targetSpecs.filter((spec) => {
        const variant = shot.assetVariants?.[spec.aspect];
        const hint = spec.aspect === "9:16" ? "竖屏构图，主体保持在中央安全区，顶部和底部预留字幕与平台界面空间" : "横屏构图，主体和关键动作保持在中央安全区，左右保留环境叙事空间";
        const fresh = variant && variant.promptHash === quickHash(`${compileShotPrompt(project.doc, shot).full}。${hint}`);
        return fresh ? false : separate || variant ? true : (!shot.assetId || assetStale(project.doc, shot));
      }).map((spec) => ({ shot, spec }));
    });
    if (!tasks.length) return fail("没有需要生成图片的镜头", 409);
    const batchId = randomUUID();
    const jobs = tasks.flatMap(({ shot, spec }) => {
      const frame: GenerationFrame = { aspect: spec.aspect, width: spec.width, height: spec.height, fps: spec.fps };
      const key = shotGenerationKey(project.doc, shot, "image", selectedId, frame);
      // 单镜头任务已经在跑时让它继续，批次停止不能误伤它。
      const active = latestJobByKey(key, id);
      if (active && (active.status === "queued" || active.status === "running")) return [];
      return [enqueue({
        projectId: id,
        stage: "shot-generate",
        key,
        target: `镜头 ${shot.id}`,
        input: { projectId: id, shotId: shot.id, kind: "image", modelId: selectedId, candidateCount: input.candidateCount, outputSpecId: spec.id, frame, assetFraming: framing, batchId },
        priority: 6,
      })];
    });
    if (!jobs.length) return fail("所需镜头已有生成任务正在执行", 409);
    return Response.json({ batchId, count: jobs.length, skipped: tasks.length - jobs.length, jobs });
  });
}
