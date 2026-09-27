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

export type Probe = { durationMs: number | null; width: number | null; height: number | null; hasAudio: boolean; hasVideo: boolean; format: string };

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await exec(ffprobePath(), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string };
    streams?: { codec_type?: string; width?: number; height?: number; duration?: string; disposition?: { attached_pic?: number } }[];
  };
  const streams = data.streams ?? [];
  // 封面图（attached_pic）不算视频流
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === "audio");
  const dur = Number(data.format?.duration ?? video?.duration ?? audio?.duration);
  return {
    durationMs: Number.isFinite(dur) ? Math.round(dur * 1000) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasAudio: !!audio,
    hasVideo: !!video,
    format: data.format?.format_name ?? "",
  };
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
