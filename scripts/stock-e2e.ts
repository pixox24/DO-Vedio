import { loadEnvConfig } from "@next/env";

/**
 * 素材管线端到端：真打 LLM（分镜 + 检索词）→ 真打 TTS（真实配音时长）→
 * 真打 Pexels（检索 + 下载）→ 渲染成片，并采集 Phase 5 要的那几个指标。
 *
 *   NODE_OPTIONS= npm run stock:e2e
 *
 * 与 `stock:probe` 的区别：那个只验证来源层的三条契约，这个跑完整条管线。
 * 会**真实花钱**：DashScope 配音 + 文本模型分镜 + Pexels 请求（免费额度内）。
 * 项目默认保留，方便在 /projects/<id>/video 里看成片。
 *
 * ⚠️ 必须带 `NODE_OPTIONS=`：本机 CLI 的 node FS shim 会拦截 Remotion 打包的
 * mkdir（误报 `EEXIST: file already exists` + `CODEBUDDY_BROKER_DENY`），
 * 渲染阶段会死在打包一步。这不是应用代码的问题。
 */

const SCRIPT = [
  "清晨的城市还没醒，第一班地铁已经钻出地面。",
  "街角的面包店拉开卷帘，烤箱的热气扑上玻璃。",
  "跑步的人沿着江边减速，水面把天光揉碎。",
  "写字楼的电梯一层层亮起，键盘声开始密集。",
  "傍晚的云被染成橘色，桥上的车流拉出长曝光。",
].join("");

type Counts = { search: number; download: number; other: number };

/** 数一数真的向 Pexels 发了多少次请求——额度是 200/小时，这个数字必须能报出来。 */
function instrumentFetch(): Counts {
  const counts: Counts = { search: 0, download: 0, other: 0 };
  const real = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String((input as Request).url ?? input);
    if (url.includes("api.pexels.com")) counts.search += 1;
    else if (url.includes("videos.pexels.com")) counts.download += 1;
    else counts.other += 1;
    return real(input as never, init);
  }) as typeof fetch;
  return counts;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  (globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
  const counts = instrumentFetch();

  const { emptyDoc } = await import("../lib/core/types");
  const { syncLines } = await import("../lib/core/sync");
  const { createProject, mutateProject, getProject } = await import("../lib/server/projects");
  const { stockConfigured } = await import("../lib/providers/stock");
  const { drive, getGoal, setGoal } = await import("../lib/pipeline/plan");
  const { allStages } = await import("../lib/pipeline/stages");
  const { onSettled, preflight } = await import("../lib/pipeline/runtime");
  const { startLoop } = await import("../worker/loop");
  const { projectJobs, runningCounts } = await import("../lib/server/jobs");
  const { all } = await import("../lib/server/db");

  if (!stockConfigured()) {
    console.error("PEXELS_API_KEY 未配置，无法端到端。");
    process.exit(1);
  }
  await preflight();

  const doc = emptyDoc();
  doc.brief = { ...doc.brief, title: "素材管线端到端" };
  doc.segments = [{ title: "城市一天", text: SCRIPT }];
  doc.settings.visualPipeline = "stock";
  doc.settings.music = { ...doc.settings.music, enabled: false };
  doc.settings.subtitle = { ...doc.settings.subtitle, enabled: true, bilingual: false };
  const project = createProject(doc);
  mutateProject(project.id, () => syncLines(getProject(project.id)!.doc));
  console.log(`项目 ${project.id} · ${getProject(project.id)!.doc.lines.length} 句`);

  const loop = startLoop({ stages: allStages, onSettled, pollMs: 300, log: (...a) => console.log("   ", ...a) });
  const goal = { until: "render" as const, aspects: ["16:9" as const], quality: "draft" as const };
  const started = Date.now();
  drive(project.id, goal, true);

  // 等到「起过任务且现在全空」，或者在空闲时目标被阻塞。
  // 注意不能一看到 blocked 就退出：失败发生时往往还有一串已排队的任务在跑，
  // 提前收工会把它们漏给下一轮，缓存指标就全失真了。
  let blocked = "";
  let seenWork = false;
  while (Date.now() - started < 20 * 60_000) {
    await sleep(1000);
    const pending = projectJobs(project.id).filter((job) => job.status === "queued" || job.status === "running").length;
    const busy = Object.values(runningCounts()).reduce((a, b) => a + b, 0);
    if (pending > 0 || busy > 0) { seenWork = true; continue; }
    if (seenWork) { blocked = getGoal(project.id)?.blocked ?? ""; break; }
  }
  await loop.stop();
  setGoal(project.id, null);

  // 第二轮：同样目标再跑一次。素材齐了的话应该一个 Pexels 请求都不发——
  // 这是缓存与门禁真正生效的证据，比「命中率」这个数字更能说明问题。
  const before = { ...counts };
  const beforeJobs = all<{ id: string }>("SELECT id FROM jobs WHERE project_id = ? AND stage = 'shot-stock'", project.id).length;
  const second = startLoop({ stages: allStages, onSettled, pollMs: 300, log: () => undefined });
  drive(project.id, goal, true);
  const secondStart = Date.now();
  let seen2 = false;
  while (Date.now() - secondStart < 60_000) {
    await sleep(1000);
    const pending = projectJobs(project.id).filter((job) => job.status === "queued" || job.status === "running").length;
    const busy = Object.values(runningCounts()).reduce((a, b) => a + b, 0);
    if (pending > 0 || busy > 0) seen2 = true;
    else if (seen2) break;
  }
  await second.stop();
  setGoal(project.id, null);
  const rerun = {
    search: counts.search - before.search,
    download: counts.download - before.download,
    jobs: all<{ id: string }>("SELECT id FROM jobs WHERE project_id = ? AND stage = 'shot-stock'", project.id).length - beforeJobs,
  };

  await report(project.id, counts, blocked, ((Date.now() - started) / 1000).toFixed(0), all, rerun);
  process.exit(0);
}

