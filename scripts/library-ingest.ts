import { loadEnvConfig } from "@next/env";
import { ensureSfx, strictProblems, syncLibrary } from "../lib/server/music";

/**
 * 同步 bgm/library.json 到媒体库：统一 -20 LUFS / 48kHz / 双声道 / AAC。
 * pending 曲目会入库供试听，但不参与自动选曲；strict 只对文件缺失、损坏、
 * 声称已核实却证据不足、重复文件失败。
 */
async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const result = await syncLibrary((...args) => console.log("[曲库]", ...args));
  for (const problem of result.problems) console.warn("[曲库]", problem);
  const { report } = result;
  console.log(
    `[曲库] accepted=${report.accepted} pending=${report.pending} rejected=${report.rejected} quarantine=${report.quarantine} duplicate=${report.duplicate} missingLicense=${report.missingLicense} invalidAudio=${report.invalidAudio}`,
  );
  await ensureSfx();
  console.log(`已同步 ${result.count} 首曲目，并确认内置转场音效。`);
  if (process.argv.includes("--strict")) {
    const failures = strictProblems(report);
    if (failures.length > 0) {
      for (const failure of failures) console.error(`[strict] ${failure}`);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
