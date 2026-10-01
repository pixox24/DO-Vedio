import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir = "";
let musicDir = "";
let libraryFile = "";

const verified = (id: string, file: string, extra: Record<string, unknown> = {}) => ({
  id,
  file,
  title: `曲目 ${id}`,
  moods: ["温暖"],
  loopable: true,
  license: "CC BY 4.0",
  source: "https://example.com",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  sourcePage: "https://example.com/track",
  downloadUrl: "https://example.com/track.mp3",
  author: "Tester",
  commercialUse: true,
  rightsStatus: "verified",
  rightsCheckedAt: "2026-10-01",
  evidence: { url: "https://creativecommons.org/licenses/by/4.0/", fetchedAt: "2026-10-01", text: "commercial use allowed" },
  ...extra,
});

const writeManifest = (tracks: unknown[]) => writeFileSync(libraryFile, JSON.stringify({ tracks }));

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-music-"));
  musicDir = path.join(dir, "bgm");
  mkdirSync(musicDir, { recursive: true });
  process.env.DATA_DIR = path.join(dir, "data");
  process.env.MUSIC_DIR = musicDir;
  libraryFile = path.join(musicDir, "library.json");
  const { ffmpeg } = await import("@/lib/server/ffmpeg");
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-ac", "1", "-ar", "44100", path.join(musicDir, "sine-a.wav")]);
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=660:duration=6", "-ac", "1", "-ar", "44100", path.join(musicDir, "sine-b.wav")]);
  writeFileSync(path.join(musicDir, "not-audio.mp3"), "this is definitely not audio");
});

afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MUSIC_DIR;
});

describe("曲库同步", { timeout: 120_000 }, () => {
  it("旧版清单：标记 pending、可试听但不可参与选曲，strict 不误报", async () => {
    writeManifest([{ id: "legacy", file: "sine-a.wav", title: "旧曲目", moods: ["温暖"], loopable: true, license: "待确认", source: "" }]);
    const { strictProblems, listTracks, listUsableTracks, syncLibrary } = await import("@/lib/server/music");
    const result = await syncLibrary();
    expect(result.report.pending).toBe(1);
    expect(result.report.accepted).toBe(0);
    expect(result.report.missingLicense).toBe(1);
    expect(result.problems).toEqual([]);
    expect(strictProblems(result.report)).toEqual([]);
    const all = listTracks();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ rightsStatus: "pending", usable: false, id: "legacy" });
    expect(all[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(all[0].durationMs).toBeGreaterThan(4_000);
    expect(all[0].assetId).toMatch(/^[a-f0-9]{64}$/);
    expect(listUsableTracks()).toHaveLength(0);
  });

  it("证据完整的已核实曲目才进入可用列表", async () => {
    writeManifest([verified("ok", "sine-b.wav")]);
    const { listUsableTracks, syncLibrary } = await import("@/lib/server/music");
    const result = await syncLibrary();
    expect(result.report.accepted).toBe(1);
    expect(result.problems).toEqual([]);
    const usable = listUsableTracks();
    expect(usable).toHaveLength(1);
    expect(usable[0]).toMatchObject({ id: "ok", rightsStatus: "verified", usable: true, author: "Tester" });
    expect(usable[0].normalizedSha256).toBe(usable[0].assetId);
    expect(usable[0].evidence?.text).toContain("commercial");
  });

  it("声称已核实但缺少证据会降级为 pending，strict 失败", async () => {
    writeManifest([verified("no-evidence", "sine-a.wav", { licenseUrl: "", evidence: undefined, sourcePage: "" })]);
    const { strictProblems, syncLibrary } = await import("@/lib/server/music");
    const result = await syncLibrary();
    expect(result.report.accepted).toBe(0);
    expect(result.report.pending).toBe(1);
    expect(result.problems.join("；")).toContain("证据不足");
    expect(strictProblems(result.report).join("；")).toContain("证据不足");
  });

  it("相同 sha256 的文件不会重复入库", async () => {
    writeManifest([verified("dup-a", "sine-a.wav"), verified("dup-b", "sine-a.wav")]);
    const { listTracks, syncLibrary } = await import("@/lib/server/music");
    const result = await syncLibrary();
    expect(result.report.duplicate).toBe(1);
    expect(result.report.accepted).toBe(1);
    expect(listTracks().filter((t) => t.id.startsWith("dup-"))).toHaveLength(1);
    expect(result.problems.join("；")).toContain("重复");
  });

  it("文件缺失与非音频文件进入 quarantine", async () => {
    writeManifest([verified("missing", "does-not-exist.mp3"), verified("bad", "not-audio.mp3")]);
    const { listTracks, syncLibrary } = await import("@/lib/server/music");
    const result = await syncLibrary();
    expect(result.report.quarantine).toBe(2);
    expect(result.report.invalidAudio).toBe(1);
    expect(result.report.accepted).toBe(0);
    const tracks = listTracks();
    expect(tracks.every((t) => t.rightsStatus === "quarantine" && !t.usable)).toBe(true);
  });
});
