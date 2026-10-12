"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { copy, download, useModels, useTemplates } from "@/lib/client";
import { pickTextModelId } from "@/lib/core/text-model";
import { estimateScriptDuration, selectPlatform, setAspectRatio, setTargetSeconds } from "@/lib/viral/duration";
import { viralExportFilename, viralMarkdown, viralPlainText } from "@/lib/viral/export";
import { assessAdoption, currentAdoption, currentVersion, currentVersionAdoption, getDraftInvalidation, hasMeaningfulInput, isTaskActive, latestAdoptionsByProject, makeStyleSnapshot, validateCommandInput } from "@/lib/viral/state";
import type { ViralCommand, ViralDraft, ViralInput, ViralMaterial, ViralMode, ViralSyncImpact } from "@/lib/viral/types";
import { ViralDraftClient, ViralRequestError, restoredViewStage, viralRequest, type PendingViralPatch, type ViralContextPatch, type ViralErrorOrigin } from "./draft-client";
import { canNavigateCreatedDraft, errorRecoveryKind, explicitCommandFocus, fieldViewStage } from "./interaction";
import { loadVerifiedViralMemes, selectViralMeme } from "./memes";
import { refreshViralSyncPreview } from "./sync-client";
import { readViralQuickFocus, storeViralQuickFocus, takeViralQuickFocus, VIRAL_QUICK_FOCUS_EVENT, VIRAL_QUICK_FOCUS_KEY } from "./quick-focus";
import type { ViralFocusRequest, ViralMemeCandidate, ViralViewStage, ViralWorkspaceViewProps } from "./view-props";
import { ViralWorkspaceView } from "./presentational/workspace-view";
import { VIRAL_REFERENCE_ENTRY_KEY } from "./entry";

const preferenceKey = "do-vedio:viral-preferences";
const stashKey = (id: string) => `do-vedio:viral-unsaved:${id || "new"}`;
const statusLabels = { analysis: "拆解中", angles: "构思角度", outline: "生成大纲", generation: "写稿中", review: "检查中" } as const;

