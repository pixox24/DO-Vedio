import { randomUUID } from "crypto";
import { fingerprint, snapshotDraft } from "../../viral/invalidation";
import { viralPatchSchema } from "../../viral/schemas";
import { applyDraftPatch } from "../../viral/state";
import type { ViralDraft, ViralPatch } from "../../viral/types";
import { ViralError } from "./errors";
import { mutateDraftTransaction } from "./repository";

export function updateDraft(id: string, request: ViralPatch): ViralDraft {
  const patch = viralPatchSchema.parse(request);
  const changes = Object.keys(patch).filter((key) => key !== "expectedRevision");
  const modeOnly = changes.length === 1 && changes[0] === "mode";
  return mutateDraftTransaction(id, patch.expectedRevision, (draft) => {
    const before = snapshotDraft(draft);
    const materialIds = new Set((patch.input ?? draft.input).materials.map((item) => item.id));
    const validateMaterials = (ids: string[]) => {
      if (ids.some((materialId) => !materialIds.has(materialId))) throw new ViralError("validation", "素材关联不存在，请重新选择本期素材", 400);
    };
    // Stale artifacts remain readable after materials are removed. Validate only artifacts explicitly edited now.
    for (const angle of patch.angles ?? []) validateMaterials([...angle.materialIds, ...angle.route.flatMap((step) => step.materialIds)]);
    if (patch.outline) validateMaterials(patch.outline.sections.flatMap((section) => section.materialIds));
    if (patch.issueResolutions) {
      if (!draft.review || draft.review.versionId !== draft.currentVersionId) throw new ViralError("needs_review", "请先检查当前稿件，再记录问题处理", 409);
      for (const resolution of patch.issueResolutions) {
        if (!draft.review.issues.some((issue) => issue.id === resolution.issueId)) throw new ViralError("validation", "问题不属于当前检查版本", 400);
        validateMaterials(resolution.materialIds);
      }
    }
    let next: ViralDraft;
    try {
      next = applyDraftPatch(draft, patch, { now: new Date().toISOString(), versionId: randomUUID(), historyId: randomUUID() });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "VERSION_NOT_FOUND" || code === "ANGLE_NOT_FOUND") throw new ViralError("not_found", code === "ANGLE_NOT_FOUND" ? "所选角度不存在" : "稿件版本不存在", 404);
      if (code === "CANDIDATE_CONFLICT") throw new ViralError("conflict", "正文已有更新，请重新生成候选", 409, { currentRevision: draft.revision });
      if (code === "MECHANISM_NOT_FOUND") throw new ViralError("validation", "只能选择当前拆解中的通用机制", 400);
      throw error;
    }
    if (!patch.restoreVersionId && fingerprint(before) !== fingerprint(snapshotDraft(next))) next.inputHistory.push({ id: randomUUID(), snapshot: before, savedAt: next.updatedAt });
    // The pure reducer and SQL repository share the same next revision, never increment it twice.
    Object.assign(draft, next, { revision: patch.expectedRevision });
  }, modeOnly);
}
