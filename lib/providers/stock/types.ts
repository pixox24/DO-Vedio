import type { GenerationFrame } from "../../core/output-spec";

/**
 * 素材来源层的公共类型。
 *
 * 这一层只回答「素材从哪来」，对「素材怎么用」一无所知：不碰 shot、不碰快照、
 * 不碰任务系统。因此接本地素材库（`Video-asset-library/`）时只需再加一个
 * `StockSource` 实现，不必重走画面管线那张改动表。
 */

/** 一条素材的某个可下载档位 */
export type StockFile = { id: number; url: string; width: number; height: number; quality: string; fileType: string };

/** 一条素材（一个视频），含它的全部档位 */
export type StockClip = {
  id: number;
  /** 人可点的素材详情页；不是带凭据的下载地址，可以安全落盘 */
  pageUrl: string;
  author: string;
  authorUrl: string;
  /** 来源声明的时长（整数秒）。只是检索用的粗过滤，实测时长仍要复检 */
  durationSec: number;
  width: number;
  height: number;
  files: StockFile[];
};

export type StockSearchOptions = {
  /** 不传表示两个方向都能用（本项目只有 16:9 / 9:16，所以总会传） */
  orientation?: "landscape" | "portrait";
  minDurationSec?: number;
  perPage?: number;
};

export type StockSource = {
  id: string;
  label: string;
  configured(): boolean;
  search(query: string, opts: StockSearchOptions, signal: AbortSignal): Promise<StockClip[]>;
  /** 选一个能填满画布的档位；返回 undefined 表示这条素材不可用，调用方跳到下一条 */
  pickFile(clip: StockClip, frame: GenerationFrame): StockFile | undefined;
};
