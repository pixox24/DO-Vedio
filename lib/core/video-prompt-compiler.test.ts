import { describe, expect, it } from "vitest";
import { blankShot } from "./shots";
import { characterCardSchema, emptyDoc, sceneCardSchema } from "./types";
import { compileVideoPrompt, compileVideoReferencePrompt, sanitizeVideoPlan } from "./video-prompt-compiler";
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
    expect(result.prompt).toContain("[keyframe completion + reference generation]");
    expect(result.prompt).toContain("fully_preserved");
    expect(result.prompt).toContain("4.200 seconds");
    expect(result.prompt).toContain("[Shot 1] The shot begins from <Picture 1>");
    expect(result.prompt).toContain("<Picture 1> ([Shot 1] opening keyframe and composition): fully_preserved");
    expect(result.prompt).toContain("if it conflicts with the visible composition, the image governs the opening");
    expect(result.prompt).toContain("Exclude their backgrounds, studio lighting, poses, shot scale and framing");
    expect(result.prompt).toContain("exclude any people or character identities they contain");
    expect(result.prompt).not.toContain("<Picture 2> is");
    expect(result.prompt).not.toContain("<Picture 3> is");
    expect(result.prompt).not.toMatch(/weak_reference|not a prescribed exact first frame/);
    expect(result.prompt).not.toMatch(/At \d\d:|\[Shot 2\]|[\u4e00-\u9fff]/);
    expect(result.prompt).toContain("overall_soundscape:\nN/A\n\nnon_diegetic_music:\nN/A");
    const manual = compileVideoPrompt({ doc, shot: { ...shot, sourceImageDescription: "用户说明：红色杯子" }, referenceAssetIds: ["source"], requestDurationSeconds: 5 });
    expect(manual.prompt).not.toContain("用户说明");
    expect(manual.prompt).toContain("[keyframe completion]");
  });
  it("旧计划中的耳语台词、口型和绘制字幕在实际请求前移除", () => {
    const { doc, shot } = fixture();
    const contaminated = {
      startState: `${plan.startState} Her lips move as she speaks.`,
      action: 'She turns and whispers: “轮到你了”. She places a cup on the table. Render subtitles: "Your turn".',
      camera: `${plan.camera} Add on-screen text: 'Now'.`,
      endState: `${plan.endState} 她张嘴说了一句：“结束了”。`,
    };
    const clean = sanitizeVideoPlan(contaminated);
    expect(clean.action).toContain("She turns");
    expect(clean.action).toContain("She places a cup on the table");
    expect(JSON.stringify(clean)).not.toMatch(/whisper|轮到你了|Your turn|Her lips|speaks|on-screen text|Now|张嘴|结束了/);
    expect(sanitizeVideoPlan(clean)).toEqual(clean);
    const compiled = compileVideoPrompt({ doc, shot: { ...shot, videoPlan: contaminated }, referenceAssetIds: ["source", "portrait"], requestDurationSeconds: 5 });
    expect(compiled.prompt).not.toMatch(/whisper|轮到你了|Your turn|Her lips|speaks|Now|张嘴|结束了/);
    expect(compiled.prompt).toContain("Keep characters silent");
    expect(compiled.prompt).toContain("Do not render subtitles");
    expect(compileVideoReferencePrompt(doc, { ...shot, videoPlan: contaminated }).slots.content).not.toContain("Her lips");
  });
  it("清洗标签对白、中英文复合指令及纯说话计划时保留无台词约束", () => {
    const clean = sanitizeVideoPlan({
      startState: 'The woman stands still without speaking.',
      action: '她转头，然后低声说：轮到你了。He nods, then says <d>[English] Your turn.</d> while subtitles appear.',
      camera: 'The camera holds steady.',
      endState: 'She mouths the words "Good bye".',
    });
    expect(clean.startState).toContain("The woman stands still");
    expect(clean.action).toContain("她转头");
    expect(clean.action).toContain("He nods");
    expect(JSON.stringify(clean)).not.toMatch(/轮到你了|Your turn|Good bye|低声|mouths|<d>|subtitles/);
    expect(clean.endState).toBe("The subjects settle naturally in the established environment.");
    expect(sanitizeVideoPlan({ ...plan, action: '“轮到你了”' }).action).toBe("The subjects remain silent with subtle natural motion.");
  });
  it("主图身份按真实请求顺序定位，缺失主图时拒绝退化成辅助图驱动", () => {
    const { doc, shot } = fixture();
    const result = compileVideoPrompt({ doc, shot, referenceAssetIds: ["portrait", "source", "room"], requestDurationSeconds: 5 });
    expect(result.prompt).toContain("<Picture 2> is the opening keyframe");
    expect(result.prompt).toContain("character 1 referenced by <Picture 1>");
    expect(result.referenceAssetIds).toEqual(["portrait", "source", "room"]);
    expect(() => compileVideoPrompt({ doc, shot, referenceAssetIds: ["portrait"], requestDurationSeconds: 5 })).toThrow("缺少镜头构图参考图");
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
