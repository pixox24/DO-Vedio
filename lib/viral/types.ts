import type { SpeechRate, StyleTemplate } from "../types";

export const VIRAL_CONTRACT_VERSION = 1 as const;
export const VIRAL_LIMITS = { reference: 20_000, topic: 200, materials: 10_000, minSeconds: 30, maxSeconds: 1_800 } as const;
export const VIRAL_PLATFORMS = ["douyin", "xiaohongshu", "bilibili", "xigua"] as const;
export type ViralPlatform = (typeof VIRAL_PLATFORMS)[number];
export const VIRAL_PLATFORM_LABELS: Record<ViralPlatform, string> = { douyin: "抖音", xiaohongshu: "小红书", bilibili: "B站", xigua: "西瓜" };
export type ViralMode = "quick" | "workbench";
export type ViralContentKind = "auto" | "fact" | "opinion" | "story";
export type ViralAspectRatio = "9:16" | "16:9";
export type ViralStage = "analysis" | "angles" | "outline" | "generation" | "review";
export const VIRAL_STAGES: readonly ViralStage[] = ["analysis", "angles", "outline", "generation", "review"];
export type ViralTaskCommand = "quick" | "analyze" | "angles" | "outline" | "generate" | "rewrite" | "calibrate" | "review";
export type ViralCommand = ViralTaskCommand | "stop" | "resume";
export type ViralTaskStatus = "queued" | "running" | "stopping" | "completed" | "needs_changes" | "failed" | "stopped";

export type ViralMaterial = {
  id: string;
  text: string;
  kind: "point" | "fact" | "experience" | "data" | "testimonial";
  source: string;
  verification: "user_provided" | "pending" | "verified";
};

/** Template copied at selection time. Later global template edits never mutate this object. */
export type ViralStyleSnapshot = {
  templateId: string;
  templateName: string;
  capturedAt: string;
  tone: string;
  dos: string[];
  donts: string[];
  rules: string[];
  /** Style-only example. It is never a source of factual evidence. */
  sample: string;
  speechRate: SpeechRate;
};

export type ViralInput = {
  referenceText: string;
  referenceTitle: string;
  referenceSource: string;
  topic: string;
  platform: ViralPlatform | null;
  targetSeconds: number;
  durationIsManual: boolean;
  materials: ViralMaterial[];
  audience: string;
  coreClaim: string;
  contentKind: ViralContentKind;
  style: ViralStyleSnapshot;
  perspective: "first" | "third";
  rate: "auto" | SpeechRate;
  mustInclude: string[];
  avoid: string[];
  ending: "natural" | "discussion" | "save" | "business";
  modelId: string;
  /** Only explicitly chosen, verified entries may be used. No automatic meme picking. */
  memes: { id: string; name: string; text: string; verified: boolean }[];
  humanize: boolean;
  handoff: { aspectRatio: ViralAspectRatio; aspectRatioIsManual: boolean; settingsVersion: number };
};

export const VIRAL_MECHANISM_ARCHETYPES = ["curiosity_gap", "contrast", "audience_callout", "problem_solution", "progressive_explanation", "emotional_transition", "recap", "question_cta"] as const;
export type ViralMechanismArchetype = (typeof VIRAL_MECHANISM_ARCHETYPES)[number];
export type ViralMechanism = { id: string; type: "hook" | "progression" | "pacing" | "ending"; archetype: ViralMechanismArchetype; description: string; enabled: boolean };
export type ViralObservation = {
  id: string;
  function: "hook" | "progression" | "pacing" | "ending";
  quote: string;
  start: number;
  end: number;
  observation: string;
  hypothesis: string;
};
export type ViralDistinctiveElement = { id: string; kind: "metaphor" | "case" | "phrase" | "data" | "argument"; text: string; reason: string };
export type ViralAnalysis = {
  id: string;
  summary: string;
  observations: ViralObservation[];
  mechanisms: ViralMechanism[];
  /** Compare-side only; never sent to angle, outline, writing or revision models. */
  distinctiveElements: ViralDistinctiveElement[];
  referenceFingerprint: string;
  createdAt: string;
};

