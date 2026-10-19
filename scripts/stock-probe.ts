import { loadEnvConfig } from "@next/env";
import { PexelsError, pexelsApiKey, pickFile, searchVideos } from "../lib/providers/stock/pexels";
import { stockConfigured } from "../lib/providers/stock";
import type { GenerationFrame } from "../lib/core/output-spec";
import { PermanentError } from "../lib/pipeline/stage";

/**
 * 素材来源探测：真打 Pexels，验证 Phase 2 的三条验收。
 *
 *   npm run stock:probe
 *
 * 1. `searchVideos("nature", { orientation: "portrait", minDurationSec: 6 })` 能返回 ≥1 条
 * 2. `pickFile` 选出的档宽高都不小于目标，且是同一条素材里面积最小的合格档
 * 3. 失败分层正确：Key 无效是 `PermanentError`（不可重试），不是普通网络错误
 *
 * 另外顺手核对两个不能靠猜的假设：`size=medium` 会不会把竖屏结果筛空、
 * `min_duration` 的单位是不是秒。这两条错了只会「结果变少」，不会报错。
 */

const LANDSCAPE: GenerationFrame = { aspect: "16:9", width: 1920, height: 1080, fps: 30 };
const PORTRAIT: GenerationFrame = { aspect: "9:16", width: 1080, height: 1920, fps: 30 };

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name} — ${detail}`);
};

function describePicks(clips: Awaited<ReturnType<typeof searchVideos>>, frame: GenerationFrame) {
  return clips.map((clip) => {
    const file = pickFile(clip, frame);
    return { clip, file };
  });
}

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  console.log(`Pexels Key：${pexelsApiKey() ? "已配置" : "未配置"}；来源可用：${stockConfigured()}`);

  console.log("\n[1] 竖屏检索 nature / min_duration=6");
  const portrait = await searchVideos("nature", { orientation: "portrait", minDurationSec: 6, perPage: 15 });
  console.log(`  返回 ${portrait.length} 条`);
  record("竖屏检索返回 ≥1 条", portrait.length > 0, `count=${portrait.length}`);
  const tooShort = portrait.filter((clip) => clip.durationSec < 6);
  record("来源侧 min_duration 生效（秒）", tooShort.length === 0, tooShort.length ? `有 ${tooShort.length} 条短于 6s：${tooShort.map((c) => c.durationSec).join(",")}` : "全部 ≥6s");
  const wrongOrientation = portrait.filter((clip) => clip.width >= clip.height);
  record("竖屏结果确实是竖屏", wrongOrientation.length === 0, wrongOrientation.length ? `有 ${wrongOrientation.length} 条横屏` : "全部 height>width");

  console.log("\n[2] pickFile 选择");
  const portraitPicks = describePicks(portrait, PORTRAIT);
  const picked = portraitPicks.filter((item) => item.file);
  console.log(`  ${picked.length}/${portraitPicks.length} 条有可用档`);
  record("竖屏有素材可选", picked.length > 0, `picked=${picked.length}`);
  const undersized = picked.filter((item) => item.file!.width < PORTRAIT.width || item.file!.height < PORTRAIT.height);
  record("选出的档宽高都不小于目标", undersized.length === 0, undersized.length ? `${undersized.length} 条不足` : `目标 ${PORTRAIT.width}×${PORTRAIT.height}`);
  const nonMinimal = picked.filter(({ clip, file }) => {
    const wantPortrait = PORTRAIT.height > PORTRAIT.width;
    const area = file!.width * file!.height;
    return clip.files.some((other) => other.fileType === "video/mp4" && other.width >= PORTRAIT.width && other.height >= PORTRAIT.height
      && (other.height > other.width) === wantPortrait && other.width * other.height < area);
  });
  record("选出的档面积最小", nonMinimal.length === 0, nonMinimal.length ? `${nonMinimal.length} 条有更小的合格档` : "已取面积最小档");
  for (const { clip, file } of picked.slice(0, 5)) {
    console.log(`    clip ${clip.id} · ${clip.durationSec}s · ${clip.width}×${clip.height} → 档 ${file!.width}×${file!.height} ${file!.quality}`);
  }

  console.log("\n[3] 横屏检索与选择");
  const landscape = await searchVideos("nature", { orientation: "landscape", minDurationSec: 6, perPage: 15 });
  const landscapePicks = describePicks(landscape, LANDSCAPE).filter((item) => item.file);
  record("横屏检索返回 ≥1 条", landscape.length > 0, `count=${landscape.length}`);
  record("横屏有素材可选", landscapePicks.length > 0, `picked=${landscapePicks.length}`);
  const landscapeUndersized = landscapePicks.filter((item) => item.file!.width < LANDSCAPE.width || item.file!.height < LANDSCAPE.height);
  record("横屏选出的档宽高都不小于目标", landscapeUndersized.length === 0, landscapeUndersized.length ? `${landscapeUndersized.length} 条不足` : `目标 ${LANDSCAPE.width}×${LANDSCAPE.height}`);

  console.log("\n[4] size=medium 对竖屏的影响");
  const url = new URL("/videos/search", "https://api.pexels.com");
  url.searchParams.set("query", "nature");
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("min_duration", "6");
  url.searchParams.set("per_page", "15");
  const raw = await fetch(url, { headers: { Authorization: pexelsApiKey()!, Accept: "application/json" } });
  const rawBody = await raw.json() as { videos?: unknown[] };
  const rawCount = Array.isArray(rawBody.videos) ? rawBody.videos.length : 0;
  record("不加 size 时竖屏结果不更少", rawCount >= portrait.length, `无 size=${rawCount} / size=medium=${portrait.length}`);
  if (rawCount !== portrait.length) console.log("    ⚠ 两者不同，size=medium 正在筛掉部分竖屏素材，需要重新评估是否保留");

  console.log("\n[5] 失败分层：用一个无效 Key");
  try {
    await searchVideos("nature", { perPage: 1 }, AbortSignal.timeout(15_000), { apiKey: "invalid-key-for-probe" });
    record("无效 Key 应该抛错", false, "居然成功了");
  } catch (e) {
    record("无效 Key → PermanentError（不可重试）", e instanceof PermanentError, `${e instanceof Error ? e.constructor.name : typeof e}: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof PexelsError) console.log(`    状态码 ${e.status}（这条不该走到这里）`);
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(`\n${failed.length ? `✗ ${failed.length}/${checks.length} 项未通过` : `✓ 全部 ${checks.length} 项通过`}`);
  if (failed.length) {
    for (const check of failed) console.log(`  - ${check.name}：${check.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("探测失败：", e);
  process.exitCode = 1;
});
