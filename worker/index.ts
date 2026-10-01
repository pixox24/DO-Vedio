import { loadEnvConfig } from "@next/env";

// 与 Next.js 相同的规则加载 .env* 文件
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
// 兼容协议的模型不支持 responseFormat 时 AI SDK 会反复告警；schema 已写进提示词，关掉告警
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const HOUR = 3_600_000;

async function main() {
  const { startLoop } = await import("./loop");
  const { allStages } = await import("../lib/pipeline/stages");
  const { onSettled, preflight } = await import("../lib/pipeline/runtime");
  await preflight();
  const w = startLoop({ stages: allStages, onSettled });
  console.log(`Worker 已启动（${w.workerId}），数据目录 ${process.env.DATA_DIR || "data"}`);

  const { runMaintenance } = await import("../lib/server/gc");
  const { activeBundleSigsSnapshot } = await import("../lib/pipeline/render");
  const maintain = async () => {
    try {
      const r = await runMaintenance({ bundleKeepSigs: activeBundleSigsSnapshot() });
      const freed = (r.bundles.freedBytes + r.temp.freedBytes + r.probes.freedBytes + r.gc.freedBytes) / 1024 / 1024;
      const parts = [`释放 ${freed.toFixed(1)}MB`, `素材 ${r.gc.removed} 个`];
      if (r.trash.projects > 0) parts.push(`过期回收站项目 ${r.trash.projects} 个`);
      if (freed >= 1 || r.gc.removed > 0 || r.trash.projects > 0) console.log(`存储维护：${parts.join("，")}`);
    } catch (e) {
      console.error("存储维护失败：", e instanceof Error ? e.message : e);
    }
  };
  const first = setTimeout(() => void maintain(), 60_000);
  const timer = setInterval(() => void maintain(), 6 * HOUR);
  first.unref();
  timer.unref();

  const shutdown = () => {
    clearTimeout(first);
    clearInterval(timer);
    return w.stop().then(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
