import { describe, expect, it } from "vitest";
import { acceptHumanized, detectAiTone, groupHits, stripOrdinalTitles } from "./detect";
import { rules, type RuleId } from "./rules";

const rulesOf = (text: string) => new Set(detectAiTone(text).map((h) => h.rule));

describe("detectAiTone：skill 自带的反例都能认出，正例不误报", () => {
  // 需要语义判断的例句（顿号只有一个的并列、零逗号同构、小标题）不在检测器范围内，交给改写模型
  const skip = new Set<RuleId>(["enum", "isomorph", "ordinal"]);
  for (const rule of rules.filter((r) => !skip.has(r.id))) {
    for (const [bad, good] of rule.examples) {
      // 段首零主语只看非首段
      const wrap = (s: string) => (rule.id === "dangling" ? `上一段。\n${s}` : s);
      it(`${rule.name}：${bad}`, () => {
        expect(rulesOf(wrap(bad))).toContain(rule.id);
        expect(rulesOf(wrap(good))).not.toContain(rule.id);
      });
    }
  }
});

describe("detectAiTone：命中位置与边界", () => {
  it("返回可定位的原文片段", () => {
    const text = "先铺垫一句。答案其实很简单——专注。";
    const [hit] = detectAiTone(text).filter((h) => h.rule === "dash");
    expect(text.slice(hit.start, hit.end)).toBe("——");
  });

  it("“并不在……而在……”也是翻案", () => {
    expect(rulesOf("答案并不在需求端，而在供给侧的结构性过剩。")).toContain("flip");
  });

  it("顿号串起三项以上才算", () => {
    expect(rulesOf("我们要看成本、效率、体验三件事。")).toContain("enum");
    expect(rulesOf("成本和效率都要看。")).not.toContain("enum");
  });

  it("连续三句同构能认出，两句不报", () => {
    const three = "张三去了北京，想找一份工作。李四去了上海，想开一家小店。王五去了广州，想学一门手艺。";
    expect(rulesOf(three)).toContain("isomorph");
    expect(rulesOf("张三去了北京，想找一份工作。李四去了上海，想开一家小店。")).not.toContain("isomorph");
  });

  it("概括词只在同段已有具体数字时才算盖掉具体", () => {
    expect(rulesOf("新系统上线后效率大幅提升，处理时间从两小时缩短到四十分钟。")).toContain("vague");
    expect(rulesOf("新系统上线后效率大幅提升。")).not.toContain("vague");
  });

  it("段首评论带回指时不报", () => {
    expect(rulesOf("上一段。\n值得注意的是，这个配置本来就分层放着。")).not.toContain("dangling");
    expect(rulesOf("值得注意的是，配置本来就分层放着。")).not.toContain("dangling");
  });

  it("首段和句中的连接词不算路标", () => {
    expect(rulesOf("上一句说完了。然而，这个方案并不适用。")).toContain("translationese");
    expect(rulesOf("这个方案然而并不适用。")).not.toContain("translationese");
  });
});

describe("detectAiTone：人类同样常用的写法不报（skill「不作为改写理由」）", () => {
  it.each([
    ["设问", "为什么天空是蓝色的？因为蓝光的波长短。"],
    ["具体的人当喻体", "他就像一个老师傅，一眼就看出毛病在哪。"],
    ["句内排比", "更高效，更专注，更有创造力。"],
    ["正文里的首先其次", "首先要看预算，其次要看人手。"],
    ["引出原话的冒号", "他说：“明天再谈。”"],
    ["“当时”不是“当……时”", "当时，没有人注意到这件事。"],
    ["“是不是”不是翻案", "你是不是也这样想，是的话就点个赞。"],
  ])("%s", (_, text) => {
    expect(detectAiTone(text)).toEqual([]);
  });

  it("引语内部不改", () => {
    expect(detectAiTone("老板只回了一句：“这不是钱的问题，而是态度的问题。”").filter((h) => h.rule === "flip")).toEqual([]);
  });
});

