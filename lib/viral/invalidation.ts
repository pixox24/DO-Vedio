import type { ViralDraft, ViralInput, ViralInputSnapshot, ViralScriptVersion, ViralStage } from "./types";
import { VIRAL_STAGES } from "./types";

/** Canonical exact serialization, shared by server and browser. This is an equality key, not a similarity score. */
export function fingerprint(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
  return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${fingerprint((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export function referenceFingerprint(text: string): string { return text; }
export function scriptFingerprint(version: Pick<ViralScriptVersion, "title" | "segments">): string {
  return fingerprint({ title: version.title, segments: version.segments });
}

function taskFields(input: ViralInput) {
  return { topic: input.topic, platform: input.platform, targetSeconds: input.targetSeconds, audience: input.audience, coreClaim: input.coreClaim, materials: input.materials, contentKind: input.contentKind, mustInclude: input.mustInclude, ending: input.ending };
}
function mechanismFields(snapshot: ViralInputSnapshot) {
  return snapshot.mechanisms.filter((item) => item.enabled).map(({ type, archetype }) => ({ type, archetype }));
}
export function anglesSourceFingerprint(snapshot: ViralInputSnapshot): string {
  return fingerprint({ reference: snapshot.input.referenceText, mechanisms: mechanismFields(snapshot), task: taskFields(snapshot.input) });
}
/** Only platform/duration adaptation preserves a selected route when a new angle batch is generated. */
export function angleContextCompatible(previousSourceFingerprint: string | null | undefined, next: ViralInputSnapshot): boolean {
  if (!previousSourceFingerprint) return false;
  try {
    const stripAdaptation = (source: string) => {
      const parsed: unknown = JSON.parse(source);
      if (!parsed || typeof parsed !== "object" || !("task" in parsed)) throw new Error("Invalid angle source");
      const value = parsed as { reference: unknown; mechanisms: unknown; task: Record<string, unknown> };
      const { platform: _platform, targetSeconds: _targetSeconds, ...task } = value.task;
      void _platform; void _targetSeconds;
      return fingerprint({ reference: value.reference, mechanisms: value.mechanisms, task });
    };
    return stripAdaptation(previousSourceFingerprint) === stripAdaptation(anglesSourceFingerprint(next));
  } catch { return false; }
}
export function outlineSourceFingerprint(snapshot: ViralInputSnapshot): string {
  return fingerprint({ angles: anglesSourceFingerprint(snapshot), selectedAngle: snapshot.selectedAngle, rate: snapshot.input.rate, styleRate: snapshot.input.rate === "auto" ? snapshot.input.style.speechRate : null });
}
export function generationSourceFingerprint(snapshot: ViralInputSnapshot): string {
  return fingerprint({ outline: outlineSourceFingerprint(snapshot), sections: snapshot.outline?.sections ?? null, style: snapshot.input.style, perspective: snapshot.input.perspective, humanize: snapshot.input.humanize, memes: snapshot.input.memes });
}

export type ViralInvalidation = { earliestStage: ViralStage | null; stages: ViralStage[]; reasons: string[]; handoffChanged: boolean; modelChanged: boolean };
/** Changes keep existing artifacts visible. The caller schedules work only after an explicit command. */
export function getInvalidation(previous: ViralInputSnapshot, next: ViralInputSnapshot): ViralInvalidation {
  const changes: { stage: ViralStage; reason: string }[] = [];
  const compare = (before: unknown, after: unknown, stage: ViralStage, reason: string) => { if (fingerprint(before) !== fingerprint(after)) changes.push({ stage, reason }); };
  compare(previous.input.referenceText, next.input.referenceText, "analysis", "参考稿");
  compare(mechanismFields(previous), mechanismFields(next), "angles", "可迁移机制");
  compare(taskFields(previous.input), taskFields(next.input), "angles", "创作任务、素材、平台或时长");
  compare(previous.selectedAngle, next.selectedAngle, "outline", "选定角度或论证路线");
  compare({ rate: previous.input.rate, styleRate: previous.input.rate === "auto" ? previous.input.style.speechRate : null }, { rate: next.input.rate, styleRate: next.input.rate === "auto" ? next.input.style.speechRate : null }, "outline", "语速");
  compare(previous.outline?.sections ?? null, next.outline?.sections ?? null, "generation", "大纲");
  compare({ style: previous.input.style, perspective: previous.input.perspective, humanize: previous.input.humanize, memes: previous.input.memes }, { style: next.input.style, perspective: next.input.perspective, humanize: next.input.humanize, memes: next.input.memes }, "generation", "语言风格、视角或文本处理");
  compare(previous.input.avoid, next.input.avoid, "review", "避免内容或禁用词");
  const earliest = changes.length ? Math.min(...changes.map((item) => VIRAL_STAGES.indexOf(item.stage))) : -1;
  return { earliestStage: earliest < 0 ? null : VIRAL_STAGES[earliest], stages: earliest < 0 ? [] : VIRAL_STAGES.slice(earliest), reasons: [...new Set(changes.map((item) => item.reason))], handoffChanged: previous.input.handoff.aspectRatio !== next.input.handoff.aspectRatio, modelChanged: previous.input.modelId !== next.input.modelId };
}
export function snapshotDraft(draft: ViralDraft): ViralInputSnapshot {
  return structuredClone({ input: draft.input, mechanisms: draft.analysis?.mechanisms ?? [], selectedAngle: draft.angles.find((item) => item.id === draft.selectedAngleId) ?? null, outline: draft.outline });
}
export function getDraftInvalidation(draft: ViralDraft, version?: ViralScriptVersion | null): ViralInvalidation {
  const current = version ?? draft.versions.find((item) => item.id === draft.currentVersionId);
  return current ? getInvalidation(current.basedOn, snapshotDraft(draft)) : { earliestStage: null, stages: [], reasons: [], handoffChanged: false, modelChanged: false };
}
export function isScriptStale(draft: ViralDraft, version?: ViralScriptVersion | null): boolean {
  const stage = getDraftInvalidation(draft, version).earliestStage;
  return stage !== null && stage !== "review";
}
