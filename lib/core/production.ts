import type { Job, ProjectDoc, Settings } from "./types";

/**
 * Settings that can change the cost or the bytes submitted by a production run.
 * Keep this deliberately explicit: adding a production-affecting setting should
 * require deciding whether an existing confirmation remains valid.
 */
export function setupFingerprint(settings: Settings): string {
  return JSON.stringify({
    version: 1,
    voice: {
      provider: settings.voice.provider,
      model: settings.voice.model,
      voiceId: settings.voice.voiceId,
      rate: settings.voice.rate,
      pitch: settings.voice.pitch,
      volume: settings.voice.volume,
      granularity: settings.voice.granularity,
      instruction: settings.voice.instruction,
      google: settings.voice.google ? {
        stylePrompt: settings.voice.google.stylePrompt,
        locale: settings.voice.google.locale ?? null,
        outputEncoding: settings.voice.google.outputEncoding,
        sampleRateHertz: settings.voice.google.sampleRateHertz ?? null,
        alignment: settings.voice.google.alignment,
      } : null,
    },
    aspects: [...settings.aspects],
    outputSpecIds: [...(settings.outputSpecIds ?? [])],
    previewAspect: settings.previewAspect ?? null,
    assetFraming: settings.assetFraming,
    budgetYuan: settings.budgetYuan,
    pauseAfterPreview: settings.pauseAfterPreview,
    modelId: settings.modelId,
    subtitle: settings.subtitle,
    music: settings.music,
    sfx: settings.sfx,
    aiLabel: settings.aiLabel,
  });
}

export function setupConfirmationMatches(stored: string | null | undefined, settings: Settings): boolean {
  return !!stored && stored === setupFingerprint(settings);
}

export function jobBelongsToGoal(job: Pick<Job, "input">, goalId: string): boolean {
  return typeof job.input === "object" && job.input !== null && "goalId" in job.input && (job.input as { goalId?: unknown }).goalId === goalId;
}

export function setupFingerprintForDoc(doc: ProjectDoc): string {
  return setupFingerprint(doc.settings);
}
