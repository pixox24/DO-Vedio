import { z } from "zod";

/** 热梗 / 流行表达：前后端共用的数据模型与纯函数 */

export const slangLevels = {
  off: { label: "关", charsPerMeme: 0 },
  light: { label: "点缀", charsPerMeme: 600 },
  medium: { label: "适中", charsPerMeme: 400 },
  heavy: { label: "浓", charsPerMeme: 250 },
} as const;
export type SlangLevel = keyof typeof slangLevels;
export const slangLevelIds = Object.keys(slangLevels) as [SlangLevel, ...SlangLevel[]];

/** brief.slang 为 auto 时跟随风格模板 */
export function resolveSlang(slang: SlangLevel | "auto", template?: { slang?: SlangLevel }): SlangLevel {
  return slang === "auto" ? (template?.slang ?? "off") : slang;
}

/** 同一个梗全片最多出现几次 */
export const MAX_USES_PER_MEME = 2;

/** 这段字数允许用几处梗；不足一处时返回 0，由提示词允许“特别贴切时最多 1 处” */
export function memeBudget(chars: number, level: SlangLevel) {
  const per = slangLevels[level].charsPerMeme;
  return per ? Math.floor(chars / per) : 0;
}

/** 圈层：按圈层刷新能扩充梗库的多样性，也用来在梗库里筛选 */
export const memeCircles = ["职场", "情感", "校园", "游戏", "二次元", "影视综艺", "体育", "美食", "数码科技", "生活日常"] as const;
export type MemeCircle = (typeof memeCircles)[number];
/** 模型给的圈层不在列表里时归为空（未分类） */
export const toCircle = (s: string): MemeCircle | "" => ((memeCircles as readonly string[]).includes(s.trim()) ? (s.trim() as MemeCircle) : "");

export const memeKinds = { word: "词汇", pattern: "句式", catchphrase: "口头禅", pun: "谐音" } as const;
export const memeHeats = { rising: "上升", peak: "高峰", fading: "退潮", dead: "过气" } as const;
export const memeRisks = { safe: "安全", caution: "慎用", banned: "禁用" } as const;
export type MemeHeat = keyof typeof memeHeats;
export type MemeRisk = keyof typeof memeRisks;

/** 模型整理出的一条梗（联网抓取的结构化结果） */
export const memeInputSchema = z.object({
  term: z.string().trim().min(1).max(24).describe("梗本身，最常见的写法"),
  variants: z.array(z.string()).default([]).describe("其他常见写法"),
  // 模型偶尔给出列表外的值（实测有 "phrase"），单条兜底，避免整批作废
  kind: z.enum(["word", "pattern", "catchphrase", "pun"]).catch("word"),
  meaning: z.string().describe("含义，一句话"),
  usage: z.string().describe("怎么用：在句子里当什么成分、搭什么语气、适合放在哪"),
  example: z.string().describe("一个自然的例句"),
  tone: z.string().default("").describe("语气：调侃、自嘲、夸、吐槽、共鸣等"),
  platform: z.string().default("").describe("主要流行的平台"),
  since: z.string().default("").describe("大约从什么时候开始流行，如 2026 年 8 月"),
  heat: z.enum(["rising", "peak", "fading", "dead"]).catch("fading"),
  risk: z.enum(["safe", "caution", "banned"]).catch("caution").describe("caution：可能冒犯群体、低俗、饭圈、涉及真实人物；banned：涉政、歧视、色情"),
  say: z.string().default("").describe("字母缩写或特殊写法的中文读法（如 yyds → 永远的神），普通汉字梗留空"),
  circle: z.string().default("").describe(`主要流行的圈层，从这些里选一个：${memeCircles.join("、")}；都不合适就留空`),
});
export type MemeInput = z.infer<typeof memeInputSchema>;
export const memeBatchSchema = z.object({ memes: z.array(memeInputSchema) });

