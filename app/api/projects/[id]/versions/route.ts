import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { getProject, RevisionConflict } from "@/lib/server/projects";
import { createVersion, listVersions } from "@/lib/server/versions";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/versions">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return getProject(id) ? Response.json(listVersions(id)) : fail("项目不存在", 404);
  });
}

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/versions">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { revision, label } = await parseBody(req, z.object({ revision: z.number().int(), label: z.string().trim().min(1).max(80) }));
    try {
      const versionId = createVersion(id, revision, label);
      return versionId ? Response.json({ id: versionId }) : fail("项目不存在", 404);
    } catch (e) {
      if (e instanceof RevisionConflict) return Response.json({ error: e.message, current: e.current }, { status: 409 });
      throw e;
    }
  });
}
