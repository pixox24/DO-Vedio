import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { listLexicon, upsertLexicon } from "@/lib/server/lexicon";

export async function GET(req: Request) {
  return handle(async () => Response.json(listLexicon(new URL(req.url).searchParams.get("projectId") ?? undefined)));
}

const clean = z.string().trim().min(1).max(80).refine((value) => !/[<>\x00-\x1f\x7f]/.test(value), "不能包含 HTML 或控制字符");
const body = z.object({ scope: z.string().min(1), word: clean, say: clean, note: z.string().default("") });

export async function POST(req: Request) {
  return handle(async () => {
    const b = await parseBody(req, body);
    upsertLexicon(b.scope, b.word, b.say, b.note);
    return Response.json({ ok: true });
  });
}