/** 选梗结果：按候选序号引用，避免模型把梗名写错 */
export const memePickSchema = z.object({
  picks: z.array(z.object({ index: z.number().int().describe("候选序号"), where: z.string().describe("一句话：这期里可以用在什么位置、什么语境") })),
});

export type MemeSource = "search" | "manual" | "import";
export const memeSources: Record<MemeSource, string> = { search: "联网搜索", manual: "手动添加", import: "粘贴导入" };

/**
 * 可信度：新抓的梗入库前逐个单独联网核实。
 * verified 多个独立来源查得到（或来自用户手动添加、粘贴导入）；doubtful 来源不足或拿不出原句，不进候选；unchecked 旧数据还没核实过。
 */
export type MemeTrust = "verified" | "doubtful" | "unchecked";
export const memeTrusts: Record<MemeTrust, string> = { verified: "已核实", doubtful: "待核实", unchecked: "未核实" };

export type Meme = MemeInput & { id: string; source: MemeSource; trust: MemeTrust; sinceMonth: string; verifiedAt: number; createdAt: number; updatedAt: number };

/** 本期选用的梗：快照进项目的 brief，梗库之后怎么改都不影响已有项目 */
export const memeRefSchema = z.object({
  term: z.string(),
  variants: z.array(z.string()).default([]),
  meaning: z.string(),
  usage: z.string(),
  example: z.string(),
  where: z.string().default(""),
});
export type MemeRef = z.infer<typeof memeRefSchema>;

export const toRef = (m: Pick<Meme, "term" | "variants" | "meaning" | "usage" | "example">, where = ""): MemeRef => ({
  term: m.term,
  variants: m.variants,
  meaning: m.meaning,
  usage: m.usage,
  example: m.example,
  where,
});

const DAY = 86_400_000;
/** 超过这么久没被搜到也没被确认，视为退潮 */
export const STALE_DAYS = 60;

/** 实际热度：长期没被再次搜到的梗自动降级（读时计算，不改库） */
export function effectiveHeat(heat: MemeHeat, verifiedAt: number, now = Date.now()): MemeHeat {
  if ((heat === "rising" || heat === "peak") && now - verifiedAt > STALE_DAYS * DAY) return "fading";
  return heat;
}

/** 可进入选梗候选：安全、仍在流行、没被核实判为存疑 */
export function isCandidate(m: Pick<Meme, "risk" | "heat" | "verifiedAt"> & { trust?: MemeTrust }, now = Date.now()) {
  const heat = effectiveHeat(m.heat, m.verifiedAt, now);
  return m.risk === "safe" && m.trust !== "doubtful" && (heat === "rising" || heat === "peak");
}

// ---------- 流行时间 ----------

/** 搜索时间窗口（月） */
export const searchWindows = { 1: "近 1 个月", 3: "近 3 个月", 6: "近半年" } as const;
export type SearchWindow = keyof typeof searchWindows;

/**
 * 从模型写的流行时间里解析出“年-月”（2026-08）；只有年份时返回“2026”，解析不出返回空。
 * 旧数据是自由文本（“2026年9月1日”“2023年9月”“今年夏天”），读的时候解析，不改库。
 */
export function parseSinceMonth(text: string): string {
  const t = text.replace(/\s/g, "");
  const ym = t.match(/(20\d{2})(?:年|[-/.])(\d{1,2})(?:月|[-/.]|$|日|\D)/);
  if (ym && +ym[2] >= 1 && +ym[2] <= 12) return `${ym[1]}-${ym[2].padStart(2, "0")}`;
  const y = t.match(/(20\d{2})年?/);
  return y ? y[1] : "";
}

/** 按流行起始时间分档，库内筛选用 */
export const sinceBuckets = { m3: "近 3 个月", m6: "近半年", y1: "近一年", older: "更早", unknown: "时间不详" } as const;
export type SinceBucket = keyof typeof sinceBuckets;

