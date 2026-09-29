#!/usr/bin/env node
/**
 * DO·Vedio 统一启动入口：启动 / 重启 / 停止 / 状态。
 *
 * 双击「启动.bat」或直接 node scripts/start.mjs 即可，不用再区分「首次启动」和「重启」：
 * 检测到旧实例会自动收掉再拉起，Web 与 Worker 一起管。
 *
 * 命令（省略时为 up）：
 *   up      启动；已有实例则先停止再启动（默认后台，日志写 logs/）
 *   stop    停止 Web 与 Worker
 *   status  查看运行状态与日志位置
 * 参数：
 *   --fg    前台运行，日志直接打到当前终端（Ctrl+C 一起停）
 *   --prod  生产模式（next start + worker），需要先 npm run build
 *   -h      查看用法
 */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(ROOT, process.env.NODE_ENV !== "production");
const PORT = Number(process.env.PORT || 3000);
const STATE_FILE = path.join(ROOT, "data", "services.json");
const LOG_DIR = path.join(ROOT, "logs");
const HEALTH_TIMEOUT_MS = 90_000;
// Worker 用 node:sqlite，22.0 这种旧 22.x 没有；低于 22.13 就从 PATH 里换个够新的 Node 重跑
const MIN_NODE = [22, 13];

function parseVersion(v) {
  return (v || "").replace(/^v/, "").split(".").map(Number);
}

function versionAtLeast(v, [maj, min]) {
  const [a = 0, b = 0] = parseVersion(v);
  return a > maj || (a === maj && b >= min);
}

function findNewerNode() {
  const name = process.platform === "win32" ? "node.exe" : "node";
  const found = new Map();
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const exe = path.join(dir, name);
    if (exe === process.execPath || found.has(exe) || !existsSync(exe)) continue;
    try {
      const res = spawnSync(exe, ["-p", "process.versions.node"], { encoding: "utf8", timeout: 5000 });
      const v = (res.stdout || "").trim();
      if (res.status === 0 && versionAtLeast(v, MIN_NODE)) found.set(exe, v);
    } catch {
      /* 跑不动的候选跳过 */
    }
  }
  return [...found].sort((a, b) => parseVersion(b[1])[0] - parseVersion(a[1])[0])[0];
}

/** 当前 Node 太旧时换 PATH 里更新的 Node 重跑本脚本 */
function ensureNode() {
  if (versionAtLeast(process.versions.node, MIN_NODE)) return;
  const better = findNewerNode();
  if (!better) {
    log(`× 当前 Node v${process.versions.node} 太旧：项目需要 22.13+ / 23.4+ / 24+（node:sqlite）。`);
    log("  请升级 Node（https://nodejs.org）后重试。");
    process.exit(1);
  }
  const res = spawnSync(better[0], [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit", cwd: ROOT });
  process.exit(res.status ?? 1);
}

ensureNode();

// 直接跑 node + npm-cli.js：按名字调 npm(.cmd) 时 %~dp0 会落到当前目录，npm 找不到自己
const NPM_CLI = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const NPM = existsSync(NPM_CLI) ? [process.execPath, NPM_CLI] : [process.platform === "win32" ? "npm.cmd" : "npm"];

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const prod = has("--prod");
const fg = has("--fg");

const webScript = prod ? "start" : "dev";
const workerScript = prod ? "worker" : "dev:worker";
const allScript = prod ? "start:all" : "dev:all";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg = "") => console.log(msg);

function usage() {
  log(`DO·Vedio 启动入口

  双击 启动.bat           启动 / 重启（后台，日志写 logs/）
  node scripts/start.mjs [stop|status] [--fg] [--prod]

  up       启动，有旧实例就先停再启（默认）
  stop     停止网页与 Worker
  status   查看是否在运行、PID 与日志位置
  --fg     前台运行，日志打到当前终端
  --prod   生产模式（next start + worker），需先 npm run build
           默认只监听 127.0.0.1；设置 DO_VEDIO_HOST 才会更改监听地址`);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid, force = false) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  // detached 起的是进程组组长，杀整组才能带上 npm 拉起的 node
  const target = -pid;
  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(target, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* 已退出 */
    }
  }
}

/** 端口上监听的进程 PID（PID 文件失效时的兜底） */
function pidsOnPort(port) {
  if (process.platform === "win32") {
    const out = spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout || "";
    return [...new Set(
      out
        .split("\n")
        .filter((line) => line.includes(`:${port} `) && line.includes("LISTENING"))
        .map((line) => Number(line.trim().split(/\s+/).pop()))
        .filter((pid) => pid > 0),
    )];
  }
  const res = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
  return (res.stdout || "")
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => pid > 0);
}

function readState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function runningServices() {
  const state = readState();
  return state?.services?.filter((s) => isAlive(s.pid)) ?? [];
}

async function stopAll({ quiet = false } = {}) {
  const targets = readState()?.services ?? [];
  const pids = [
    ...new Set([...targets.map((s) => s.pid), ...pidsOnPort(PORT)]),
  ].filter((pid) => pid && pid !== process.pid);

  if (!pids.length) {
    if (!quiet) log("没有运行中的实例。");
    return false;
  }
  if (!quiet) log(`正在停止 ${pids.length} 个进程…`);

  for (const pid of pids) killPid(pid);

  let survivors = pids.filter(isAlive);
  for (let i = 0; i < 20 && survivors.length; i++) {
    await sleep(250);
    survivors = survivors.filter(isAlive);
  }

  for (const pid of survivors) killPid(pid, true);
  rmSync(STATE_FILE, { force: true });
  return true;
}

