#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvConfig(root, process.env.NODE_ENV !== "production");

// next start defaults to 0.0.0.0. Keep production local by default and require
// an explicit opt-in (`DO_VEDIO_HOST=0.0.0.0`) for LAN exposure.
const host = process.env.DO_VEDIO_HOST?.trim() || "127.0.0.1";
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "-H", host, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
