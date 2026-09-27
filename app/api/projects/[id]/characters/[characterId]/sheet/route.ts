import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { resolveImageModel } from "@/lib/pipeline/image-models";
import { characterSheetKey, sheetKinds } from "@/lib/pipeline/stages/character-sheet";
import { enqueue } from "@/lib/server/jobs";
import { get } from "@/lib/server/db";
import { ensureProjectVisualStyle } from "@/lib/visual-styles/store";

const body = z.object({ kind: z.enum(sheetKinds), lookId: z.string().optional(), modelId: z.string().optional(), count: z.number().int().min(1).max(4).optional() });

/** 定妆：立绘候选 / 三视图 / 表情组 / 造型。会产生生图费用 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/characters/[characterId]/sheet">) {
  return handle(async () => {
    const { id, characterId } = await ctx.params;
    // 定妆要套用画面风格：没选时先写入推荐风格
    const project = await ensureProjectVisualStyle(id);
    if (!project) return fail("项目不存在", 404);
    const card = project.doc.characters.find((c) => c.id === characterId);
    if (!card) return fail("角色不存在", 404);
    if (card.locked) return fail("角色已锁定，请先解锁", 409);
    if (card.presentation !== "full") return fail("这个角色不露正脸，不需要定妆", 409);
    const input = await parseBody(req, body);
    if (input.kind !== "portrait" && !card.sheet.portraitAssetId) return fail("请先生成并选定立绘", 409);
    if (input.kind === "look" && !card.looks.some((l) => l.id === input.lookId)) return fail("造型不存在", 404);
    const modelId = resolveImageModel(input.modelId);
    if (!modelId) return fail("没有可用的图片模型，请在模型中心配置并启用", 409);
    // 同一个角色同时只跑一个定妆任务，避免连点重复计费
    const busy = get<{ id: string }>("SELECT id FROM jobs WHERE project_id = ? AND stage = 'character-sheet' AND status IN ('queued', 'running') AND json_extract(input, '$.characterId') = ? LIMIT 1", id, characterId);
    if (busy) return fail("这个角色正在定妆，请等当前任务完成", 409);
    const key = characterSheetKey(project.doc, card, input.kind, modelId, input.lookId, input.count);
    const job = enqueue({ projectId: id, stage: "character-sheet", key: `${key}:${Date.now()}`, target: `定妆 ${card.name}`, input: { projectId: id, characterId, kind: input.kind, lookId: input.lookId, modelId, count: input.count }, priority: 6 });
    return Response.json({ job });
  });
}
