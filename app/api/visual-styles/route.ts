import { handle, parseBody } from "@/lib/api";
import { visualStyleInputSchema } from "@/lib/core/types";
import { recommendVisualStyles } from "@/lib/visual-styles/builtin";
import { createVisualStyle, listVisualStyles } from "@/lib/visual-styles/store";

/** 视觉风格库；带 ?templateId= 时按解说风格推荐排序 */
export async function GET(req: Request) {
  return handle(async () => {
    const templateId = new URL(req.url).searchParams.get("templateId");
    const styles = await listVisualStyles();
    return Response.json(templateId ? recommendVisualStyles(templateId, styles) : styles);
  });
}

export async function POST(req: Request) {
  return handle(async () => Response.json(await createVisualStyle(await parseBody(req, visualStyleInputSchema))));
}
