import { describe, expect, it } from "vitest";
import { fallbackCard, sanitizeCard, splitShotSize } from "./cards";

describe("信息卡校验", () => {
  it("数据卡的数字必须出自旁白", () => {
    const caption = "全世界每年浪费的粮食，高达十三亿吨。";
    expect(sanitizeCard({ variant: "stat", stat: { value: "十三亿", unit: "吨", label: "全球每年浪费的粮食" } }, caption)).toEqual({ variant: "stat", headline: undefined, stat: { value: "十三亿", unit: "吨", label: "全球每年浪费的粮" } });
    // 编造或换算过的数字 → 降级为短提示卡
    expect(sanitizeCard({ variant: "stat", headline: "粮食浪费", stat: { value: "1.3", unit: "十亿吨", label: "" } }, caption)).toEqual({ variant: "alert", alert: { type: "info", content: "粮食浪费" } });
    expect(sanitizeCard({ variant: "stat", stat: { value: "1,000", label: "" } }, "超过 1000 人")?.variant).toBe("stat");
  });

  it("列表至少两项、去重、截断", () => {
    expect(sanitizeCard({ variant: "list", items: ["成本太高", "成本太高"] }, "")).toBeUndefined();
    expect(sanitizeCard({ variant: "list", headline: "三个原因", items: ["成本太高。", "效率太低", "习惯难改"] }, "")?.items).toEqual(["成本太高", "效率太低", "习惯难改"]);
  });

  it("对比卡需要两边不同", () => {
    expect(sanitizeCard({ variant: "split", sides: ["十年前", "今天"] }, "")?.sides).toEqual(["十年前", "今天"]);
    expect(sanitizeCard({ variant: "split", headline: "变化", sides: ["今天", "今天"] }, "")).toEqual({ variant: "alert", alert: { type: "info", content: "变化" } });
  });

  it("移除问答、号召卡，保留提示、定义、时间线和人物卡", () => {
    expect(sanitizeCard({ variant: "qa", qa: { question: "为什么不愿意生孩子？", answer: "养不起" } }, "那问题来了")).toEqual({ variant: "alert", alert: { type: "info", content: "为什么不愿意生孩" } });
    expect(sanitizeCard({ variant: "cta", cta: { action: "现在就行动", subtitle: "不要再等了" } }, "")).toEqual({ variant: "alert", alert: { type: "info", content: "现在就行动" } });
    expect(sanitizeCard({ variant: "alert", alert: { type: "warning", content: "注意数据安全" } }, "")?.alert).toEqual({ type: "warning", content: "注意数据安全" });
    expect(sanitizeCard({ variant: "definition", definition: { term: "元宇宙", meaning: "虚拟世界和现实世界的深度融合" } }, "")?.definition?.term).toBe("元宇宙");
    expect(sanitizeCard({ variant: "timeline", timeline: [{ time: "2018年", event: "立项" }, { time: "2020年", event: "开工" }] }, "")?.timeline).toHaveLength(2);
    expect(sanitizeCard({ variant: "timeline", timeline: [{ time: "2018年", event: "立项" }] }, "只有一个节点")).toBeUndefined();
    expect(sanitizeCard({ variant: "profile", profile: { name: "张伟", role: "项目负责人", bio: "计算机系教授" } }, "")?.profile?.name).toBe("张伟");
  });

  it("卡片字段统一压到 8 个字以内", () => {
    const card = sanitizeCard({ variant: "definition", headline: "这是一个很长的卡片标题", definition: { term: "超长术语名称", meaning: "这是一段很长的解释文字" } }, "旁白");
    expect(card).toMatchObject({ variant: "definition" });
    expect(card?.headline?.length).toBeLessThanOrEqual(8);
    expect(card?.definition?.term.length).toBeLessThanOrEqual(8);
    expect(card?.definition?.meaning.length).toBeLessThanOrEqual(8);
  });

  it("不许把整句字幕照搬上屏", () => {
    const caption = "这就是我们常说的幸存者偏差效应。";
    expect(sanitizeCard({ variant: "quote", headline: "这就是我们常说的幸存者偏差效应" }, caption)).toBeUndefined();
    expect(sanitizeCard({ variant: "headline", headline: "幸存者偏差" }, caption)).toEqual({ variant: "alert", alert: { type: "info", content: "幸存者偏差" } });
  });
});

describe("信息卡兜底", () => {
  it("只认明确的信号", () => {
    expect(fallbackCard("增长了 35%", ["增长"])).toEqual({ variant: "stat", stat: { value: "35", unit: "%", label: "增长" } });
    // 普通数字和常见字「与」不再误判
    expect(fallbackCard("第3个人与他见面", [])).toEqual({ variant: "list", items: [] });
    expect(fallbackCard("相比燃油车，电动车更便宜", ["燃油车", "电动车"])).toEqual({ variant: "split", sides: ["燃油车", "电动车"] });
    expect(fallbackCard("有成本和效率的问题", ["成本", "效率"]).variant).toBe("list");
  });

  it("没有明确卡片信号时不生成文字卡", () => {
    expect(fallbackCard("他推开门，屋里一个人都没有。", [])).toEqual({ variant: "list", items: [] });
    expect(fallbackCard("他推开门，屋里一个人都没有。", ["空无一人"]).alert).toBeUndefined();
  });
});

describe("拆镜头换景别", () => {
  it("远近交替", () => {
    expect([1, 2, 3].map((k) => splitShotSize("wide", k))).toEqual(["close", "wide", "close"]);
    expect(splitShotSize(undefined, 1)).toBe("close");
  });
});
