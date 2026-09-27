import { z } from "zod";
import { quickHash } from "./hash";
import {
  characterFields,
  characterKinds,
  characterRoles,
  narrativeModes,
  presentationLabels,
  presentations,
  type CastAnalysis,
  type CharacterCard,
  type CharacterField,
  type Line,
  type Look,
  type ProjectDoc,
  type VisualStyle,
} from "./types";

/**
 * 选角规则 —— 纯函数。大模型负责「读懂」：有哪些人物、指代归并、外貌推断；
 * 这里负责「定规矩」：谁建卡、怎么和已有角色卡对账、身份锚文本、区分度检查。
 */

/** 定妆种类：立绘候选 → 选定后三视图 / 表情组 / 各套造型 */
export const sheetKinds = ["portrait", "turnaround", "expressions", "look"] as const;
export type SheetKind = (typeof sheetKinds)[number];
export const sheetKindLabels: Record<SheetKind, string> = { portrait: "立绘", turnaround: "三视图", expressions: "表情组", look: "造型定妆" };

// —— 大模型输出 ——

export const castDraftSchema = z.object({
  modes: z.array(z.object({ segmentIndex: z.number().int().min(0), mode: z.enum(narrativeModes) })),
  characters: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      kind: z.enum(characterKinds),
      role: z.enum(characterRoles),
      real: z.boolean(),
      /** 出场的句子 ID（被提到或出现） */
      mentions: z.array(z.string()),
      needsCard: z.boolean(),
      reason: z.string(),
      presentation: z.enum(presentations).optional(),
      ageRange: z.string().optional(),
      gender: z.string().optional(),
      region: z.string().optional(),
      era: z.string().optional(),
      occupation: z.string().optional(),
      hair: z.string().optional(),
      eyes: z.string().optional(),
      faceShape: z.string().optional(),
      facialHair: z.string().optional(),
      marks: z.string().optional(),
      build: z.string().optional(),
      height: z.string().optional(),
      signature: z.array(z.string()).optional(),
      personality: z.string().optional(),
      looks: z.array(z.object({ name: z.string(), wardrobe: z.string(), props: z.string().optional(), fromLineId: z.string().optional() })).optional(),
      /** 原文明确写到的字段 */
      explicitFields: z.array(z.string()).optional(),
      /** 从上下文推断的字段（其余有值的字段视为按题材补全） */
      inferredFields: z.array(z.string()).optional(),
    }),
  ),
});
export type CastDraft = z.infer<typeof castDraftSchema>;
type DraftCharacter = CastDraft["characters"][number];

/** 决定选角结果的文案输入；变了就要重新分析 */
export function castSourceHash(doc: Pick<ProjectDoc, "lines" | "brief">) {
  return quickHash({ v: 1, lines: doc.lines.map((l) => [l.id, l.text]), summary: doc.brief.summary, templateId: doc.brief.templateId, perspective: doc.brief.perspective });
}

/** 模型没有依据时常写的占位值 */
const PLACEHOLDER = /^(不指定|未指定|不详|未知|未提及|无|没有|不限|不确定|待定|n\/a|none|unknown|-|—|\/)$/i;

export const castKeyOf = (name: string) => name.trim().toLowerCase().replace(/[\s\p{P}]/gu, "");

// —— 建卡判定 ——

export type DecidedCharacter = Omit<CharacterCard, "id">;

/**
 * 规则优先于大模型的判断：
 * 建卡 ⇐ 主角，或出场 ≥ 2 句，或跨章节，或大模型认为需要（路人除外）
 * 不建 ⇐ 原文里找不到出场句；只出现一次的路人；群体（除非大模型认为有统一外观且出场 ≥ 2 句）
 */
