import { describe, expect, it } from "vitest";
import { evenChars } from "./align";
import type { TtsResult } from "./keys";
import { blankShot } from "./shots";
import { effectiveStockQuery, snapshotFor, stockAssetStale, stockExclusions, stockFrame, stockMinDurationSec, stockOrientation, stockQuery, stockSnapshot } from "./stock";
import { buildTimeline, type Artifacts } from "./timeline";
import { emptyDoc, type Line, type Shot } from "./types";
import { videoGenerationSnapshot, videoShotTiming } from "./video";

const line = (id: string, text = "一段足够长的连续旁白内容"): Line => ({ id, text, segmentIndex: 0, spans: [], keywords: [], locked: false });
const tts = (text: string, durationMs: number): TtsResult => ({
  assetId: `audio-${text}`, durationMs: durationMs + 400, speechStartMs: 200, speechEndMs: durationMs + 200,
  chars: evenChars(text, 200, durationMs + 200), aligned: true, spokenChars: text.length,
});
const frame = { aspect: "16:9" as const, width: 1920, height: 1080, fps: 30 };
const portrait = { aspect: "9:16" as const, width: 1080, height: 1920, fps: 30 };

function fixture(durations = [3000, 3000]) {
  const doc = emptyDoc();
  doc.settings.visualPipeline = "stock";
  doc.lines = durations.map((_, index) => line(`line${index}`));
  doc.shots = doc.lines.map((item, index): Shot => ({
    ...blankShot(`shot${index}`, item.id), kind: "video", mode: "generate", groupId: "group",
    stockQuery: "woman walking street",
    videoPlan: { startState: "A woman stands by the window", action: "She turns toward the door", camera: "Static camera", endState: "She faces the door" },
  }));
  const art: Artifacts = { tts: new Map(doc.lines.map((item, index) => [item.id, tts(item.text, durations[index])])), tracks: new Map(), media: (id) => `/m/${id}` };
  return { doc, art };
}

describe("素材检索词", () => {
  it("分镜给了检索词就用它，缺了才退到规则派生", () => {
    const { doc } = fixture();
    expect(effectiveStockQuery(doc.shots[0])).toBe("woman walking street");
    expect(effectiveStockQuery({ ...doc.shots[0], stockQuery: "   " })).toBe(stockQuery(doc.shots[0]));
  });

  it("规则派生必须可复现：它是快照哈希的一部分", () => {
    const { doc } = fixture();
    const shot = { ...doc.shots[0], stockQuery: undefined };
    expect(stockQuery(shot)).toBe(stockQuery(shot));
    expect(stockQuery(shot)).toBe("woman stands window");
  });

  it("派生结果只含小写英文词、不超过 3 个、剔掉虚词", () => {
    const { doc } = fixture();
    const query = stockQuery({ ...doc.shots[0], stockQuery: undefined, videoPlan: { startState: "A young woman in a red coat slowly walks through the crowded market", action: "She looks around", camera: "x", endState: "y" } });
    expect(query).toMatch(/^[a-z]+(?: [a-z]+)*$/);
    expect(query.split(" ").length).toBeLessThanOrEqual(3);
    expect(query).not.toMatch(/\b(the|a|an|in|of|through|slowly)\b/);
  });

  it("没有执行计划时也有确定性的兜底词", () => {
    const { doc } = fixture();
    const bare = { ...doc.shots[0], stockQuery: undefined, videoPlan: undefined };
    expect(stockQuery(bare)).toBe("abstract background");
  });
});

describe("素材画幅与时长下限", () => {
  it("方向由画幅决定", () => {
    expect(stockOrientation(frame)).toBe("landscape");
    expect(stockOrientation(portrait)).toBe("portrait");
  });

  it("默认取第一个输出规格", () => {
    const { doc } = fixture();
    doc.settings.aspects = ["9:16"];
    doc.settings.outputSpecIds = ["portrait-1080p"];
    expect(stockFrame(doc)).toMatchObject({ aspect: "9:16", width: 1080, height: 1920 });
    expect(stockFrame(doc, frame)).toBe(frame);
  });

  it("时长下限取「设置里的下限」与「镜头时长向上取整」的较大者", () => {
    const { doc, art } = fixture([3000]);
    const timeline = buildTimeline(doc, art, "16:9");
    const timing = videoShotTiming(doc, doc.shots[0], timeline);
    expect(stockMinDurationSec(doc, timing.targetDurationMs)).toBe(Math.ceil(timing.targetDurationMs / 1000));

    doc.settings.stock.minDurationSec = 30;
    expect(stockMinDurationSec(doc, timing.targetDurationMs)).toBe(30);
  });
});

