// node:sqlite 在 Node 22 上会打印 ExperimentalWarning；必须在导入 node:sqlite 之前执行，只屏蔽这一条
const originalEmit = process.emitWarning;
process.emitWarning = function (warning: string | Error, ...rest: unknown[]) {
  const msg = typeof warning === "string" ? warning : warning?.message;
  if (msg?.includes("SQLite is an experimental feature")) return;
  return (originalEmit as (...a: unknown[]) => void).call(process, warning, ...rest);
} as typeof process.emitWarning;

export {};