export function decideCharacters(draft: CastDraft, lines: Pick<Line, "id" | "text" | "segmentIndex">[]): { cards: DecidedCharacter[]; skipped: CastAnalysis["skipped"] } {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const cards: DecidedCharacter[] = [];
  const skipped: CastAnalysis["skipped"] = [];
  const seen = new Set<string>();
  for (const c of draft.characters) {
    const name = c.name.trim();
    const key = castKeyOf(c.key || name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    const mentions = [...new Set(c.mentions.filter((id) => byId.has(id)))];
    const n = mentions.length;
    const crossSegment = new Set(mentions.map((id) => byId.get(id)!.segmentIndex)).size > 1;
    const needs =
      n === 0 ? false : c.kind === "group" ? c.needsCard && n >= 2 : c.role === "extra" && n < 2 ? false : c.role === "protagonist" || n >= 2 || crossSegment || c.needsCard;
    if (!needs) {
      skipped.push({ name, reason: n === 0 ? "原文中找不到出场的句子" : c.kind === "group" ? "群体，不单独建卡" : c.role === "extra" ? "只出现一次的路人" : c.reason || "出场太少" });
      continue;
    }
    cards.push(toCard(c, name, key, mentions, byId));
  }
  return { cards, skipped };
}

function toCard(c: DraftCharacter, name: string, key: string, mentions: string[], byId: Map<string, Pick<Line, "text">>): DecidedCharacter {
  // 「不指定」「未知」这类占位值不是外貌，留空（否则会被拼进身份锚）
  const text = (v: string | undefined) => {
    const t = v?.trim() ?? "";
    return PLACEHOLDER.test(t) ? "" : t;
  };
  const values: Record<CharacterField, string | string[]> = {
    ageRange: text(c.ageRange),
    gender: text(c.gender),
    region: text(c.region),
    era: text(c.era),
    occupation: text(c.occupation),
    hair: text(c.hair),
    eyes: text(c.eyes),
    faceShape: text(c.faceShape),
    facialHair: text(c.facialHair),
    marks: text(c.marks),
    build: text(c.build),
    height: text(c.height),
    signature: (c.signature ?? []).map((x) => text(x)).filter(Boolean).slice(0, 3),
    personality: text(c.personality),
  };
  const explicit = new Set(c.explicitFields ?? []);
  const inferred = new Set(c.inferredFields ?? []);
  const fieldSources: DecidedCharacter["fieldSources"] = {};
  for (const f of characterFields) {
    const v = values[f];
    if (Array.isArray(v) ? v.length === 0 : !v) continue;
    fieldSources[f] = explicit.has(f) ? "explicit" : inferred.has(f) ? "inferred" : "default";
  }
  const real = c.real || c.role === "real";
  const looks: Look[] = (c.looks ?? [])
    .filter((l) => l.wardrobe.trim() || l.props?.trim())
    .map((l, i) => ({ id: `look-${i + 1}`, name: l.name.trim() || (i === 0 ? "默认" : `造型 ${i + 1}`), wardrobe: l.wardrobe.trim(), props: l.props?.trim() ?? "", fromLineId: l.fromLineId && byId.has(l.fromLineId) && i > 0 ? l.fromLineId : undefined }));
  return {
    key,
    name,
    kind: c.kind,
    role: real ? "real" : c.role,
    real,
    // 真实人物不生成可辨认的正脸
    presentation: real ? (c.presentation && c.presentation !== "full" ? c.presentation : "back") : "full",
    ...(values as Omit<Record<CharacterField, string>, "signature">),
    signature: values.signature as string[],
    appearance: "",
    wardrobe: "",
    looks,
    fieldSources,
    overriddenExplicit: [],
    evidence: mentions.slice(0, 8).map((id) => ({ lineId: id, text: byId.get(id)!.text.slice(0, 60) })),
    absent: false,
    sheet: { candidates: [], turnaroundAssetIds: [], expressionAssetIds: [], lookAssetIds: {} },
    referenceAssetIds: [],
    locked: false,
  };
}

// —— 对账 ——

/**
 * 新的选角结果和已有角色卡对账：
 * - 锁定的卡原样保留
 * - 同一角色（key 或名字相同）：用户改过的字段、名字、定妆、参考图都保留，其余用新结果
 * - 新角色追加；这次没出现的旧角色标记为「未出场」但不删除
 */
export function reconcileCharacters(existing: CharacterCard[], decided: DecidedCharacter[], newId: () => string): CharacterCard[] {
  const match = (c: CharacterCard, d: DecidedCharacter) => (c.key && c.key === d.key) || castKeyOf(c.name) === d.key || castKeyOf(c.name) === castKeyOf(d.name);
  const used = new Set<string>();
  const out = existing.map((c) => {
    const d = decided.find((x) => !used.has(x.key) && match(c, x));
    if (!d) return c.locked ? c : { ...c, absent: true };
    used.add(d.key);
    if (c.locked) return { ...c, absent: false };
    const merged: CharacterCard = { ...c, ...d, id: c.id, name: c.name || d.name, key: c.key || d.key, sheet: c.sheet, referenceAssetIds: c.referenceAssetIds, locked: false, absent: false, fieldSources: { ...d.fieldSources }, overriddenExplicit: c.overriddenExplicit };
    for (const f of characterFields) {
      if (c.fieldSources[f] !== "user") continue;
      (merged as Record<CharacterField, unknown>)[f] = c[f];
      merged.fieldSources[f] = "user";
    }
    // 造型按名字对应，保住已经定妆的造型 ID
    merged.looks = d.looks.map((l) => {
      const old = c.looks.find((x) => x.name === l.name);
      return old ? { ...l, id: old.id } : l;
    });
    if (c.looks.length && !d.looks.length) merged.looks = c.looks;
    if (c.appearance) merged.appearance = c.appearance;
    if (c.wardrobe) merged.wardrobe = c.wardrobe;
    return merged;
  });
  for (const d of decided) if (!used.has(d.key)) out.push({ ...d, id: newId() });
  return out;
}

/** 用户编辑某个外貌字段：来源记为 user，重新选角不再覆盖 */
export function editCharacterField<F extends CharacterField>(card: CharacterCard, field: F, value: CharacterCard[F]): CharacterCard {
  const overriddenExplicit = card.fieldSources[field] === "explicit" && !card.overriddenExplicit.includes(field) ? [...card.overriddenExplicit, field] : card.overriddenExplicit;
  return { ...card, [field]: value, fieldSources: { ...card.fieldSources, [field]: "user" }, overriddenExplicit };
}

// —— 检查 ——

/** 区分度与一致性：角色之间要分得清，每个角色要有识别锚点 */
export function castIssues(cards: CharacterCard[]): string[] {
  const issues: string[] = [];
  const people = cards.filter((c) => !c.absent && c.kind === "person" && c.presentation === "full");
  const norm = (s: string) => s.replace(/[\s，,、。]/g, "");
  for (let i = 0; i < people.length; i++)
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i];
      const b = people[j];
      const same = [a.hair && norm(a.hair) === norm(b.hair), a.build && norm(a.build) === norm(b.build), a.ageRange && a.gender && a.ageRange === b.ageRange && a.gender === b.gender].filter(Boolean).length;
      if (same >= 2) issues.push(`「${a.name}」和「${b.name}」的外貌太接近，观众可能分不清，建议在发型、配色或体型上拉开差异`);
    }
  for (const c of people) if (!c.hair && !c.appearance && !c.ageRange && c.signature.length === 0 && !c.sheet.portraitAssetId && !c.referenceAssetIds.length) issues.push(`「${c.name}」几乎没有外貌信息，定妆会随机生成一个形象，建议先在「编辑外貌与造型」里补充`);
  for (const c of people) if (c.signature.length === 0 && (c.hair || c.ageRange)) issues.push(`「${c.name}」没有识别锚点（如标志性的服饰或配饰），不同镜头里可能不像同一个人`);
  for (const c of cards.filter((x) => !x.absent)) {
    // 身份锚出现在每个镜头：换装的角色，识别锚点和职业不能是某套造型专属的
    if (c.looks.length < 2) continue;
    for (const sig of c.signature) {
      const look = c.looks.find((l) => sharesPhrase(sig, `${l.wardrobe}${l.props}`));
      if (look) issues.push(`「${c.name}」的识别锚点「${sig}」像是「${look.name}」造型专属的，换装后的镜头里仍会出现，建议移进造型`);
    }
    if (/[/／、]|或|兼/.test(c.occupation)) issues.push(`「${c.name}」的职业写了多个（${c.occupation}），会出现在每套造型里，建议只保留不变的身份，其余写进造型`);
  }
  return issues;
}

