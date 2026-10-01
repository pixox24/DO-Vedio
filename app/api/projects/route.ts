import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { applyPresetToDoc, presetGroupIds } from "@/lib/core/preset";
import { emptyDoc, projectDocSchema, type ProjectDoc } from "@/lib/core/types";
import { getDefaultPreset, getPreset } from "@/lib/server/presets";
import { createProject, duplicateProject, listProjects } from "@/lib/server/projects";

export async function GET() {
  return handle(async () => Response.json(listProjects()));
}

const body = z.object({
  doc: projectDocSchema.optional(),
  duplicateOf: z.string().optional(),
  presetId: z.string().nullable().optional(),
});

/**
 * 新建项目；可以带初始文档（导入浏览器草稿用），或复制已有项目。
 * presetId 不传用默认预设、传 null 明确跳过、传字符串用指定预设（不存在返回 404）。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { doc, duplicateOf, presetId } = await parseBody(req, body);
    if (duplicateOf) {
      const p = duplicateProject(duplicateOf);
      return p ? Response.json(p) : Response.json({ error: "项目不存在" }, { status: 404 });
    }
    let next: ProjectDoc = doc ?? emptyDoc();
    if (presetId !== null) {
      const preset = presetId === undefined ? getDefaultPreset() : getPreset(presetId);
      if (presetId !== undefined && !preset) return fail("预设不存在", 404);
      if (preset) next = applyPresetToDoc(next, preset.payload, { groups: [...presetGroupIds], includeBudget: true }).doc;
    }
    return Response.json(createProject(next));
  });
}
