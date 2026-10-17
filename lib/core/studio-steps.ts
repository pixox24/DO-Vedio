import type { Timeline } from "./timeline";
import type { ProjectDoc } from "./types";
import { outputSpecsFor } from "./output-spec";
import { snapshotFor } from "./stock";
import { isAiVideo, isStock, isVideoForm, sourceImageConfirmed, videoAssetStale } from "./video";
import { subtitleTranslateUnits } from "./subtitle/translate-plan";
import { storyboardImageHint, voiceDirectionHint, type StepHint } from "./step-status";

/**
 * 制作页步骤条的「形状」：有哪些步骤、每步给什么提示。
 *
 * 这两件事是**纯函数**，从 `components/video-studio.tsx` 提出来单独放：
 * 步骤条的形状只取决于画面管线，与渲染无关；放在组件里既测不到，也容易被
 * 顺手塞进 DOM 状态。三条管线的差别全部收在这里：
 *
 * - `image`：没有媒体步骤，画面由分镜面板逐镜生图。
 * - `video`：`shot-reference`（参考图）+ `shot-generate`（视频）。
 * - `stock`：只有 `shot-stock`（检索素材）。它没有参考图、没有标准图、没有确认点。
 *
 * 之前这里收的是 `video: boolean`，stock 会被塞进 AI 视频那两步，
 * 进度条上永远有两个不会动的格子。
 */

export type StudioStep = { stage: string; stages?: string[]; label: string; indeterminate?: boolean };

const steps: StudioStep[] = [
  { stage: "annotate", label: "断句标注" },
  { stage: "voice-direction", label: "配音口吻", indeterminate: true },
  { stage: "tts", stages: ["tts", "tts-block"], label: "配音" },
  { stage: "cast", label: "识别角色和场景", indeterminate: true },
  { stage: "storyboard", label: "分镜", indeterminate: true },
  { stage: "render", label: "渲染" },
];

/** 媒体步骤插在「分镜」与「渲染」之间，双语翻译也在这个位置。 */
export function produceSteps(bilingual: boolean, pipeline: ProjectDoc["settings"]["visualPipeline"]): StudioStep[] {
  const renderAt = steps.findIndex((step) => step.stage === "render");
  const media = isStock(pipeline)
    ? [{ stage: "shot-stock", label: "检索素材" }]
    : isVideoForm(pipeline)
      ? [{ stage: "shot-reference", label: "参考图" }, { stage: "shot-generate", label: "视频" }]
      : [];
  return [...steps.slice(0, renderAt), ...media, ...(bilingual ? [{ stage: "subtitle-translate", label: "翻译" }] : []), ...steps.slice(renderAt)];
}

export function stepHints(doc: ProjectDoc, jobs: { stage: string; status: string }[], storyboardPending: boolean, timeline: Timeline | null): Record<string, StepHint> {
  const hints: Record<string, StepHint> = {};
  const voice = voiceDirectionHint(doc.settings.voice, jobs.some((job) => job.stage === "voice-direction" && job.status === "succeeded"));
  if (voice) hints["voice-direction"] = voice;
  const frame = outputSpecsFor(doc.settings)[0];
  const videoShots = doc.shots.filter((shot) => shot.kind === "video" && !!shot.videoPlan);
  if (isStock(doc.settings.visualPipeline)) {
    // 素材管线只有一步：缺检索词 → 缺素材 → 齐。
    if (storyboardPending) hints["shot-stock"] = { tone: "hold", message: "等待视频分镜" };
    else if (doc.shots.length) {
      const pending = videoShots.filter((shot) => !shot.locked && !shot.stockQuery);
      if (pending.length) hints["shot-stock"] = { tone: "hold", message: `待补检索词 · ${pending.length} 镜` };
      else {
        // 指纹口径与门禁一致：变体上的 promptHash 对不上快照就当作缺素材。
        const missing = videoShots.filter((shot) => !shot.locked && (() => {
          const variant = shot.assetVariants[frame.aspect];
          return !(variant?.assetId ?? shot.assetId) || !timeline || variant?.promptHash !== snapshotFor(doc, shot, timeline, frame).hash;
        })());
        hints["shot-stock"] = missing.length ? { tone: "hold", message: `待检索素材 · ${missing.length} 镜` } : { tone: "done" };
      }
    }
  } else if (isVideoForm(doc.settings.visualPipeline) && storyboardPending) {
    hints["shot-reference"] = { tone: "hold", message: "等待视频分镜" };
    hints["shot-generate"] = { tone: "hold", message: "等待视频分镜" };
  } else if (isAiVideo(doc.settings.visualPipeline) && doc.shots.length) {
    const pending = videoShots.filter((shot) => !shot.locked && !sourceImageConfirmed(doc, shot, frame));
    if (pending.length && !doc.settings.video.autoContinue) hints["shot-reference"] = { tone: "hold", message: `待生成或确认参考图 · ${pending.length} 镜` };
    else if (!pending.length) hints["shot-reference"] = { tone: "done" };
    const missing = videoShots.filter((shot) => !shot.locked && (!shot.assetId || !timeline || videoAssetStale(doc, shot, timeline, frame)));
    hints["shot-generate"] = missing.length ? { tone: "hold", message: `待生成视频 · ${missing.length} 镜` } : { tone: "done" };
  }
  if (!storyboardPending && !isVideoForm(doc.settings.visualPipeline)) {
    const generating = jobs.some((job) => job.stage === "shot-generate" && (job.status === "queued" || job.status === "running"));
    const image = storyboardImageHint(doc, generating);
    if (image) hints.storyboard = image;
  }
  if (doc.settings.subtitle.bilingual && subtitleTranslateUnits(doc.lines).length === 0) hints["subtitle-translate"] = { tone: "done", message: "已齐" };
  return hints;
}
