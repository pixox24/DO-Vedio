import { handle } from "@/lib/api";
import { blockDoubtful } from "@/lib/server/memes";

/** 把所有待核实的梗删除并不再收录 */
export async function POST() {
  return handle(async () => Response.json({ blocked: blockDoubtful() }));
}
