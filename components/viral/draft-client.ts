import { createEmptyDraft, hasMeaningfulInput, isTaskActive } from "@/lib/viral/state";
import { viralInputSchema } from "@/lib/viral/schemas";
import type { ViralApiError, ViralApiResponse, ViralDraft, ViralPatch } from "@/lib/viral/types";

export class ViralRequestError extends Error {
  constructor(public readonly detail: ViralApiError) { super(detail.message); }
}
export async function viralRequest<T>(url: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const envelope = await response.json() as ViralApiResponse<T>;
  if (!envelope.ok) throw new ViralRequestError(envelope.error);
  if (!response.ok) throw new Error(`请求失败（${response.status}）`);
  return envelope.data;
}
export type PendingViralPatch = Omit<ViralPatch, "expectedRevision">;
export type ViralContextPatch = { currentVersionId: string } | { restoreVersionId: string } | { adoptCandidateVersionId: string };
export type ViralDraftRequest = (url: string, body?: unknown, method?: string) => Promise<ViralDraft>;
export type ViralErrorOrigin = "save" | "command" | "action" | "load" | "poll" | "sync" | null;
export type ViralClientState = { draft: ViralDraft; saveState: "idle" | "saving" | "saved" | "error" | "conflict"; error: string; errorOrigin: ViralErrorOrigin; fieldErrors: Record<string, string>; preferencesReady: boolean };
export function restoredViewStage(draft: ViralDraft): "reference" | "angles" | "outline" | "script" {
  if (draft.currentVersionId) return "script";
  if (draft.outline) return "outline";
  if (draft.angles.length) return "angles";
  return "reference";
}

/** Unsaved preview stays outside the authoritative version ledger. Save responses may update revision, never newer edits. */
export function previewDraft(base: ViralDraft, pending: PendingViralPatch): ViralDraft {
  const draft = structuredClone(base);
  if (pending.input) draft.input = structuredClone(pending.input);
  if (pending.mode) draft.mode = pending.mode;
  if (pending.angles) draft.angles = structuredClone(pending.angles);
  if (pending.enabledMechanismIds && draft.analysis) draft.analysis.mechanisms = draft.analysis.mechanisms.map((item) => ({ ...item, enabled: pending.enabledMechanismIds!.includes(item.id) }));
  if (pending.selectedAngleId !== undefined) draft.selectedAngleId = pending.selectedAngleId;
  if (pending.outline !== undefined) draft.outline = structuredClone(pending.outline);
  if (pending.manualScript && draft.currentVersionId) {
    const version = draft.versions.find((item) => item.id === draft.currentVersionId);
    if (version) { version.title = pending.manualScript.title; version.segments = structuredClone(pending.manualScript.segments); version.manuallyEdited = true; draft.review = null; }
  }
  if (pending.currentVersionId) draft.currentVersionId = pending.currentVersionId;
  if (pending.issueResolutions) draft.issueResolutions = structuredClone(pending.issueResolutions);
  return draft;
}

