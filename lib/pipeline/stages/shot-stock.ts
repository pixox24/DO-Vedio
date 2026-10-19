import { outputSpecsFor, type GenerationFrame } from "../../core/output-spec";
import { selectShotCandidate } from "../../core/shot-asset";
import { stockExclusions, stockFrame, stockOrientation, stockSnapshot } from "../../core/stock";
import type { Timeline } from "../../core/timeline";
import type { ProjectDoc, Shot } from "../../core/types";
import { isVideoForm, videoPlayback, videoShotTiming } from "../../core/video";
import { videoPlanNeedsSync } from "../../core/video-plan";
import { longRequest } from "../../providers/http";
import { beginGenerationRun, failGenerationRun, finishGenerationRun } from "../../providers/runs";
import { searchStock, stockConfigured, stockSource } from "../../providers/stock";
import { enqueue, latestJobByKey } from "../../server/jobs";
import { getAsset, putStream } from "../../server/media";
import { getProject, mutateProject } from "../../server/projects";
import { timelineFor } from "../artifacts";
import { cachedStockAsset, cachedStockFile, rememberStockAsset, rememberStockFile } from "../stock-cache";
import { videoAssetFraming } from "../video-generation";
import { defineStage, PermanentError, type StageContext } from "../stage";
import { mergeCandidateHistory } from "./shot-generate";

/**
 * 素材管线的检索步骤：把「这一镜要什么画面」变成一条已经入库、时长够用的真实视频。
 *
 * 下游完全不知道字节从哪来：写回的候选与变体和 AI 视频管线一模一样，
 * 所以 `videoRenderProblems`、`selectShotCandidate`、恢复机制都不用改。
 *
 * 三处最容易踩的坑，都在下面标了：
 * 1. 候选的 `promptHash` 与 `generationPromptHash` **都要**等于快照哈希
 * 2. 时长必须按 **ffprobe 实测**复检，来源声明的 `duration` 只是整数秒的粗过滤
 * 3. 显式重搜必须采用新素材，不能沿用「当前选中」
 */

/** 单条素材上限。与生成式管线的 200MB 口径保持一致。 */
const MAX_BYTES = 200 * 1024 * 1024;
/**
 * 一条镜头最多下载几条候选。下载也算一次请求，免费额度是 200 请求/小时，
 * 所以不能「一直试到找到为止」——试满就报错，让用户改描述或换 AI 视频。
 */
const MAX_DOWNLOADS = 3;

export type ShotStockInput = {
  projectId: string;
  shotId: string;
  frame?: GenerationFrame;
  requestHash?: string;
  /** 重搜游标：该镜头已经试过的 assetId。只走任务 input，**不进快照哈希**。 */
  excludeAssetIds?: string[];
};

export type ShotStockResult = { shotId: string; assetId: string };

/**
 * 素材管线的就绪前置。与 `videoPrerequisite` 是**并列**关系，不是继承：
 * 素材管线不需要参考图、标准图与视频模型，所以不能走 AI 视频那道门禁。
 */
export function stockPrerequisite(doc: ProjectDoc, shot: Shot, timeline: Timeline): string | undefined {
  if (!isVideoForm(doc.settings.visualPipeline)) return "请先切换到视频素材驱动";
  if (shot.kind !== "video" || !shot.videoPlan) return shot.locked ? "锁定镜头还不是视频分镜，请解锁并重新导演" : "请先重新导演生成视频分镜";
  if (!shot.stockQuery) return "等待分镜补齐素材检索词";
  if (videoPlanNeedsSync(shot)) return "等待中文镜头要求同步到执行计划";
  const timing = videoShotTiming(doc, shot, timeline);
  if (!timing.ready) return timing.reason === "duration-out-of-range" ? "镜头超过 15 秒或时长无效，请重新导演" : "等待真实配音完成";
  if (!stockConfigured()) return "未配置 PEXELS_API_KEY，请在模型中心配置后再制作";
}

/** 下载失败也带状态码，让 `isRetryable` 能按 408/429/5xx 判断。 */
const downloadError = (message: string, status?: number) =>
  status === undefined ? new Error(message) : Object.assign(new Error(message), { status });

