import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { projectDocSchema } from "@/lib/core/types";
import { deleteProject, getProject, RevisionConflict, saveProject } from "@/lib/server/projects";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  return handle(async () => {
    const p = getProject((await ctx.params).id);
    return p ? Response.json(p) : fail("项目不存在", 404);
  });
}

const body = z.object({ doc: projectDocSchema, revision: z.number().int().nullable() });
const patchBody = z.object({ revision: z.number().int().nullable(), patch: z.record(z.string(), z.unknown()) });

function mergePatch<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || !base || typeof base !== "object" || Array.isArray(base)) return patch as T;
  const out = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) out[key] = key in out ? mergePatch(out[key], value) : value;
  return out as T;
}

/** 保存文档；revision 与服务端不一致时返回 409 和最新文档，revision 传 null 表示强制覆盖 */
export async function PUT(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { doc, revision } = await parseBody(req, body);
    try {
      const p = saveProject(id, doc, revision);
      return p ? Response.json({ revision: p.revision, updatedAt: p.updatedAt }) : fail("项目不存在", 404);
    } catch (e) {
      if (e instanceof RevisionConflict) return Response.json({ error: e.message, current: e.current }, { status: 409 });
      throw e;
    }
  });
}

/** 按文档约定的局部更新接口；revision 不一致时返回最新文档。 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { revision, patch } = await parseBody(req, patchBody);
    const current = getProject(id);
    if (!current) return fail("项目不存在", 404);
    try {
      const p = saveProject(id, mergePatch(current.doc, patch), revision);
      return p ? Response.json({ revision: p.revision, updatedAt: p.updatedAt, doc: p.doc }) : fail("项目不存在", 404);
    } catch (e) {
      if (e instanceof RevisionConflict) return Response.json({ error: e.message, current: e.current }, { status: 409 });
      throw e;
    }
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  return handle(async () => (deleteProject((await ctx.params).id) ? Response.json({ ok: true }) : fail("项目不存在", 404)));
}
