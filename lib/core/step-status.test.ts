import { describe, expect, it } from "vitest";
import { blankShot } from "./shots";
import { storyboardImageHint, voiceDirectionHint } from "./step-status";
import { emptyDoc, voiceSettingsSchema } from "./types";

describe("配音口吻的进度状态", () => {
  const voice = voiceSettingsSchema.parse({});

  it("当前音色不接收说明时直接完成", () => {
    expect(voiceDirectionHint(voice, false)).toEqual({ tone: "done", message: "当前音色不需要" });
  });

  it("已经写过口吻时直接完成", () => {
    const qwen = voiceSettingsSchema.parse({ model: "qwen-audio-3.0-tts-flash", instruction: "轻松一点" });
    expect(voiceDirectionHint(qwen, false)).toEqual({ tone: "done", message: "已有口吻" });
  });

  it("没写成时不标红，配音继续", () => {
    const qwen = voiceSettingsSchema.parse({ model: "qwen-audio-3.0-tts-flash", instruction: "" });
    expect(voiceDirectionHint(qwen, true)).toEqual({ tone: "done", message: "未写成，配音继续" });
    expect(voiceDirectionHint(qwen, false)).toBeNull();
  });
});

describe("分镜缺图时的进度状态", () => {
  function docWith(shots: ReturnType<typeof blankShot>[]) {
    const doc = emptyDoc();
    doc.lines = [{ id: "a", segmentIndex: 0, text: "一句。", spans: [], keywords: [], locked: false }];
    doc.shots = shots;
    return doc;
  }

  it("还没有镜头时不提前显示", () => {
    expect(storyboardImageHint(docWith([]), false)).toBeNull();
  });

  it("需要生图但还没有图时用等待状态", () => {
    const shot = { ...blankShot("s", "a"), kind: "image" as const };
    expect(storyboardImageHint(docWith([shot]), false)).toEqual({ tone: "hold", message: "待生成图片 · 还缺 1 个" });
  });

  it("生图进行中按已有图片计数", () => {
    const ready = { ...blankShot("s", "a"), kind: "image" as const, assetId: "img" };
    const missing = { ...blankShot("t", "a"), kind: "image" as const };
    expect(storyboardImageHint(docWith([ready, missing]), true)).toEqual({ tone: "hold", message: "生成图片 1/2", pulse: true });
  });

  it("标题卡和锁定镜头不算缺图", () => {
    const title = { ...blankShot("s", "a"), kind: "title" as const };
    const locked = { ...blankShot("t", "a"), kind: "image" as const, locked: true };
    expect(storyboardImageHint(docWith([title, locked]), false)).toEqual({ tone: "done" });
  });

  it("过期图片仍算缺图", () => {
    const stale = { ...blankShot("s", "a"), kind: "image" as const, assetId: "img", assetPromptHash: "old" };
    expect(storyboardImageHint(docWith([stale]), false)?.tone).toBe("hold");
  });
});
