import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AutoDlClient, autoDlInput, generateAutoDlMedia } from "./autodl";
import type { MediaRequest } from "../../pipeline/media-gen";
import { all, closeDb, run } from "../../server/db";
import { findMediaRecoveryRun, findOriginalMediaAttempt } from "../runs";

vi.mock("../../server/ffmpeg", () => ({ probe: vi.fn(async () => ({ hasVideo: true, durationMs: 3000, width: 768, height: 432, fps: 24 })) }));
const uri = async () => "data:image/png;base64,cGljdHVyZQ==";
const client = () => new AutoDlClient({ token: "test-token", baseUrl: "https://autodl.test", pollMs: 0 });
const request = (shotId: string): MediaRequest => ({ kind: "video", modelId: "autodl::minimax_h3_zm_u08", prompt: "[reference generation] single shot", references: ["ref-main", "ref-person"], targetDurationMs: 2900, requestDurationSeconds: 3, resolution: "480p", frame: { aspect: "16:9", width: 1920, height: 1080, fps: 30 }, meta: { shotId }, recovery: { projectId: "p", jobId: "j", attemptId: `${shotId}-attempt`, requestHash: `${shotId}-hash`, candidateIndex: 0 } });
const envelope = (data: unknown) => new Response(JSON.stringify({ code: "Success", data }), { headers: { "content-type": "application/json" } });
const submitted = () => envelope({ task_id: "remote-1", status: "QUEUED" });
const completed = (url = "https://cdn.test/video.mp4") => envelope({ status: "SUCCESS", duration: 50000, results: [{ type: "video", file_type: "mp4", output_type: "output", url }] });
const mp4 = () => new Response(Buffer.from("0000ftypisom0000testvideo"));
let dir: string;
let previousDataDir: string | undefined;
beforeAll(() => { previousDataDir = process.env.DATA_DIR; dir = mkdtempSync(path.join(tmpdir(), "dovedio-autodl-")); process.env.DATA_DIR = dir; });
afterEach(() => { vi.unstubAllGlobals(); run("DELETE FROM model_profiles WHERE provider_id = 'autodl'"); });
afterAll(() => { closeDb(); if (previousDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDataDir; rmSync(dir, { recursive: true, force: true }); });

describe("AutoDL recovery", () => {
  it("submits supported fields with raw token, persists task before callbacks, probes video and keeps unknown cost", async () => {
    const req = request("success");
    const states: string[] = [];
    req.onRecovery = (state) => {
      states.push(state.phase);
      const stored = findMediaRecoveryRun(req.recovery!)!;
      expect(stored.params.phase).toBe(state.phase);
      if (state.providerTaskId) expect(stored.params.taskId).toBe("remote-1");
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(submitted()).mockResolvedValueOnce(completed()).mockResolvedValueOnce(mp4());
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateAutoDlMedia(req, new AbortController().signal, uri, client());
    expect(result.assets).toHaveLength(1);
    expect(states).toEqual(["submitting", "polling", "downloading", "ready"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://autodl.test/comfyui_workflow/minimax_h3_zm_u08");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("test-token");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ prompt: req.prompt, duration: 3, resolution: "480p横", ref_image_0: await uri(), ref_image_1: await uri() });
    const record = findOriginalMediaAttempt({ projectId: "p", shotId: "success", requestHash: "success-hash" })!;
    expect(record.params.costStatus).toBe("unknown");
    expect(record.outputAssets).toEqual(result.assets);
    expect(all("SELECT * FROM ledger WHERE project_id = 'p'")).toHaveLength(0);
    const asset = (await import("../../server/media")).getAsset(result.assets[0])!;
    expect(asset.durationMs).toBe(3000);
    expect(asset.meta.fps).toBe(24);
    fetchMock.mockClear();
    expect(await generateAutoDlMedia({ ...req, recovery: { ...req.recovery!, jobId: "new-job" } }, new AbortController().signal, uri, client())).toEqual(result);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cross-job/new-goal retries download only the original task, including expired URL refresh", async () => {
    const req = request("download");
    const fetchMock = vi.fn().mockResolvedValueOnce(submitted()).mockResolvedValueOnce(completed()).mockResolvedValueOnce(new Response("broken", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateAutoDlMedia(req, new AbortController().signal, uri, client())).rejects.toThrow("502");
    fetchMock.mockClear().mockResolvedValueOnce(completed("https://cdn.test/old.mp4")).mockResolvedValueOnce(new Response("expired", { status: 403 })).mockResolvedValueOnce(completed("https://cdn.test/fresh.mp4")).mockResolvedValueOnce(mp4());
    // Even a new attempt/job cannot bypass the existing unresolved same snapshot.
    const result = await generateAutoDlMedia({ ...req, recovery: { ...req.recovery!, jobId: "j-new-goal", attemptId: "different-attempt" } }, new AbortController().signal, uri, client());
    expect(result.runId).toBe(findMediaRecoveryRun(req.recovery!)!.id);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method ?? "DOWNLOAD")).toEqual(["GET", "DOWNLOAD", "GET", "DOWNLOAD"]);
    expect(fetchMock.mock.calls[2][0]).toBe("https://autodl.test/comfyui_workflow/result/remote-1");
  });

  it("network submission uncertainty and missing task ID cannot cause another POST across jobs or attempts", async () => {
    for (const shot of ["unknown", "no-id"]) {
      const req = request(shot);
      const fetchMock = shot === "unknown" ? vi.fn().mockRejectedValueOnce(new Error("connection reset")) : vi.fn().mockResolvedValueOnce(envelope({ status: "QUEUED" }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(generateAutoDlMedia(req, new AbortController().signal, uri, client())).rejects.toMatchObject({ code: "submission-unknown" });
      expect(findMediaRecoveryRun(req.recovery!)!.params).toMatchObject({ submissionStarted: true, phase: "submission-unknown", costStatus: "unknown" });
      await expect(generateAutoDlMedia({ ...req, recovery: { ...req.recovery!, jobId: "next", attemptId: "next" } }, new AbortController().signal, uri, client())).rejects.toMatchObject({ code: "submission-unknown" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("only explicit regenerate with a fresh attempt allows a new submission after unknown", async () => {
    const req = request("regenerate");
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("submission response lost"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateAutoDlMedia(req, new AbortController().signal, uri, client())).rejects.toMatchObject({ code: "submission-unknown" });
    fetchMock.mockClear().mockResolvedValueOnce(submitted()).mockResolvedValueOnce(completed()).mockResolvedValueOnce(mp4());
    const replacement = { ...req, recovery: { ...req.recovery!, attemptId: "explicit-regeneration", allowNewAttempt: true } };
    const result = await generateAutoDlMedia(replacement, new AbortController().signal, uri, client());
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(result.runId).not.toBe(findMediaRecoveryRun(req.recovery!)!.id);
  });

  it("atomic acquisition prevents two workers posting the same candidate", async () => {
    const req = request("concurrent");
    const fetchMock = vi.fn().mockResolvedValueOnce(submitted()).mockResolvedValueOnce(completed()).mockResolvedValueOnce(mp4());
    vi.stubGlobal("fetch", fetchMock);
    const results = await Promise.allSettled([
      generateAutoDlMedia(req, new AbortController().signal, uri, client()),
      generateAutoDlMedia({ ...req, recovery: { ...req.recovery!, jobId: "parallel-job" } }, new AbortController().signal, uri, client()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });

  it("keeps querying a known queued/running task after 15 minutes without another submission", async () => {
    let now = 0;
    const time = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const fetchMock = vi.fn()
        .mockImplementationOnce(async () => { now = 16 * 60_000; return envelope({ status: "QUEUED" }); })
        .mockResolvedValueOnce(envelope({ status: "RUNNING" }))
        .mockResolvedValueOnce(completed());
      vi.stubGlobal("fetch", fetchMock);
      await expect(client().output("original-long-task", new AbortController().signal)).resolves.toBe("https://cdn.test/video.mp4");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls.every((call) => call[1]?.method === "GET")).toBe(true);
    } finally { time.mockRestore(); }
  });

  it("retains explicit rejection and bounds polling unknown remote statuses", async () => {
    const req = request("rejected");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("quota", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateAutoDlMedia(req, new AbortController().signal, uri, client())).rejects.toThrow("429");
    expect(findMediaRecoveryRun(req.recovery!)!.params).toMatchObject({ submissionRejected: true, phase: "failed" });
    await expect(generateAutoDlMedia(req, new AbortController().signal, uri, client())).rejects.toThrow("429");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear().mockImplementation(async () => envelope({ status: "UNRECOGNIZED" }));
    await expect(client().output("remote-unknown", new AbortController().signal)).rejects.toMatchObject({ code: "unknown-status" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects oversized streams before collecting the body", async () => {
    const req = request("oversized");
    const fetchMock = vi.fn().mockResolvedValueOnce(submitted()).mockResolvedValueOnce(completed()).mockResolvedValueOnce(new Response("video", { headers: { "content-length": String(201 * 1024 * 1024) } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateAutoDlMedia(req, new AbortController().signal, uri, client())).rejects.toThrow("200MB");
    expect(findMediaRecoveryRun(req.recovery!)!.params.taskId).toBe("remote-1");
  });

  it("local abort retains remote task and resume queries it without remote cancel", async () => {
    const req = request("abort");
    const controller = new AbortController();
    req.onRecovery = (state) => { if (state.phase === "polling") controller.abort(new DOMException("stop locally", "AbortError")); };
    const fetchMock = vi.fn().mockResolvedValueOnce(submitted());
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateAutoDlMedia(req, controller.signal, uri, client())).rejects.toMatchObject({ name: "AbortError" });
    expect(findMediaRecoveryRun(req.recovery!)!.params).toMatchObject({ taskId: "remote-1", phase: "canceled" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear().mockResolvedValueOnce(completed()).mockResolvedValueOnce(mp4());
    await generateAutoDlMedia({ ...req, onRecovery: undefined, recovery: { ...req.recovery!, jobId: "resume" } }, new AbortController().signal, uri, client());
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it("records known unit price once even when downloading needs resume", async () => {
    run("INSERT INTO model_profiles (provider_id, model_id, price, updated_at) VALUES ('autodl', 'minimax_h3_zm_u08', ?, ?)", JSON.stringify({ perSecond: 0.1, verified: false }), Date.now());
    const req = request("priced");
    const fetchMock = vi.fn().mockResolvedValueOnce(submitted()).mockResolvedValueOnce(completed()).mockResolvedValueOnce(new Response("broken", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateAutoDlMedia(req, new AbortController().signal, uri, client())).rejects.toThrow();
    fetchMock.mockClear().mockResolvedValueOnce(completed()).mockResolvedValueOnce(mp4());
    await generateAutoDlMedia(req, new AbortController().signal, uri, client());
    const record = findMediaRecoveryRun(req.recovery!)!;
    expect(record.params.costStatus).toBe("estimated");
    expect(record.cost_yuan).toBeCloseTo(0.3);
    expect(all("SELECT * FROM ledger WHERE id = ?", record.ledger_id)).toHaveLength(1);
  });

  it("remote failure is retained and never automatically reposted", async () => {
    const req = request("remote-failure");
    const fetchMock = vi.fn().mockResolvedValueOnce(submitted()).mockResolvedValueOnce(envelope({ status: "FAILED" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateAutoDlMedia(req, new AbortController().signal, uri, client())).rejects.toThrow("FAILED");
    await expect(generateAutoDlMedia(req, new AbortController().signal, uri, client())).rejects.toThrow("FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(findMediaRecoveryRun(req.recovery!)!.params.remoteTerminal).toBe(true);
  });

  it("enforces duration, required reference, MIME and measured short duration", async () => {
    const req = request("validation");
    expect(() => autoDlInput({ ...req, requestDurationSeconds: 16 }, ["ref"])).toThrow("1–15");
    expect(() => autoDlInput(req, [])).toThrow("1–9");
    expect(autoDlInput({ ...req, frame: { ...req.frame!, aspect: "9:16" }, resolution: "768p" }, ["ref"]).resolution).toBe("768p竖");
    const fetchMock = vi.fn().mockResolvedValueOnce(submitted()).mockResolvedValueOnce(completed()).mockResolvedValueOnce(new Response("not mp4"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateAutoDlMedia(req, new AbortController().signal, uri, client())).rejects.toThrow("不是 MP4");
    const short = request("short"); short.targetDurationMs = 4000; short.requestDurationSeconds = 4;
    fetchMock.mockClear().mockResolvedValueOnce(submitted()).mockResolvedValueOnce(completed()).mockResolvedValueOnce(mp4());
    await expect(generateAutoDlMedia(short, new AbortController().signal, uri, client())).rejects.toThrow("不足目标");
  });
});
