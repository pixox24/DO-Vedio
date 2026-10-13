import { describe, expect, it } from "vitest";
import { changeKindOrder, changelog } from "@/lib/changelog";

/**
 * 项目更新记录是 /changelog 页面的唯一数据源（AGENTS.md 约定）。
 * 这几条断言不检查文案好不好，只挡住「页面会渲染坏掉」和「约定被破坏」两类问题。
 */
describe("项目更新记录", () => {
  it("版本倒序排列，最新一条在最前面", () => {
    const versions = changelog.map((entry) => entry.version);
    const sorted = [...versions].sort((a, b) => {
      const [am, an, ap] = a.split(".").map(Number);
      const [bm, bn, bp] = b.split(".").map(Number);
      return bm - am || bn - an || bp - ap;
    });
    expect(versions).toEqual(sorted);
  });

  it("版本号唯一，没有重复发布同一个版本", () => {
    const versions = changelog.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("每条都填齐了页面渲染需要的字段", () => {
    for (const entry of changelog) {
      expect(entry.version, `${entry.version} 版本号格式`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.date, `${entry.version} 发布日期`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(entry.date)), `${entry.version} 日期可解析`).toBe(false);
      expect(entry.title.trim(), `${entry.version} 主题`).not.toBe("");
      expect(entry.summary.trim(), `${entry.version} 概括`).not.toBe("");
      expect(entry.items.length, `${entry.version} 至少一条分类条目`).toBeGreaterThan(0);
    }
  });

  it("分类都在页面认识的四种之内，页面按这个顺序分组", () => {
    for (const entry of changelog) {
      for (const item of entry.items) {
        expect(changeKindOrder, `${entry.version}「${item.title}」的分类`).toContain(item.kind);
        expect(item.title.trim()).not.toBe("");
        expect(item.detail?.trim(), "detail 若存在就不能是空串").not.toBe("");
      }
    }
  });
});
