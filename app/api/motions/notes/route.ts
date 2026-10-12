import { handle, parseBody } from "@/lib/api";
import { motionNoteInputSchema } from "@/lib/core/motion-notes";
import { createMotionNote, listMotionNotes } from "@/lib/server/motion-notes";

export async function GET() {
  return handle(async () => Response.json(listMotionNotes()));
}

export async function POST(req: Request) {
  return handle(async () => Response.json(createMotionNote(await parseBody(req, motionNoteInputSchema))));
}