/** 两段文字是否共享一个 ≥ 3 字的短语（用于发现造型专属的识别锚点） */
function sharesPhrase(a: string, b: string, n = 3) {
  const s = a.replace(/[\s\p{P}]/gu, "");
  for (let i = 0; i + n <= s.length; i++) if (b.includes(s.slice(i, i + n))) return true;
  return false;
}

// —— 身份锚 ——

/** 镜头所在位置适用的造型：最后一个起点不晚于这句的造型，缺省第一个 */
export function lookAt(card: CharacterCard, lineId: string | undefined, lines: Pick<Line, "id">[]): Look | undefined {
  if (!card.looks.length) return undefined;
  const order = new Map(lines.map((l, k) => [l.id, k]));
  const at = lineId ? (order.get(lineId) ?? 0) : 0;
  let pick = card.looks[0];
  for (const l of card.looks) if (!l.fromLineId || (order.get(l.fromLineId) ?? Infinity) <= at) pick = l;
  return pick;
}

/**
 * 身份锚：只写可见、稳定的特征（性格和背景不写），同一造型下每个镜头逐字相同。
 * 这是纯文本模型保持一致的关键；支持参考图的模型再加上定妆图。
 */
export function anchorText(card: CharacterCard, look?: Look): string {
  const wardrobe = look?.wardrobe || card.wardrobe;
  const props = look?.props;
  const who = `${card.era ? `${card.era}的` : ""}${card.ageRange}${card.gender}`;
  if (card.presentation !== "full") {
    const parts = [who, card.occupation, card.build, wardrobe && `穿着${wardrobe}`, ...card.signature].filter(Boolean);
    return `${card.name}：只拍${presentationLabels[card.presentation]}，不出现可辨认的正脸${parts.length ? `；${parts.join("，")}` : ""}`;
  }
  const parts = [who, card.region, card.occupation, card.hair, card.eyes, card.faceShape, card.facialHair, card.marks, card.build, card.height, card.appearance, ...card.signature, wardrobe && `穿着${wardrobe}`, props && `带着${props}`].map((x) => x?.trim()).filter(Boolean);
  return parts.length ? `${card.name}：${parts.join("，")}` : card.name;
}

/** 参考图优先级：用户上传 > 选定立绘 > 三视图 */
export function characterReferenceIds(card: CharacterCard): string[] {
  return [...new Set([...card.referenceAssetIds, card.sheet.portraitAssetId, ...card.sheet.turnaroundAssetIds].filter((x): x is string => !!x))];
}

/** 定妆指纹：外貌字段或画面风格变了，定妆就过期 */
export function sheetSourceHash(card: CharacterCard, style: VisualStyle | null) {
  return quickHash({ anchor: anchorText(card, card.looks[0]), style: style && { ...style, id: undefined, name: undefined, description: undefined, suits: undefined } });
}
