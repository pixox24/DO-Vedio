import { describe, expect, it } from "vitest";
import { NoEligibleMusicError, contentEnergy, moodFallbackOrder, moodSpans, pickMusic, type SelectableMusicTrack } from "./music";
import type { Line, Mood } from "./types";

const L = (id: string, mood?: Line["mood"]): Line => ({ id, segmentIndex: 0, text: "x", spans: [], keywords: [], locked: false, mood });
const track = (id: string, moods: Mood[], extra: Partial<SelectableMusicTrack> = {}): SelectableMusicTrack => ({
  id,
  title: id,
  assetId: "",
  durationMs: 200_000,
  moods,
  loopable: true,
  rightsStatus: "verified",
  ...extra,
});
const tracks = [
  track("epic", ["史诗", "激昂"]),
  track("warm", ["温暖", "轻松"]),
  track("dark", ["悬疑", "忧伤"]),
];

describe("选曲", () => {
  it("相同情绪合并、短片段并入相邻段", () => {
    const lines = [L("a", "悬疑"), L("b", "悬疑"), L("c", "温暖"), L("d", "悬疑"), L("e", "激昂"), L("f", "激昂")];
    const spans = moodSpans(lines, [15000, 15000, 3000, 10000, 20000, 20000]);
    expect(spans.map((s) => s.mood)).toEqual(["悬疑", "激昂"]);
    expect(spans[0]).toMatchObject({ from: 0, to: 3 });
  });

  it("短视频不会频繁换曲", () => {
    const lines = ["悬疑", "轻松", "中性", "轻松", "温暖", "中性", "温暖", "轻松"].map((m, k) => L(`l${k}`, m as Line["mood"]));
    const spans = moodSpans(lines, lines.map(() => 4000));
    expect(spans.length).toBe(1);
  });

  it("按情绪选曲，相邻不重复，锁定保持", () => {
    const lines = [L("a", "悬疑"), L("b", "激昂"), L("c", "温暖")];
    const cues = pickMusic(lines, [30000, 30000, 30000], tracks);
    expect(cues.map((c) => c.trackId)).toEqual(["dark", "epic", "warm"]);
    expect(cues[0].reason).toContain("精确匹配");
    const locked = pickMusic(lines, [30000, 30000, 30000], tracks, [{ ...cues[0], trackId: "warm", locked: true }]);
    expect(locked[0].trackId).toBe("warm");
    expect(locked[1].trackId).not.toBe("warm");
  });

  it("pending / rejected / disabled 曲目不参与自动选曲", () => {
    const lines = [L("a", "悬疑")];
    expect(() => pickMusic(lines, [30000], [track("p", ["悬疑"], { rightsStatus: "pending" })])).toThrow(NoEligibleMusicError);
    expect(() => pickMusic(lines, [30000], [track("r", ["悬疑"], { rightsStatus: "rejected" })])).toThrow(NoEligibleMusicError);
    expect(() => pickMusic(lines, [30000], [track("d", ["悬疑"], { disabledReason: "授权问题" })])).toThrow(NoEligibleMusicError);

    const cues = pickMusic(lines, [30000], [track("p", ["悬疑"], { rightsStatus: "pending" }), track("v", ["悬疑"], { rightsStatus: "verified" })]);
    expect(cues.map((c) => c.trackId)).toEqual(["v"]);
  });

  it("没有合格曲目时抛出明确错误，不会静默选曲", () => {
    const lines = [L("a", "悬疑")];
    expect(() => pickMusic(lines, [30000], [])).toThrow(/曲库为空/);
    try {
      pickMusic(lines, [30000], [track("p", ["悬疑"], { rightsStatus: "pending" })]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(NoEligibleMusicError);
      expect((e as Error).message).toContain("已核实");
    }
  });

  it("9 个情绪都没有精确匹配时按退让顺序选择", () => {
    const allMoods: Mood[] = ["悬疑", "紧张", "轻松", "温暖", "激昂", "史诗", "科技", "忧伤", "中性"];
    for (const mood of allMoods) {
      const near = moodFallbackOrder(mood)[1];
      expect(near).toBeDefined();
      const cues = pickMusic([L("a", mood)], [30000], [track("fallback", [near])]);
      expect(cues).toHaveLength(1);
      expect(cues[0].reason).toContain("退让");
    }
  });

  it("同一曲目有冷却与全片占比上限", () => {
    const lines = [L("a", "悬疑"), L("b", "温暖"), L("c", "悬疑"), L("d", "温暖")];
    const cues = pickMusic(lines, [30000, 30000, 30000, 30000], [track("dark", ["悬疑"]), track("warmT", ["温暖"])]);
    const counts = new Map<string, number>();
    for (const cue of cues) counts.set(cue.trackId, (counts.get(cue.trackId) ?? 0) + 1);
    expect(counts.get("dark")).toBe(2);
    expect(counts.get("warmT")).toBe(2);
    expect(Math.max(...counts.values()) / cues.length).toBeLessThanOrEqual(0.5);
  });

  it("超长片段优先可循环或足够长的曲目", () => {
    const shortFixed = track("short", ["悬疑"], { durationMs: 60_000, loopable: false });
    const shortLoop = track("loop", ["悬疑"], { durationMs: 60_000, loopable: true });
    const long = track("long", ["悬疑"], { durationMs: 600_000, loopable: false });
    expect(pickMusic([L("a", "悬疑")], [300_000], [shortFixed, shortLoop])[0].trackId).toBe("loop");
    expect(pickMusic([L("a", "悬疑")], [300_000], [shortLoop, long])[0].trackId).toBe("long");
    expect(pickMusic([L("a", "悬疑")], [30_000], [shortFixed, long])[0].trackId).toBe("long");
  });

  it("能量与 BPM 参与评分", () => {
    const energetic = track("energetic", ["悬疑"], { energy: "high", bpm: 122, instrumental: true, durationMs: 30_000 });
    const calm = track("calm", ["悬疑"], { energy: "low", bpm: 80, instrumental: false, durationMs: 30_000 });
    const lines = [{ ...L("a", "悬疑"), text: "这是一段很快的旁白句子内容很密集" }];
    const cues = pickMusic(lines, [3000], [calm, energetic], [], { maxTrackShare: 1 });
    expect(cues[0].trackId).toBe("energetic");
    expect(contentEnergy(lines, [3000], 0, 0)).toBe("high");
  });
});