describe("硬凹网感（规则 12）", () => {
  const memes = [{ term: "破防了", variants: ["破大防"] }, { term: "班味", variants: [] }];
  const slangOf = (text: string, ctx = {}) => detectAiTone(text, ctx).filter((h) => h.rule === "slang").map((h) => h.text);
  it("过气梗和梗库里已过气的梗", () => {
    expect(slangOf("家人们谁懂啊，这波操作yyds。")).toEqual(["家人们谁懂啊", "yyds"]);
    expect(slangOf("这个梗早就过气了：尊嘟假嘟。", { stale: ["早就过气"] })).toEqual(["早就过气", "尊嘟假嘟"]);
  });
  it("用户选用的梗不算过气", () => {
    expect(slangOf("这波yyds。", { memes: [{ term: "yyds", variants: [] }] })).toEqual([]);
  });
  it("日常词汇和家人的“家人们”不报", () => {
    expect(slangOf("打工人卷不动了，只想躺平。家人们都睡了。")).toEqual([]);
  });
  it("解释梗", () => {
    expect(slangOf("他当场心态崩了，也就是网上说的破大防。")).toContain("也就是网上说的");
    expect(slangOf("用现在流行的话说，这叫班味。")).toContain("用现在流行的话说");
  });
  it("超出网感档位的用量、同一个梗一段里出现两次", () => {
    const text = "我破防了。".padEnd(60, "字") + "身上全是班味，又破大防。";
    expect(slangOf(text, { memes, slang: "light" })).toEqual(["班味", "破大防"]);
    const long = "我破防了。".padEnd(300, "字") + "身上全是班味，又破大防。";
    expect(slangOf(long, { memes, slang: "heavy" })).toEqual(["破大防"]);
    expect(slangOf(text, { memes, slang: "off" })).toEqual([]);
  });
});

describe("groupHits", () => {
  it("按规则编号分组计数", () => {
    const g = groupHits(detectAiTone("说白了，答案是——专注。说穿了也就这样。"));
    expect(g.map((x) => [x.rule.id, x.hits.length])).toEqual([
      ["dash", 1],
      ["opener", 2],
    ]);
  });
});

describe("stripOrdinalTitles", () => {
  it("连续三个以上序数标题去掉编号，保留原文字", () => {
    const out = stripOrdinalTitles([{ title: "一、开场" }, { title: "二、为什么会这样" }, { title: "第三章 怎么办" }, { title: "结尾" }]);
    expect(out.map((s) => s.title)).toEqual(["开场", "为什么会这样", "怎么办", "结尾"]);
  });
  it("只有一两个编号时不动", () => {
    const list = [{ title: "一、开场" }, { title: "为什么" }, { title: "二、结尾" }];
    expect(stripOrdinalTitles(list)).toBe(list);
  });
});

describe("acceptHumanized", () => {
  const before = "真正的壁垒不是技术，而是认知。说白了，这件事没那么复杂。\n第二段保持不动。";
  it("最小改动通过", () => {
    expect(acceptHumanized(before, "真正的壁垒是认知。这件事没那么复杂。\n第二段保持不动。")).toEqual({ ok: true });
  });
  it("段落数变了不通过", () => {
    expect(acceptHumanized(before, "真正的壁垒是认知。这件事没那么复杂。第二段保持不动。").ok).toBe(false);
  });
  it("大幅扩写不通过", () => {
    expect(acceptHumanized(before, `${before.split("\n")[0]}我们再补充很多很多原文没有的内容，让它看起来更丰富更具体。\n第二段保持不动。`).ok).toBe(false);
  });
  it("skill 自己的每组改写都能通过验收（守住误杀）", () => {
    for (const r of rules) for (const [bad, good] of r.examples) expect(acceptHumanized(`${bad}\n`, good), `${r.name}：${good}`).toEqual({ ok: true });
  });
  it("抄入规则例句不通过（实测 DeepSeek 出现过）", () => {
    const src = "上一段。\n值得注意的是，大脑一直在处理信息。";
    expect(acceptHumanized(src, "上一段。\n这听起来像一条功能描述，其实底下换掉了一样更根本的东西。大脑一直在处理信息。")).toMatchObject({ ok: false, reason: "混入了规则里的例句" });
  });
  it("凭空多出一句原文没有的话不通过", () => {
    const src = "每天快走二十分钟，疲劳感降低了百分之三十。";
    expect(acceptHumanized(src, "每天快走二十分钟，疲劳感降低了百分之三十。哈佛大学的研究团队也证实过这个结论。").ok).toBe(false);
  });
  it("删掉选用的梗不通过", () => {
    const memes = [{ term: "破防了", variants: [] }];
    expect(acceptHumanized("说白了，我直接破防了。", "我直接破防了。", { memes })).toEqual({ ok: true });
    expect(acceptHumanized("说白了，我直接破防了。", "我很难过。", { memes })).toMatchObject({ ok: false, reason: "删掉了选用的梗：破防了" });
  });
  it("疑似命中增加不通过", () => {
    expect(acceptHumanized("这件事没那么复杂。", "这件事——没那么复杂。").ok).toBe(false);
  });
});