/**
 * 单条素材太大。这是「这一条不合适」，不是「这一个镜头没救了」——
 * 早先直接抛 `PermanentError`，结果镜头永久失败，重跑还命中同一条，永远出不来。
 */
class OversizedStockFile extends Error {
  constructor() {
    super(`素材超过 ${Math.round(MAX_BYTES / 1024 / 1024)}MB 上限`);
    this.name = "OversizedStockFile";
  }
}

export const shotStockStage = defineStage<ShotStockInput, ShotStockResult>({
  name: "shot-stock",
  // Pexels 免费额度 200 请求/小时，搜索与下载都算，所以默认串行。
  concurrency: 1,
  async run(input, ctx) {
    const project = getProject(input.projectId);
    const shot = project?.doc.shots.find((item) => item.id === input.shotId);
    if (!project || !shot || !isVideoForm(project.doc.settings.visualPipeline) || shot.kind !== "video" || !shot.videoPlan) throw new PermanentError("视频镜头不存在，请重新导演");
    if (shot.locked) throw new PermanentError("镜头已锁定，请先解锁");
    if (videoPlanNeedsSync(shot)) throw new PermanentError("等待中文镜头要求同步到执行计划");
    const frame = stockFrame(project.doc, input.frame);
    const timeline = timelineFor(project.doc, input.projectId, frame.aspect);
    const snapshot = stockSnapshot(project.doc, shot, timeline, frame);
    if (input.requestHash !== snapshot.hash) throw new PermanentError("素材输入已变化，请重新搜索");
    const source = stockSource();
    if (!source?.configured()) throw new PermanentError("未配置 PEXELS_API_KEY，请在模型中心配置后再制作");

    const excluded = new Set(input.excludeAssetIds ?? []);
    // 显式重搜（带游标）时不读快照缓存：否则会原样返回上一条，用户点了重搜画面却不变。
    if (!excluded.size) {
      const remembered = cachedStockAsset(snapshot.hash);
      if (remembered) {
        ctx.progress(0.5, "复用上次的素材");
        if (!writeBack(input, ctx, frame, snapshot.hash, remembered.assetId, false)) throw new PermanentError("素材输入已变化，请重新搜索");
        return { shotId: shot.id, assetId: remembered.assetId };
      }
    }

    ctx.progress(0.1, `正在检索素材：${snapshot.query}`);
    const generation = beginGenerationRun({
      projectId: input.projectId, jobId: ctx.job.id, providerId: source.id, modelId: `${source.id}-video`, kind: "video",
      inputHash: snapshot.hash, params: { stage: "shot-stock", shotId: shot.id, query: snapshot.query, orientation: stockOrientation(frame), minDurationSec: snapshot.minDurationSec, frame, excluded: excluded.size },
    });
    try {
      const clips = await searchStock(snapshot.query, {
        orientation: stockOrientation(frame),
        minDurationSec: snapshot.minDurationSec,
        maxDurationSec: snapshot.maxDurationSec,
        perPage: project.doc.settings.stock.perPage,
      }, ctx.signal);
      if (!clips.length) throw new PermanentError(`没有找到「${snapshot.query}」的素材，请改镜头描述或改用 AI 视频`);

      let downloads = 0;
      let sawFile = false;
      let tooShort = 0;
      let tooLarge = 0;
      let picked: { assetId: string; clipId: number; author: string; pageUrl: string; url: string } | undefined;
      for (const clip of clips) {
        if (!ctx.current()) throw ctx.signal.reason ?? new DOMException("任务已取消", "AbortError");
        const file = source.pickFile(clip, frame);
        if (!file) continue;
        sawFile = true;
        // 游标按 assetId 比对。assetId 是内容 sha256、只有下载后才知道，所以靠 URL 缓存
        // 把「这条地址」映射回 assetId——否则为了跳过一条已试素材还得先重新下载一遍。
        const known = cachedStockFile(source.id, file.url);
        if (known && excluded.has(known)) continue;
        if (!known && downloads >= MAX_DOWNLOADS) break;
        if (!known) downloads += 1;
        let assetId: string;
        try {
          assetId = known ?? await download(file.url, input, ctx, clip, frame);
        } catch (e) {
          // 太大就换下一条，别把整镜判死。下载预算已经扣了，所以最多也就试满 MAX_DOWNLOADS 条。
          if (e instanceof OversizedStockFile) { tooLarge += 1; continue; }
          throw e;
        }
        const asset = getAsset(assetId);
        // 实测时长复检：来源声明的 duration 是整数秒，实测可能短一点。短了会让
        // videoPlayback 的 videoDurationReady 为假，渲染被门禁直接卡住且不报错。
        if (!asset || asset.kind !== "video" || !videoPlayback(snapshot.timing.targetDurationMs, { durationMs: asset.durationMs ?? 0 }).videoDurationReady) { tooShort += 1; continue; }
        picked = { assetId, clipId: clip.id, author: clip.author, pageUrl: clip.pageUrl, url: file.url };
        break;
      }
      if (!picked) {
        if (!sawFile) throw new PermanentError("找到的素材分辨率不符合画幅要求，请改用 AI 视频");
        const reasons = [tooLarge ? `${tooLarge} 条超过 ${Math.round(MAX_BYTES / 1024 / 1024)}MB` : "", tooShort ? `${tooShort} 条比镜头短` : ""].filter(Boolean);
        throw new PermanentError(`找到的素材都不合适（已试 ${downloads} 条：${reasons.join("、")}），请改用 AI 视频或调整镜头描述`);
      }

      if (!writeBack(input, ctx, frame, snapshot.hash, picked.assetId, excluded.size > 0)) throw new PermanentError("素材输入已变化，请重新搜索");
      // 两条缓存都在写回成功之后才落：写回被并发编辑挡掉时不能留下「已经定过」的假记录。
      rememberStockAsset(snapshot.hash, { source: source.id, assetId: picked.assetId, clipId: picked.clipId, author: picked.author, pageUrl: picked.pageUrl });
      rememberStockFile(source.id, picked.url, picked.assetId);
      finishGenerationRun(generation.id, { status: "succeeded", latencyMs: Date.now() - generation.startedAt, outputAssets: [picked.assetId] });
      ctx.progress(1, "素材已就绪");
      return { shotId: shot.id, assetId: picked.assetId };
    } catch (error) {
      failGenerationRun(generation, error, ctx.signal.aborted);
      throw error;
    }
  },
});

