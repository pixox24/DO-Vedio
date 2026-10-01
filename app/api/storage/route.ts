import { handle } from "@/lib/api";
import { storageUsage } from "@/lib/server/gc";

export async function GET() {
  return handle(async () => Response.json(await storageUsage()));
}
