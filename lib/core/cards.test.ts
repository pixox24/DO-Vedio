import { describe, expect, it } from "vitest";
import { fallbackCard, sanitizeCard, splitShotSize } from "./cards";

describe("信息卡校验", () => {
  it("数据卡的数字必须出自旁白", () => {
    const caption = "全世界每年浪费的粮食，高达十三亿吨。";
    expect(sanitizeCard({ variant: "stat", stat: { value: "十三亿", unit: "吨", label: "全球每年浪费的粮食" } }, caption)).toEqual({ variant: "stat", headline: undefined, stat: { value: "十三亿", unit: "吨", label: "全球每年浪费的粮食" } });
    // 编造或换算过的数字 → 降级为标题卡
    expect(sanitizeCard({ variant: "stat", headline: "粮食浪费", stat: { value: "1.3", unit: "十亿吨", label: "" } }, caption)).toEqual({ variant: "headline", headline: "粮食浪费" });
    expect(sanitizeCard({ variant: "stat", stat: { value: "1,000", label: "" } }, "超过 1000 人")?.variant).toBe("stat");
  });

  it("列表至少两项、去重、截断", () => {
    expect(sanitizeCard({ variant: "list", items: ["成本太高", "成本太高"] }, "")).toBeUndefined();
    expect(sanitizeCard({ variant: "list", headline: "三个原因", items: ["成本太高。", "效率太低", "习惯难改"] }, "")?.items).toEqual(["成本太高", "效率太低", "习惯难改"]);
  });

  it("对比卡需要两边不同", () => {
    expect(sanitizeCard({ variant: "split", sides: ["十年前", "今天"] }, "")?.sides).toEqual(["十年前", "今天"]);
    expect(sanitizeCard({ variant: "split", headline: "变化", sides: ["今天", "今天"] }, "")).toEqual({ variant: "headline", headline: "变化" });
  });

  it("不许把整句字幕照搬上屏", () => {
    const caption = "这就是我们常说的幸存者偏差效应。";
    expect(sanitizeCard({ variant: "quote", headline: "这就是我们常说的幸存者偏差效应" }, caption)).toBeUndefined();
    expect(sanitizeCard({ variant: "headline", headline: "幸存者偏差" }, caption)).toEqual({ variant: "headline", headline: "幸存者偏差" });
  });
});

describe("信息卡兜底", () => {
  it("只认明确的信号", () => {
    expect(fallbackCard("增长了 35%", ["增长"])).toEqual({ variant: "stat", stat: { value: "35", unit: "%", label: "增长" } });
    // 普通数字和常见字「与」不再误判
    expect(fallbackCard("第3个人与他见面", []).variant).toBe("headline");
    expect(fallbackCard("相比燃油车，电动车更便宜", ["燃油车", "电动车"])).toEqual({ variant: "split", sides: ["燃油车", "电动车"] });
    expect(fallbackCard("有成本和效率的问题", ["成本", "效率"]).variant).toBe("list");
  });

  it("标题只用关键词或第一个短分句，不复述整句", () => {
    expect(fallbackCard("他推开门，屋里一个人都没有。", [])).toEqual({ variant: "headline", headline: "他推开门" });
    expect(fallbackCard("他推开门，屋里一个人都没有。", ["空无一人"]).headline).toBe("空无一人");
  });
});

describe("拆镜头换景别", () => {
  it("远近交替", () => {
    expect([1, 2, 3].map((k) => splitShotSize("wide", k))).toEqual(["close", "wide", "close"]);
    expect(splitShotSize(undefined, 1)).toBe("close");
  });
});
