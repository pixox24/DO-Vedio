import { fail, handle } from "@/lib/api";
import { aspects, outputSpecIds, type Aspect, type OutputSpecId } from "@/lib/core/types";
import { outputSpecForRequest, outputSpecsFor } from "@/lib/core/output-spec";
import { animationHash, contentHash, timelineHash } from "@/lib/core/timeline";
import { syncLines } from "@/lib/pipeline/plan";
import { timelineFor } from "@/lib/pipeline/artifacts";
import { getProject } from "@/lib/server/projects";

/** 派生时间轴：预览播放器直接用它作 inputProps */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/timeline">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const p = getProject(id);
    if (!p) return fail("项目不存在", 404);
    const params = new URL(req.url).searchParams;
    const requestedSpec = params.get("outputSpecId") as OutputSpecId;
    const requestedAspect = params.get("aspect") as Aspect;
    const doc = syncLines(p.doc);
    const spec = outputSpecIds.includes(requestedSpec) ? outputSpecForRequest(doc.settings, requestedSpec) : outputSpecForRequest(doc.settings, undefined, aspects.includes(requestedAspect) ? requestedAspect : undefined);
    const specs = outputSpecsFor(doc.settings);
    const targets = specs.some((item) => item.id === spec.id) ? specs : [...specs, spec];
    const hashes: Partial<Record<Aspect, { contentHash: string; animationHash: string; timelineHash: string }>> = {};
    let timeline = null as ReturnType<typeof timelineFor> | null;
    for (const item of targets) {
      const built = timelineFor(doc, id, item.id);
      hashes[item.aspect] = { contentHash: contentHash(built), animationHash: animationHash(built), timelineHash: timelineHash(built) };
      if (item.id === spec.id) timeline = built;
    }
    const t = timeline ?? timelineFor(doc, id, spec.id);
    return Response.json({ timeline: t, hash: contentHash(t), contentHash: contentHash(t), animationHash: animationHash(t), timelineHash: timelineHash(t), hashes, revision: p.revision });
  });
}
