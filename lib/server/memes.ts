import { randomUUID } from "crypto";
import { effectiveHeat, mergeFetched, normalizeTerm, parseSinceMonth, toCircle, type Meme, type MemeHeat, type MemeInput, type MemeRisk, type MemeSource, type MemeTrust, type Verdict } from "../memes";
import { all, db, get, run, transaction } from "./db";

/** 梗库：全局一份；项目里用的是 brief.memes 快照 */

type Row = {
  id: string;
  term: string;
  variants: string;
  kind: Meme["kind"];
  category: Meme["category"];
  meaning: string;
  usage: string;
  example: string;
  tone: string;
  platform: string;
  since: string;
  heat: MemeHeat;
  risk: MemeRisk;
  say: string;
  circle: string;
  trust: MemeTrust;
  since_month: string;
  source: Meme["source"];
  verified_at: number;
  created_at: number;
  updated_at: number;
};

const toMeme = (r: Row): Meme => ({
  id: r.id,
  term: r.term,
  variants: JSON.parse(r.variants) as string[],
  kind: r.kind,
  category: r.category,
  meaning: r.meaning,
  usage: r.usage,
  example: r.example,
  tone: r.tone,
  platform: r.platform,
  since: r.since,
  heat: r.heat,
  risk: r.risk,
  say: r.say,
  circle: r.circle,
  trust: r.trust,
  // 核实给出的年-月优先；旧数据从自由文本里解析
  sinceMonth: r.since_month || parseSinceMonth(r.since),
  source: r.source,
  verifiedAt: r.verified_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listMemes(): Meme[] {
  return all<Row>("SELECT * FROM memes ORDER BY verified_at DESC, term").map(toMeme);
}

/** 入库的一条：可以带上核实结果 */
export type Incoming = MemeInput & { trust?: MemeTrust; sinceMonth?: string };

/**
 * 把一批抓取结果并入梗库，返回新增 / 续期 / 丢弃 / 屏蔽数。
 * 手动添加和粘贴导入不要求写明流行时间和平台，来源是用户亲眼看到的内容，直接算已核实。
 */
export function saveFetched(incoming: Incoming[], now = Date.now(), source: MemeSource = "search") {
  const existing = listMemes();
  const { inserts, updates, dropped, blocked } = mergeFetched(existing, incoming, { requireProvenance: source === "search", blocked: blockedKeys() });
  const byId = new Map(existing.map((m) => [m.id, m]));
  transaction(db(), () => {
    for (const m of inserts)
      run(
        `INSERT INTO memes (id, term, variants, kind, category, meaning, usage, example, tone, platform, since, heat, risk, say, circle, trust, since_month, source, verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(), m.term.trim(), JSON.stringify(m.variants), m.kind, m.category, m.meaning, m.usage, m.example, m.tone, m.platform, m.since, m.heat, m.risk, m.say, toCircle(m.circle),
        (m as Incoming).trust ?? (source === "search" ? "unchecked" : "verified"), (m as Incoming).sinceMonth || parseSinceMonth(m.since), source, now, now, now,
      );
    // 续期：更新热度和确认时间；用户手动改过的风险等级、读法不覆盖（只在原来为空时补上读法和圈层）
    for (const { id, input } of updates) {
      const old = byId.get(id)!;
      const variants = [...new Set([...old.variants, ...input.variants.filter((v) => v !== old.term)])];
      run(
        "UPDATE memes SET heat = ?, variants = ?, say = ?, circle = ?, category = ?, verified_at = ?, updated_at = ? WHERE id = ?",
        input.heat, JSON.stringify(variants), old.say || input.say, old.circle || toCircle(input.circle), source === "search" ? old.category : input.category, now, now, id,
      );
    }
  });
  return { added: inserts.length, updated: updates.length, dropped, blocked };
}

/**
 * 写回单个梗的核实结果（复核）：查得到就续期并更新热度和流行时间；查不到或来源不足只标为待核实，不删，由用户决定。
 */
export function applyVerdict(id: string, v: Verdict, now = Date.now()) {
  const cur = get<Row>("SELECT * FROM memes WHERE id = ?", id);
  if (!cur) return;
  const ok = v.found && v.trust === "verified";
  run(
    "UPDATE memes SET trust = ?, since_month = ?, heat = ?, verified_at = ?, updated_at = ? WHERE id = ?",
    ok ? "verified" : "doubtful", v.sinceMonth || cur.since_month, ok && v.heat ? v.heat : cur.heat, ok ? now : cur.verified_at, now, id,
  );
}

/**
 * 需要复核的梗：没核实过的，和确认时间超过 days 天的（刷新时它们不在排除清单里，但未必会被再次搜到）。
 * 最旧的优先。
 */
export function recheckTargets(limit: number, days = 30, now = Date.now()) {
  return listMemes()
    .filter((m) => m.category === "hot" && (m.trust === "unchecked" || now - m.verifiedAt > days * 86_400_000))
    .sort((a, b) => Number(b.trust === "unchecked") - Number(a.trust === "unchecked") || a.verifiedAt - b.verifiedAt)
    .slice(0, limit);
}

/** 把所有待核实的梗删除并不再收录 */
export function blockDoubtful() {
  const list = listMemes().filter((m) => m.trust === "doubtful");
  for (const m of list) deleteMeme(m.id, true);
  return list.length;
}

export function updateMeme(id: string, patch: { category?: Meme["category"]; risk?: MemeRisk; heat?: MemeHeat; say?: string }) {
  const cur = get<Row>("SELECT * FROM memes WHERE id = ?", id);
  if (!cur) return false;
  // 手动改热度等于人工确认过一次，顺带续期
  const verified = patch.heat ? Date.now() : cur.verified_at;
  run("UPDATE memes SET category = ?, risk = ?, heat = ?, say = ?, verified_at = ?, updated_at = ? WHERE id = ?", patch.category ?? cur.category, patch.risk ?? cur.risk, patch.heat ?? cur.heat, (patch.say ?? cur.say).trim(), verified, Date.now(), id);
  return true;
}

/** 删除；block = true 时顺带屏蔽，以后刷新搜到它（任何写法）都不再收录 */
export function deleteMeme(id: string, block = false) {
  const cur = get<Row>("SELECT * FROM memes WHERE id = ?", id);
  if (!cur) return false;
  transaction(db(), () => {
    if (block) blockTerms(cur.term, JSON.parse(cur.variants) as string[]);
    run("DELETE FROM memes WHERE id = ?", id);
  });
  return true;
}

// ---------- 屏蔽（不再收录） ----------

export type MemeBlock = { id: string; term: string; createdAt: number };

function blockTerms(term: string, variants: string[]) {
  const now = Date.now();
  for (const f of [term, ...variants]) {
    const key = normalizeTerm(f);
    if (key) run("INSERT INTO meme_blocks (id, key, term, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING", randomUUID(), key, term, now);
  }
}

/** 屏蔽列表按梗名归并（一个梗的各种写法算一条） */
export function listBlocks(): MemeBlock[] {
  return all<{ id: string; term: string; created_at: number }>("SELECT MIN(id) AS id, term, MAX(created_at) AS created_at FROM meme_blocks GROUP BY term ORDER BY created_at DESC").map((r) => ({
    id: r.id,
    term: r.term,
    createdAt: r.created_at,
  }));
}

export function blockedKeys() {
  return new Set(all<{ key: string }>("SELECT key FROM meme_blocks").map((r) => r.key));
}

/** 取消屏蔽：同一个梗的所有写法一起恢复 */
export function unblock(id: string) {
  const row = get<{ term: string }>("SELECT term FROM meme_blocks WHERE id = ?", id);
  return row ? run("DELETE FROM meme_blocks WHERE term = ?", row.term).changes > 0 : false;
}

/** 用户主动添加一个被屏蔽的梗时，解除屏蔽 */
export function unblockTerm(term: string) {
  const key = normalizeTerm(term);
  const row = get<{ term: string }>("SELECT term FROM meme_blocks WHERE key = ?", key);
  if (row) run("DELETE FROM meme_blocks WHERE term = ?", row.term);
}

/**
 * 刷新时告诉模型不用再列的梗：近 days 天内确认过的（更早的允许再次搜到，以便续期）和屏蔽的。
 * 按确认时间取最近的 limit 个，控制提示词长度。
 */
export function knownTerms(days = 30, limit = 150, now = Date.now()) {
  const fresh = listMemes()
    .filter((m) => now - m.verifiedAt <= days * 86_400_000)
    .map((m) => m.term);
  const blocked = listBlocks().map((b) => b.term);
  return [...new Set([...fresh, ...blocked])].slice(0, limit);
}

// ---------- 抓取记录 ----------

export type MemeFetch = {
  id: string;
  kind: "trending" | "topic" | "circle" | "verify";
  query: string;
  model: string;
  added: number;
  updated: number;
  dropped: number;
  blocked: number;
  /** 核实时查不到而丢弃的新梗 */
  unverified: number;
  error: string | null;
  createdAt: number;
};

type FetchRow = Omit<MemeFetch, "createdAt"> & { created_at: number };
const toFetch = (r: FetchRow): MemeFetch => ({
  id: r.id, kind: r.kind, query: r.query, model: r.model, added: r.added, updated: r.updated, dropped: r.dropped, blocked: r.blocked, unverified: r.unverified, error: r.error, createdAt: r.created_at,
});

/** at：和入库用同一个时间戳，据此标出“本次新增” */
export function recordFetch(f: Omit<MemeFetch, "id" | "createdAt" | "blocked" | "unverified"> & { blocked?: number; unverified?: number; at?: number }) {
  run(
    "INSERT INTO meme_fetches (id, kind, query, model, added, updated, dropped, blocked, unverified, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    randomUUID(), f.kind, f.query, f.model, f.added, f.updated, f.dropped, f.blocked ?? 0, f.unverified ?? 0, f.error, f.at ?? Date.now(),
  );
}

export function lastFetch(kind: MemeFetch["kind"] = "trending"): MemeFetch | undefined {
  const r = get<FetchRow>("SELECT * FROM meme_fetches WHERE kind = ? ORDER BY created_at DESC LIMIT 1", kind);
  return r && toFetch(r);
}

/** 最近一次成功的抓取（不含单纯复核），用来标“本次新增” */
export function latestSuccessfulFetch(): MemeFetch | undefined {
  const r = get<FetchRow>("SELECT * FROM meme_fetches WHERE error IS NULL AND kind != 'verify' ORDER BY created_at DESC LIMIT 1");
  return r && toFetch(r);
}

/** 梗的中文读法，并入读音词典（优先级最低，用户词条会覆盖它） */
export function memeReadings() {
  return all<{ term: string; variants: string; say: string }>("SELECT term, variants, say FROM memes WHERE say != ''").flatMap((r) =>
    [r.term, ...(JSON.parse(r.variants) as string[])].filter((w) => w && w !== r.say).map((word) => ({ word, say: r.say })),
  );
}

/** 梗库里已经过气的梗（含变体），交给去 AI 味检测 */
export function staleMemeTerms(now = Date.now()) {
  return listMemes()
    .filter((m) => effectiveHeat(m.heat, m.verifiedAt, now) === "dead")
    .flatMap((m) => [m.term, ...m.variants]);
}
