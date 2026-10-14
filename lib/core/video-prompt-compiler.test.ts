import { describe, expect, it } from "vitest";
import { blankShot } from "./shots";
import { characterCardSchema, emptyDoc, sceneCardSchema } from "./types";
import { compileVideoPrompt, compileVideoReferencePrompt } from "./video-prompt-compiler";
import { storyboardPrompt } from "../prompts";

const plan = { startState: "A short-haired woman in a blue coat stands beside the cafe window. Warm daylight falls across wooden tables.", action: "She places a cup on the table and sits down.", camera: "The camera slowly tracks right at eye level.", endState: "She is seated with both hands resting beside the cup." };
function fixture() {
  const doc = emptyDoc();
  doc.lines = [{ id: "a", text: "外部旁白不能进模型", segmentIndex: 0, spans: [], keywords: [], locked: false }];
  doc.characters = [characterCardSchema.parse({ id: "c", name: "林夏", hair: "齐耳短发", looks: [{ id: "l", wardrobe: "蓝色外套" }], referenceAssetIds: ["portrait"] })];
  doc.scenes = [sceneCardSchema.parse({ id: "s", name: "咖啡厅", description: "木桌与窗户", referenceAssetIds: ["room"] })];
  const shot = { ...blankShot("shot", "a"), videoPlan: plan, characterIds: ["c"], sceneId: "s", sourceImageAssetId: "source", description: "中文扫读描述", prompt: "旧图片自定义提示词" };
  doc.shots = [shot];
  return { doc, shot };
}

describe("视频导演与Full-Reference编译", () => {
  it("保留最终refs顺序，使用英文连续单镜，不泄漏外部旁白", () => {
    const { doc, shot } = fixture();
    const result = compileVideoPrompt({ doc, shot, referenceAssetIds: ["source", "room", "portrait"], targetDurationMs: 4200, requestDurationSeconds: 5 });
    expect(result.labels).toEqual([{ assetId: "source", picture: "<Picture 1>" }, { assetId: "room", picture: "<Picture 2>" }, { assetId: "portrait", picture: "<Picture 3>" }]);
    expect(result.prompt).toContain("character 1 referenced by <Picture 3>");
    expect(result.prompt).toContain("environment referenced by <Picture 2>");
    expect(result.prompt).toContain("[reference generation]");
    expect(result.prompt).toContain("fully_preserved");
    expect(result.prompt).toContain("4.200 seconds");
    expect(result.prompt).toContain("[Shot 1] Opening");
    expect(result.prompt).not.toMatch(/At \d\d:|\[Shot 2\]|[\u4e00-\u9fff]/);
    expect(result.prompt).toContain("overall_soundscape:\nN/A\n\nnon_diegetic_music:\nN/A");
    const manual = compileVideoPrompt({ doc, shot: { ...shot, sourceImageDescription: "用户说明：红色杯子" }, referenceAssetIds: ["source"], requestDurationSeconds: 5 });
    expect(manual.prompt).toContain("Supplied image description (user-authored, not visually inspected): 用户说明：红色杯子");
  });
  it("静态图只取起始状态，造型和场景复用已有编译器", () => {
    const { doc, shot } = fixture();
    const compiled = compileVideoReferencePrompt(doc, { ...shot, sourceImageDescription: "过时旧图说明" });
    expect(compiled.slots.content).toBe(plan.startState);
    expect(compiled.slots.characters).toContain("蓝色外套");
    expect(compiled.slots.scene).toContain("木桌与窗户");
    expect(compiled.full).not.toContain(plan.action);
    expect(compiled.full).not.toContain("过时旧图说明");
  });
  it("图片导演保留原节奏，视频导演用动态计划与真实字级时间", () => {
    const input = { title: "测试", brief: { summary: "", audience: "", perspective: "third" as const }, segments: [], lines: [{ id: "a", text: "她坐下", segmentIndex: 0, ms: 4200, keywords: [], chars: [{ i: 0, startMs: 500, endMs: 900 }], estimated: false }] };
    expect(storyboardPrompt(input).instructions).toContain("每镜约 2-6 秒");
    const video = storyboardPrompt({ ...input, visualPipeline: "video" });
    expect(video.instructions).toContain("startState");
    expect(video.instructions).toContain("不在单镜头安排剪切");
    expect(JSON.parse(video.prompt).lines[0].chars[0].startMs).toBe(500);
  });
});
