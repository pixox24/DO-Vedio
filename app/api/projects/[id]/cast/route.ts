import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { castSourceHash } from "@/lib/core/cast";
import { textModelId } from "@/lib/pipeline/plan";
import { enqueue, latestJobByKey } from "@/lib/server/jobs";
import { getProject } from "@/lib/server/projects";

const body = z.object({ force: z.boolean().default(false) });

/** 手动重新识别角色；锁定的角色卡和用户改过的字段不受影响 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/cast">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const project = getProject(id);
    if (!project) return fail("项目不存在", 404);
    if (!project.doc.lines.length) return fail("还没有文案", 409);
    const modelId = textModelId(project.doc);
    if (!modelId) return fail("没有可用文本模型，请在模型中心配置并启用", 409);
    const { force } = await parseBody(req, body);
    const key = `cast:${id}:${castSourceHash(project.doc)}${force ? `:force:${Date.now()}` : ""}`;
    const previous = latestJobByKey(key);
    if (previous && ["queued", "running"].includes(previous.status)) return Response.json({ job: previous });
    return Response.json({ job: enqueue({ projectId: id, stage: "cast", key, target: "识别角色", input: { projectId: id, modelId, force }, priority: 4 }) });
  });
}