/**
 * 写回。严格照抄 `runVideoShot` 的四步，只有一处不同：
 * **显式重搜时必须采用新素材**，不能沿用 `selected`——否则用户点了重搜画面却不变。
 */
function writeBack(input: ShotStockInput, ctx: StageContext, frame: GenerationFrame, snapshotHash: string, assetId: string, replacing: boolean): boolean {
  let written = false;
  mutateProject(input.projectId, (doc) => {
    const current = doc.shots.find((item) => item.id === input.shotId);
    if (!ctx.current() || !isVideoForm(doc.settings.visualPipeline) || !current || current.locked) return null;
    // 生成期间描述被改过：不把旧输入的素材盖到新描述上，让编排层下一轮重新排。
    if (stockSnapshot(doc, current, timelineFor(doc, input.projectId, frame.aspect), frame).hash !== snapshotHash) return null;
    // 两个哈希都要填：`selectShotCandidate` 读的是 `generationPromptHash`，
    // 只填 `promptHash` 会让变体指纹落到兜底值 "unknown"，
    // 门禁永远报「视频缺失或已过期」，而且不报错、只卡住。
    const fresh = [{ id: `${ctx.job.id}:0`, assetId, selected: false, kind: "video" as const, frame: { aspect: frame.aspect }, promptHash: snapshotHash, generationPromptHash: snapshotHash }];
    const currentAssetId = current.kind === "video" ? current.assetVariants[frame.aspect]?.assetId ?? (frame.aspect === stockFrame(doc).aspect ? current.assetId : undefined) : undefined;
    const history = current.candidates.map((candidate) => candidate.assetId === current.assetId && !candidate.promptHash
      ? { ...candidate, kind: current.kind === "video" ? "video" as const : "image" as const, promptHash: current.assetPromptHash } : candidate);
    // 合并而不是替换：历史候选留着，用户还能切回去，也是重搜游标的来源。
    const candidates = mergeCandidateHistory(history, fresh, currentAssetId).map((candidate) => ({ ...candidate, selected: !!candidate.selected }));
    const currentOutputHash = current.assetVariants[frame.aspect]?.promptHash ?? (frame.aspect === stockFrame(doc).aspect ? current.assetPromptHash : undefined);
    const selected = replacing || !currentAssetId || currentOutputHash !== snapshotHash
      ? candidates.find((candidate) => candidate.id === fresh[0].id)
      : candidates.find((candidate) => candidate.selected);
    let next: Shot = { ...current, candidates };
    if (selected && fresh.some((candidate) => candidate.id === selected.id)) {
      next = selectShotCandidate(next, selected.id, { aspect: frame.aspect, framing: videoAssetFraming(doc), aspects: outputSpecsFor(doc.settings).map((spec) => spec.aspect) }) ?? next;
      const variant = next.assetVariants[frame.aspect];
      if (variant) next.assetVariants = { ...next.assetVariants, [frame.aspect]: { ...variant, width: frame.width, height: frame.height, generatedAt: new Date().toISOString() } };
    }
    written = true;
    return { ...doc, shots: doc.shots.map((item) => item.id === input.shotId ? next : item) };
  });
  return written;
}

