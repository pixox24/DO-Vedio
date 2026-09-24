import { handle, parseBody } from "@/lib/api";
import { createTemplate, listTemplates } from "@/lib/templates/store";
import { templateInputSchema } from "@/lib/types";

export async function GET() {
  return handle(async () => Response.json(await listTemplates()));
}

export async function POST(req: Request) {
  return handle(async () => Response.json(await createTemplate(await parseBody(req, templateInputSchema))));
}
