import { describe, expect, it, vi } from "vitest";
import { ViralDraftClient } from "@/components/viral/draft-client";
import { refreshViralSyncPreview } from "@/components/viral/sync-client";
import { createEmptyDraft, defaultViralInput } from "@/lib/viral/state";
import type { ViralSyncImpact } from "@/lib/viral/types";

describe("同步冲突恢复", () => {
  it("先读取草稿最新版，再重新GET制作影响，不重新提交旧确认或覆盖制作", async () => {
    const draft = createEmptyDraft(defaultViralInput(), "quick", "d1");
    const order: string[] = [];
    const client = new ViralDraftClient({ request: vi.fn(async (url: string) => { order.push(url); return { ...draft, revision: 9 }; }) }, draft);
    const impact: ViralSyncImpact = { projectId: "p1", projectScript: "制作后来人工修改的新正文", productionEdited: true, hasSentences: true, hasVoices: true, hasShots: true, hasRenders: true };
    const previewRequest = vi.fn(async (url: string) => { order.push(url); return impact; });
    expect(await refreshViralSyncPreview(client, "p1", previewRequest)).toEqual(impact);
    expect(order).toEqual(["/api/viral/d1", "/api/viral/d1/sync?projectId=p1"]);
    expect(client.getState().draft.revision).toBe(9);
    expect(previewRequest).toHaveBeenCalledExactlyOnceWith("/api/viral/d1/sync?projectId=p1");
  });
});