/**
 * 下载并入库。
 *
 * `meta` 按**白名单**重建：`putStream` 会把 meta 写进 assets 表永久落盘，
 * 而 Pexels 的下载地址可能带签名/token。所以只存 `pageUrl`（人可点的网页地址）。
 */
async function download(url: string, input: ShotStockInput, ctx: StageContext, clip: { id: number; author: string; pageUrl: string }, frame: GenerationFrame) {
  const response = await fetch(url, { signal: ctx.signal, ...longRequest }).catch((e) => {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw downloadError(`下载素材失败：${e instanceof Error ? e.message : String(e)}`);
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw downloadError(`下载素材失败（HTTP ${response.status}）`, response.status);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    await response.body.cancel().catch(() => {});
    throw new OversizedStockFile();
  }
  const asset = await putStream(response.body, MAX_BYTES, {
    ext: "mp4",
    meta: { source: "pexels", stage: "shot-stock", projectId: input.projectId, shotId: input.shotId, clipId: clip.id, author: clip.author, pageUrl: clip.pageUrl, frame },
  }).catch((e) => {
    throw e instanceof Error && /上限/.test(e.message) ? new OversizedStockFile() : e;
  });
  if (asset.kind !== "video") throw new PermanentError("来源返回的文件不是视频，请改用 AI 视频");
  return asset.hash;
}

/**
 * 单镜「重新搜索素材」入队。游标只在这里算，**绝不进快照哈希**：
 * 候选池被 `mergeCandidateHistory` 的容量上限截断后，从文档推导的排除集会变，
 * 若它参与哈希，门禁会把当前正在用的素材误判成过期。
 */
export function enqueueStockShot(projectId: string, doc: ProjectDoc, shot: Shot, frame: GenerationFrame, extra: { excludeAssetIds?: string[] } = {}) {
  if (shot.locked) throw new PermanentError("镜头已锁定，请先解锁");
  const timeline = timelineFor(doc, projectId, frame.aspect);
  const error = stockPrerequisite(doc, shot, timeline);
  if (error) throw new PermanentError(error);
  const snapshot = stockSnapshot(doc, shot, timeline, frame);
  const active = latestJobByKey(snapshot.key, projectId);
  if (active && ["queued", "running"].includes(active.status)) return { job: active, reused: true, requestHash: snapshot.hash };
  const job = enqueue({
    projectId, stage: "shot-stock", key: snapshot.key, target: `检索素材 ${shot.id}`, maxAttempts: 1, priority: 6,
    input: { projectId, shotId: shot.id, frame, requestHash: snapshot.hash, excludeAssetIds: extra.excludeAssetIds ?? stockExclusions(shot) },
  });
  return { job, reused: false, requestHash: snapshot.hash };
}
