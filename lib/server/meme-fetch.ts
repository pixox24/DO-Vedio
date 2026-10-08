import { errorMessage, generateJson, generatePlain, listModels, searchModel } from "../llm";
import { classifyImport, enabledMemeCategories, groundCandidate, isCandidate, memeBatchSchema, memeImportSchema, memePickSchema, mergeFetched, normalizeTerm, parseSinceMonth, parseVerdict, resolveSlang, toRef, type ImportCandidate, type MemeCategory, type MemeInput, type MemeRef, type Verdict } from "../memes";
import { memeImportPrompt, memeLookupPrompt, memePickPrompt, memeSearchPrompt, memeStructurePrompt, memeVerifyPrompt } from "../prompts";
import type { Brief, StyleTemplate } from "../types";
import { applyVerdict, blockedKeys, knownTerms, lastFetch, listMemes, recheckTargets, recordFetch, saveFetched, unblockTerm, type Incoming, type MemeFetch } from "./memes";

const today = () => new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });

/** 候选太多时只给模型看最近确认过的这些 */
const MAX_POOL = 60;
const MAX_PICKS = 12;
/** 全网热梗超过这么久没刷新，挑梗时在后台自动刷新 */
export const AUTO_REFRESH_DAYS = 7;

export type FetchResult = {
  added: number;
  updated: number;
  dropped: number;
  blocked: number;
  /** 核实时完全查不到、直接丢弃的新梗 */
  unverified: number;
  /** 新增里已核实 / 待核实的数量 */
  verified: number;
  doubtful: number;
  /** 顺带复核的老梗数量 */
  rechecked: number;
};
export type RecheckResult = { checked: number; verified: number; doubtful: number };

/**
 * 抓取和复核串行执行（一次要几分钟）：同样的请求正在跑就共用结果，不同的请求排队。
 * 避免重复点击、多个标签页或后台自动刷新同时打搜索接口。
 */
const g = globalThis as unknown as { __memeJob?: { key: string; p: Promise<unknown> }; __memeQueue?: Promise<unknown> };

function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (g.__memeJob?.key === key) return g.__memeJob.p as Promise<T>;
  const p = (g.__memeQueue ?? Promise.resolve()).catch(() => {}).then(fn);
  g.__memeQueue = p;
  g.__memeJob = { key, p };
  p.catch(() => {}).finally(() => {
    if (g.__memeJob?.p === p) g.__memeJob = undefined;
  });
  return p;
}

export const NO_SEARCH_MODEL = "联网搜梗需要带搜索能力的模型：请在模型中心配置通义千问（DASHSCOPE_API_KEY）";

/** 核实并发数：逐个单独搜索，并发太高容易被限流 */
const VERIFY_CONCURRENCY = 5;
/** 每次刷新顺带复核几个最旧的梗，避免它们因为在排除清单外、又没被再次搜到而过期 */
const RECHECK_PER_FETCH = 5;
/** 手动“核实现有梗”一次最多处理多少个 */
const MAX_RECHECK = 30;

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/** 单独联网搜这个词本身来核实；网络出错时按存疑处理，不当作查不到（不误删） */
async function verifyOne(modelId: string, m: { term: string; variants: string[]; meaning: string }, date: string): Promise<Verdict> {
  try {
    const text = await generatePlain(modelId, memeVerifyPrompt(m.term, m.meaning, date), { search: true, quick: true });
    return parseVerdict(text, [m.term, ...m.variants]);
  } catch (e) {
    console.error(`[梗库] 核实「${m.term}」失败`, e);
    return { trust: "doubtful", found: true, sources: 0, sinceMonth: "", evidence: "" };
  }
}

/**
 * 联网抓梗：先强制搜索写调研笔记，再整理成结构化条目；新梗逐个单独核实后再入库。
 * 分两步是因为搜索模式下拿不到稳定的 JSON；逐个核实是因为实测模型会“凑”出看起来像梗、其实没人用的词。
 */
export function fetchMemes(kind: MemeFetch["kind"], topic = "", circle = "", months: number = 1): Promise<FetchResult> {
  return enqueue(`${kind}:${topic}:${circle}:${months}`, () => runFetch(kind, topic, circle, months));
}

