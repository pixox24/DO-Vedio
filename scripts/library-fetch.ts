import { loadEnvConfig } from "@next/env";
import { runImport } from "../lib/server/music-import";
import { strictImportFailures } from "../lib/core/music-import";

/**
 * 批量导入曲库（只下载，不做授权判断的替代）：
 *   npm run library:fetch -- --input bgm/candidates/xxx.json --allow-domain example.com
 *
 * 关键参数：
 *   --dry-run            只校验候选清单与许可证，不联网、不写文件
 *   --strict             存在缺授权/隔离/重复时以非 0 退出
 *   --limit N            只处理前 N 首（pilot 阶段）
 *   --resume             复用 .staging 状态，跳过已导入曲目
 *   --output DIR         输出目录，默认 bgm
 *   --allow-domain D     追加允许下载/取证的域名，可重复
 *   --max-file-mb N      单文件上限，默认 30
 *   --max-total-mb N     本次总量上限，默认 2048
 */

type Cli = {
  input?: string;
  output?: string;
  limit?: number;
  dryRun?: boolean;
  strict?: boolean;
  resume?: boolean;
  finalizeOnly?: boolean;
  allowDomains: string[];
  maxFileMb?: number;
  maxTotalMb?: number;
  timeoutMs?: number;
  minDelayMs?: number;
  normalize?: boolean;
  help?: boolean;
};

function parseArgs(argv: string[]): Cli {
  const cli: Cli = { allowDomains: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} 缺少参数`);
      return value;
    };
    switch (arg) {
      case "--input": cli.input = next(); break;
      case "--output": cli.output = next(); break;
      case "--limit": cli.limit = Number(next()); break;
      case "--dry-run": cli.dryRun = true; break;
      case "--strict": cli.strict = true; break;
      case "--resume": cli.resume = true; break;
      case "--finalize-only": cli.finalizeOnly = true; break;
      case "--allow-domain": cli.allowDomains.push(next()); break;
      case "--max-file-mb": cli.maxFileMb = Number(next()); break;
      case "--max-total-mb": cli.maxTotalMb = Number(next()); break;
      case "--timeout-ms": cli.timeoutMs = Number(next()); break;
      case "--min-delay-ms": cli.minDelayMs = Number(next()); break;
      case "--no-normalize": cli.normalize = false; break;
      case "--help": case "-h": cli.help = true; break;
      default: throw new Error(`未知参数：${arg}`);
    }
  }
  return cli;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help || !cli.input) {
    console.log(`用法：npm run library:fetch -- --input <候选清单.json> [--dry-run] [--strict] [--limit N] [--resume] [--output bgm] [--allow-domain 域名]...`);
    if (!cli.input && !cli.help) process.exitCode = 2;
    return;
  }
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const { report } = await runImport({
    input: cli.input,
    output: cli.output,
    limit: cli.limit,
    dryRun: cli.dryRun,
    strict: cli.strict,
    resume: cli.resume,
    finalizeOnly: cli.finalizeOnly,
    allowDomains: cli.allowDomains,
    maxFileBytes: cli.maxFileMb ? cli.maxFileMb * 1024 * 1024 : undefined,
    maxTotalBytes: cli.maxTotalMb ? cli.maxTotalMb * 1024 * 1024 : undefined,
    timeoutMs: cli.timeoutMs,
    minDelayMs: cli.minDelayMs,
    normalize: cli.normalize,
    log: console.log,
  });
  console.log(`[导入] accepted=${report.accepted} rejected=${report.rejected} quarantine=${report.quarantine} duplicate=${report.duplicate} skipped=${report.skipped} missingLicense=${report.missingLicense} invalidAudio=${report.invalidAudio}`);
  console.log(`[导入] 报告：${cli.output ?? "bgm"}/reports/`);
  const failures = strictImportFailures(report);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`[strict] ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