export type ViralEvidenceStep = { id: string; claim: string; materialIds: string[] };
export type ViralAngle = {
  id: string;
  title: string;
  coreQuestion: string;
  coreClaim: string;
  hook: string;
  route: ViralEvidenceStep[];
  materialIds: string[];
  missingEvidence: string[];
  recommendedReason: string;
};

/** Exact input content, selected angle and outline. Equality uses content, not a mutable input revision. */
export type ViralInputSnapshot = {
  input: ViralInput;
  mechanisms: ViralMechanism[];
  selectedAngle: ViralAngle | null;
  outline: ViralOutline | null;
};
export type ViralOutline = {
  id: string;
  sections: { id: string; title: string; function: string; points: string[]; seconds: number; materialIds: string[] }[];
  /** Source angle/input signature, without an outline recursion. */
  sourceFingerprint: string;
  createdAt: string;
};
export type ViralSegment = { id: string; title: string; text: string; materialIds: string[] };
export type ViralScriptVersion = {
  id: string;
  revision: number;
  title: string;
  segments: ViralSegment[];
  completedSegmentIds: string[];
  complete: boolean;
  /** Once manually edited, all descendants retain this protection until a fresh full generation. */
  manuallyEdited: boolean;
  basedOn: ViralInputSnapshot;
  createdAt: string;
  parentVersionId: string | null;
  origin: "generated" | "manual" | "rewrite" | "calibrated" | "auto_repair";
};

export type ViralIssueResolution = { issueId: string; action: "evidence" | "revised" | "citation"; note: string; materialIds: string[] };
export type ViralReviewIssue = {
  id: string;
  severity: "blocker" | "judgment" | "suggestion";
  category: "fact" | "originality" | "style" | "constraint" | "duration" | "complete";
  segmentId: string | null;
  excerpt: string;
  reason: string;
  suggestion: string;
  materialIds: string[];
  resolved: boolean;
};
export type ViralReviewRules = { avoid: string[]; mustInclude: string[]; contentKind: ViralContentKind; perspective: ViralInput["perspective"]; materials: ViralMaterial[]; style: ViralStyleSnapshot; targetSeconds: number; rate: ViralInput["rate"] };
export type ViralReview = {
  id: string;
  versionId: string;
  /** Exact canonical title/segments string; avoids probabilistic hash collisions for acceptance. */
  scriptFingerprint: string;
  rules: ViralReviewRules;
  referenceFingerprint: string;
  issues: ViralReviewIssue[];
  resolutions: ViralIssueResolution[];
  checkedAt: string;
  autoRepairCount: number;
};

export type ViralTaskSnapshot = ViralInputSnapshot & {
  command: ViralTaskCommand;
  modelId: string;
  versionId: string | null;
  scriptFingerprint: string | null;
  rewrite: { segmentId: string; instruction: string } | null;
};
export type ViralTask = {
  id: string;
  generation: number;
  status: ViralTaskStatus;
  command: ViralTaskCommand;
  plan: ViralStage[];
  stage: ViralStage | null;
  completedStages: ViralStage[];
  snapshot: ViralTaskSnapshot;
  workingVersionId: string | null;
  cancelRequested: boolean;
  error: { code: string; message: string; stage: ViralStage | null } | null;
  createdAt: string;
  updatedAt: string;
};