async function checkHealth() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

function preflight() {
  if (!existsSync(path.join(ROOT, "node_modules", "next"))) {
    log("× 还没安装依赖，请先在项目目录执行：npm install");
    process.exit(1);
  }
  const hasEnv = [".env.local", ".env"].some((f) => existsSync(path.join(ROOT, f)));
  if (!hasEnv) {
    log(`! 没找到 .env.local，页面里的模型列表会是空的。`);
    log(`  复制一份 .env.local.example 为 .env.local，填入至少一个 API Key 后重新双击即可。\n`);
  }
  if (prod && !existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    log("× 生产模式没找到构建产物，请先执行 npm run build（或去掉 --prod 用开发模式）。");
    process.exit(1);
  }
}

function spawnNpm(script, options) {
  // 让 npm 脚本里的 node（tsx.cmd / next.cmd 这些 shim）也用当前这个 Node，而不是 PATH 里的旧版
  const env = { ...process.env, PATH: [path.dirname(process.execPath), process.env.PATH || ""].join(path.delimiter) };
  return spawn(NPM[0], [...NPM.slice(1), "run", script], { ...options, env });
}

function startForeground() {
  log(`前台启动（${allScript}），Ctrl+C 一起停止…\n`);
  const child = spawnNpm(allScript, { stdio: "inherit", cwd: ROOT });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function startBackground() {
  mkdirSync(LOG_DIR, { recursive: true });
  const services = [
    { name: "web", script: webScript, file: "web.log" },
    { name: "worker", script: workerScript, file: "worker.log" },
  ].map((svc) => {
    const logFile = path.join(LOG_DIR, svc.file);
    // 日志文件以 fd 交给子进程，免 shell 重定向（detached 进程不能继承 stdio）
    const out = openSync(logFile, "a");
    let child;
    try {
      child = spawnNpm(svc.script, {
        cwd: ROOT,
        detached: true,
        stdio: ["ignore", out, out],
        windowsHide: true,
      });
    } finally {
      closeSync(out);
    }
    child.unref();
    return { ...svc, pid: child.pid, log: path.relative(ROOT, logFile) };
  });

  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ startedAt: new Date().toISOString(), mode: prod ? "prod" : "dev", services }, null, 2),
  );
  return services;
}

async function waitForReady() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let dots = 0;
  while (Date.now() < deadline) {
    if (await checkHealth()) return true;
    await sleep(1000);
    if (++dots % 5 === 0) process.stdout.write(`  已等待 ${dots}s…\n`);
  }
  return false;
}

function tailLog(file, lines = 20) {
  const full = path.join(LOG_DIR, file);
  if (!existsSync(full)) return "";
  return readFileSync(full, "utf8").split("\n").slice(-lines).join("\n");
}

async function up() {
  preflight();
  // 重启时按 Ctrl+C 会留下「旧的停了、新的没起」的空档，直接忽略掉
  if (!fg) process.on("SIGINT", () => log("\n（启动/重启进行中，先别按 Ctrl+C；完成后本窗口可直接关掉）"));
  const alive = runningServices();
  if (alive.length) {
    log(`检测到已在运行（${alive.map((s) => s.name).join(" + ")}），正在重启…`);
    await stopAll({ quiet: true });
    await sleep(500);
  }

  if (fg) {
    startForeground();
    return;
  }

  const services = startBackground();
  log(`已后台启动（${prod ? "生产" : "开发"}模式）：`);
  for (const svc of services) log(`  ${svc.name.padEnd(6)} PID ${svc.pid}  日志 ${svc.log}`);
  process.stdout.write("\n等待网页就绪…\n");

  if (await waitForReady()) {
    log(`\n√ 就绪：http://localhost:${PORT}`);
    log(`  本窗口可以直接关掉，后台的网页和 Worker 不受影响；要停就用 启动.bat stop。`);
    log(`  查看日志：tail -f logs/web.log（Windows 用 Get-Content logs\\web.log -Wait）`);
  } else {
    log(`\n× ${HEALTH_TIMEOUT_MS / 1000}s 内网页没起来，最近日志：`);
    log(tailLog("web.log") || "（空）");
    log(`\n完整日志见 logs/web.log；修好后重新双击即可。`);
    process.exitCode = 1;
  }
}

async function status() {
  const services = runningServices();
  const healthy = await checkHealth();
  if (!services.length && !healthy) {
    log("没有运行中的实例（双击 启动.bat 即可启动）。");
    return;
  }
  const state = readState();
  log(`状态：${healthy ? "运行中" : "进程在但网页未响应"}${state ? `（${state.mode === "prod" ? "生产" : "开发"}模式，启动于 ${state.startedAt}）` : ""}`);
  log(`网页：${healthy ? `http://localhost:${PORT}` : "未就绪"}`);
  for (const svc of services) log(`  ${svc.name.padEnd(6)} PID ${svc.pid}  日志 ${svc.log}`);
  if (!services.length && healthy) log("  （网页由外部进程占用端口，本脚本未记录 PID）");
}

async function main() {
  const cmd = args.find((a) => !a.startsWith("-")) ?? "up";
  if (has("-h") || has("--help")) return usage();
  if (cmd === "stop") return stopAll();
  if (cmd === "status") return status();
  if (cmd !== "up") {
    log(`未知命令：${cmd}\n`);
    return usage();
  }
  return up();
}

main();
