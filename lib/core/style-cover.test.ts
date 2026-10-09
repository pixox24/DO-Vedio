import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveStyleCover } from "./style-cover";

describe("风格封面", () => {
  it("有官方缩略图时不用样张，也不用配色", () => {
    expect(resolveStyleCover({
      thumbnail: { src: "/aix/abc/thumbnails/Aix0012/thumbnail.webp", alt: "朱日禅意" },
      samples: ["sample-a", "sample-b"],
    })).toEqual({ kind: "thumbnail", src: "/aix/abc/thumbnails/Aix0012/thumbnail.webp", alt: "朱日禅意" });
  });

  it("没有缩略图时用已生成的样张", () => {
    expect(resolveStyleCover({ samples: [null, "sample-b", undefined] })).toEqual({ kind: "samples", assets: ["sample-b"] });
  });

  it("都没有时用中性底", () => {
    expect(resolveStyleCover({ thumbnail: { src: "  ", alt: "" }, samples: [] })).toEqual({ kind: "neutral" });
    expect(resolveStyleCover({})).toEqual({ kind: "neutral" });
  });
});

describe("风格编辑界面", () => {
  const editor = readFileSync(new URL("../../components/visual-style-editor.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../components/visual-style-panel.tsx", import.meta.url), "utf8");

  it("编辑器保留调色，不再提供配色组和强调色", () => {
    expect(editor).toContain('label="调色"');
    expect(editor).toContain('label="饱和度"');
    expect(editor).toContain('label="对比度"');
    expect(editor).not.toContain("配色 ");
    expect(editor).not.toContain("强调色");
    expect(editor).not.toContain("再加一组配色");
  });

  it("当前风格把 Aix 缩略图交给封面，不再承诺信息卡换色", () => {
    expect(panel).toContain("thumbnail={aixThumb");
    expect(panel).not.toContain("信息卡、标题卡会立刻换成新配色");
    expect(panel).not.toContain("信息卡和标题卡会跟着换配色");
  });
});