type All = typeof import("../lib/server/db")["all"];

async function report(projectId: string, counts: Counts, blocked: string, elapsed: string, all: All, rerun: { search: number; download: number; jobs: number } = { search: 0, download: 0, jobs: 0 }) {
  const { getProject } = await import("../lib/server/projects");
  const { timelineFor } = await import("../lib/pipeline/artifacts");
  const { stockFrame } = await import("../lib/core/stock");

  const project = getProject(projectId)!;
  const doc = project.doc;
  const jobs = all<{ stage: string; status: string; error: string | null; cost_actual: number }>(
    "SELECT stage, status, error, cost_actual FROM jobs WHERE project_id = ?", projectId,
  );
  const stockJobs = jobs.filter((job) => job.stage === "shot-stock");
  const failedStock = stockJobs.filter((job) => job.status === "failed");
  const cachedRows = all<{ key: string }>("SELECT key FROM cache WHERE key LIKE 'stock:%'").length;
  const urlRows = all<{ key: string }>("SELECT key FROM cache WHERE key LIKE 'stock-url:%'").length;

  const frame = stockFrame(doc);
  const timeline = timelineFor(doc, projectId, frame.aspect);
  const videoShots = doc.shots.filter((shot) => shot.kind === "video");
  const assets = new Map(
    all<{ hash: string; duration_ms: number | null; meta: string }>("SELECT hash, duration_ms, meta FROM assets WHERE kind = 'video'")
      .map((row) => [row.hash, row] as const),
  );
  const pexelsAssets = [...assets.values()].filter((row) => (row.meta ?? "").includes("pexels"));
  const leaksUrl = pexelsAssets.filter((row) => (row.meta ?? "").includes("videos.pexels.com"));

  const deltas: number[] = [];
  const shotRows: string[] = [];
  for (const shot of videoShots) {
    const timed = timeline.shots.find((item) => item.shotId === shot.id);
    const assetId = shot.assetVariants[frame.aspect]?.assetId ?? shot.assetId;
    const asset = assetId ? assets.get(assetId) : undefined;
    const target = timed ? timed.endMs - timed.startMs : 0;
    if (asset?.duration_ms && target) deltas.push(asset.duration_ms - target);
    shotRows.push(`    ${shot.id} · 「${shot.stockQuery ?? "—"}」 · 镜头 ${target}ms · 素材 ${asset?.duration_ms ?? "—"}ms${asset?.duration_ms && target ? ` · 富余 ${asset.duration_ms - target}ms` : ""}`);
  }

  const renders = all<{ duration_ms: number; video_hash: string; quality: string }>("SELECT duration_ms, video_hash, quality FROM renders WHERE project_id = ?", projectId);
  const spent = jobs.reduce((sum, job) => sum + (job.cost_actual ?? 0), 0);

  console.log(`\n=== 素材管线端到端 · ${elapsed}s ===`);
  console.log(`镜头 ${doc.shots.length} 个（视频 ${videoShots.length}）· 时间轴 ${timeline.durationMs}ms · 阻塞：${blocked || "无"}`);

  console.log(`\n[请求]`);
  console.log(`  Pexels 检索 ${counts.search} 次 · 下载 ${counts.download} 次 · 其它出站 ${counts.other} 次`);
  console.log(`  shot-stock 任务 ${stockJobs.length} 个，失败 ${failedStock.length} 个`);
  for (const job of failedStock) console.log(`    ✗ ${job.error}`);

  console.log(`\n[缓存]`);
  console.log(`  按快照哈希 ${cachedRows} 条 · 按下载地址 ${urlRows} 条`);
  console.log(`  同目标再跑一次：新增检索 ${rerun.search} 次 · 新增下载 ${rerun.download} 次 · 新增 shot-stock 任务 ${rerun.jobs} 个${rerun.search === 0 && rerun.jobs === 0 ? " ✓" : " ✗"}`);

  console.log(`\n[素材]`);
  console.log(`  入库视频 ${pexelsAssets.length} 条 · meta 泄漏下载地址 ${leaksUrl.length} 条${leaksUrl.length ? " ✗" : " ✓"}`);
  for (const row of shotRows) console.log(row);
  if (deltas.length) {
    const sorted = [...deltas].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    console.log(`  富余：min ${sorted[0]}ms · 中位 ${at(0.5)}ms · max ${sorted[sorted.length - 1]}ms · 负富余 ${deltas.filter((d) => d < 0).length} 条`);
  }

  console.log(`\n[成片]`);
  for (const render of renders) console.log(`  ${render.quality} · ${render.duration_ms}ms · ${render.video_hash.slice(0, 12)}`);
  console.log(`\n[费用] 任务记账合计 ¥${spent.toFixed(4)}（素材检索本身不计费）`);
  console.log(`\n项目 ${projectId} 已保留：/projects/${projectId}/video`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
