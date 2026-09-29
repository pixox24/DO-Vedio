import { loadEnvConfig } from "@next/env";
import { promises as fs } from "fs";
import { cachePut } from "../lib/server/cache";
import { lineSpeech, ttsKey } from "../lib/core/keys";
import { blankShot } from "../lib/core/shots";
import { buildTimeline, timelineHash } from "../lib/core/timeline";
import { emptyDoc } from "../lib/core/types";
import { createProject, mutateProject } from "../lib/server/projects";
import { ffmpeg } from "../lib/server/ffmpeg";
import { assetFile, putFile, tempPath } from "../lib/server/media";
import { renderTimeline } from "../lib/pipeline/render";
import { syncLines } from "../lib/core/sync";
import { all, run } from "../lib/server/db";

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const project = createProject({ ...emptyDoc(), brief: { ...emptyDoc().brief, title: "smoke" }, segments: [{ title: "Smoke", text: "这是一段渲染冒烟测试。" }], settings: { ...emptyDoc().settings, music: { ...emptyDoc().settings.music, enabled: false } } });
  let assetHash = "";
  let cacheKey = "";
  try {
  const synced = syncLines(project.doc);
  mutateProject(project.id, () => synced);
  const line = synced.lines[0];
  const spoken = lineSpeech(line, []).spoken;
  const wav = await tempPath("wav");
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=1.4", "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  const asset = await putFile(wav, { ext: "wav", mime: "audio/wav" });
  assetHash = asset.hash;
  const tts = {
    assetId: asset.hash,
    durationMs: 1400,
    speechStartMs: 0,
    speechEndMs: 1400,
    chars: line.text.split("").map((_, i) => ({ i, startMs: i * 100, endMs: (i + 1) * 100 })),
    aligned: true,
    spokenChars: line.text.length,
  };
  cacheKey = ttsKey(spoken, synced.settings.voice);
  cachePut(cacheKey, "tts", tts);
  const doc = { ...synced, shots: [blankShot("smoke-shot", line.id)] };
  const timeline = buildTimeline(doc, { tts: new Map([[line.id, tts]]), tracks: new Map(), media: (hash) => `/api/media/${hash}` }, "16:9");
  const out = await renderTimeline({ projectId: project.id, timeline, timelineHash: timelineHash(timeline), quality: "draft", signal: new AbortController().signal, current: () => true, progress: (p, message) => console.log(`${Math.round(p * 100)}% ${message}`) });
  console.log(`Smoke render OK: ${out.videoHash}`);
  } finally {
    const renderAssets = all<{ video_hash: string; srt_hash: string | null }>("SELECT video_hash, srt_hash FROM renders WHERE project_id = ?", project.id);
    for (const render of renderAssets) {
      for (const hash of [render.video_hash, render.srt_hash].filter((x): x is string => !!x)) {
        const row = all<{ ext: string }>("SELECT ext FROM assets WHERE hash = ?", hash)[0];
        if (row) await fs.rm(assetFile({ hash, ext: row.ext }), { force: true }).catch(() => undefined);
        run("DELETE FROM assets WHERE hash = ?", hash);
      }
    }
    if (cacheKey) run("DELETE FROM cache WHERE key = ?", cacheKey);
    run("DELETE FROM renders WHERE project_id = ?", project.id);
    run("DELETE FROM project_goals WHERE project_id = ?", project.id);
    run("DELETE FROM projects WHERE id = ?", project.id);
    if (assetHash) {
      const asset = { hash: assetHash, ext: "wav" as const };
      await fs.rm(assetFile(asset), { force: true }).catch(() => undefined);
      run("DELETE FROM assets WHERE hash = ?", assetHash);
    }
    await fs.rm("data/tmp", { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
