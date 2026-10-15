import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { projectDocSchema, type Project, type ProjectDoc } from "@/lib/core/types";
import { missingVideoStandards } from "@/lib/core/video";
import { deleteProject, getProject, RevisionConflict, saveProject } from "@/lib/server/projects";
import { purgeProjects } from "@/lib/server/gc";
import { enqueueAutoScenes } from "@/lib/pipeline/auto-portrait";
import { enqueueVideoPlanSyncs } from "@/lib/pipeline/video-plan-sync";
import { wakeCurrentGoal } from "@/lib/pipeline/plan";

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

function afterSave(id: string, previous: ProjectDoc | undefined, project: Project): Project {
  enqueueAutoScenes(id, true);
  enqueueVideoPlanSyncs(id);
  // 手动采用或上传标准图也能释放已有目标；没有目标时不会额外开工。
  if (previous && project.doc.shots.some((shot) => {
    const before = previous.shots.find((item) => item.id === shot.id);
    return before && missingVideoStandards(previous, before).length && !missingVideoStandards(project.doc, shot).length;
  })) {
    wakeCurrentGoal(id);
    return getProject(id) ?? project;
  }
  return project;
}

/** 保存文档；revision 与服务端不一致时返回 409 和最新文档，revision 传 null 表示强制覆盖 */
export async function PUT(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { doc, revision } = await parseBody(req, body);
    try {
      const previous = getProject(id);
      let p = saveProject(id, doc, revision);
      if (p) p = afterSave(id, previous?.doc, p);
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
      let p = saveProject(id, mergePatch(current.doc, patch), revision);
      if (p) p = afterSave(id, current.doc, p);
      return p ? Response.json({ revision: p.revision, updatedAt: p.updatedAt, doc: p.doc }) : fail("项目不存在", 404);
    } catch (e) {
      if (e instanceof RevisionConflict) return Response.json({ error: e.message, current: e.current }, { status: 409 });
      throw e;
    }
  });
}

/** 默认进回收站；?purge=1 表示从回收站彻底删除（素材文件由存储回收统一处理） */
export async function DELETE(req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (new URL(req.url).searchParams.get("purge") === "1") {
      const result = purgeProjects([id]);
      return result.projects > 0 ? Response.json({ ok: true, ...result }) : fail("回收站中没有该项目", 404);
    }
    return deleteProject(id) ? Response.json({ ok: true }) : fail("项目不存在", 404);
  });
}
