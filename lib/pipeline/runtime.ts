import { isTtsStage } from "../core/keys";
import type { Job } from "../core/types";
import { hasFfmpeg } from "../server/ffmpeg";
import { ensureSfx, scanLibrary } from "../server/music";
import { run } from "../server/db";
import { enqueueAutoPortraits, enqueueAutoScenes, isAutoPortraitJob } from "./auto-portrait";

/** Worker 启动自检：FFmpeg、曲库、内置音效 */
export async function preflight() {
  if (!(await hasFfmpeg())) {
    console.warn("⚠ 未找到 ffmpeg / ffprobe，配音和渲染将无法执行。可设置 FFMPEG_PATH、FFPROBE_PATH。");
    return;
  }
  try {
    const { ensureBrowser } = await import("@remotion/renderer");
    await ensureBrowser();
  } catch (e) {
    console.warn("⚠ Chrome Headless Shell 检查失败：", e instanceof Error ? e.message : e);
  }
  try {
    const r = await scanLibrary((...a) => console.log("  [曲库]", ...a));
    console.log(`曲库：${r.count} 首`);
    for (const p of r.problems) console.warn(`  ⚠ ${p}`);
    await ensureSfx();
  } catch (e) {
    console.warn("⚠ 曲库处理失败：", e instanceof Error ? e.message : e);
  }
}

/** 任务结束后：失败/取消则暂停自动推进；成功则继续对账 */
export async function onSettled(job: Job, ok: boolean) {
  const standardReference = job.stage === "character-sheet" || job.stage === "scene-reference";
  const { advance } = await import("./plan");
  if (isTtsStage(job.stage) && job.projectId && job.key.startsWith(`voice-change:${job.projectId}:`)) {
    if (ok && (await import("../server/voice-change")).finalizeVoiceChange(job.projectId)) advance(job);
    return;
  }
  if (!ok) {
    const cur = (await import("../server/jobs")).getJob(job.id);
    // 还会自动重试的不算失败
    if (cur?.status === "queued") return;
    // 自动立绘是支线：失败只留在角色面板等用户处理，不暂停整条自动推进
    if (job.projectId && !isAutoPortraitJob(job) && !standardReference) run("UPDATE project_goals SET blocked = ?, updated_at = ? WHERE project_id = ?", cur?.status === "canceled" ? "已取消" : `「${job.target || job.stage}」失败：${cur?.error ?? ""}`, Date.now(), job.projectId);
    if (isAutoPortraitJob(job) || standardReference) advance(job);
    if (job.projectId && job.stage === "scene-reference") enqueueAutoScenes(job.projectId, true);
    return;
  }
  if (job.projectId && job.stage === "cast") {
    const project = (await import("../server/projects")).getProject(job.projectId);
    if (project?.doc.settings.autoPortrait) await (await import("../visual-styles/store")).ensureProjectVisualStyle(job.projectId);
  }
  advance(job);
  // 识别角色完成后补自动立绘。自动推进那条路已由 advance() 的编排排好，这里管的是
  // 手动「重新识别角色」——它不属于任何制作目标，advance() 看不到它。
  if (job.projectId && job.stage === "cast") {
    enqueueAutoPortraits(job.projectId);
    enqueueAutoScenes(job.projectId);
  }
  // 生成期间场景被编辑：旧结果不会采用，成功结算后补排当前描述的一张图。
  if (job.projectId && job.stage === "scene-reference") enqueueAutoScenes(job.projectId);
}
