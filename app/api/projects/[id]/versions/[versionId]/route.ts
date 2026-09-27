import { fail, handle } from "@/lib/api";
import { getVersion } from "@/lib/server/versions";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/versions/[versionId]">) {
  return handle(async () => {
    const { id, versionId } = await ctx.params;
    const version = getVersion(id, versionId);
    return version ? Response.json(version) : fail("版本不存在", 404);
  });
}
