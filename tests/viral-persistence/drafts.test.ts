import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, run, tx } from "../../lib/server/db";
import { updateDraft } from "../../lib/server/viral/drafts";
import { createDraft, getDraft, listDrafts, putDraftWithinTx, requireDraft, sourceByProject, writeAdoptionMappingWithinTx } from "../../lib/server/viral/repository";
import { currentVersion, defaultViralInput, handoffSettings } from "../../lib/viral/state";
import { snapshotDraft } from "../../lib/viral/invalidation";
import type { ViralScriptVersion } from "../../lib/viral/types";

const directory = mkdtempSync(path.join(tmpdir(), "dovedio-viral-drafts-"));
const oldDataDir = process.env.DATA_DIR;
beforeAll(() => { process.env.DATA_DIR = directory; });
afterAll(() => {
  closeDb();
  rmSync(directory, { recursive: true, force: true });
  if (oldDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = oldDataDir;
});

function makeDraft() {
  return createDraft({ ...defaultViralInput(), referenceText: "参考稿只是讲清楚一个问题。", topic: "自己的任务", platform: "douyin" });
}

describe("复创草稿持久化", () => {
  it("空访问不落库，保存后重开连接恢复完整输入，旧revision不能覆盖", () => {
    const before = listDrafts().length;
    expect(() => createDraft(defaultViralInput())).toThrow(/填写/);
    expect(listDrafts()).toHaveLength(before);
    const draft = makeDraft();
    const next = updateDraft(draft.id, { expectedRevision: draft.revision, input: { ...draft.input, topic: "新的任务" } });
    expect(next.revision).toBe(draft.revision + 1);
    expect(next.inputHistory).toHaveLength(1);
    expect(() => updateDraft(draft.id, { expectedRevision: draft.revision, input: draft.input })).toThrow(/已有更新/);
    closeDb();
    expect(getDraft(draft.id)?.input.topic).toBe("新的任务");
    expect(getDraft(draft.id)?.inputHistory[0].snapshot.input.topic).toBe("自己的任务");
  });

  it("人工编辑形成不可变新版并保留旧来源快照；恢复设置前保存当前输入", () => {
    let draft = makeDraft();
    const now = new Date().toISOString();
    const version: ViralScriptVersion = { id: "manual-base", revision: 1, title: "自己的标题", segments: [{ id: "part", title: "正文", text: "这是自己的完整内容。", materialIds: [] }], completedSegmentIds: ["part"], complete: true, manuallyEdited: false, basedOn: snapshotDraft(draft), createdAt: now, parentVersionId: null, origin: "generated" };
    draft = tx(() => {
      const stored = requireDraft(draft.id);
      stored.versions.push(version);
      stored.currentVersionId = version.id;
      return putDraftWithinTx(stored);
    });
    draft = updateDraft(draft.id, { expectedRevision: draft.revision, input: { ...draft.input, topic: "已经改变的任务" } });
    draft = updateDraft(draft.id, { expectedRevision: draft.revision, manualScript: { title: "手写标题", segments: [{ id: "part", title: "正文", text: "人工修好的内容。", materialIds: [] }] } });
    expect(draft.versions).toHaveLength(2);
    expect(currentVersion(draft)?.manuallyEdited).toBe(true);
    expect(currentVersion(draft)?.basedOn.input.topic).toBe("自己的任务");
    expect(draft.versions[0].title).toBe("自己的标题");
    draft = updateDraft(draft.id, { expectedRevision: draft.revision, restoreVersionId: version.id });
    expect(draft.input.topic).toBe("自己的任务");
    expect(draft.inputHistory.at(-1)?.snapshot.input.topic).toBe("已经改变的任务");
    expect(() => tx(() => {
      const stored = requireDraft(draft.id);
      stored.versions[0].title = "试图覆盖旧稿";
      putDraftWithinTx(stored);
    })).toThrow(/不可原地覆盖/);
    expect(getDraft(draft.id)?.versions[0].title).toBe("自己的标题");
  });

  it("同毫秒采用与同步时，制作来源返回最后一次写入的映射", () => {
    const draft = makeDraft();
    const createdAt = new Date().toISOString();
    const version: ViralScriptVersion = { id: "tie-version", revision: 1, title: "标题", segments: [{ id: "tie-section", title: "正文", text: "完整口播。", materialIds: [] }], completedSegmentIds: ["tie-section"], complete: true, manuallyEdited: false, basedOn: snapshotDraft(draft), createdAt, parentVersionId: null, origin: "generated" };
    tx(() => {
      const stored = requireDraft(draft.id);
      stored.versions.push(version);
      stored.currentVersionId = version.id;
      putDraftWithinTx(stored);
      run("INSERT INTO projects (id, title, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", "tie-project", "标题", "{}", Date.now(), Date.now());
      const adoption = { projectId: "tie-project", versionId: version.id, settings: handoffSettings(stored), adoptedScript: { title: version.title, segments: version.segments }, createdAt };
      writeAdoptionMappingWithinTx(draft.id, "first-settings", { ...adoption, id: "first-adoption" });
      writeAdoptionMappingWithinTx(draft.id, "second-settings", { ...adoption, id: "latest-adoption" });
    });
    expect(sourceByProject("tie-project")?.adoption.id).toBe("latest-adoption");
  });
});
