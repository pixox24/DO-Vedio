import { describe, expect, it } from "vitest";
import { canNavigateCreatedDraft, errorRecoveryKind, explicitCommandFocus, fieldViewStage } from "@/components/viral/interaction";

describe("显式操作后的界面恢复", () => {
  it("新地址等用户提交和偏好就绪后发布，保存完成不能切走验证错误", () => {
    const saved = { error: "", saveState: "saved" as const };
    expect(canNavigateCreatedDraft("new-id", true, saved, true, false)).toBe(false);
    expect(canNavigateCreatedDraft("new-id", false, saved, false, false)).toBe(false);
    expect(canNavigateCreatedDraft("new-id", false, { ...saved, error: "请填写主题" }, true, false)).toBe(false);
    expect(canNavigateCreatedDraft("new-id", false, saved, true, true)).toBe(false);
    expect(canNavigateCreatedDraft("new-id", false, saved, true, false)).toBe(true);
  });
  it("有验证错误时定位首个创作字段，不折叠输入或跳向结果", () => {
    expect(explicitCommandFocus("quick", "quick", { modelId: "缺模型", materials: "素材超长", topic: "缺主题" }, 3)).toEqual({ token: 3, target: "field", field: "topic" });
    expect(fieldViewStage("topic")).toBe("task");
    expect(fieldViewStage("modelId")).toBe("style");
  });
  it("只有快捷模式成功提交才请求结果定位；续作、停止和逐步操作不重复定位", () => {
    expect(explicitCommandFocus("quick", "quick", {}, 4)).toEqual({ token: 4, target: "result" });
    expect(explicitCommandFocus("quick", "workbench", {}, 4)).toBeNull();
    expect(explicitCommandFocus("resume", "quick", {}, 4)).toBeNull();
    expect(explicitCommandFocus("stop", "quick", {}, 4)).toBeNull();
    expect(explicitCommandFocus("angles", "workbench", {}, 4)).toBeNull();
  });
  it("命令失败、保存失败和后台任务失败分别恢复对应动作", () => {
    expect(errorRecoveryKind({ error: "请求断网", errorOrigin: "command", saveState: "saved" }, false, true)).toBe("command");
    expect(errorRecoveryKind({ error: "保存冲突", errorOrigin: "save", saveState: "conflict" }, true, true)).toBe("save");
    expect(errorRecoveryKind({ error: "", errorOrigin: null, saveState: "saved" }, true, false)).toBe("resume");
    expect(errorRecoveryKind({ error: "复制失败", errorOrigin: "action", saveState: "saved" }, false, true)).toBeNull();
    expect(errorRecoveryKind({ error: "读取失败", errorOrigin: "poll", saveState: "saved" }, false, false)).toBe("reload");
    expect(errorRecoveryKind({ error: "制作正文已修改，请重看同步影响", errorOrigin: "sync", saveState: "saved" }, false, false)).toBe("sync");
  });
});