export function sinceBucket(sinceMonth: string, now = new Date()): SinceBucket {
  const m = sinceMonth.match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!m) return "unknown";
  // 只有年份时按年中估算
  const months = (now.getFullYear() - +m[1]) * 12 + (now.getMonth() + 1 - (m[2] ? +m[2] : 6));
  return months <= 3 ? "m3" : months <= 6 ? "m6" : months <= 12 ? "y1" : "older";
}

// ---------- 核实 ----------

export type Verdict = { trust: MemeTrust; found: boolean; sources: number; sinceMonth: string; heat?: MemeHeat; evidence: string };

const HEAT_WORDS: [RegExp, MemeHeat][] = [
  [/过气/, "dead"],
  [/退潮/, "fading"],
  [/正火/, "peak"],
  [/刚起来|上升/, "rising"],
];

/**
 * 解析单个梗的核实结果（固定格式的纯文本）。
 * 判为已核实需要同时满足：结论为真实、独立来源 ≥ 2、给出的原句里确实有这个词（防止模型顺着编）。
 * 结论为“查不到”返回 found = false（新梗直接丢弃）；其余情况为待核实。
 */
export function parseVerdict(text: string, forms: string[]): Verdict {
  const line = (label: string) => text.match(new RegExp(`${label}[：:]\\s*(.+)`))?.[1]?.trim() ?? "";
  const conclusion = line("结论");
  const sources = Number(line("独立来源").match(/\d+/)?.[0] ?? 0);
  const evidence = line("原文");
  const heatText = line("当前热度");
  const heat = HEAT_WORDS.find(([rx]) => rx.test(heatText))?.[1];
  const sinceMonth = parseSinceMonth(line("流行起始"));
  // 格式对不上：存疑但保留；明确查不到：新梗直接丢弃
  if (!conclusion) return { trust: "doubtful", found: true, sources, sinceMonth, heat, evidence };
  if (/查不到/.test(conclusion)) return { trust: "doubtful", found: false, sources, sinceMonth, heat, evidence };
  const quoted = forms.some((f) => normalizeTerm(evidence).includes(normalizeTerm(f)));
  const trust: MemeTrust = /真实/.test(conclusion) && sources >= 2 && quoted ? "verified" : "doubtful";
  return { trust, found: true, sources, sinceMonth, heat, evidence };
}

export const normalizeTerm = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();

const formsOf = (m: Pick<MemeRef, "term" | "variants">) => [m.term, ...m.variants].map((x) => x.trim()).filter((x) => x.length >= 2);

export type MemeUse = { term: string; start: number; end: number };

/**
 * 文本里每处用梗的位置（按原写法和变体匹配，化用认不出）。
 * 长的写法优先、互不重叠，所以“班味浓度”只算一处“班味”。
 */
