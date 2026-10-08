import { countChars } from "../duration";
import { BURNED_MEMES, findMemeUses, groundedLevels, lostMemes, normalizeTerm, slangLevels, type MemeRef, type SlangLevel } from "../memes";
import { ruleById, rules, type RuleId } from "./rules";

/**
 * AI 味检测器（纯函数，前后端共用）。
 * 正则移植自 lieflat-less-ai-tone 的 scripts/*.py，并按 skill 的「算子过宽会误报」教训收窄：
 * 只认字面上可定位的触发标记，语义判断交给改写模型。命中只代表“疑似”。
 */

export type Hit = { rule: RuleId; start: number; end: number; text: string };

/** 表达检测上下文：所选词条、过气热梗、生效的网感与接地气力度 */
export type ToneContext = {
  memes?: (Pick<MemeRef, "term" | "variants"> & Partial<Pick<MemeRef, "category">>)[];
  stale?: string[];
  slang?: SlangLevel;
  groundedEnabled?: boolean;
  groundedLevel?: keyof typeof groundedLevels;
};

const P = "[^，。！？；\\n]"; // 分句内的字符
const HARD_END = /[。！？!?]/;

const patterns: Partial<Record<RuleId, RegExp[]>> = {
  flip: [
    new RegExp(`(?:不是|并非|不在于)${P}{1,20}[，,]?\\s*(?:而是|而在于)`, "g"),
    new RegExp(`(?:并不在|不在)${P}{1,20}[，,]\\s*而在`, "g"),
    new RegExp(`(?<!是)不是${P}{1,15}[，。]\\s*(?:而)?是(?!不是)`, "g"),
    /与其说[^。！？\n]{1,30}不如说/g,
    /看似[^。！？\n]{1,20}(?:实则|实际上|其实)/g,
    /表面上?[^。！？\n]{1,20}实际上?/g,
    /你以为[^。！？\n]{1,30}[？?，,]\s*(?:其实|实际上|错了|醒醒|但)/g,
    new RegExp(`${P}{1,10}不重要[，,]\\s*重要的是`, "g"),
    /回头才发现|说到底|答案恰恰相反|恰恰相反/g,
  ],
  enum: [/[^，。！？；：、\n]{1,14}、[^，。！？；：、\n]{1,14}、[^，。！？；：、\n]{1,14}/g],
  dash: [/—+|－{2,}/g],
  colon: [
    // 只匹配提示语+冒号，不碰对话、句中总分
    /(?:一句话(?:总结|说|概括)|简单说|总结|小结|结论|核心(?:是|在于|观点)?|关键(?:是|在于)?|重点(?:是)?|原因(?:如下|有[两二三四几]个|在于)?|答案(?:是)?|本质(?:是|上)?|换句话说|也就是说|我的(?:观点|判断|结论)|建议(?:是)?)[：:]/g,
    // 空转句：整行以冒号收尾，只为宣布下面有内容
    /[^。！？\n“”「」]{2,30}[：:][ \t]*$/gm,
  ],
  persona: [
    /(?:像|好比|相当于|如同|仿佛|宛如)(?:是)?(?:一个|一位|一名|个|位)?[^，。！？\n]{0,8}?(?:永不|不知疲倦|永远在线|智慧|全能|万能|贴身|贴心|忠实|忠诚|专属|私人|随身|得力|无所不知|全天候|24\s*小时)[^，。！？\n]{0,8}?(?:导师|秘书|助手|助理|顾问|管家|审查员|实习生|伙伴|向导|守护者|军师|保姆|教练|参谋|专家)/g,
  ],
  vague: [
    /(?:完成|实现|进行|开展)了?(?:对)?[^，。！？\n]{0,10}?的(?:优化|提升|调整|分析|改造|升级|改善|增长|突破)/g,
    /(?:进行|作出|做出|给予|予以)了?(?:一次|一番|全面|深入)?的?(?:分析|调整|优化|评估|检查|讨论|改进)/g,
  ],
  opener: [/说白了|说穿了|先说结论/g],
  // 解释梗：用了梗还怕观众听不懂
  slang: [/也就是(?:网上|网友们?|大家)(?:常|经常)?说的|用(?:现在|网上|网络上?)(?:流行|最火)?的话(?:来)?说|套用一句网络(?:热梗|流行语)|(?:这里|这个梗)的?[^，。！？\n]{0,10}(?:指的是|意思是)/g],
  translationese: [
    /(?:一个|一种|一套|这种|这个)[^，。、；：！？\n]{15,}的[一-鿿]{2,5}/g,
    new RegExp(`(?<![相适应正恰每充担])当${P}{2,20}时[，,]`, "g"),
    new RegExp(`对于${P}{2,15}来说|(?<![面相])对${P}{2,15}而言|就${P}{2,15}而言`, "g"),
    /(?<=^|[。！？!?])[ \t]*(?:然而|因此|此外|与此同时|换言之|总而言之)(?=[，,、])/gm,
    /这意味着|这表明|换句话说/g,
  ],
};