export type ViralHandoffSettings = { version: number; aspectRatio: ViralAspectRatio; platform: ViralPlatform; targetSeconds: number; rate: SpeechRate; perspective: ViralInput["perspective"]; style: ViralStyleSnapshot };
export type ViralAdoption = {
  id: string;
  projectId: string;
  versionId: string;
  settings: ViralHandoffSettings;
  /** Exact adopted body baseline for detecting later edits in production. */
  adoptedScript: { title: string; segments: ViralSegment[] };
  createdAt: string;
};
export type ViralDraft = {
  id: string;
  revision: number;
  mode: ViralMode;
  input: ViralInput;
  analysis: ViralAnalysis | null;
  angles: ViralAngle[];
  anglesSourceFingerprint: string | null;
  selectedAngleId: string | null;
  outline: ViralOutline | null;
  versions: ViralScriptVersion[];
  currentVersionId: string | null;
  candidateVersionId: string | null;
  review: ViralReview | null;
  task: ViralTask | null;
  adoptions: ViralAdoption[];
  inputHistory: { id: string; snapshot: ViralInputSnapshot; savedAt: string }[];
  issueResolutions: ViralIssueResolution[];
  createdAt: string;
  updatedAt: string;
};

/** Only this reduced DTO is allowed on the generation side. No reference or observation fields. */
export type ViralGenerationContext = {
  mechanisms: { type: ViralMechanism["type"]; archetype: ViralMechanismArchetype; description: string }[];
  task: Pick<ViralInput, "topic" | "platform" | "targetSeconds" | "audience" | "coreClaim" | "contentKind" | "perspective" | "rate" | "mustInclude" | "avoid" | "ending" | "memes" | "humanize">;
  style: ViralStyleSnapshot;
  materials: ViralMaterial[];
  selectedAngle: ViralAngle | null;
  outline: ViralOutline | null;
};
export type ViralStageArtifacts = { analysis: ViralAnalysis | null; angles: ViralAngle[]; anglesSourceFingerprint?: string | null; selectedAngleId: string | null; outline: ViralOutline | null; version: ViralScriptVersion | null; review: ViralReview | null };
export type ViralStageResult = { stage: "analysis"; analysis: ViralAnalysis } | { stage: "angles"; angles: ViralAngle[]; selectedAngleId: string | null } | { stage: "outline"; outline: ViralOutline } | { stage: "generation"; version: ViralScriptVersion; candidateVersion?: ViralScriptVersion } | { stage: "review"; review: ViralReview; repairedVersion?: ViralScriptVersion; candidateVersion?: ViralScriptVersion };

export type ViralPatch = {
  expectedRevision: number;
  input?: ViralInput;
  mode?: ViralMode;
  angles?: ViralAngle[];
  enabledMechanismIds?: string[];
  selectedAngleId?: string | null;
  outline?: ViralOutline | null;
  manualScript?: { title: string; segments: ViralSegment[] };
  currentVersionId?: string;
  adoptCandidateVersionId?: string;
  restoreVersionId?: string;
  issueResolutions?: ViralIssueResolution[];
};
export type ViralCommandRequest = { expectedRevision: number; command: ViralCommand; expectedTaskId?: string; rewrite?: { segmentId: string; instruction: string } };
export type ViralApiErrorCode = "validation" | "not_found" | "conflict" | "locked" | "model_unavailable" | "stale" | "needs_review" | "needs_changes" | "save_failed" | "generation_failed" | "handoff_conflict";
export type ViralApiError = { code: ViralApiErrorCode; message: string; fields?: Record<string, string>; currentRevision?: number };
export type ViralApiResponse<T> = { ok: true; data: T } | { ok: false; error: ViralApiError };
export type ViralAdoptRequest = { expectedRevision: number; versionId: string; settingsVersion: number };
export type ViralSyncRequest = ViralAdoptRequest & { projectId: string; strategy: "replace" | "new_project"; expectedProjectScript: string };
export type ViralSyncImpact = { projectId: string; productionEdited: boolean; hasSentences: boolean; hasVoices: boolean; hasShots: boolean; hasRenders: boolean; projectScript: string };

export type ViralTemplateSource = Pick<StyleTemplate, "id" | "name" | "tone" | "dos" | "donts" | "sample" | "speechRate">;
