import { workerOnline } from "@/lib/server/jobs";

export async function GET() {
  return Response.json({ online: workerOnline() });
}
