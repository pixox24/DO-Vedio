import { handle } from "@/lib/api";
import { listProviderProfiles } from "@/lib/providers/registry";

export async function GET() {
  return handle(async () => Response.json({ providers: listProviderProfiles() }));
}
