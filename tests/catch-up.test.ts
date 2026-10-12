import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evenChars } from "@/lib/core/align";
import { castSourceHash } from "@/lib/core/cast";
import { RENDER_OUTPUT_VERSION } from "@/lib/core/keys";
import { blankShot, stampShots } from "@/lib/core/shots";
import { emptyDoc, type Line } from "@/lib/core/types";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-catch-up-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("后台追成片", () => {
  it("配音还没好时不提交渲染", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { startCatchUp } = await import("@/lib/pipeline/catch-up");
    const doc = emptyDoc();
    doc.lines = [{ id: "a", segmentIndex: 0, text: "第一句话。", spans: [], keywords: [], locked: true }];
    const project = createProject(doc);
    expect(startCatchUp(project.id)).toMatchObject({ action: "skipped" });
  });

  it("只差成片时提交带标记的渲染，并只取消这一类任务", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { cachePut } = await import("@/lib/server/cache");
    const { run } = await import("@/lib/server/db");
    const { enqueue, getJob } = await import("@/lib/server/jobs");
    const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
    const { cancelCatchUp, startCatchUp } = await import("@/lib/pipeline/catch-up");
    const line: Line = { id: "a", segmentIndex: 0, text: "第一句话。", spans: [], keywords: [], locked: true };
    const doc = emptyDoc();
    doc.lines = [line];
    doc.segments = [{ title: "", text: line.text }];
    doc.shots = stampShots([{ ...blankShot("s1", "a"), locked: true }], doc.lines);
    doc.castAnalysis = { sourceHash: castSourceHash(doc), modes: [], skipped: [], issues: [] };
    const project = createProject(doc);
    for (const item of lineTtsKeys(project.doc, project.id)) {
      cachePut(item.key, "tts", { assetId: "a".repeat(64), durationMs: 1400, speechStartMs: 200, speechEndMs: 1200, chars: evenChars(line.text, 200, 1200), aligned: true, spokenChars: line.text.length });
    }
    run(
      "INSERT INTO renders (id, project_id, aspect, quality, timeline_hash, content_hash, animation_hash, video_hash, duration_ms, created_at, output_version, origin) VALUES (?, ?, '16:9', 'final', 'old', 'old', 'old', 'video', 1000, ?, ?, 'manual')",
      "render-old",
      project.id,
      Date.now(),
      RENDER_OUTPUT_VERSION,
    );
    const manual = enqueue({ projectId: project.id, stage: "render", key: `render:manual:${project.id}`, input: { projectId: project.id, aspect: "16:9", quality: "final" }, maxAttempts: 1 });
    const first = startCatchUp(project.id);
    expect(first.action).toBe("started");
    if (first.action !== "started") return;
    expect(first.jobs).toHaveLength(1);
    expect(getJob(first.jobs[0].id)?.input).toMatchObject({ catchUp: true, quality: "final" });
    expect(getJob(manual.id)?.status).toBe("queued");
    const again = startCatchUp(project.id);
    expect(again.action).toBe("running");
    expect(cancelCatchUp(project.id)).toBe(1);
    expect(getJob(first.jobs[0].id)?.status).toBe("canceled");
    expect(getJob(manual.id)?.status).toBe("queued");
  });
});
