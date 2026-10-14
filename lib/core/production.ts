import type { Job, ProjectDoc, Settings } from "./types";

/**
 * Settings that can change the cost or the bytes submitted by a production run.
 * Keep this deliberately explicit: adding a production-affecting setting should
 * require deciding whether an existing confirmation remains valid.
 * previewAspect is omitted: it only chooses which output is on screen.
 */
export function setupFingerprint(settings: Settings): string {
  return JSON.stringify({
    version: 3, // 视频与参考图模型/自动连续都会改变制作费用。
    visualPipeline: settings.visualPipeline,
    video: settings.video,
    voice: {
      provider: settings.voice.provider,
      model: settings.voice.model,
      voiceId: settings.voice.voiceId,
      rate: settings.voice.rate,
      pitch: settings.voice.pitch,
      volume: settings.voice.volume,
      granularity: settings.voice.granularity,
      instruction: settings.voice.instructionSource === "generated" ? "" : settings.voice.instruction,
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
    assetFraming: settings.assetFraming,
    budgetYuan: settings.budgetYuan,
    pauseAfterPreview: settings.pauseAfterPreview,
    // 开启后会自动提交生图任务：改变费用与提交内容，切换它必须让上一次开工确认失效
    autoPortrait: settings.autoPortrait,
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
