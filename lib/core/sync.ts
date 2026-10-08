import { rebuildLines } from "./lines";
import { retargetMusic } from "./music";
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
 * 并修复分镜锚点。已选的一首配乐会重新铺到新的首尾句上。没有变化时返回原对象。
 */
export function syncLines(doc: ProjectDoc, makeId: () => string = newId): ProjectDoc {
  if (!doc.segments.some((s) => s.text.trim())) return doc.lines.length ? { ...doc, lines: [], shots: [], music: [] } : doc;
  const lines = rebuildLines(doc.lines, doc.segments, makeId);
  const same = lines.length === doc.lines.length && lines.every((l, k) => l.id === doc.lines[k].id && l.segmentIndex === doc.lines[k].segmentIndex && l.text === doc.lines[k].text);
  if (same) return doc;
  const { shots } = repairShots(doc.shots, doc.lines, lines);
  return { ...doc, lines, shots, music: retargetMusic(doc.music, lines) };
}

const eq = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

/** 按 id 合并数组：我没改的项用对方的，对方没改的用我的；两边都改了同一项算冲突 */
function mergeById<T extends { id: string }>(base: T[], mine: T[], theirs: T[]): { value: T[]; conflict: boolean } {
  const b = new Map(base.map((x) => [x.id, x]));
  const m = new Map(mine.map((x) => [x.id, x]));
  const t = new Map(theirs.map((x) => [x.id, x]));
  let conflict = false;
  const merged = new Map<string, T>();
  const ids = new Set([...base.map((x) => x.id), ...mine.map((x) => x.id), ...theirs.map((x) => x.id)]);

  for (const id of ids) {
    const hasBase = b.has(id);
    const hasMine = m.has(id);
    const hasTheirs = t.has(id);
    const bb = b.get(id);
    const mm = m.get(id);
    const tt = t.get(id);

    if (!hasBase) {
      // 双方独立新增应同时保留；同 ID 的不同新增说明生成器/编辑器发生了冲突。
      if (hasMine && hasTheirs) {
        if (eq(mm, tt)) merged.set(id, mm!);
        else {
          conflict = true;
          merged.set(id, mm!);
        }
      } else if (hasMine) merged.set(id, mm!);
      else if (hasTheirs) merged.set(id, tt!);
      continue;
    }

    if (hasMine && hasTheirs) {
      if (eq(mm, bb)) merged.set(id, tt!);
      else if (eq(tt, bb) || eq(tt, mm)) merged.set(id, mm!);
      else {
        conflict = true;
        merged.set(id, mm!);
      }
    } else if (!hasMine && !hasTheirs) {
      // 双方都删除。
    } else if (!hasMine) {
      // 我的删除与对方修改冲突；保留对方值直到用户解决冲突，避免数据静默消失。
      if (!eq(tt, bb)) {
        conflict = true;
        merged.set(id, tt!);
      }
    } else {
      // 对方删除与我的修改冲突；同样保留修改后的值并报告冲突。
      if (!eq(mm, bb)) {
        conflict = true;
        merged.set(id, mm!);
      }
    }
  }

  // 以我的顺序为基础，再把对方独有的新增项插入到其后继项之前，避免丢失且尽量保持结构。
  const mineIds = new Set(mine.map((x) => x.id));
  const order = mine.map((x) => x.id).filter((id) => merged.has(id));
  for (let i = 0; i < theirs.length; i++) {
    const id = theirs[i].id;
    if (mineIds.has(id) || !merged.has(id)) continue;
    const next = theirs.slice(i + 1).find((x) => order.includes(x.id));
    const at = next ? order.indexOf(next.id) : -1;
    if (at < 0) order.push(id);
    else order.splice(at, 0, id);
  }
  return { value: order.map((id) => merged.get(id)!), conflict };
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
