import { describe, expect, it } from "vitest";
import { edgeTokenCs64, edgeTokenDigest, generateSecMsGec, invalidateSecMsGec, secMsGec } from "./edge-drm";
import { edgeConnectionUrl, edgeGainDb, edgeHeaders, edgePlainText, edgeProsody, edgeSsml, parseEdgeMetadata, wordsFromEdgeMetadata } from "./edge";

/**
 * 令牌向量由参考实现（rany2/edge-tts 的 drm.py）产出，见 `edge-drm.ts` 顶部说明。
 * 这些断言是「移植没被改坏」的唯一保障：算错只会得到 403，看不出错在哪。
 */
describe("Edge 朗读令牌（Sec-MS-GEC v2）", () => {
  it("与参考实现的令牌逐字节一致", () => {
    const vectors: [number, string][] = [
      [0, "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6"],
      [1, "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6"],
      [299, "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6"],
      [300, "F7535A20A262E331-28675BF85C7106BBF20035A78FCB0B6890813EAD5C3B983EF3424931B720BABB"],
      [1_700_000_000, "2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2"],
      [1_763_000_000, "3689BC1F78238B9A-DD2A2B71647FAA9B316154E46E5EEA92B85708C5C753EC77984ED8A78A848763"],
      [1_763_123_456.7, "294C3D85CCDF27C0-5F54D68BB1629250FAD5EF20582410B80E140B4FDF92E2335F83BF732CE635C6"],
    ];
    for (const [unix, token] of vectors) expect(generateSecMsGec(unix)).toBe(token);
  });

  it("定制 SHA-256 不是标准 SHA-256（用参考实现的中间值对拍）", () => {
    const cases: [string, string][] = [
      ["78787878787878", "C5D8753F7D7FEDA9ADD20A7C259D80264B34061958150C5735F891738814E8F0"],
      ["79".repeat(44), "FA6EEACCD9DA3B4CA2C15D89350A5F7DF69694EC51C7BCBF1CB304E369F304F6"],
      [`30${"41".repeat(43)}`, "BED61450FA71FC34F573EBB5EE79B08621D1780C5C170DDB17A2AA815A75254A"],
    ];
    for (const [hex, digest] of cases) {
      const data = Buffer.from(hex, "hex");
      expect(edgeTokenDigest(data).toString("hex").toUpperCase()).toBe(digest);
      expect(edgeTokenCs64(data, edgeTokenDigest(data)).length).toBe(8);
    }
  });

  it("令牌按 5 分钟窗口缓存，失效后可重算", () => {
    invalidateSecMsGec();
    const first = secMsGec(1_763_123_456_000);
    expect(secMsGec(1_763_123_457_000)).toBe(first);
    invalidateSecMsGec();
    expect(secMsGec(1_763_123_456_000)).toBe(first);
  });
});

describe("Edge 朗读请求构造", () => {
  it("语速按倍率换算成带符号百分比", () => {
    expect(edgeProsody({ rate: 1 })).toEqual({ rate: "+0%" });
    expect(edgeProsody({ rate: 2 })).toEqual({ rate: "+100%" });
    expect(edgeProsody({ rate: 0.5 })).toEqual({ rate: "-50%" });
    expect(edgeProsody({ rate: 1.55 })).toEqual({ rate: "+55%" });
  });

  it("音量滑块换算成线性增益 dB", () => {
    // 内置中文音色不接受 prosody 的 volume，增益只能在本地做
    expect(edgeGainDb(undefined)).toBe(0);
    expect(edgeGainDb(50)).toBe(0);
    expect(edgeGainDb(100)).toBe(20);
    expect(edgeGainDb(0)).toBe(-20);
    expect(edgeGainDb(65)).toBe(6);
  });

  it("正文清洗掉标签与控制字符，外壳固定", () => {
    expect(edgePlainText("a<b>&'\"\u000b c")).toBe("a&lt;b&gt;&amp;&apos;&quot;  c");
    const ssml = edgeSsml("第一句<break time='800ms'/>第二句", "zh-CN-XiaoxiaoNeural", edgeProsody({ rate: 1 }));
    expect(ssml).not.toContain("<break");
    expect(ssml).toContain("第一句&lt;break time=&apos;800ms&apos;/&gt;第二句");
    expect(ssml).toContain("rate='+0%'");
    expect(ssml.startsWith("<speak version='1.0'")).toBe(true);
    expect(ssml.endsWith("</prosody></voice></speak>")).toBe(true);
  });

  it("连接串带令牌与版本，头带 MUID", () => {
    const url = edgeConnectionUrl({ connectionId: "abc", token: "TOKEN", version: "2-143.0.3650.75" });
    expect(url).toContain("TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4");
    expect(url).toContain("ConnectionId=abc");
    expect(url).toContain("Sec-MS-GEC=TOKEN");
    expect(url).toContain("Sec-MS-GEC-Version=2-143.0.3650.75");
    expect(edgeHeaders("MUID").Cookie).toBe("muid=MUID;");
    expect(edgeHeaders().Origin).toBe("chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold");
  });
});

describe("Edge 元数据解析", () => {
  const frame = (metadata: unknown) => `X-RequestId:1\r\nContent-Type:application/json\r\nPath:audio.metadata\r\n\r\n${JSON.stringify({ Metadata: metadata })}`;

  it("只取 WordBoundary，100ns 换算成毫秒", () => {
    const text = frame([
      { Type: "WordBoundary", Data: { Offset: 1_000_000, Duration: 3_000_000, text: { Text: "这是" } } },
      { Type: "SessionEnd", Data: {} },
      { Type: "WordBoundary", Data: { Offset: 4_130_000, Duration: 3_380_000, text: { Text: "一次 &amp; 测试" } } },
    ]);
    const parsed = parseEdgeMetadata(text);
    expect(parsed.map((item) => item.text)).toEqual(["这是", "一次 & 测试"]);
    expect(wordsFromEdgeMetadata(parsed)).toEqual([
      { text: "这是", startMs: 100, endMs: 400 },
      { text: "一次 & 测试", startMs: 413, endMs: 751 },
    ]);
  });

  it("非元数据帧与坏 JSON 都返回空数组", () => {
    expect(parseEdgeMetadata("X-RequestId:1\r\nPath:turn.start\r\n\r\n{}")).toEqual([]);
    expect(parseEdgeMetadata("Path:audio.metadata\r\n\r\nnot json")).toEqual([]);
    expect(parseEdgeMetadata("")).toEqual([]);
  });

  it("丢掉空白与零时长，同起点的重复上报合并", () => {
    const words = wordsFromEdgeMetadata([
      { type: "WordBoundary", offset: 0, duration: 5_000_000, text: "  " },
      { type: "WordBoundary", offset: 1_000_000, duration: 0, text: "零" },
      { type: "WordBoundary", offset: 2_000_000, duration: 1_000_000, text: "甲" },
      { type: "WordBoundary", offset: 2_000_000, duration: 2_000_000, text: "甲" },
    ]);
    expect(words).toEqual([{ text: "甲", startMs: 200, endMs: 400 }]);
  });
});
