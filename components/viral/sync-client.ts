import type { ViralSyncImpact } from "@/lib/viral/types";
import { viralRequest, type ViralDraftClient } from "./draft-client";

/** A recovery reads production again. It never reuses the rejected preview or submits a replacement. */
export async function refreshViralSyncPreview(client: ViralDraftClient, projectId: string, request: (url: string) => Promise<ViralSyncImpact> = viralRequest): Promise<ViralSyncImpact | null> {
  await client.reload();
  const saved = await client.flush();
  if (!saved?.id) return null;
  return request(`/api/viral/${encodeURIComponent(saved.id)}/sync?projectId=${encodeURIComponent(projectId)}`);
}