/** One writer queue per mounted draft; reading/polling never launches a generation task. */
export class ViralDraftClient {
  private base: ViralDraft;
  private pending: PendingViralPatch = {};
  private savingPatch: PendingViralPatch | null = null;
  private inflight: Promise<ViralDraft | null> | null = null;
  private changingContext = false;
  private disposed = false;
  private listeners = new Set<(state: ViralClientState) => void>();
  private state: ViralClientState;
  constructor(private readonly options: { request?: ViralDraftRequest; onCreated?: (id: string) => void; onStash?: (draftId: string, pending: PendingViralPatch) => void }, draft = createEmptyDraft()) {
    this.base = draft;
    this.state = { draft, saveState: "idle", error: "", errorOrigin: null, fieldErrors: {}, preferencesReady: Boolean(draft.id) };
  }
  getState = () => this.state;
  setOnCreated(callback?: (id: string) => void) { this.options.onCreated = callback; }
  subscribe(listener: (state: ViralClientState) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(saveState = this.state.saveState, error = this.state.error, fieldErrors = this.state.fieldErrors, errorOrigin = error ? this.state.errorOrigin : null) {
    this.state = { draft: previewDraft(this.base, { ...this.savingPatch, ...this.pending }), saveState, error, errorOrigin, fieldErrors, preferencesReady: this.state.preferencesReady };
    if (!this.disposed) this.listeners.forEach((listener) => listener(this.state));
  }
  private publishSaveProgress(saveState: ViralClientState["saveState"]) {
    // An autosave is not a successful resubmission of a rejected command. Keep its field guidance until editing or retry.
    if (this.state.errorOrigin === "command") this.publish(saveState);
    else this.publish(saveState, "", {});
  }
  get dirty() { return Object.keys(this.pending).length > 0; }
  markPreferencesReady() { if (!this.state.preferencesReady) { this.state = { ...this.state, preferencesReady: true }; this.publish(); } }
  get busySaving() { return Boolean(this.inflight) || this.changingContext; }
  setError(error: unknown, origin: Exclude<ViralErrorOrigin, null> = "action") {
    const detail = error instanceof ViralRequestError ? error.detail : null;
    this.publish(origin === "save" && detail?.code === "conflict" ? "conflict" : this.state.saveState, error instanceof Error ? error.message : String(error), detail?.fields ?? {}, origin);
  }
  clearError() { this.publish(this.state.saveState, "", {}); }
  patch(patch: PendingViralPatch) {
    if (this.changingContext && Object.keys(patch).some((key) => key !== "mode")) return;
    if (isTaskActive(this.state.draft.task) && Object.keys(patch).some((key) => key !== "mode")) return;
    this.pending = { ...this.pending, ...structuredClone(patch) };
    this.options.onStash?.(this.base.id, { ...this.savingPatch, ...this.pending });
    this.publish(this.inflight ? "saving" : "idle", "", {});
  }
  accept(draft: ViralDraft) {
    if (this.base.id && draft.id !== this.base.id) return;
    if (draft.revision < this.base.revision) return;
    this.base = draft;
    this.publish(this.dirty ? "idle" : "saved");
  }
  async reload(id = this.base.id) {
    if (!id) return this.state.draft;
    const remote = await (this.options.request ?? viralRequest<ViralDraft>)(`/api/viral/${encodeURIComponent(id)}`);
    if (!this.disposed) this.accept(remote);
    return this.state.draft;
  }
  /** Finish edits against their original version before independently selecting another context. Failed actions are not autosaved later. */
  async changeContext(patch: ViralContextPatch): Promise<ViralDraft | null> {
    if (this.changingContext || isTaskActive(this.state.draft.task)) return null;
    this.changingContext = true;
    try {
      const saved = await this.flush();
      if (!saved?.id) return null;
      const next = await (this.options.request ?? viralRequest<ViralDraft>)(`/api/viral/${encodeURIComponent(saved.id)}`, { ...patch, expectedRevision: saved.revision }, "PATCH");
      this.accept(next);
      return this.state.draft;
    } finally { this.changingContext = false; }
  }
  async flush(): Promise<ViralDraft | null> {
    if (this.inflight) return this.inflight;
    const request = this.options.request ?? viralRequest<ViralDraft>;
    const run = async () => {
      while (this.dirty && !this.disposed) {
        const snapshot = this.pending;
        const preview = previewDraft(this.base, snapshot);
        if (!this.base.id && !hasMeaningfulInput(preview.input)) return null;
        const parsed = viralInputSchema.safeParse(preview.input);
        if (!parsed.success) {
          const fields: Record<string, string> = {};
          parsed.error.issues.forEach((issue) => { fields[String(issue.path[0] ?? "input")] = issue.message; });
          this.publish("error", "输入还未保存，请先处理字段提示", fields, "save");
          return null;
        }
        this.pending = {};
        this.savingPatch = snapshot;
        this.publishSaveProgress("saving");
        try {
          const created = !this.base.id;
          const saved = created
            ? await request("/api/viral", { input: preview.input, mode: preview.mode })
            : await request(`/api/viral/${encodeURIComponent(this.base.id)}`, { ...snapshot, expectedRevision: this.base.revision }, "PATCH");
          this.base = saved;
          this.savingPatch = null;
          this.options.onStash?.(saved.id, this.pending);
          if (created) this.options.onCreated?.(saved.id);
          this.publishSaveProgress(this.dirty ? "saving" : "saved");
        } catch (error) {
          // Newer local edits take precedence over the request snapshot that failed.
          this.pending = { ...snapshot, ...this.pending };
          this.savingPatch = null;
          this.options.onStash?.(this.base.id, this.pending);
          this.publish(error instanceof ViralRequestError && error.detail.code === "conflict" ? "conflict" : "error", error instanceof Error ? error.message : String(error), error instanceof ViralRequestError ? error.detail.fields ?? {} : {}, "save");
          return null;
        }
      }
      return this.state.draft;
    };
    this.inflight = run();
    try { return await this.inflight; } finally { this.inflight = null; }
  }
  dispose() { this.disposed = true; this.listeners.clear(); }
}
