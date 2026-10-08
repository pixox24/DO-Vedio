import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir = "";
let musicDir = "";

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-music-"));
  musicDir = path.join(dir, "bgm");
  mkdirSync(path.join(musicDir, "warm"), { recursive: true });
  process.env.DATA_DIR = path.join(dir, "data");
  process.env.MUSIC_DIR = musicDir;
  const { ffmpeg } = await import("@/lib/server/ffmpeg");
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-ac", "1", "-ar", "44100", path.join(musicDir, "sine-a.wav")]);
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=660:duration=6", "-ac", "1", "-ar", "44100", path.join(musicDir, "sine-b.wav")]);
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=880:duration=6", "-ac", "1", "-ar", "44100", path.join(musicDir, "warm", "tone.wav")]);
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=0.2", "-ac", "1", "-ar", "44100", path.join(musicDir, "too-short.wav")]);
  writeFileSync(path.join(musicDir, "not-audio.mp3"), "this is definitely not audio");
  writeFileSync(path.join(musicDir, "library.json"), "{\"tracks\":[]}");
});

afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MUSIC_DIR;
});

describe("文件夹曲库", { timeout: 120_000 }, () => {
  it("扫描音频文件，跳过清单、损坏文件和过短文件", async () => {
    const { scanLibrary } = await import("@/lib/server/music");
    const result = await scanLibrary();
    expect(result.tracks.map((track) => track.id).sort()).toEqual(["sine-a.wav", "sine-b.wav", "warm/tone.wav"]);
    expect(result.tracks.every((track) => track.assetId && track.durationMs > 4_000)).toBe(true);
    expect(result.problems.join("；")).toContain("too-short");
    expect(result.problems.join("；")).toContain("not-audio");
    expect(result.problems.join("；")).not.toContain("library.json");
  });

  it("文件没变时不重新入库", async () => {
    const { get } = await import("@/lib/server/db");
    const { scanLibrary } = await import("@/lib/server/music");
    const before = get<{ updated_at: number; asset_hash: string }>("SELECT updated_at, asset_hash FROM music_tracks WHERE id = ?", "sine-a.wav");
    const result = await scanLibrary();
    const after = get<{ updated_at: number; asset_hash: string }>("SELECT updated_at, asset_hash FROM music_tracks WHERE id = ?", "sine-a.wav");
    expect(after).toEqual(before);
    expect(result.tracks.find((track) => track.id === "sine-a.wav")?.assetId).toBe(before?.asset_hash);
  });

  it("修改时间变了会重新处理，文件删除后从曲库消失", async () => {
    const { get } = await import("@/lib/server/db");
    const { scanLibrary } = await import("@/lib/server/music");
    const file = path.join(musicDir, "sine-a.wav");
    const before = get<{ updated_at: number }>("SELECT updated_at FROM music_tracks WHERE id = ?", "sine-a.wav");
    const stamp = new Date((statSync(file).mtimeMs || Date.now()) + 5_000);
    utimesSync(file, stamp, stamp);
    const refreshed = await scanLibrary();
    const after = get<{ updated_at: number }>("SELECT updated_at FROM music_tracks WHERE id = ?", "sine-a.wav");
    expect(after?.updated_at).toBeGreaterThan(before?.updated_at ?? 0);
    expect(refreshed.tracks.some((track) => track.id === "sine-a.wav")).toBe(true);

    rmSync(path.join(musicDir, "sine-b.wav"));
    const removed = await scanLibrary();
    expect(removed.tracks.map((track) => track.id)).not.toContain("sine-b.wav");
  });
});
