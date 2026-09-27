import { loadEnvConfig } from "@next/env";

// 与 Next.js 相同的规则加载 .env* 文件
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
// 兼容协议的模型不支持 responseFormat 时 AI SDK 会反复告警；schema 已写进提示词，关掉告警
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

async function main() {
  const { startLoop } = await import("./loop");
  const { allStages } = await import("../lib/pipeline/stages");
  const { onSettled, preflight } = await import("../lib/pipeline/runtime");
  await preflight();
  const w = startLoop({ stages: allStages, onSettled });
  console.log(`Worker 已启动（${w.workerId}），数据目录 ${process.env.DATA_DIR || "data"}`);
  const shutdown = () => w.stop().then(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
