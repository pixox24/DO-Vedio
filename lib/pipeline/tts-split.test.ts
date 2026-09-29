import { describe, expect, it } from "vitest";
import { decodeWav, durationMsOf, encodeWav, findSilences, frameDb, sliceWav, splitBySilence, splitByTimestamps, type Wav } from "./tts-split";
import { strongEnd } from "../core/blocks";

const RATE = 24_000;

/** 合成测试音频：[时长ms, 是否发声] 依次拼接；发声段用 220Hz 正弦，静音段带一点底噪 */
function synth(parts: [number, boolean][]): Wav {
  const total = parts.reduce((s, [ms]) => s + Math.round((ms / 1000) * RATE), 0);
  const pcm = new Int16Array(total);
  let i = 0;
  let seed = 1;
  for (const [ms, voiced] of parts) {
    const n = Math.round((ms / 1000) * RATE);
    for (let k = 0; k < n; k++, i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = ((seed / 0x7fffffff) * 2 - 1) * 30;
      pcm[i] = Math.round(voiced ? Math.sin((2 * Math.PI * 220 * i) / RATE) * 8000 + noise : noise);
    }
  }
  return { pcm, sampleRate: RATE };
}

describe("WAV 编解码与切片", () => {
  it("编码后解码保持采样不变", () => {
    const w = synth([[100, true], [50, false]]);
    const back = decodeWav(encodeWav(w));
    expect(back.sampleRate).toBe(RATE);
    expect(Array.from(back.pcm)).toEqual(Array.from(w.pcm));
  });

  it("流式 WAV 的 data 长度为 0 时按剩余字节解析", () => {
    const buf = encodeWav(synth([[100, true]]));
    buf.writeUInt32LE(0, 40);
    expect(decodeWav(buf).pcm.length).toBe(2400);
  });

  it("切片首尾淡入淡出，长度准确", () => {
    const w = synth([[500, true]]);
    const s = sliceWav(w, 100, 300);
    expect(durationMsOf(s)).toBeCloseTo(200, 0);
    expect(s.pcm[0]).toBe(0);
    expect(s.pcm[s.pcm.length - 1]).toBe(0);
  });
});

describe("静音检测", () => {
  it("找出不短于阈值的停顿", () => {
    const w = synth([[300, false], [800, true], [400, false], [600, true], [60, false], [500, true], [300, false]]);
    const gaps = findSilences(frameDb(w), { minMs: 120 });
    // 首尾静音 + 中间 400ms；60ms 太短不算
    expect(gaps).toHaveLength(3);
    expect(gaps[1].startMs).toBeGreaterThanOrEqual(1090);
    expect(gaps[1].endMs).toBeLessThanOrEqual(1510);
  });
});

describe("无时间戳切分", () => {
  it("在字数比例附近挑最长的停顿，忽略句内短停顿", () => {
    // 三句：每句 ~1s，句内有 130ms 逗号停顿，句间 450ms
    const w = synth([[200, false], [500, true], [130, false], [500, true], [450, false], [1000, true], [450, false], [500, true], [130, false], [500, true], [200, false]]);
    const r = splitBySilence(frameDb(w), [{ chars: 10, strongEnd: true }, { chars: 10, strongEnd: true }, { chars: 10, strongEnd: true }], durationMsOf(w));
    expect(r.source).toBe("vad");
    expect(r.boundaries).toHaveLength(2);
    // 真正的句界中心：200+500+130+500+225 = 1555；1555+225+1000+225 = 3005
    expect(Math.abs(r.boundaries[0].cutMs - 1555)).toBeLessThan(120);
    expect(Math.abs(r.boundaries[1].cutMs - 3005)).toBeLessThan(120);
    expect(r.confidence).toBeGreaterThan(0.6);
    expect(r.lines[0].cutStartMs).toBe(0);
    expect(r.lines[2].cutEndMs).toBe(durationMsOf(w));
    expect(r.lines[1].cutStartMs).toBe(r.lines[0].cutEndMs);
    expect(r.lines[0].endMs).toBeLessThan(r.lines[1].startMs);
  });

  it("停顿数量不够时置信度为 0（交给上层降级）", () => {
    const w = synth([[200, false], [2000, true], [200, false]]);
    const r = splitBySilence(frameDb(w), [{ chars: 5, strongEnd: true }, { chars: 5, strongEnd: true }], durationMsOf(w));
    expect(r.confidence).toBe(0);
    expect(r.lines).toHaveLength(2);
  });

  it("只有一句时不切", () => {
    const w = synth([[100, false], [500, true], [100, false]]);
    const r = splitBySilence(frameDb(w), [{ chars: 5, strongEnd: true }], durationMsOf(w));
    expect(r.lines).toEqual([{ startMs: expect.any(Number), endMs: expect.any(Number), cutStartMs: 0, cutEndMs: durationMsOf(w) }]);
    expect(r.confidence).toBe(1);
  });
});

