import { handle, fail } from "@/lib/api";
import { aixMeta, getAixDetail } from "@/lib/aix/catalog";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const detail = await getAixDetail((await params).id);
    return detail ? Response.json({ source: "aix", detail, libraryVersion: (await aixMeta()).libraryVersion }) : fail("Aix 风格不存在", 404);
  });
}
