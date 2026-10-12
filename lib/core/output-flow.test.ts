import { describe, expect, it } from "vitest";
import { RENDER_OUTPUT_VERSION } from "./keys";
import { outputReadiness, renderBadge, renderMatches, visibleRenders, type ListedRender, type TimelineHashes } from "./output-flow";

const current: TimelineHashes = { contentHash: "content", animationHash: "anim", timelineHash: "timeline" };

function render(patch: Partial<ListedRender> & Pick<ListedRender, "id" | "aspect">): ListedRender {
  return {
    quality: "final",
    outputVersion: RENDER_OUTPUT_VERSION,
    contentHash: "content",
    animationHash: "anim",
    timelineHash: "timeline",
    videoHash: `${patch.id}-video`,
    srtHash: `${patch.id}-srt`,
    createdAt: 1_000,
    ...patch,
  };
}

describe("成片是否对得上当前时间轴", () => {
  it("内容和动画都一致才算当前成片", () => {
    expect(renderMatches(render({ id: "a", aspect: "16:9" }), current)).toBe(true);
    expect(renderMatches(render({ id: "a", aspect: "16:9", animationHash: "other" }), current)).toBe(false);
    expect(renderMatches(render({ id: "a", aspect: "16:9", contentHash: "other" }), current)).toBe(false);
  });

  it("没有动画哈希的旧文件退回时间轴哈希", () => {
    expect(renderMatches(render({ id: "a", aspect: "16:9", animationHash: "" }), current)).toBe(true);
    expect(renderMatches(render({ id: "a", aspect: "16:9", animationHash: "", timelineHash: "old" }), current)).toBe(false);
  });

  it("输出版本过旧的文件不算", () => {
    expect(renderMatches(render({ id: "a", aspect: "16:9", outputVersion: 0 }), current)).toBe(false);
  });
});

describe("自动成片不挤占上一版", () => {
  it("对不上的自动成片在已有手工成片时不出现", () => {
    const manual = render({ id: "manual", aspect: "16:9", createdAt: 1 });
    const caught = render({ id: "auto", aspect: "16:9", contentHash: "other", origin: "catch-up", createdAt: 2 });
    expect(visibleRenders([manual, caught], { "16:9": current }).map((item) => item.id)).toEqual(["manual"]);
  });

  it("对得上的自动成片留下来，并成为最新", () => {
    const manual = render({ id: "manual", aspect: "16:9", createdAt: 1 });
    const caught = render({ id: "auto", aspect: "16:9", origin: "catch-up", createdAt: 2 });
    const shown = visibleRenders([manual, caught], { "16:9": current });
    expect(shown.map((item) => item.id)).toEqual(["manual", "auto"]);
    expect(renderBadge(caught, shown, { "16:9": current })).toBe("最新");
    expect(renderBadge(manual, shown, { "16:9": current })).toBe("上一版");
  });
});

describe("制作页成片状态", () => {
  const now = 1_000 + 5 * 60_000;

  it("还没有成片", () => {
    const readiness = outputReadiness(["16:9"], [], { "16:9": current }, now);
    expect(readiness.phase).toBe("empty");
    expect(readiness.status).toBe("还没有成片");
    expect(readiness.files).toEqual([]);
  });

  it("只有样片时仍然算还没有成片", () => {
    const draft = render({ id: "draft", aspect: "16:9", quality: "draft" });
    const readiness = outputReadiness(["16:9"], [draft], { "16:9": current }, now);
    expect(readiness.phase).toBe("empty");
  });

  it("每个已选画幅都有一份一致的成片", () => {
    const file = render({ id: "final", aspect: "16:9", createdAt: now - 2 * 60_000 });
    const readiness = outputReadiness(["16:9"], [file], { "16:9": current }, now);
    expect(readiness.phase).toBe("fresh");
    expect(readiness.status).toBe("16:9 · 最新 · 2 分钟前");
    expect(readiness.files[0]?.stale).toBe(false);
  });

  it("只改动画时标成将重渲，导出文件是上一版", () => {
    const file = render({ id: "final", aspect: "16:9", animationHash: "old" });
    const readiness = outputReadiness(["16:9"], [file], { "16:9": current }, now);
    expect(readiness.phase).toBe("stale");
    expect(readiness.status).toBe("将重渲 16:9");
    expect(readiness.files[0]?.stale).toBe(true);
  });

  it("一个画幅已最新、另一个还没有文件", () => {
    const landscape = render({ id: "land", aspect: "16:9" });
    const hashes = { "16:9": current, "9:16": current };
    const readiness = outputReadiness(["16:9", "9:16"], [landscape], hashes, now);
    expect(readiness.phase).toBe("stale");
    expect(readiness.status).toContain("将生成 9:16");
    expect(readiness.status).toContain("16:9 最新");
    expect(readiness.files.map((file) => file.aspect)).toEqual(["16:9"]);
  });

  it("哈希还没到齐时不宣称已是最新", () => {
    const file = render({ id: "final", aspect: "16:9" });
    expect(outputReadiness(["16:9", "9:16"], [file], { "16:9": current }, now).phase).toBe("pending");
  });

  it("文档退回后，导出对得上的那一版，而不是较新的过期文件", () => {
    const older = render({ id: "older", aspect: "16:9", createdAt: 1 });
    const newer = render({ id: "newer", aspect: "16:9", createdAt: 2, contentHash: "later" });
    const readiness = outputReadiness(["16:9"], [newer, older], { "16:9": current }, now);
    expect(readiness.phase).toBe("fresh");
    expect(readiness.files[0]?.videoHash).toBe("older-video");
  });
});

describe("成片列表徽章", () => {
  it("最新的一份一致成片是最新，更早的一致成片是上一版", () => {
    const older = render({ id: "older", aspect: "16:9", createdAt: 1 });
    const newer = render({ id: "newer", aspect: "16:9", createdAt: 2 });
    const hashes = { "16:9": current };
    expect(renderBadge(newer, [older, newer], hashes)).toBe("最新");
    expect(renderBadge(older, [older, newer], hashes)).toBe("上一版");
  });

  it("样片即使对得上也不标成最新", () => {
    const draft = render({ id: "draft", aspect: "16:9", quality: "draft" });
    expect(renderBadge(draft, [draft], { "16:9": current })).toBeNull();
    const staleDraft = render({ id: "old", aspect: "16:9", quality: "draft", animationHash: "old" });
    expect(renderBadge(staleDraft, [staleDraft], { "16:9": current })).toBe("已过期");
  });
});