async function runFetch(kind: MemeFetch["kind"], topic: string, circle: string, months: number): Promise<FetchResult> {
  const model = searchModel();
  if (!model) throw new Error(NO_SEARCH_MODEL);
  const date = today();
  const query = [topic, circle, months > 1 ? `近 ${months} 个月` : ""].filter(Boolean).join(" · ");
  try {
    // 近 30 天确认过的和屏蔽的不用再列，名额留给新梗；更早的允许再次搜到，以便续期
    const notes = await generatePlain(model.id, memeSearchPrompt(date, { topic: topic || undefined, circle: circle || undefined, exclude: knownTerms(), months }), { search: true });
    const { memes: rawMemes } = await generateJson(model.id, memeBatchSchema, memeStructurePrompt(notes, date));
    const memes = rawMemes.map((m) => ({ ...m, category: "hot" as const }));

    // 先算出哪些是新梗，只核实新梗；再顺带复核几个最旧的老梗
    const { inserts } = mergeFetched(listMemes(), memes, { blocked: blockedKeys() });
    const fresh = new Set(inserts);
    const old = recheckTargets(RECHECK_PER_FETCH);
    const jobs = [...inserts.map((m) => ({ m, id: undefined as string | undefined })), ...old.map((m) => ({ m, id: m.id }))];
    const verdicts = await pool(jobs, VERIFY_CONCURRENCY, (j) => verifyOne(model.id, j.m, date));
    const byNew = new Map(inserts.map((m, i) => [m, verdicts[i]]));

    let unverified = 0;
    const incoming: Incoming[] = [];
    for (const m of memes) {
      const v = fresh.has(m) ? byNew.get(m) : undefined;
      if (!v) {
        incoming.push(m);
        continue;
      }
      if (!v.found) {
        unverified++;
        continue;
      }
      incoming.push({ ...m, trust: v.trust, sinceMonth: v.sinceMonth || parseSinceMonth(m.since), heat: v.trust === "verified" && v.heat ? v.heat : m.heat });
    }
    const at = Date.now();
    const result = saveFetched(incoming, at);
    old.forEach((m, i) => applyVerdict(m.id, verdicts[inserts.length + i], at));
    // 只有核实过的新梗带 trust
    const verified = incoming.filter((m) => m.trust === "verified").length;
    recordFetch({ kind, query, model: model.label, ...result, unverified, error: null, at });
    return { ...result, unverified, verified, doubtful: result.added - verified, rechecked: old.length };
  } catch (e) {
    recordFetch({ kind, query, model: model.label, added: 0, updated: 0, dropped: 0, error: errorMessage(e) });
    throw e;
  }
}

/** 复核现有的梗：没核实过的和超过 30 天没确认的，最旧的优先 */
export function recheckMemes(limit = MAX_RECHECK): Promise<RecheckResult> {
  return enqueue(`verify:${limit}`, async () => {
    const model = searchModel();
    if (!model) throw new Error(NO_SEARCH_MODEL);
    const date = today();
    const targets = recheckTargets(limit);
    const verdicts = await pool(targets, VERIFY_CONCURRENCY, (m) => verifyOne(model.id, m, date));
    const at = Date.now();
    targets.forEach((m, i) => applyVerdict(m.id, verdicts[i], at));
    const verified = verdicts.filter((v) => v.found && v.trust === "verified").length;
    recordFetch({ kind: "verify", query: "", model: model.label, added: 0, updated: verified, dropped: 0, error: null, at });
    return { checked: targets.length, verified, doubtful: targets.length - verified };
  });
}

/** 距上次成功刷新全网热梗是否已超期 */
export function needsRefresh(now = Date.now()) {
  const last = lastFetch("trending");
  return !last || now - last.createdAt > AUTO_REFRESH_DAYS * 86_400_000;
}

/**
 * 为这期视频挑候选梗。梗库还是空的就先联网抓一轮（要等）；
 * 梗库超过 7 天没刷新就在后台刷新，这次先用现有的梗，下次挑梗就能用上新的。
 */
export async function pickMemes(brief: Brief, template: StyleTemplate, modelId: string): Promise<{ candidates: MemeRef[]; fetched: boolean; refreshing: boolean }> {
  const hotEnabled = resolveSlang(brief.slang, template) !== "off";
  const enabled = new Set(enabledMemeCategories(hotEnabled, brief.groundedEnabled));
  const pool = () => listMemes().filter((m) => enabled.has(m.category) && isCandidate(m)).slice(0, MAX_POOL);
  let candidates = pool();
  let fetched = false;
  let refreshing = false;
  if (hotEnabled && searchModel()) {
    if (!candidates.some((m) => m.category === "hot")) {
      await fetchMemes("trending");
      fetched = true;
      candidates = pool();
    } else if (needsRefresh()) {
      refreshing = true;
      fetchMemes("trending").catch((e) => console.error("[梗库] 后台刷新失败", e));
    }
  }
  if (candidates.length === 0) return { candidates: [], fetched, refreshing };
  const { picks } = await generateJson(modelId, memePickSchema, memePickPrompt(brief, template, candidates));
  const seen = new Set<number>();
  const out: MemeRef[] = [];
  for (const p of picks) {
    if (seen.has(p.index) || !candidates[p.index]) continue;
    seen.add(p.index);
    out.push(toRef(candidates[p.index], p.where));
  }
  return { candidates: out.slice(0, MAX_PICKS), fetched, refreshing };
}

