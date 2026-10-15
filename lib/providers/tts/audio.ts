import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpeg } from "../../server/ffmpeg";

/** 各服务商返回的音频容器 → 项目统一的 WAV；Gemini 与 Edge 共用 */

/** 已知但非 WAV 的容器；这些交给 ffmpeg 转，而不是直接判为非法音频 */
export function hasKnownContainer(audio: Buffer, mime: string) {
  return (
    /audio\/(?:mpeg|mp3|ogg|opus|flac|mp4|aac)/i.test(mime) ||
    audio.toString("ascii", 0, 3) === "ID3" ||
    audio.toString("ascii", 0, 4) === "OggS" ||
    audio.toString("ascii", 0, 4) === "fLaC"
  );
}

/** 用 ffmpeg 把任意可解码容器转成 16bit 单声道 WAV；gainDb 只做线性增益，limiter 防削波 */
export async function transcodeToWav(
  audio: Buffer,
  mime: string,
  options: { sampleRate?: number; gainDb?: number; signal?: AbortSignal; describe?: (message: string, cause?: unknown) => Error } = {},
): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tts-audio-"));
  const input = path.join(dir, "input.audio");
  const output = path.join(dir, "output.wav");
  try {
    await fs.writeFile(input, audio);
    const args = ["-i", input, "-vn", "-ac", "1", ...(options.sampleRate ? ["-ar", String(options.sampleRate)] : [])];
    if (options.gainDb) args.push("-af", `volume=${options.gainDb}dB,alimiter=limit=0.98`);
    args.push("-c:a", "pcm_s16le", "-f", "wav", output);
    await ffmpeg(args, options.signal);
    return await fs.readFile(output);
  } catch (error) {
    const describe = options.describe ?? ((message: string, cause?: unknown) => new Error(message, { cause }));
    throw describe(`无法把 ${mime || "音频"} 转换为 WAV（需要 ffmpeg，可用 FFMPEG_PATH 指定路径）`, error);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
