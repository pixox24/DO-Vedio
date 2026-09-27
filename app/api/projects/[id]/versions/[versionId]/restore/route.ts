import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { RevisionConflict } from "@/lib/server/projects";
import { restoreVersion } from "@/lib/server/versions";

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/versions/[versionId]/restore">) {
  return handle(async () => {
    const { id, versionId } = await ctx.params;
    const { revision } = await parseBody(req, z.object({ revision: z.number().int() }));
    try {
      const project = restoreVersion(id, versionId, revision);
      return project ? Response.json(project) : fail(project === null ? "版本不存在" : "项目不存在", 404);
    } catch (e) {
      if (e instanceof RevisionConflict) return Response.json({ error: e.message, current: e.current }, { status: 409 });
      throw e;
    }
  });
}
