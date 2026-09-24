import { listModels } from "@/lib/llm";

export async function GET() {
  return Response.json(listModels());
}
