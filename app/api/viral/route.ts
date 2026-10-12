import { viralCreateSchema } from "@/lib/viral/schemas";
import { viralBody, viralHandle, viralSuccess } from "@/lib/server/viral/errors";
import { createDraft, listDrafts, sourceByProject } from "@/lib/server/viral/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return viralHandle(() => {
    const search = new URL(request.url).searchParams;
    const projectId = search.get("projectId");
    if (projectId) return viralSuccess(sourceByProject(projectId) ?? null);
    return viralSuccess(listDrafts());
  });
}

export async function POST(request: Request) {
  return viralHandle(async () => {
    const body = await viralBody(request, viralCreateSchema);
    return viralSuccess(createDraft(body.input, body.mode), 201);
  });
}