describe("素材快照", () => {
  it("同一份文档永远算出同一个哈希", () => {
    const { doc, art } = fixture();
    const timeline = buildTimeline(doc, art, "16:9");
    expect(stockSnapshot(doc, doc.shots[0], timeline, frame).hash).toBe(stockSnapshot(doc, doc.shots[0], timeline, frame).hash);
    expect(stockSnapshot(doc, doc.shots[0], timeline, frame).key).toMatch(/^stock:[0-9a-f]+$/);
  });

  it("改了检索词、方向、时长下限或覆盖句，哈希必须变", () => {
    const { doc, art } = fixture([3000]);
    const timeline = buildTimeline(doc, art, "16:9");
    const base = stockSnapshot(doc, doc.shots[0], timeline, frame).hash;

    const renamed: Shot = { ...doc.shots[0], stockQuery: "man running beach" };
    expect(stockSnapshot({ ...doc, shots: [renamed] }, renamed, timeline, frame).hash).not.toBe(base);
    expect(stockSnapshot(doc, doc.shots[0], timeline, portrait).hash).not.toBe(base);
    expect(stockSnapshot({ ...doc, settings: { ...doc.settings, stock: { ...doc.settings.stock, minDurationSec: 30 } } }, doc.shots[0], timeline, frame).hash).not.toBe(base);
    expect(stockSnapshot({ ...doc, lines: [{ ...doc.lines[0], text: "改过的旁白" }] }, doc.shots[0], timeline, frame).hash).not.toBe(base);
  });

  it("候选与已试素材游标不进哈希：重搜前后必须是同一个值", () => {
    const { doc, art } = fixture([3000]);
    const timeline = buildTimeline(doc, art, "16:9");
    const shot = doc.shots[0];
    const base = stockSnapshot(doc, shot, timeline, frame).hash;

    const withCandidates: Shot = {
      ...shot, assetId: "asset-a", assetPromptHash: base,
      candidates: [
        { id: "c1", assetId: "asset-a", selected: true, kind: "video", promptHash: base, generationPromptHash: base },
        { id: "c2", assetId: "asset-b", selected: false, kind: "video", promptHash: base, generationPromptHash: base },
      ],
    };
    expect(stockSnapshot(doc, withCandidates, timeline, frame).hash).toBe(base);
    // 游标是从候选推出来的，所以它变了哈希也不能变——否则门禁会把在用素材误判为过期
    expect(stockExclusions(withCandidates)).toEqual(["asset-a", "asset-b"]);
    expect(stockSnapshot(doc, { ...withCandidates, candidates: [] }, timeline, frame).hash).toBe(base);
  });

  it("快照里带上这次检索实际用的词与时长下限", () => {
    const { doc, art } = fixture([3000]);
    const timeline = buildTimeline(doc, art, "16:9");
    const snapshot = stockSnapshot(doc, doc.shots[0], timeline, frame);
    expect(snapshot.query).toBe("woman walking street");
    expect(snapshot.minDurationSec).toBe(Math.ceil(snapshot.timing.targetDurationMs / 1000));
  });
});

describe("按管线分发快照", () => {
  it("AI 视频走原快照，素材走素材快照", () => {
    const { doc, art } = fixture([3000]);
    const timeline = buildTimeline(doc, art, "16:9");
    const shot = doc.shots[0];
    expect(snapshotFor(doc, shot, timeline, frame).hash).toBe(stockSnapshot(doc, shot, timeline, frame).hash);

    const ai = { ...doc, settings: { ...doc.settings, visualPipeline: "video" as const } };
    expect(snapshotFor(ai, shot, timeline, frame).hash).toBe(videoGenerationSnapshot(ai, shot, timeline, frame).hash);
    // 两条管线各有各的判据，同一个镜头在两个管线下的哈希本来就不同
    expect(snapshotFor(ai, shot, timeline, frame).hash).not.toBe(snapshotFor(doc, shot, timeline, frame).hash);
  });
});

describe("素材过期判定与游标", () => {
  it("当前素材的指纹与现在的快照不一致就是过期", () => {
    const { doc, art } = fixture([3000]);
    const timeline = buildTimeline(doc, art, "16:9");
    const shot = doc.shots[0];
    const hash = stockSnapshot(doc, shot, timeline, frame).hash;
    expect(stockAssetStale(doc, { ...shot, assetId: "a", assetPromptHash: hash }, timeline, frame)).toBe(false);
    expect(stockAssetStale(doc, { ...shot, assetId: "a", assetPromptHash: "old" }, timeline, frame)).toBe(true);
    // 还没素材就谈不上过期
    expect(stockAssetStale(doc, { ...shot, assetId: undefined }, timeline, frame)).toBe(false);
  });

  it("游标含当前素材与全部候选，去重", () => {
    const { doc } = fixture();
    const shot: Shot = {
      ...doc.shots[0], assetId: "asset-a",
      candidates: [
        { id: "c1", assetId: "asset-a", selected: true },
        { id: "c2", assetId: "asset-b", selected: false },
        { id: "c3", assetId: "asset-b", selected: false },
      ],
    };
    expect(stockExclusions(shot)).toEqual(["asset-a", "asset-b"]);
    expect(stockExclusions({ ...doc.shots[0], assetId: undefined, candidates: [] })).toEqual([]);
  });
});
