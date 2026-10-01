import { spawn } from "child_process";

/** FFmpeg / FFprobe 调用；路径可用 FFMPEG_PATH / FFPROBE_PATH 覆盖 */

export const ffmpegPath = () => process.env.FFMPEG_PATH?.trim() || "ffmpeg";
export const ffprobePath = () => process.env.FFPROBE_PATH?.trim() || "ffprobe";

export function exec(bin: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { signal, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    p.on("error", (e) => reject(Object.assign(new Error(`无法运行 ${bin}：${e.message}`), { cause: e })));
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} 退出码 ${code}：${stderr.trim().split("\n").slice(-4).join(" | ")}`));
    });
  });
}

export const ffmpeg = (args: string[], signal?: AbortSignal) => exec(ffmpegPath(), ["-hide_banner", "-y", ...args], signal);

export type Probe = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  format: string;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitRate: number | null;
};

export type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  sample_rate?: string;
  channels?: number;
  width?: number;
  height?: number;
  duration?: string;
  bit_rate?: string;
  disposition?: { attached_pic?: number };
};

export type FfprobeOutput = {
  format?: { duration?: string; format_name?: string; bit_rate?: string };
  streams?: FfprobeStream[];
};

/** 从 ffprobe JSON 提取基础音频信息（纯函数，测试用） */
export function probeFromJson(data: FfprobeOutput): Probe {
  const streams = data.streams ?? [];
  // 封面图（attached_pic）不算视频流
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === "audio");
  const dur = Number(data.format?.duration ?? video?.duration ?? audio?.duration);
  const sampleRate = Number(audio?.sample_rate);
  const bitRate = Number(data.format?.bit_rate ?? audio?.bit_rate);
  return {
    durationMs: Number.isFinite(dur) ? Math.round(dur * 1000) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasAudio: !!audio,
    hasVideo: !!video,
    format: data.format?.format_name ?? "",
    audioCodec: audio?.codec_name ?? null,
    sampleRate: Number.isFinite(sampleRate) ? sampleRate : null,
    channels: audio?.channels ?? null,
    bitRate: Number.isFinite(bitRate) ? bitRate : null,
  };
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await exec(ffprobePath(), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  return probeFromJson(JSON.parse(stdout) as FfprobeOutput);
}

export type AudioInspection = Probe & {
  /** 静音时长占比 0–1 */
  silenceRatio: number;
  /** 峰值电平 dBFS（越接近 0 越可能削波）；null = 无法测量 */
  peakDb: number | null;
  /** 直流/异常超短等质检问题（不含授权判断） */
  issues: string[];
};

/** 从 silencedetect 输出解析静音占比（纯函数，测试用） */
export function parseSilenceRatio(stderr: string, durationMs: number | null): number {
  if (!durationMs || durationMs <= 0) return 0;
  let silence = 0;
  const re = /silence_duration:\s*([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr))) silence += Number(m[1]) * 1000;
  return Math.min(1, Math.max(0, silence / durationMs));
}

/** 从 astats / volumedetect 输出解析峰值 dBFS（纯函数，测试用） */
export function parsePeakDb(stderr: string): number | null {
  const astats = [...stderr.matchAll(/Peak level dB:\s*(-?[\d.]+|-?inf)/gi)].map((m) => m[1]);
  const volumes = [...stderr.matchAll(/max_volume:\s*(-?[\d.]+|-?inf)\s*dB/gi)].map((m) => m[1]);
  const values = [...astats, ...volumes].map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;
  return Math.max(...values);
}

/** 音频质检：解码是否可行、是否只有音频流、时长/采样率/声道、静音比例、削波 */
export async function inspectAudio(file: string, signal?: AbortSignal): Promise<AudioInspection> {
  const info = await probe(file);
  const issues: string[] = [];
  if (!info.hasAudio) issues.push("没有音频流");
  if (info.hasVideo) issues.push("包含视频流");
  if (info.durationMs === null) issues.push("无法读取时长");
  if (info.sampleRate !== null && info.sampleRate < 22_050) issues.push(`采样率过低（${info.sampleRate}Hz）`);
  if (info.channels !== null && info.channels < 1) issues.push("声道数异常");

  let silenceRatio = 0;
  let peakDb: number | null = null;
  try {
    const { stderr } = await ffmpeg(["-i", file, "-vn", "-af", "silencedetect=noise=-50dB:d=0.5,astats=metadata=1:reset=0", "-f", "null", "-"], signal);
    silenceRatio = parseSilenceRatio(stderr, info.durationMs);
    peakDb = parsePeakDb(stderr);
  } catch (e) {
    issues.push(`解码失败：${(e as Error).message}`);
  }
  // 静音比例与峰值只作为测量结果返回，阈值判定由 core/music-import 的 audioQcIssues 负责。
  return { ...info, silenceRatio, peakDb, issues };
}

export type Loudness = { i: number; tp: number; lra: number; thresh: number; offset: number };

/** loudnorm 第一遍：测量整体响度 */
export async function measureLoudness(file: string, target = { i: -14, tp: -1, lra: 11 }, signal?: AbortSignal): Promise<Loudness> {
  const { stderr } = await ffmpeg(
    ["-i", file, "-vn", "-af", `loudnorm=I=${target.i}:TP=${target.tp}:LRA=${target.lra}:print_format=json`, "-f", "null", "-"],
    signal,
  );
  const m = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!m) throw new Error("响度测量失败");
  const j = JSON.parse(m[0]) as Record<string, string>;
  return {
    i: Number(j.input_i),
    tp: Number(j.input_tp),
    lra: Number(j.input_lra),
    thresh: Number(j.input_thresh),
    offset: Number(j.target_offset),
  };
}

export function loudnormFilter(m: Loudness, target = { i: -14, tp: -1, lra: 11 }) {
  // 静音或近乎静音时 input_i 为 -inf，此时不做归一
  if (!Number.isFinite(m.i) || m.i < -70) return "anull";
  return `loudnorm=I=${target.i}:TP=${target.tp}:LRA=${target.lra}:measured_I=${m.i}:measured_TP=${m.tp}:measured_LRA=${m.lra}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true`;
}

export async function hasFfmpeg() {
  try {
    await exec(ffmpegPath(), ["-version"]);
    await exec(ffprobePath(), ["-version"]);
    return true;
  } catch {
    return false;
  }
}