describe("有时间戳切分", () => {
  it("时间戳把尾音算短时，以附近的静音为准", () => {
    const w = synth([[100, false], [900, true], [400, false], [900, true], [100, false]]);
    // 服务商说第一句 950ms 结束（实际 1000ms），第二句 1420ms 开始（实际 1400ms）
    const r = splitByTimestamps(frameDb(w), [{ startMs: 100, endMs: 950 }, { startMs: 1420, endMs: 2300 }], durationMsOf(w));
    expect(r.source).toBe("provider");
    expect(r.boundaries[0].confidence).toBe(1);
    expect(r.lines[0].endMs).toBeGreaterThanOrEqual(990);
    expect(r.lines[1].startMs).toBeLessThanOrEqual(1410);
    expect(r.boundaries[0].cutMs).toBeGreaterThan(1000);
    expect(r.boundaries[0].cutMs).toBeLessThan(1400);
  });

  it("句界处没有静音时切在能量最低处并降低置信度", () => {
    const w = synth([[100, false], [2000, true], [100, false]]);
    const r = splitByTimestamps(frameDb(w), [{ startMs: 100, endMs: 1100 }, { startMs: 1100, endMs: 2100 }], durationMsOf(w));
    expect(r.boundaries[0].confidence).toBe(0.6);
    expect(r.boundaries[0].gapMs).toBe(0);
  });
});

it("强停顿识别", () => {
  expect(strongEnd("结束了。")).toBe(true);
  expect(strongEnd("真的吗？”")).toBe(true);
  expect(strongEnd("然后，")).toBe(false);
});

describe("按标点对齐停顿", () => {
  it("记录句内逗号处可能的停顿位置", async () => {
    const { silenceLine } = await import("./tts-split");
    expect(silenceLine("他说，继续。")).toEqual({ chars: 4, strongEnd: true, pauses: [2] });
    expect(silenceLine("地面控制中心只有几秒钟来决定：继续，还是放弃。").pauses).toEqual([14, 16]);
    expect(silenceLine("结尾的逗号不算，")).toMatchObject({ strongEnd: false, pauses: [] });
  });

  it("逗号处的戏剧性长停顿被句内槽吸收，句界落在真正的句间停顿（「他说，……继续。」）", async () => {
    const { silenceLine } = await import("./tts-split");
    // 第一句 15 字 3s；句间停顿 350ms；「他说」0.4s；逗号处停顿 700ms；「继续」0.4s
    const w = synth([[200, false], [3000, true], [350, false], [400, true], [700, false], [400, true], [200, false]]);
    const texts = ["一个年仅二十六岁的工程师给出了答案。", "他说，继续。"];
    const r = splitBySilence(frameDb(w), texts.map(silenceLine), durationMsOf(w));
    // 句间停顿中心 200+3000+175 = 3375
    expect(Math.abs(r.boundaries[0].cutMs - 3375)).toBeLessThan(60);
    expect(Math.abs(r.boundaries[0].gapMs - 350)).toBeLessThanOrEqual(20);
    expect(r.confidence).toBeGreaterThan(0.5);
  });
});
