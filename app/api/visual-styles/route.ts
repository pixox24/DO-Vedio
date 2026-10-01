import { handle, parseBody } from "@/lib/api";
import { visualStyleInputSchema } from "@/lib/core/types";
import { createVisualStyle, listVisualStyles } from "@/lib/visual-styles/store";

/** 用户自定义风格；系统 Aix 风格由 /api/style-library 提供。 */
export async function GET() {
  return handle(async () => {
    return Response.json(await listVisualStyles());
  });
}

export async function POST(req: Request) {
  return handle(async () => Response.json(await createVisualStyle(await parseBody(req, visualStyleInputSchema))));
}
