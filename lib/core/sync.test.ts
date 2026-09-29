import { describe, expect, it } from "vitest";
import { mergeDocs, newId, syncLines } from "./sync";
import { emptyDoc } from "./types";

describe("文档同步与合并", () => {
  it("syncLines 稳定：同一文本不重复生成 ID", () => {
    const d = { ...emptyDoc(), segments: [{ title: "a", text: "第一句话。第二句话。" }] };
    const s1 = syncLines(d);
    expect(s1.lines).toHaveLength(2);
    expect(syncLines(s1)).toBe(s1);
    const s2 = syncLines({ ...s1, segments: [{ title: "a", text: "第一句话。第二句话改了。" }] });
    expect(s2.lines[0].id).toBe(s1.lines[0].id);
    expect(s2.lines[1].id).not.toBe(s1.lines[1].id);
  });

  it("我改设置、对方写标注：自动合并", () => {
    const base = syncLines({ ...emptyDoc(), segments: [{ title: "a", text: "第一句话。第二句话。" }] });
    const mine = { ...base, settings: { ...base.settings, budgetYuan: 5 } };
    const theirs = { ...base, lines: base.lines.map((l) => ({ ...l, keywords: ["第一句"] })) };
    const r = mergeDocs(base, mine, theirs);
    expect(r.conflict).toBe(false);
    expect(r.doc.settings.budgetYuan).toBe(5);
    expect(r.doc.lines[0].keywords).toEqual(["第一句"]);
  });

  it("我改文案、对方写标注：未改动的句子保留标注", () => {
    const base = syncLines({ ...emptyDoc(), segments: [{ title: "a", text: "第一句话。第二句话。" }] });
    const mine = syncLines({ ...base, segments: [{ title: "a", text: "第一句话。第二句话。第三句话。" }] });
    const theirs = { ...base, lines: base.lines.map((l) => ({ ...l, mood: "温暖" as const })) };
    const r = mergeDocs(base, mine, theirs);
    expect(r.conflict).toBe(false);
    expect(r.doc.lines).toHaveLength(3);
    expect(r.doc.lines[0].mood).toBe("温暖");
  });

  it("两边改同一字段：冲突", () => {
    const base = emptyDoc();
    const r = mergeDocs(base, { ...base, settings: { ...base.settings, budgetYuan: 1 } }, { ...base, settings: { ...base.settings, budgetYuan: 2 } });
    expect(r.conflict).toBe(true);
  });

  it("双方独立新增的句子都保留", () => {
    const base = syncLines({ ...emptyDoc(), segments: [{ title: "a", text: "第一句话。" }] });
    const mine = { ...base, lines: [...base.lines, { ...base.lines[0], id: "mine-new", text: "我的新增句。" }] };
    const theirs = { ...base, lines: [...base.lines, { ...base.lines[0], id: "theirs-new", text: "对方新增句。" }] };
    const r = mergeDocs(base, mine, theirs);
    expect(r.conflict).toBe(false);
    expect(r.doc.lines.map((line) => line.id)).toEqual([base.lines[0].id, "mine-new", "theirs-new"]);
  });

  it("删除与对方修改同一项时报告冲突并保留对方数据", () => {
    const base = syncLines({ ...emptyDoc(), segments: [{ title: "a", text: "第一句话。" }] });
    const mine = { ...base, lines: [] };
    const theirs = { ...base, lines: [{ ...base.lines[0], mood: "温暖" as const }] };
    const r = mergeDocs(base, mine, theirs);
    expect(r.conflict).toBe(true);
    expect(r.doc.lines[0].mood).toBe("温暖");
  });

  it("newId 格式", () => expect(newId()).toMatch(/^[0-9a-f-]{36}$/));
});