/** 概括说法：同段已有具体数字时才算把具体盖掉了 */
const VAGUE_SUMMARY = /显著(?:提升|提高|增长|改善|降低|下降)|大幅(?:提升|提高|增长|下降|降低|缩短|减少)|明显(?:改善|提升|提高)/g;
const HAS_NUMBER = /\d|百分之|[零一二三四五六七八九十百千万亿两半]+(?:倍|成|个百分点|分钟|小时|年|天|元|块|万|亿)/;

// 段首评论语与回指成分，取自 scripts/check-structure.py
const COMMENT = /^(?:听起来|看起来|看上去|听上去|意味着|值得注意的是|值得一提的是|不难看出|问题在于|原因在于|有意思的是|更重要的是|关键在于|真正的)/;
// “其实”“其他”“那么”不是回指
const ANAPHOR = /这|那(?![么])|其(?![实他])|此|上面|前面|刚才|以上|该|它/;

type Span = { start: number; text: string };

function paragraphs(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(/[^\n]+/g)) {
    const lead = m[0].length - m[0].trimStart().length;
    const t = m[0].trim();
    if (t) out.push({ start: m.index! + lead, text: t });
  }
  return out;
}

function sentences(p: Span): Span[] {
  return [...p.text.matchAll(/[^。！？!?]+[。！？!?]*/g)].map((m) => ({ start: p.start + m.index!, text: m[0] }));
}

/** 句子结构指纹：逗号数、有无冒号、有无括号、长度档（同 check-structure.py） */
const signature = (s: string) => `${(s.match(/，/g) ?? []).length}|${s.includes("：")}|${/[（(]/.test(s)}|${Math.floor(s.length / 15)}`;

