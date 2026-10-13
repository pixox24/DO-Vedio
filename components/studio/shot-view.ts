import type { Job, Shot } from "@/lib/core/types";

/**
 * 分镜板三种形态（扫读卡片 / 展开区 / 表格行）共用的纯计算。
 *
 * 单独成一个模块而不是留在 storyboard-panel.tsx 里，是因为这几项都是「算错了界面就会错、
 * 但肉眼很难看出来」的判断：排几列、展开区插在哪一行、一个镜头现在到底算哪种状态。
 * 组件文件带 next/dynamic 和 Image，测试环境跑不起来；这些计算又不依赖 React。
 */

export type ShotServerStatus = { status: string; progress: number; message: string; error: string | null; total: number; done: number; failed: number; running: number };

/** 分镜板里一个镜头能展示的状态 */
export type ShotViewStatus = "idle" | "queued" | "running" | "done" | "failed" | "canceled";

/** `00:34`。分镜的时间码只精确到秒；超过一小时按分钟累计（`75:00`），不截断也不进位成小时。 */
export function shotTime(ms: number) {
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
}

/** 每 columns 个切一行 */
export function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

/**
 * 按容器宽度算列数，不用 Tailwind 的断点类——断点看的是视口，而分镜板活在制作页右栏里，
 * 两者对不上（视口 1920 时右栏可能只有 830px）。列数由此算、也由此设，
 * 才能保证「排几列」和「几个一组」永远是同一个数。
 *
 * 220px 是扫读卡片的可用下限：再窄，画面格子认不出是什么，卡片也就失去扫读的意义。
 */
export const SHOT_TILE_MIN_WIDTH = 220;
const GRID_GAP = 12;

export function columnCount(width: number, wide: boolean) {
  const fit = Math.floor((width + GRID_GAP) / (SHOT_TILE_MIN_WIDTH + GRID_GAP));
  return Math.max(1, Math.min(fit, wide ? 5 : 3));
}

/**
 * 把镜头按行分组，并指出展开区该插在哪一行之后。
 * 展开区必须独占一整行：被展开的卡若不在行末，交给网格自动排布会在这行余下的格子里留一片空格。
 * 按列数自己分组，才能做到「这一行只放展开卡之前的卡片，展开区紧跟其后，下一行重新开始」。
 */
export function shotRows<T extends { id: string }>(items: T[], columns: number, expanded: string | null) {
  return chunk(items, columns).map((row) => ({ row, expandedInRow: row.find((item) => item.id === expanded) }));
}

/**
 * 服务端裁决 + 本地 job 兜底，合并成一份状态。
 * 有三处容易搞错、所以由这里统一裁决，表格行和展开区共用同一份：
 *   1. 服务端状态优先；`canceled` 也是终态，不能因为本地 job 还停在 queued 就继续显示排队。
 *   2. `succeeded` 不等于 `done`——素材还没同步回文档时画面上仍是旧的（或没有）图，不能说已完成。
 *   3. 进度取服务端批次进度，没有才退回本地 job 的进度。
 */
export function shotState({ shot, job, serverStatus }: { shot: Shot; job?: Job; serverStatus?: ShotServerStatus }) {
  const effectiveStatus = serverStatus?.status ?? job?.status;
  const running = effectiveStatus === "queued" || effectiveStatus === "running";
  const hasImage = !!shot.assetId;
  const status: ShotViewStatus = effectiveStatus === "failed" ? "failed"
    : effectiveStatus === "canceled" ? "canceled"
      : running ? (effectiveStatus === "queued" ? "queued" : "running")
        : effectiveStatus === "succeeded" && hasImage ? "done" : "idle";
  const progress = serverStatus && serverStatus.total > 0 ? serverStatus.progress : (job?.progress ?? 0);
  const label = { queued: "排队中", running: `生成中 · ${Math.round(progress * 100)}%`, done: "已完成", failed: "生成失败", canceled: "已取消", idle: hasImage ? "已有图片" : "待生成" }[status];
  return {
    status, running, hasImage, progress, label,
    error: serverStatus?.error ?? job?.error,
    message: serverStatus?.message ?? job?.message,
  };
}