/** 整理用的模型：优先搜索模型（顺带联网核实），没有就用第一个文本模型 */
function helperModel() {
  const s = searchModel();
  const id = s?.id ?? listModels()[0]?.id;
  if (!id) throw new Error("没有可用的文本模型");
  return { id, online: !!s };
}

/** 手动添加一个梗：有搜索模型时联网查含义和热度，否则按模型知识补全 */
export async function addMemeByTerm(term: string, category: MemeCategory = "hot") {
  const { id, online: hasSearchModel } = helperModel();
  const online = category === "hot" && hasSearchModel;
  const date = today();
  const notes = await generatePlain(id, memeLookupPrompt(term, date, online), { search: online });
  const { memes } = await generateJson(id, memeBatchSchema, memeStructurePrompt(notes, date));
  // 只收用户要的这一个；模型顺带列出的其他梗不入库
  const hit = memes.find((m) => [m.term, ...m.variants].some((f) => f.trim() === term.trim())) ?? memes[0];
  if (!hit) throw new Error(`没有查到「${term}」的用法`);
  // 用户主动添加，说明想要它：解除之前的屏蔽
  unblockTerm(term);
  return { ...saveFetched([{ ...hit, term: term.trim(), category }], Date.now(), "manual"), online };
}

// ---------- 粘贴导入：抽取 → 预览 → 确认入库 ----------

/**
 * 从粘贴的材料里抽取候选，不入库。
 * 用原文校验：梗必须真的出现在材料里，例句也换成材料里的原句。
 */
export async function extractMemes(inputText: string) {
  const { id } = helperModel();
  const { publishedAt, memes } = await generateJson(id, memeImportSchema, memeImportPrompt(inputText, today()));
  const existing = listMemes();
  const blocked = blockedKeys();
  const seen = new Set<string>();
  const candidates: ImportCandidate[] = [];
  let dropped = 0;
  for (const m of memes) {
    const grounded = groundCandidate(inputText, m);
    const key = normalizeTerm(grounded?.input.term ?? m.term);
    if (!grounded || seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    const { input } = grounded;
    // 材料没写流行时间时，用发布时间兜底：至少说明那时已经在流行
    candidates.push({ ...grounded, ...classifyImport(existing, blocked, input), input: { ...input, since: input.since || publishedAt } });
  }
  return { candidates, dropped, publishedAt };
}

/** 确认入库：只导入用户勾选并改好的条目；核实热度是可选的，只更新热度和流行时间 */
export async function importCandidates(items: MemeInput[], { verify = true, at = Date.now() } = {}) {
  // 用户勾选了屏蔽过的梗，说明想要它：先解除屏蔽，否则入库时会被跳过
  for (const m of items) for (const f of [m.term, ...m.variants]) unblockTerm(f);
  const verifiable = items.map((m, index) => ({ m, index })).filter(({ m }) => m.category === "hot");
  const model = verify && verifiable.length ? searchModel() : null;
  const verdicts: (Verdict | undefined)[] = items.map(() => undefined);
  if (model) {
    const hotVerdicts = await pool(verifiable, VERIFY_CONCURRENCY, ({ m }) => verifyOne(model.id, m, today()));
    verifiable.forEach(({ index }, i) => { verdicts[index] = hotVerdicts[i]; });
  }
  const incoming: Incoming[] = items.map((m, i) => {
    const v = verdicts[i];
    return v ? { ...m, trust: "verified" as const, sinceMonth: v.sinceMonth || parseSinceMonth(m.since), heat: v.heat ?? m.heat } : m;
  });
  const result = saveFetched(incoming, at, "import");
  const rechecked = verdicts.filter((v) => v?.heat || v?.sinceMonth).length;
  if (model) recordFetch({ kind: "verify", query: "粘贴导入", model: model.label, added: result.added, updated: result.updated, dropped: result.dropped, error: null, at });
  return { ...result, rechecked };
}
