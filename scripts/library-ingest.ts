import { loadEnvConfig } from "@next/env";
import { ensureSfx, syncLibrary } from "../lib/server/music";

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const result = await syncLibrary((...args) => console.log("[曲库]", ...args));
  for (const problem of result.problems) console.warn("[曲库]", problem);
  await ensureSfx();
  console.log(`已导入 ${result.count} 首曲目，并确认内置转场音效。`);
  if (process.argv.includes("--strict") && result.problems.some((p) => /文件不存在|授权来源/.test(p))) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