type HandoffResponse = { draft: ViralDraft; projectId: string; url: string; reused: boolean };
export function ViralWorkspace({ draftId }: { draftId?: string }) {
  const [newSession, setNewSession] = useState(0);
  return <ViralWorkspaceSession key={`${draftId ?? "new"}:${newSession}`} draftId={newSession ? undefined : draftId} onNewSession={() => setNewSession((session) => session + 1)} />;
}
function ViralWorkspaceSession({ draftId, onNewSession }: { draftId?: string; onNewSession: () => void }) {
  const router = useRouter();
  const alive = useRef(true);
  const [client] = useState(() => new ViralDraftClient({
    onStash(id, pending) {
      try {
        if (Object.keys(pending).length) sessionStorage.setItem(stashKey(id), JSON.stringify(pending));
        else sessionStorage.removeItem(stashKey(id));
      } catch { /* The authoritative save status remains visible. */ }
    },
  }));
  const subscribe = useCallback((listener: () => void) => client.subscribe(() => listener()), [client]);
  const state = useSyncExternalStore(subscribe, client.getState, client.getState);
  const { draft } = state;
  const models = useModels();
  const { templates } = useTemplates();
  const [loading, setLoading] = useState(Boolean(draftId));
  const [createdDraftId, setCreatedDraftId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [recent, setRecent] = useState<ViralDraft[]>([]);
  const [viewStage, setViewStage] = useState<ViralViewStage>("reference");
  const [modeOverride, setModeOverride] = useState<ViralMode | null>(null);
  const [historyViewVersionId, setHistoryViewVersionId] = useState<string | null>(null);
  const [syncImpact, setSyncImpact] = useState<ViralSyncImpact | null>(null);
  const [syncRecoveryProjectId, setSyncRecoveryProjectId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<ViralFocusRequest | null>(null);
  const focusToken = useRef(0);
  const [failedCommand, setFailedCommand] = useState<{ command: ViralCommand; rewrite?: { segmentId: string; instruction: string }; reloadRequired: boolean; expectedTaskId?: string } | null>(null);
  const [memeCandidates, setMemeCandidates] = useState<ViralMemeCandidate[]>([]);
  const [memesLoading, setMemesLoading] = useState(true);
  const [memesError, setMemesError] = useState("");
  const [memeRefresh, setMemeRefresh] = useState(0);
  const pendingAdoption = useRef(false);
  const initializedPreferences = useRef(false);
  const taskId = draft.task?.id;
  const taskStatus = draft.task?.status;

  useEffect(() => {
    client.setOnCreated((id) => {
      // Publish only after the current explicit operation settles; replacing route segments can unmount this submit.
      setCreatedDraftId(id);
      try { sessionStorage.removeItem(stashKey("")); } catch { /* Saving still works without browser storage. */ }
    });
    return () => client.setOnCreated(undefined);
  }, [client]);

  useEffect(() => {
    alive.current = true;
    let active = true;
    const initialize = async () => {
      try {
        if (draftId) {
          const restored = await client.reload(draftId);
          if (active) setViewStage(restoredViewStage(restored));
          try { const mode = sessionStorage.getItem(`do-vedio:viral-view:${draftId}`); if (active && (mode === "quick" || mode === "workbench")) setModeOverride(mode); } catch { /* Saved mode applies. */ }
        }
        let stash: PendingViralPatch | null = null;
        try { const raw = sessionStorage.getItem(stashKey(draftId ?? "")); if (raw) stash = JSON.parse(raw); } catch { /* Fresh draft can proceed. */ }
        if (active && stash) client.patch(stash);
        if (!draftId) {
          try {
            const reference = sessionStorage.getItem(VIRAL_REFERENCE_ENTRY_KEY);
            if (reference !== null) { sessionStorage.removeItem(VIRAL_REFERENCE_ENTRY_KEY); client.patch({ input: { ...client.getState().draft.input, referenceText: reference } }); }
          } catch { /* Empty entry still works. */ }
        }
        const list = await viralRequest<ViralDraft[]>("/api/viral");
        if (active) setRecent(list);
      } catch (error) { if (active) client.setError(error, "load"); }
      finally { if (active) setLoading(false); }
    };
    void initialize();
    return () => { active = false; alive.current = false; };
  }, [client, draftId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadVerifiedViralMemes(controller.signal).then((candidates) => {
      if (!controller.signal.aborted) { setMemeCandidates(candidates); setMemesError(""); }
    }).catch((error) => {
      if (!controller.signal.aborted) setMemesError(error instanceof Error ? error.message : "热梗暂时未能读取");
    }).finally(() => { if (!controller.signal.aborted) setMemesLoading(false); });
    return () => controller.abort();
  }, [memeRefresh]);

  useEffect(() => {
    if (loading || !models || initializedPreferences.current) return;
    if (draftId) { initializedPreferences.current = true; client.markPreferencesReady(); return; }
    if (!templates.length) return;
    initializedPreferences.current = true;
    const input = client.getState().draft.input;
    let preferences: { modelId?: string; templateId?: string; humanize?: boolean } = {};
    try { preferences = JSON.parse(localStorage.getItem(preferenceKey) ?? "{}"); } catch { /* Default preferences apply. */ }
    const chosenTemplate = templates.find((item) => item.id === preferences.templateId) ?? templates.find((item) => item.id === input.style.templateId);
    const next = { ...input, modelId: input.modelId || pickTextModelId([preferences.modelId], models), style: chosenTemplate ? makeStyleSnapshot(chosenTemplate, new Date().toISOString()) : input.style, humanize: preferences.humanize ?? input.humanize };
    client.patch({ input: next });
    client.markPreferencesReady();
  }, [client, draftId, loading, models, templates]);

  const commandsReady = !loading && models !== null && state.preferencesReady;
  const navigationPending = canNavigateCreatedDraft(createdDraftId, busy, state, commandsReady, client.dirty);
  useEffect(() => {
    if (navigationPending && createdDraftId) router.replace(`/viral/${encodeURIComponent(createdDraftId)}`, { scroll: false });
  }, [createdDraftId, navigationPending, router]);

  // A single debounced writer drains edits in order. Leaving the page never stops the server task.
  useEffect(() => {
    if (loading || !client.dirty || state.saveState === "conflict" || state.saveState === "error") return;
    const timer = setTimeout(() => { void client.flush(); }, 700);
    const onHide = () => { void client.flush(); };
    window.addEventListener("pagehide", onHide);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", onHide); };
  }, [client, draft, loading, state.saveState]);

  useEffect(() => {
    if (!draft.id || !taskStatus || !["queued", "running", "stopping"].includes(taskStatus)) return;
    let active = true;
    const poll = async () => {
      if (client.dirty || client.busySaving) return;
      try {
        const refreshed = await viralRequest<ViralDraft>(`/api/viral/${encodeURIComponent(draft.id)}`);
        if (active) client.accept(refreshed);
      } catch (error) { if (active) client.setError(error, "poll"); }
    };
    const timer = setInterval(() => { void poll(); }, 1_000);
    return () => { active = false; clearInterval(timer); };
  }, [client, draft.id, taskId, taskStatus]);

  const withAction = useCallback(async (action: () => Promise<void>, options?: { origin?: Exclude<ViralErrorOrigin, null>; onError?: (error: unknown) => void }) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); client.clearError();
    try { await action(); } catch (error) { options?.onError?.(error); client.setError(error, options?.origin ?? "action"); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }, [client]);
  const requestFocus = useCallback((target: ViralFocusRequest["target"], field?: string) => {
    if (!alive.current) return;
    setFocusRequest({ token: ++focusToken.current, target, ...(field ? { field } : {}) });
    if (field) { const stage = fieldViewStage(field); if (stage) setViewStage(stage); }
  }, []);
  useEffect(() => {
    if (!draftId) return;
    let active = true;
    const consume = async () => {
      try {
        if (!active || window.location.pathname !== `/viral/${encodeURIComponent(draftId)}`) return;
        const intent = readViralQuickFocus(sessionStorage, draftId);
        if (!intent) return;
        const refreshed = await client.reload(draftId);
        if (active && takeViralQuickFocus(sessionStorage, draftId, intent.taskId) && refreshed.task?.id === intent.taskId) { setViewStage("script"); requestFocus("result"); }
      } catch (error) { if (active) client.setError(error, "load"); }
    };
    window.addEventListener(VIRAL_QUICK_FOCUS_EVENT, consume);
    void consume();
    return () => { active = false; window.removeEventListener(VIRAL_QUICK_FOCUS_EVENT, consume); };
  }, [client, draftId, requestFocus]);
  const commandFocus = useCallback((requested: ViralCommand, fields: Record<string, string>) => {
    const focus = explicitCommandFocus(requested, modeOverride ?? client.getState().draft.mode, fields, 0);
    if (focus) requestFocus(focus.target, focus.field);
  }, [client, modeOverride, requestFocus]);
  const patchInput = useCallback((patch: Partial<ViralInput>) => {
    const next = { ...client.getState().draft.input, ...patch };
    client.patch({ input: next });
    if (patch.modelId !== undefined || patch.style || patch.humanize !== undefined) {
      try { localStorage.setItem(preferenceKey, JSON.stringify({ modelId: next.modelId, templateId: next.style.templateId, humanize: next.humanize })); } catch { /* Preferences are optional. */ }
    }
  }, [client]);
  const command = useCallback((requested: ViralCommand, rewrite?: { segmentId: string; instruction: string }, reloadRequired = false, expectedTaskIdOverride?: string) => {
    // Capture the clicked task before any reload/flush; a retry must not silently stop its replacement.
    const expectedTaskId = requested === "stop" ? expectedTaskIdOverride ?? client.getState().draft.task?.id : undefined;
    void withAction(async () => {
      if (requested === "stop" && !expectedTaskId) return;
      if (requested !== "stop" && requested !== "resume" && !commandsReady) throw new ViralRequestError({ code: "validation", message: "模型与默认设置正在读取，请稍后再提交", fields: { modelId: "默认设置准备完成后再提交" } });
      const carryNewQuickFocus = !draftId && requested === "quick" && (modeOverride ?? client.getState().draft.mode) === "quick";
      if (reloadRequired) await client.reload();
      if (requested !== "stop" && requested !== "resume") {
        const input = client.getState().draft.input;
        const fields = validateCommandInput(input, requested);
        if (models && !models.some((item) => item.id === input.modelId)) fields.modelId = "所选文字模型不可用，请在模型中心配置或选择其他模型";
        if (Object.keys(fields).length) throw new ViralRequestError({ code: "validation", message: "请先补充必要信息", fields });
      }
      const saved = await client.flush();
      if (!saved?.id) { const fields = client.getState().fieldErrors; if (Object.keys(fields).length) commandFocus(requested, fields); return; }
      const next = await viralRequest<ViralDraft>(`/api/viral/${encodeURIComponent(saved.id)}/commands`, { expectedRevision: saved.revision, command: requested, ...(expectedTaskId ? { expectedTaskId } : {}), ...(rewrite ? { rewrite } : {}) });
      setFailedCommand(null);
      client.accept(next);
      if (requested !== "stop") setViewStage(requested === "analyze" ? "reference" : requested === "angles" ? "angles" : requested === "outline" ? "outline" : requested === "review" ? "review" : "script");
      if (carryNewQuickFocus && next.task) {
        const destination = `/viral/${encodeURIComponent(saved.id)}`;
        if (window.location.pathname === "/viral" || window.location.pathname === destination) {
          try {
            storeViralQuickFocus(sessionStorage, { draftId: saved.id, taskId: next.task.id });
            window.dispatchEvent(new Event(VIRAL_QUICK_FOCUS_EVENT));
          } catch { if (alive.current) commandFocus(requested, {}); }
        }
      } else commandFocus(requested, {});
    }, { origin: "command", onError: (error) => {
      setFailedCommand({ command: requested, rewrite, expectedTaskId, reloadRequired: error instanceof ViralRequestError && error.detail.code === "conflict" });
      const fields = error instanceof ViralRequestError ? error.detail.fields ?? {} : {};
      if (Object.keys(fields).length) commandFocus(requested, fields);
    } });
  }, [client, commandFocus, commandsReady, draftId, modeOverride, models, withAction]);
  const flushPatch = useCallback((patch: PendingViralPatch) => {
    client.patch(patch);
    void withAction(async () => { await client.flush(); });
  }, [client, withAction]);
  const changeContext = useCallback((patch: ViralContextPatch) => {
    void withAction(async () => {
      if (await client.changeContext(patch)) { setSyncImpact(null); setSyncRecoveryProjectId(null); }
    });
  }, [client, withAction]);

  const continueAdoption = useCallback(async (saved: ViralDraft) => {
    const assessment = assessAdoption(saved);
    if (assessment.reviewRequired) {
      const next = await viralRequest<ViralDraft>(`/api/viral/${encodeURIComponent(saved.id)}/commands`, { expectedRevision: saved.revision, command: "review" });
      pendingAdoption.current = true;
      client.accept(next);
      setViewStage("review");
      return;
    }
    if (!assessment.allowed) throw new ViralRequestError({ code: assessment.code === "locked" ? "locked" : assessment.code === "stale" ? "stale" : "needs_changes", message: assessment.reasons.join("；") });
    const sameVersionLink = currentVersionAdoption(saved);
    const linked = !sameVersionLink ? latestAdoptionsByProject(saved)[0] : null;
    if (linked) {
      const impact = await viralRequest<ViralSyncImpact>(`/api/viral/${encodeURIComponent(saved.id)}/sync?projectId=${encodeURIComponent(linked.projectId)}`);
      setSyncImpact(impact);
      setSyncRecoveryProjectId(null);
      requestFocus("sync");
      return;
    }
    const version = currentVersion(saved)!;
    const response = await viralRequest<HandoffResponse>(`/api/viral/${encodeURIComponent(saved.id)}/adopt`, { expectedRevision: saved.revision, versionId: version.id, settingsVersion: saved.input.handoff.settingsVersion });
    client.accept(response.draft);
    router.push(response.url);
  }, [client, requestFocus, router]);
  const adopt = useCallback(() => {
    void withAction(async () => {
      const saved = await client.flush();
      if (!saved?.id) return;
      await continueAdoption(saved);
    });
  }, [client, continueAdoption, withAction]);

  useEffect(() => {
    if (!pendingAdoption.current || !taskStatus || ["queued", "running", "stopping"].includes(taskStatus)) return;
    pendingAdoption.current = false;
    if (taskStatus !== "completed") return;
    void withAction(async () => { const saved = await client.flush(); if (saved) await continueAdoption(saved); });
  }, [client, continueAdoption, taskStatus, withAction]);

  const refreshSync = useCallback(() => {
    const projectId = syncRecoveryProjectId ?? syncImpact?.projectId;
    if (!projectId) return;
    void withAction(async () => {
      const impact = await refreshViralSyncPreview(client, projectId);
      if (impact) { setSyncImpact(impact); setSyncRecoveryProjectId(null); requestFocus("sync"); }
    }, { origin: "sync", onError: () => { setSyncImpact(null); setSyncRecoveryProjectId(projectId); } });
  }, [client, requestFocus, syncImpact, syncRecoveryProjectId, withAction]);

  const viewingHistory = isTaskActive(draft.task) && historyViewVersionId;
  const version = viewingHistory ? draft.versions.find((item) => item.id === historyViewVersionId) ?? currentVersion(draft) : currentVersion(draft);
  const assessment = assessAdoption(draft);
  const invalidation = getDraftInvalidation(draft);
  const existing = currentAdoption(draft);
  const sameVersionLink = currentVersionAdoption(draft);
  const differentVersionLink = !sameVersionLink && latestAdoptionsByProject(draft).length > 0;
  const adoptionLabel = existing ? "打开视频制作" : sameVersionLink ? "更新制作设置并打开" : differentVersionLink ? "同步新版文案" : assessment.reviewRequired ? "检查并进入视频制作" : "采用并进入视频制作";
  const locked = isTaskActive(draft.task);
  const statusText = locked ? draft.task?.status === "queued" ? "等待开始" : draft.task?.status === "stopping" ? "正在停止" : draft.task?.stage ? statusLabels[draft.task.stage] : "等待开始" : draft.task?.status === "failed" ? `失败：${draft.task.error?.message ?? "请重试"}` : draft.task?.status === "stopped" ? "已停止" : draft.task?.status === "needs_changes" ? "需要修改" : draft.task?.status === "completed" ? "已完成" : "等待开始";
  const retrySave = () => { void withAction(async () => { if (client.getState().saveState === "conflict") await client.reload(); await client.flush(); }); };
  const reloadDraft = () => { void withAction(async () => { await client.reload(); const list = await viralRequest<ViralDraft[]>("/api/viral"); if (alive.current) setRecent(list); }, { origin: "load" }); };
  const recovery = errorRecoveryKind(state, draft.task?.status === "failed", Boolean(failedCommand));
  const errorRecoveryLabel = recovery === "save" ? "重试保存" : recovery === "resume" ? "从失败步骤继续" : recovery === "command" ? "重试本次操作" : recovery === "sync" ? "重新查看同步影响" : recovery === "reload" ? "重新读取草稿" : null;
  const onErrorRecovery = recovery === "save" ? retrySave : recovery === "resume" ? () => command("resume") : recovery === "sync" ? refreshSync : recovery === "reload" ? reloadDraft : recovery === "command" && failedCommand ? () => command(failedCommand.command, failedCommand.rewrite, failedCommand.reloadRequired, failedCommand.expectedTaskId) : null;

  const props: ViralWorkspaceViewProps = {
    draft: modeOverride ? { ...draft, mode: modeOverride } : draft, version, candidate: draft.versions.find((item) => item.id === draft.candidateVersionId) ?? null,
    recentDrafts: recent.map((item) => ({ id: item.id, title: item.input.topic || item.input.referenceTitle || "未命名复创", updatedAt: item.updatedAt, running: isTaskActive(item.task) })),
    models: models ?? [], modelsLoading: models === null, commandsReady, templates, loading, busy: busy || navigationPending || leaving, locked, saveState: state.saveState, error: state.error || (draft.task?.status === "failed" ? draft.task.error?.message ?? "任务执行失败" : ""), errorRecoveryLabel, onErrorRecovery, fieldErrors: state.fieldErrors, focusRequest, memeCandidates, memesLoading, memesError, statusText, viewStage, staleReasons: invalidation.earliestStage && invalidation.earliestStage !== "review" ? invalidation.reasons : [], assessment, estimate: version ? estimateScriptDuration(version, draft.input) : null, adoptionLabel,
    adoptionDisabled: busy || navigationPending || leaving || locked || !version || (!assessment.allowed && !assessment.reviewRequired), syncImpact,
    onInputPatch: patchInput,
    onPlatform: (platform) => patchInput(selectPlatform(client.getState().draft.input, platform)),
    onDuration: (seconds) => patchInput(setTargetSeconds(client.getState().draft.input, seconds)),
    onAspectRatio: (ratio) => patchInput(setAspectRatio(client.getState().draft.input, ratio)),
    onTemplate: (templateId) => { const template = templates.find((item) => item.id === templateId); if (template) patchInput({ style: makeStyleSnapshot(template, new Date().toISOString()) }); },
    onMeme: (id, selected) => { if (!isTaskActive(client.getState().draft.task)) patchInput({ memes: selectViralMeme(client.getState().draft.input.memes, memeCandidates, id, selected) }); },
    onReloadMemes: () => { setMemesLoading(true); setMemeRefresh((value) => value + 1); },
    onMaterialsText: (text) => {
      const current = client.getState().draft.input.materials;
      if (current.length > 1) { client.setError(new Error("本期有多条带来源的素材，请到工作台逐条编辑")); return; }
      const material = current[0] ?? { id: crypto.randomUUID(), text: "", kind: "point" as const, source: "用户提供", verification: "user_provided" as const };
      patchInput({ materials: text ? [{ ...material, text }] : [] });
    },
    onMaterial: (index, patch) => patchInput({ materials: client.getState().draft.input.materials.map((item, i) => i === index ? { ...item, ...patch } : item) }),
    onAddMaterial: () => patchInput({ materials: [...client.getState().draft.input.materials, { id: crypto.randomUUID(), text: "", kind: "point", source: "用户提供", verification: "user_provided" } satisfies ViralMaterial] }),
    onRemoveMaterial: (index) => patchInput({ materials: client.getState().draft.input.materials.filter((_, i) => i !== index) }),
    onMode: (mode) => { setModeOverride(mode); try { const id = client.getState().draft.id; if (id) sessionStorage.setItem(`do-vedio:viral-view:${id}`, mode); } catch {} if (!isTaskActive(client.getState().draft.task)) client.patch({ mode }); }, onStage: setViewStage, onCommand: command,
    onSelectAngle: (selectedAngleId) => client.patch({ selectedAngleId }),
    onMechanism: (id, enabled) => client.patch({ enabledMechanismIds: (client.getState().draft.analysis?.mechanisms ?? []).filter((item) => item.id === id ? enabled : item.enabled).map((item) => item.id) }),
    onAngle: (angle) => client.patch({ angles: client.getState().draft.angles.map((item) => item.id === angle.id ? angle : item) }),
    onOutline: (outline) => client.patch({ outline }), onScript: (manualScript) => client.patch({ manualScript }),
    onSelectVersion: (currentVersionId) => { if (isTaskActive(client.getState().draft.task)) setHistoryViewVersionId(currentVersionId); else changeContext({ currentVersionId }); }, onRestoreVersion: (restoreVersionId) => changeContext({ restoreVersionId }),
    onAdoptCandidate: () => { const id = client.getState().draft.candidateVersionId; if (id) changeContext({ adoptCandidateVersionId: id }); },
    onResolveIssue: (issueId, action, note, materialIds) => flushPatch({ issueResolutions: [...client.getState().draft.issueResolutions.filter((item) => item.issueId !== issueId), { issueId, action, note, materialIds }] }),
    onAdopt: adopt,
    onSync: (strategy) => {
      void withAction(async () => {
        const saved = await client.flush(); if (!saved || !syncImpact) return;
        const current = currentVersion(saved); if (!current) return;
        const validation = assessAdoption(saved);
        if (!validation.allowed) { await continueAdoption(saved); return; }
        const response = await viralRequest<HandoffResponse>(`/api/viral/${encodeURIComponent(saved.id)}/sync`, { expectedRevision: saved.revision, versionId: current.id, settingsVersion: saved.input.handoff.settingsVersion, projectId: syncImpact.projectId, strategy, expectedProjectScript: syncImpact.projectScript });
        client.accept(response.draft); router.push(response.url);
      }, { origin: "sync", onError: () => { if (syncImpact) { setSyncRecoveryProjectId(syncImpact.projectId); setSyncImpact(null); } } });
    },
    onCancelSync: () => { setSyncImpact(null); setSyncRecoveryProjectId(null); },
    onCopy: () => { if (version) void copy(viralPlainText(version)).catch((error) => client.setError(error)); },
    onExport: () => { if (version) download(viralExportFilename(version), viralMarkdown(version)); },
    onSave: retrySave,
    onReload: reloadDraft,
    onNew: () => { void withAction(async () => { if (client.dirty && hasMeaningfulInput(client.getState().draft.input) && !await client.flush()) return; try { sessionStorage.removeItem(stashKey("")); sessionStorage.removeItem(VIRAL_REFERENCE_ENTRY_KEY); sessionStorage.removeItem(VIRAL_QUICK_FOCUS_KEY); } catch {} if (window.location.pathname === "/viral") onNewSession(); else { setLeaving(true); router.push("/viral"); } }); },
    onOpenDraft: (id) => { void withAction(async () => { if (client.dirty && hasMeaningfulInput(client.getState().draft.input) && !await client.flush()) return; try { sessionStorage.removeItem(VIRAL_QUICK_FOCUS_KEY); } catch {} router.push(`/viral/${encodeURIComponent(id)}`); }); },
  };
  return <ViralWorkspaceView {...props} />;
}
