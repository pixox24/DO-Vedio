import { describe, expect, it, vi } from "vitest";
import { ViralDraftClient, ViralRequestError, previewDraft, restoredViewStage, type PendingViralPatch, type ViralContextPatch } from "@/components/viral/draft-client";
import { applyDraftPatch, createEmptyDraft, defaultViralInput, snapshotDraft } from "@/lib/viral/state";
import type { ViralDraft, ViralPatch, ViralScriptVersion } from "@/lib/viral/types";

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function draftWithScript(): ViralDraft {
  const input = defaultViralInput(); input.referenceText = "参考"; input.topic = "主题";
  const draft = createEmptyDraft(input, "quick", "d1", "");
  const version: ViralScriptVersion = { id: "v1", revision: 1, title: "标题", segments: [{ id: "s1", title: "", text: "旧正文", materialIds: [] }], completedSegmentIds: ["s1"], complete: true, manuallyEdited: false, basedOn: snapshotDraft(draft), parentVersionId: null, origin: "generated", createdAt: "" };
  draft.versions = [version]; draft.currentVersionId = version.id;
  return draft;
}

describe("复创前端保存队列", () => {
  it.each(["select", "restore"] as const)("%s版本前先保存原稿与输入，再独立动作请求且屏幕不先切换", async (action) => {
    const initial = draftWithScript();
    const other = { ...structuredClone(initial.versions[0]), id: "v-history", title: "历史标题", segments: [{ ...initial.versions[0].segments[0], text: "历史正文不能被覆盖" }] };
    initial.versions.push(other);
    const switching = deferred<ViralDraft>();
    let remote = structuredClone(initial);
    const request = vi.fn(async (_url: string, body?: unknown) => {
      const patch = body as ViralPatch;
      remote = applyDraftPatch(remote, patch, { now: "", versionId: patch.manualScript ? "v-edit" : undefined });
      if (patch.currentVersionId || patch.restoreVersionId) return switching.promise;
      return remote;
    });
    const client = new ViralDraftClient({ request }, initial);
    client.patch({ input: { ...initial.input, topic: "未保存的新主题" }, manualScript: { title: "新手写标题", segments: [{ ...initial.versions[0].segments[0], text: "属于原稿的未保存编辑" }] } });
    const changing = client.changeContext(action === "select" ? { currentVersionId: other.id } : { restoreVersionId: other.id });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const edits = request.mock.calls[0][1] as ViralPatch;
    const context = request.mock.calls[1][1] as ViralPatch;
    expect(edits.manualScript?.segments[0].text).toBe("属于原稿的未保存编辑");
    expect(edits.input?.topic).toBe("未保存的新主题");
    expect(edits.currentVersionId).toBeUndefined(); expect(edits.restoreVersionId).toBeUndefined();
    expect(context.manualScript).toBeUndefined(); expect(context.input).toBeUndefined();
    expect(context.expectedRevision).toBe(1);
    expect(client.getState().draft.currentVersionId).toBe("v-edit");
    switching.resolve(remote); await changing;
    expect(client.getState().draft.currentVersionId).toBe(other.id);
    expect(client.getState().draft.versions.find((version) => version.id === other.id)?.segments[0].text).toBe("历史正文不能被覆盖");
    expect(client.getState().draft.versions.find((version) => version.id === "v-edit")?.parentVersionId).toBe("v1");
    expect(client.getState().draft.input.topic).toBe(action === "select" ? "未保存的新主题" : other.basedOn.input.topic);
  });
  it.each(["select", "restore", "candidate"] as const)("%s操作前保存失败不切换，也不把动作留下供自动保存重放", async (action) => {
    const initial = draftWithScript();
    const request = vi.fn<(url: string, body?: unknown) => Promise<ViralDraft>>().mockRejectedValue(new Error("保存失败"));
    const client = new ViralDraftClient({ request }, initial);
    client.patch({ manualScript: { title: "我的标题", segments: [{ ...initial.versions[0].segments[0], text: "未保存编辑" }] } });
    const patch: ViralContextPatch = action === "select" ? { currentVersionId: "other" } : action === "restore" ? { restoreVersionId: "other" } : { adoptCandidateVersionId: "candidate" };
    expect(await client.changeContext(patch)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(client.getState().draft.currentVersionId).toBe("v1");
    expect(client.getState().draft.versions[0].segments[0].text).toBe("未保存编辑");
    const payload = request.mock.calls[0][1] as ViralPatch;
    expect(payload.currentVersionId).toBeUndefined(); expect(payload.restoreVersionId).toBeUndefined(); expect(payload.adoptCandidateVersionId).toBeUndefined();
  });
  it("候选采用先保存较新手改，独立动作冲突后保留新稿且不自动重试旧候选", async () => {
    const initial = draftWithScript();
    initial.versions.push({ ...structuredClone(initial.versions[0]), id: "candidate", parentVersionId: "v1", origin: "rewrite" }); initial.candidateVersionId = "candidate";
    let remote = structuredClone(initial);
    const request = vi.fn(async (_url: string, body?: unknown) => {
      remote = applyDraftPatch(remote, body as ViralPatch, { now: "", versionId: "v-edit" });
      return remote;
    });
    const client = new ViralDraftClient({ request }, initial);
    client.patch({ manualScript: { title: "我的标题", segments: [{ ...initial.versions[0].segments[0], text: "候选生成后又手改" }] } });
    await expect(client.changeContext({ adoptCandidateVersionId: "candidate" })).rejects.toThrow("CANDIDATE_CONFLICT");
    expect(request).toHaveBeenCalledTimes(2);
    expect(client.getState().draft.currentVersionId).toBe("v-edit");
    expect(client.getState().draft.versions.find((version) => version.id === "v-edit")?.segments[0].text).toBe("候选生成后又手改");
    expect(client.dirty).toBe(false);
    await client.flush(); expect(request).toHaveBeenCalledTimes(2);
  });
  it("恢复时定位已有稿件与阶段，不重新启动生成", () => {
    const ready = draftWithScript(); expect(restoredViewStage(ready)).toBe("script");
    ready.currentVersionId = null;
    ready.outline = { id: "o1", sections: [], sourceFingerprint: "", createdAt: "" };
    expect(restoredViewStage(ready)).toBe("outline");
    ready.outline = null;
    expect(restoredViewStage(ready)).toBe("reference");
  });
  it("空白访问及仅设置偏好不会创建草稿/项目", async () => {
    const request = vi.fn(); const client = new ViralDraftClient({ request });
    expect(client.getState().preferencesReady).toBe(false);
    client.patch({ input: { ...defaultViralInput(), modelId: "user-model" } });
    client.markPreferencesReady();
    expect(await client.flush()).toBeNull(); expect(request).not.toHaveBeenCalled();
    expect(client.getState().preferencesReady).toBe(true);
  });
  it("新建响应晚于下一次输入时仅POST一次，继续保存新输入且不回滚屏幕", async () => {
    const first = deferred<ViralDraft>(); const created = vi.fn();
    let remote = createEmptyDraft(defaultViralInput(), "quick", "d1", "");
    const request = vi.fn(async (_url: string, body?: unknown): Promise<ViralDraft> => {
      const payload = body as { input?: ViralDraft["input"] } & ViralPatch;
      if (request.mock.calls.length === 1) { remote.input = payload.input!; return first.promise; }
      remote = applyDraftPatch(remote, payload, { now: "" }); return remote;
    });
    const client = new ViralDraftClient({ request, onCreated: created });
    client.patch({ input: { ...defaultViralInput(), referenceText: "第一版" } });
    const saving = client.flush();
    expect(client.getState().draft.input.referenceText).toBe("第一版");
    client.patch({ input: { ...client.getState().draft.input, referenceText: "更新后完整版" } });
    first.resolve(remote);
    await saving;
    expect(request.mock.calls.map((call) => call[0])).toEqual(["/api/viral", "/api/viral/d1"]);
    expect(created).toHaveBeenCalledExactlyOnceWith("d1");
    expect(client.getState().draft.input.referenceText).toBe("更新后完整版");
    expect(client.getState().saveState).toBe("saved");
  });
  it("保存失败保留请求期间手工改稿，恢复读取也不会抹去未保存正文", async () => {
    const first = deferred<ViralDraft>(); const initial = draftWithScript();
    const stash = vi.fn<(id: string, patch: PendingViralPatch) => void>();
    const request = vi.fn(async (url: string): Promise<ViralDraft> => url === "/api/viral/d1" && request.mock.calls.length > 1 ? { ...initial, revision: 4 } : first.promise);
    const client = new ViralDraftClient({ request, onStash: stash }, initial);
    client.patch({ manualScript: { title: "标题", segments: [{ ...initial.versions[0].segments[0], text: "第一段手写" }] } });
    const saving = client.flush();
    client.patch({ manualScript: { title: "我的标题", segments: [{ ...initial.versions[0].segments[0], text: "完整手写不可覆盖" }] } });
    first.reject(new Error("保存断网")); await saving;
    expect(client.getState().draft.versions[0].segments[0].text).toBe("完整手写不可覆盖");
    expect(client.getState().saveState).toBe("error");
    await client.reload();
    expect(client.getState().draft.revision).toBe(4);
    expect(client.getState().draft.versions[0].segments[0].text).toBe("完整手写不可覆盖");
    expect(client.dirty).toBe(true); expect(stash).toHaveBeenCalled();
  });
  it("冲突不覆盖本地输入，用户重试读取新revision后仅保存自己的字段", async () => {
    const initial = draftWithScript();
    let remote = { ...initial, revision: 3 };
    let calls = 0;
    const request = vi.fn(async (_url: string, body?: unknown): Promise<ViralDraft> => {
      if (!body) return remote;
      if (++calls === 1) throw new ViralRequestError({ code: "conflict", message: "已有新版", currentRevision: 3 });
      remote = applyDraftPatch(remote, body as ViralPatch, { now: "" }); return remote;
    });
    const client = new ViralDraftClient({ request }, initial);
    client.patch({ input: { ...initial.input, topic: "我的新主题" } });
    expect(await client.flush()).toBeNull(); expect(client.getState().saveState).toBe("conflict");
    expect(client.getState().draft.input.topic).toBe("我的新主题");
    await client.reload(); await client.flush();
    expect(remote.revision).toBe(4); expect(remote.input.topic).toBe("我的新主题");
  });
  it("超长参考完整保留且不发送部分输入", async () => {
    const request = vi.fn(); const client = new ViralDraftClient({ request });
    client.patch({ input: { ...defaultViralInput(), referenceText: "字".repeat(20_001) } });
    expect(await client.flush()).toBeNull(); expect(request).not.toHaveBeenCalled();
    expect(client.getState().draft.input.referenceText.length).toBe(20_001);
    expect(client.getState().fieldErrors).toHaveProperty("referenceText");
  });
  it("任务活动期间仅允许切换视图，不接受人工正文和主题写入", () => {
    const draft = draftWithScript();
    draft.task = { id: "t1", generation: 1, status: "running", command: "generate", plan: ["generation"], stage: "generation", completedStages: [], snapshot: { ...snapshotDraft(draft), command: "generate", modelId: "model", versionId: "v1", scriptFingerprint: null, rewrite: null }, workingVersionId: null, cancelRequested: false, error: null, createdAt: "", updatedAt: "" };
    const client = new ViralDraftClient({}, draft);
    client.patch({ input: { ...draft.input, topic: "不可写入" } });
    client.patch({ mode: "workbench" });
    expect(client.getState().draft.input.topic).toBe("主题");
    expect(client.getState().draft.mode).toBe("workbench");
    expect(client.getState().draft.task?.id).toBe("t1");
  });
  it("预览不修改权威版本ledger，也不宣称手改已按新主题生成", () => {
    const base = draftWithScript();
    const preview = previewDraft(base, { input: { ...base.input, topic: "新主题" }, manualScript: { title: "改标题", segments: [{ ...base.versions[0].segments[0], text: "新正文" }] } });
    expect(base.versions[0].segments[0].text).toBe("旧正文");
    expect(preview.versions[0].basedOn.input.topic).toBe("主题");
    expect(preview.versions[0].manuallyEdited).toBe(true);
  });
  it("命令冲突不伪装成保存冲突，自动保存的错误来源明确为保存", async () => {
    const client = new ViralDraftClient({}, draftWithScript());
    client.setError(new ViralRequestError({ code: "conflict", message: "命令版本冲突" }), "command");
    expect(client.getState().saveState).toBe("idle");
    expect(client.getState().errorOrigin).toBe("command");
    client.patch({ input: { ...client.getState().draft.input, referenceText: "字".repeat(20_001) } });
    await client.flush();
    expect(client.getState().saveState).toBe("error");
    expect(client.getState().errorOrigin).toBe("save");
  });
  it("背景保存成功不清除显式提交的字段错误，用户编辑后才清除", async () => {
    const initial = draftWithScript();
    const request = vi.fn(async (_url: string, payload?: unknown) => applyDraftPatch(initial, payload as ViralPatch, { now: "" }));
    const client = new ViralDraftClient({ request }, initial);
    client.patch({ input: { ...initial.input, topic: "" } });
    client.setError(new ViralRequestError({ code: "validation", message: "请先补充必要信息", fields: { topic: "请填写自己的主题" } }), "command");
    await client.flush();
    expect(client.getState().saveState).toBe("saved");
    expect(client.getState().fieldErrors).toEqual({ topic: "请填写自己的主题" });
    expect(client.getState().errorOrigin).toBe("command");
    client.patch({ input: { ...client.getState().draft.input, topic: "已补充" } });
    expect(client.getState().error).toBe("");
  });
});
