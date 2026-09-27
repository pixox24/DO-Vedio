import { rebuildLines } from "./lines";
import { repairShots } from "./shots";
import { stableStringify } from "./hash";
import type { ProjectDoc } from "./types";

/** ID 生成：浏览器在非安全上下文（内网 http://IP）里没有 crypto.randomUUID，需要兜底 */
export function newId() {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * 文案段落 → 句子（纯函数）。未改动句子保留 ID（配音缓存、镜头锚点都不动），
 * 并修复分镜锚点、清理失效的配乐片段。没有变化时返回原对象。
 */
export function syncLines(doc: ProjectDoc, makeId: () => string = newId): ProjectDoc {
  if (!doc.segments.some((s) => s.text.trim())) return doc.lines.length ? { ...doc, lines: [], shots: [], music: [] } : doc;
  const lines = rebuildLines(doc.lines, doc.segments, makeId);
  const same = lines.length === doc.lines.length && lines.every((l, k) => l.id === doc.lines[k].id && l.segmentIndex === doc.lines[k].segmentIndex && l.text === doc.lines[k].text);
  if (same) return doc;
  const { shots } = repairShots(doc.shots, doc.lines, lines);
  const alive = new Set(lines.map((l) => l.id));
  const music = doc.music.filter((c) => alive.has(c.fromLineId) && alive.has(c.toLineId));
  return { ...doc, lines, shots, music: music.length === doc.music.length ? music : [] };
}

const eq = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

/** 按 id 合并数组：我没改的项用对方的，对方没改的用我的；两边都改了同一项算冲突 */
function mergeById<T extends { id: string }>(base: T[], mine: T[], theirs: T[]): { value: T[]; conflict: boolean } {
  const b = new Map(base.map((x) => [x.id, x]));
  const t = new Map(theirs.map((x) => [x.id, x]));
  let conflict = false;
  // 以我的顺序为准（结构由用户编辑决定），逐项取值
  const value = mine.map((m) => {
    const bb = b.get(m.id);
    const tt = t.get(m.id);
    if (!tt) return m;
    if (!bb) return eq(m, tt) ? m : m;
    if (eq(m, bb)) return tt;
    if (eq(tt, bb) || eq(tt, m)) return m;
    conflict = true;
    return m;
  });
  // 对方新增、我这边结构没动时，接受对方新增的项
  if (eq(base.map((x) => x.id), mine.map((x) => x.id))) {
    if (!eq(base.map((x) => x.id), theirs.map((x) => x.id))) {
      const mineById = new Map(value.map((x) => [x.id, x]));
      return { value: theirs.map((x) => mineById.get(x.id) ?? x), conflict };
    }
  }
  return { value, conflict };
}

/**
 * 三方合并（base = 上次从服务端拿到的，mine = 本地，theirs = 服务端最新）。
 * 顶层字段逐个比较；lines、shots 按 id 逐项合并。常见情况（我改设置、Worker 写分镜）能自动合并。
 */
export function mergeDocs(base: ProjectDoc, mine: ProjectDoc, theirs: ProjectDoc): { doc: ProjectDoc; conflict: boolean } {
  let conflict = false;
  const out = { ...theirs } as Record<string, unknown>;
  for (const key of Object.keys({ ...base, ...mine, ...theirs }) as (keyof ProjectDoc)[]) {
    const b = base[key];
    const m = mine[key];
    const t = theirs[key];
    if (eq(m, b)) out[key] = t;
    else if (eq(t, b) || eq(t, m)) out[key] = m;
    else if (key === "lines" || key === "shots") {
      const r = mergeById(b as { id: string }[], m as { id: string }[], t as { id: string }[]);
      out[key] = r.value;
      conflict ||= r.conflict;
    } else {
      out[key] = m;
      conflict = true;
    }
  }
  return { doc: out as ProjectDoc, conflict };
}
