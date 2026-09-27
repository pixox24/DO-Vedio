import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { createProject, duplicateProject, listProjects } from "@/lib/server/projects";

export async function GET() {
  return handle(async () => Response.json(listProjects()));
}

const body = z.object({ doc: z.unknown().optional(), duplicateOf: z.string().optional() });

/** 新建项目；可以带初始文档（导入浏览器草稿用），或复制已有项目 */
export async function POST(req: Request) {
  return handle(async () => {
    const { doc, duplicateOf } = await parseBody(req, body);
    if (duplicateOf) {
      const p = duplicateProject(duplicateOf);
      return p ? Response.json(p) : Response.json({ error: "项目不存在" }, { status: 404 });
    }
    return Response.json(createProject(doc as never));
  });
}