function quoteRanges(text: string): [number, number][] {
  return [...text.matchAll(/“[^”\n]*”|「[^」\n]*」/g)].map((m) => [m.index!, m.index! + m[0].length]);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 过气热梗、超量热梗和重复的接地气表达（规则 12） */
function slangHits(text: string, ctx: ToneContext, push: (rule: RuleId, start: number, end: number) => void) {
  const picked = new Set((ctx.memes ?? []).flatMap((m) => [m.term, ...m.variants]).map(normalizeTerm));
  const burned = [...new Set([...BURNED_MEMES, ...(ctx.stale ?? [])])].filter((w) => w.length >= 2 && !picked.has(normalizeTerm(w)));
  if (burned.length) {
    const rx = new RegExp(burned.sort((a, b) => b.length - a.length).map(escape).join("|"), "gi");
    for (const m of text.matchAll(rx)) push("slang", m.index!, m.index! + m[0].length);
  }
  const level = ctx.slang;
  if (!ctx.memes?.length) return;
  const checkQuota = (memes: typeof ctx.memes, allowed: number) => {
    const occ = findMemeUses(text, memes ?? []);
    const seen = new Set<string>();
    let n = 0;
    for (const o of occ) {
      if (seen.has(o.term) || n >= allowed) push("slang", o.start, o.end);
      else n++;
      seen.add(o.term);
    }
  };
  const hot = ctx.memes.filter((m) => (m.category ?? "hot") === "hot");
  if (level && level !== "off" && hot.length) {
    // 同一热梗一段只用一次，总量随网感档位变化。
    checkQuota(hot, Math.max(1, Math.ceil(countChars(text) / slangLevels[level].charsPerMeme)));
  }
  const grounded = ctx.memes.filter((m) => m.category && m.category !== "hot");
  if (ctx.groundedEnabled && grounded.length) {
    const groundedLevel = ctx.groundedLevel ?? "medium";
    checkQuota(grounded, Math.max(1, Math.ceil(countChars(text) / groundedLevels[groundedLevel].charsPerExpression)));
  }
}

export function detectAiTone(text: string, ctx: ToneContext = {}): Hit[] {
  const hits: Hit[] = [];
  const push = (rule: RuleId, start: number, end: number) => {
    const s = start + (text.slice(start, end).length - text.slice(start, end).trimStart().length);
    if (end > s) hits.push({ rule, start: s, end, text: text.slice(s, end) });
  };

  for (const [rule, list] of Object.entries(patterns) as [RuleId, RegExp[]][])
    for (const rx of list) for (const m of text.matchAll(rx)) push(rule, m.index!, m.index! + m[0].length);

  slangHits(text, ctx, push);

  const paras = paragraphs(text);
  paras.forEach((p, i) => {
    if (HAS_NUMBER.test(p.text)) for (const m of p.text.matchAll(VAGUE_SUMMARY)) push("vague", p.start + m.index!, p.start + m.index! + m[0].length);

    const c = i > 0 && p.text.match(COMMENT);
    if (c) {
      const first = p.text.slice(c[0].length).split(HARD_END)[0];
      if (!ANAPHOR.test(first)) push("dangling", p.start, p.start + c[0].length);
    }

    // 连续三句同构（两句同构人类也常见，交给改写模型按规则判断）
    const ss = sentences(p).filter((s) => s.text.trim().length > 10);
    for (let k = 0; k + 3 <= ss.length; k++) {
      const sig = ss.slice(k, k + 3).map((s) => signature(s.text));
      if (sig[0].startsWith("0|")) continue;
      if (sig.every((x) => x === sig[0])) push("isomorph", ss[k].start, ss[k + 2].start + ss[k + 2].text.length);
    }
  });

  // 引语不改；同一规则重叠的命中只留一处
  const quotes = quoteRanges(text);
  const sorted = hits.filter((h) => !quotes.some(([a, b]) => h.start >= a && h.end <= b)).sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Hit[] = [];
  for (const h of sorted) if (!out.some((o) => o.rule === h.rule && h.start < o.end && o.start < h.end)) out.push(h);
  return out;
}

const ORDINAL_TITLE = /^\s*(?:[一二三四五六七八九十]+\s*[、.．]|第[一二三四五六七八九十\d]+\s*(?:[、，,.．：:]|章|节|部分)?|\d+\s*[、.．])\s*/;

/** 规则 6：章节标题连续三个以上用序数编号时，去掉编号，保留原有文字（机械规则，无需模型） */
export function stripOrdinalTitles<T extends { title: string }>(sections: T[]): T[] {
  let run = 0;
  let longest = 0;
  for (const s of sections) {
    run = ORDINAL_TITLE.test(s.title) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  if (longest < 3) return sections;
  return sections.map((s) => {
    const title = s.title.replace(ORDINAL_TITLE, "").trim();
    return title ? { ...s, title } : s;
  });
}

/** 每千字命中数（按汉字计） */
export function density(text: string, hits = detectAiTone(text)) {
  const k = (text.match(/[一-鿿]/g)?.length ?? 0) / 1000;
  return k > 0 ? hits.length / k : 0;
}

export function groupHits(hits: Hit[]) {
  const map = new Map<RuleId, Hit[]>();
  for (const h of hits) map.set(h.rule, [...(map.get(h.rule) ?? []), h]);
  return [...map.entries()].map(([rule, list]) => ({ rule: ruleById[rule], hits: list })).sort((a, b) => a.rule.no - b.rule.no);
}

/** 字数漂移上限：去 AI 味只做最小改动，漂移大多半是模型顺手扩写或删减了信息；短段落另给固定余量 */
export const MAX_DRIFT = 0.15;
const DRIFT_SLACK = 20;

const bigrams = (s: string) => {
  const c = s.replace(/[\s\p{P}\p{S}]/gu, "");
  const out = new Set<string>();
  for (let i = 0; i + 1 < c.length; i++) out.add(c.slice(i, i + 2));
  return out;
};

/** 规则例句按分句拆开，用来发现模型把例句抄进稿子 */
const clausesOf = (s: string) => s.split(/[，。！？、；：]/).map((x) => x.trim()).filter((x) => x.length >= 6);
const examplePairs = rules.flatMap((r) => r.examples).map(([bad, good]) => ({ bad, clauses: [...new Set([...clausesOf(bad), ...clausesOf(good)])] }));

/** 新句子里原文没有的二字组超过这个比例，多半是凭空写出来的。规则 7 的正当改写能到 0.875，编造的句子接近 1（skill：改写后的每个实词都要能在原文里找到出处） */
const MAX_NOVELTY = 0.9;
const NOVELTY_MIN_CHARS = 12;

/**
 * 去 AI 味结果的验收（对应 skill 的「最终验收」里能机械检查的部分）：
 * 段落数不变、字数漂移不超限、没有抄入规则例句、没有凭空多出的句子、选用的梗没被删、疑似命中不增加。不通过就保留原文。
 */
export function acceptHumanized(before: string, after: string, ctx: ToneContext = {}): { ok: true } | { ok: false; reason: string } {
  const a = after.trim();
  if (!a) return { ok: false, reason: "结果为空" };
  // 超量删掉的梗不算丢：只要求每个用过的梗至少留一处
  const lost = lostMemes(before, a, ctx.memes ?? []);
  if (lost.length) return { ok: false, reason: `删掉了选用的梗：${lost.join("、")}` };
  if (paragraphs(before).length !== paragraphs(a).length) return { ok: false, reason: "段落结构被改动" };
  const b = countChars(before);
  if (Math.abs(countChars(a) - b) > Math.max(b * MAX_DRIFT, DRIFT_SLACK)) return { ok: false, reason: "改动幅度过大，可能增删了信息" };
  const known = bigrams(before);
  const novelty = (s: string) => {
    const g = [...bigrams(s)];
    return g.length ? g.filter((x) => !known.has(x)).length / g.length : 0;
  };
  // 原文本来就像某条反例时，改出对应正例的样子是正常的；只拦和原文无关的例句
  if (examplePairs.some((p) => novelty(p.bad) > 0.5 && p.clauses.some((c) => a.includes(c) && !before.includes(c)))) return { ok: false, reason: "混入了规则里的例句" };
  for (const s of a.split(/[。！？!?\n]/)) {
    if (before.includes(s) || countChars(s) < NOVELTY_MIN_CHARS) continue;
    if (novelty(s) > MAX_NOVELTY) return { ok: false, reason: `新增了原文没有的内容：「${s.trim().slice(0, 20)}」` };
  }
  if (detectAiTone(a, ctx).length > detectAiTone(before, ctx).length) return { ok: false, reason: "疑似 AI 痕迹不降反增" };
  return { ok: true };
}
