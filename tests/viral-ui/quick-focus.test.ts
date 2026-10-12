import { describe, expect, it } from "vitest";
import { readViralQuickFocus, storeViralQuickFocus, takeViralQuickFocus } from "@/components/viral/quick-focus";

function storage() {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}

describe("新建快捷提交跨稳定地址的焦点承接", () => {
  it("原新建组件销毁后，仅匹配草稿接收已成功提交的任务意图一次", () => {
    const session = storage();
    storeViralQuickFocus(session, { draftId: "created-draft", taskId: "explicit-quick-task" });
    expect(takeViralQuickFocus(session, "another-draft")).toBeNull();
    expect(takeViralQuickFocus(session, "created-draft")).toEqual({ draftId: "created-draft", taskId: "explicit-quick-task" });
    expect(takeViralQuickFocus(session, "created-draft")).toBeNull();
  });
  it("普通刷新和后台轮询没有提交意图，不触发结果定位", () => {
    const session = storage();
    expect(takeViralQuickFocus(session, "saved-draft")).toBeNull();
    expect(takeViralQuickFocus(session, "saved-draft")).toBeNull();
  });
  it("路由effect加载期间清理不丢失意图，晚响应不能抢走后来提交的任务", () => {
    const session = storage();
    storeViralQuickFocus(session, { draftId: "created-draft", taskId: "first-task" });
    const beforeCleanup = readViralQuickFocus(session, "created-draft");
    expect(readViralQuickFocus(session, "created-draft")).toEqual(beforeCleanup);
    storeViralQuickFocus(session, { draftId: "created-draft", taskId: "later-task" });
    expect(takeViralQuickFocus(session, "created-draft", beforeCleanup!.taskId)).toBeNull();
    expect(takeViralQuickFocus(session, "created-draft", "later-task")?.taskId).toBe("later-task");
  });
});
