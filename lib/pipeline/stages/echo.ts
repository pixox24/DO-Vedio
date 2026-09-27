import { defineStage, PermanentError } from "../stage";

/** 测试用步骤：按指定时长逐步上报进度；failTimes 次之前失败，用于验证重试 */
export const echoStage = defineStage<{ ms?: number; failTimes?: number; permanent?: boolean; value?: unknown }, unknown>({
  name: "echo",
  concurrency: 4,
  async run(input, ctx) {
    if (input.permanent) throw new PermanentError("永久失败");
    if (input.failTimes && ctx.job.attempts <= input.failTimes) throw new Error(`第 ${ctx.job.attempts} 次故意失败`);
    const total = input.ms ?? 1000;
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await new Promise((r, reject) => {
        const t = setTimeout(r, total / steps);
        ctx.signal.addEventListener("abort", () => (clearTimeout(t), reject(ctx.signal.reason)), { once: true });
      });
      ctx.progress(i / steps, `${i}/${steps}`);
    }
    return { echoed: input.value ?? null };
  },
});
