import { handle } from "@/lib/api";
import { listAixStyles, aixMeta } from "@/lib/aix/catalog";

export async function GET(req: Request) {
  return handle(async () => {
    const params = new URL(req.url).searchParams;
    const [items, meta] = await Promise.all([listAixStyles({ q: params.get("q") ?? undefined, category: params.get("category") ?? undefined }), aixMeta()]);
    return Response.json({ source: "aix", meta, items }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
  });
}