export function findMemeUses(text: string, memes: Pick<MemeRef, "term" | "variants">[]): MemeUse[] {
  const forms = memes.flatMap((m) => [...new Set(formsOf(m))].map((f) => ({ term: m.term, f }))).sort((a, b) => b.f.length - a.f.length);
  const taken: MemeUse[] = [];
  for (const { term, f } of forms) {
    for (let i = text.indexOf(f); i >= 0; i = text.indexOf(f, i + f.length)) {
      const end = i + f.length;
      if (!taken.some((u) => i < u.end && u.start < end)) taken.push({ term, start: i, end });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

/** 文本里每个梗出现了几次 */
export function countMemeUses(text: string, memes: Pick<MemeRef, "term" | "variants">[]) {
  const out = new Map<string, number>();
  for (const u of findMemeUses(text, memes)) out.set(u.term, (out.get(u.term) ?? 0) + 1);
  return out;
}

/** 原文里用到的梗，改写后必须还在；返回丢掉的梗 */
export function lostMemes(before: string, after: string, memes: Pick<MemeRef, "term" | "variants">[]) {
  const had = countMemeUses(before, memes);
  const has = countMemeUses(after, memes);
  return [...had.keys()].filter((t) => !has.has(t));
}

/**
 * 抓取结果并入梗库：按 term / variants 归一化去重。
 * 已有的续期（更新热度和确认时间），新的插入；禁用级别的不入库，没写流行时间或平台的丢弃（减少编造）。
 * 用户自己粘贴、手动添加的来源可信，不要求写明流行时间和平台（requireProvenance = false）。
 */
export function mergeFetched<T extends Pick<Meme, "id" | "term" | "variants">>(
  existing: T[],
  incoming: MemeInput[],
  { requireProvenance = true, blocked = new Set<string>() }: { requireProvenance?: boolean; blocked?: Set<string> } = {},
) {
  const index = new Map<string, T>();
  for (const e of existing) for (const f of [e.term, ...e.variants]) index.set(normalizeTerm(f), e);
  const inserts: MemeInput[] = [];
  const updates: { id: string; input: MemeInput }[] = [];
  let dropped = 0;
  let skipped = 0;
  const seen = new Set<string>();
  for (const m of incoming) {
    const key = normalizeTerm(m.term);
    // 用户屏蔽过（删除时选了“不再收录”）的梗，任何写法都跳过
    if ([m.term, ...m.variants].some((f) => blocked.has(normalizeTerm(f)))) {
      skipped++;
      continue;
    }
    if (!key || m.risk === "banned" || (requireProvenance && (!m.since.trim() || !m.platform.trim())) || seen.has(key)) {
      dropped++;
      continue;
    }
    for (const f of [m.term, ...m.variants]) seen.add(normalizeTerm(f));
    const hit = [m.term, ...m.variants].map((f) => index.get(normalizeTerm(f))).find(Boolean);
    if (hit) updates.push({ id: hit.id, input: m });
    else inserts.push(m);
  }
  return { inserts, updates, dropped, blocked: skipped };
}

/**
 * 大纲的用梗分配清洗：只留本期选用的梗，同一个梗只分给一章，每章最多 2 个，全片不超过 limit。
 * 网感关闭或没选梗时去掉分配。返回的每章都带 memes 数组，表示“已分配”（空数组 = 本章不用梗）。
 */
export function assignMemes<T extends { memes?: string[] }>(sections: T[], picked: Pick<MemeRef, "term" | "variants">[] | null, limit: number): T[] {
  if (!picked?.length) return sections.map((s) => ({ ...s, memes: undefined }));
  const byForm = new Map<string, string>();
  for (const m of picked) for (const f of [m.term, ...m.variants]) byForm.set(normalizeTerm(f), m.term);
  const used = new Set<string>();
  let total = 0;
  return sections.map((s) => {
    const memes: string[] = [];
    for (const raw of s.memes ?? []) {
      const term = byForm.get(normalizeTerm(raw));
      if (!term || used.has(term) || memes.length >= 2 || total >= limit) continue;
      used.add(term);
      memes.push(term);
      total++;
    }
    return { ...s, memes };
  });
}

/** 本章可用的梗：大纲分配过就按分配，没分配过（旧大纲）就给全部 */
export function memesForSection(picked: MemeRef[], assigned: string[] | undefined) {
  return assigned ? picked.filter((m) => assigned.includes(m.term)) : picked;
}

/**
 * 过气或被 AI 用滥的网络梗：模型凭记忆“凹网感”时最爱用，观众一听就出戏。
 * 只收字面稳定、已经明显过时的写法；打工人、内卷、躺平这类已经进入日常词汇的不算。
 */
export const BURNED_MEMES = [
  "yyds", "YYDS", "绝绝子", "家人们谁懂啊", "谁懂啊家人们", "宝子们", "集美们", "狠狠拿捏", "拿捏住了", "泰裤辣", "栓Q", "芭比Q了", "夺笋啊",
  "奥利给", "蚌埠住了", "雨女无瓜", "u1s1", "xswl", "咱就是说", "一整个爱住", "尊嘟假嘟", "退！退！退！", "听我说谢谢你", "emo了",
];

// ---------- 粘贴导入 ----------

/** 从用户粘贴的文章、评论、弹幕里抽取的梗 */
export const memeImportSchema = z.object({
  publishedAt: z.string().default("").describe("原文能看出的发布时间（年-月，如 2026-09），看不出填空字符串"),
  memes: z.array(
    memeInputSchema.extend({
      explained: z.boolean().default(false).describe("原文有没有解释这个梗的含义；没解释、含义是按上下文推测的填 false"),
    }),
  ),
});
export type ImportExtract = z.infer<typeof memeImportSchema>["memes"][number];

export type ImportStatus = "new" | "existing" | "blocked";
export const importStatuses: Record<ImportStatus, string> = { new: "新梗", existing: "库里已有，会续期", blocked: "你屏蔽过" };

/** 预览里的一条候选 */
export type ImportCandidate = {
  input: MemeInput;
  /** 原文里出现这个梗的那句话（程序从原文截取，不用模型给的引文） */
  context: string;
  /** 原文没解释含义，含义是 AI 按上下文推测的 */
  inferred: boolean;
  status: ImportStatus;
  /** status = existing 时，库里对应的梗名 */
  existingTerm?: string;
};

const SENTENCE_END = /[。！？!?\n]/;
const CONTEXT_MAX = 90;

/** 这个梗在原文里第一次出现的位置（英文忽略大小写） */
function findForm(text: string, forms: string[]) {
  const lower = text.toLowerCase();
  for (const f of forms.map((x) => x.trim()).filter(Boolean)) {
    const i = lower.indexOf(f.toLowerCase());
    if (i >= 0) return { start: i, end: i + f.length };
  }
  return null;
}

/** 截取包含这个位置的那句话，太长时以梗为中心截断 */
function sentenceAround(text: string, start: number, end: number) {
  let a = start;
  while (a > 0 && !SENTENCE_END.test(text[a - 1])) a--;
  let b = end;
  while (b < text.length && !SENTENCE_END.test(text[b])) b++;
  if (b < text.length) b++;
  let s = text.slice(a, b).trim();
  if (s.length > CONTEXT_MAX) {
    const mid = start - a;
    const from = Math.max(0, mid - CONTEXT_MAX / 2);
    s = `${from > 0 ? "…" : ""}${s.slice(from, from + CONTEXT_MAX).trim()}…`;
  }
  return s;
}

/**
 * 用原文校验抽取结果：梗（或它的某种写法）必须出现在原文里，否则丢弃（防止模型顺手“整理”出原文没有的词）。
 * 例句只有在原文里真的出现过才保留，否则换成原文里的那句话。
 */
export function groundCandidate(text: string, c: ImportExtract): { input: MemeInput; context: string; inferred: boolean } | null {
  const hit = findForm(text, [c.term, ...c.variants]);
  if (!hit) return null;
  const context = sentenceAround(text, hit.start, hit.end);
  const exampleInText = c.example.trim() && normalizeTerm(text).includes(normalizeTerm(c.example));
  const { explained, ...input } = c;
  return { input: { ...input, example: exampleInText ? c.example.trim() : context.replace(/^…|…$/g, "") }, context, inferred: !explained };
}

/** 候选和梗库对照：新梗 / 库里已有 / 屏蔽过 */
export function classifyImport(existing: Pick<Meme, "term" | "variants">[], blocked: Set<string>, input: MemeInput): { status: ImportStatus; existingTerm?: string } {
  const forms = [input.term, ...input.variants].map(normalizeTerm).filter(Boolean);
  if (forms.some((f) => blocked.has(f))) return { status: "blocked" };
  const hit = existing.find((m) => [m.term, ...m.variants].some((f) => forms.includes(normalizeTerm(f))));
  return hit ? { status: "existing", existingTerm: hit.term } : { status: "new" };
}
