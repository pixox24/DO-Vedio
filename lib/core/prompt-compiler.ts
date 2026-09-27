import { quickHash } from "./hash";
import { shotLineIds } from "./shots";
import { anchorText, characterReferenceIds, lookAt } from "./cast";
import { shotSizeLabels, styleMediumLabels, type CharacterCard, type Mood, type ProjectDoc, type Shot, type ShotSize, type VisualStyle } from "./types";

/**
 * 提示词编译器 —— 纯函数。把「画什么」和「怎么画」按槽位拼成生图提示词：
 *   [内容] 主体 + 动作 + 环境（来自分镜，过滤掉混进来的画风词）
 *   [人物] 出场角色的身份锚（来自角色卡，每个镜头逐字相同）
 *   [镜头] 景别 + 镜头 + 景深 + 构图
 *   [风格] 画风 + 渲染 + 质感 + 调色 + 光影 + 氛围（来自风格卡，按强度取舍）
 *   [情绪] 在风格范围内调制光影和氛围
 *   [负面] 全局负面词 + 风格负面词
 * 内容放在最前面：多数模型对开头的词权重更高，风格只改「怎么画」。
 */

// —— 画风词过滤：分镜不该写画风，混进来会和风格卡打架 ——

/** 几乎不会是画面内容的质量词、画风词 */
const TAGS = /(超高清|高清|4K|8K|16K|高分辨率|杰作|大师级|大师作品|精细细节|细节丰富|超写实|照片级|电影感|电影级|电影质感|虚幻引擎\s*\d*|UE\s?\d|OC\s?渲染|C4D|octane|赛博朋克|蒸汽朋克|吉卜力|宫崎骏|新海诚|皮克斯)/gi;
/** 「XX风格」「XX画风」 */
const PHRASE = /[^，,。；;、\s]{0,8}(风格|画风)/g;
/** 去掉画风词后剩下的连接词 */
const FILLER = /^(带有|采用|呈现|具有|充满|营造出?|以|用|的|和|与)+|(的|感|效果)+$/g;

export function filterStyleWords(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const clauses = text.split(/[，,。；;、]/).map((c) => {
    const cleaned = c.replace(TAGS, (m) => (removed.push(m), "")).replace(PHRASE, (m) => (removed.push(m), ""));
    return cleaned === c ? c.trim() : cleaned.trim().replace(FILLER, "").trim();
  });
  return { text: removed.length ? clauses.filter(Boolean).join("，") : text.trim(), removed };
}

// —— 情绪 ——

const moodHints: Partial<Record<Mood, string>> = {
  悬疑: "氛围神秘，光线偏暗",
  紧张: "氛围紧张，画面有压迫感",
  轻松: "氛围轻松明快",
  温暖: "氛围温暖",
  激昂: "氛围激昂，有力量感",
  史诗: "氛围宏大壮阔",
  科技: "带有科技感",
  忧伤: "氛围忧伤安静",
};

/** 镜头覆盖句子中出现最多的情绪 */
export function shotMood(doc: Pick<ProjectDoc, "shots" | "lines">, shot: Shot): Mood | undefined {
  const ids = shotLineIds(doc.shots, doc.lines).get(shot.id) ?? [shot.at.lineId];
  const count = new Map<Mood, number>();
  for (const l of doc.lines) if (ids.includes(l.id) && l.mood) count.set(l.mood, (count.get(l.mood) ?? 0) + l.text.length);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
}

// —— 编译 ——

export const GLOBAL_NEGATIVE = ["文字", "字幕", "水印", "logo", "畸形的手", "多余的手指", "模糊"];

export type CompiledPrompt = {
  /** 正向提示词 */
  prompt: string;
  negative: string[];
  /** 发给不支持负面词的模型：正向 + 「画面中不要出现」 */
  full: string;
  /** 指纹：判断已生成的素材是否过期、以及缓存键 */
  hash: string;
  slots: { content: string; characters: string; camera: string; style: string; mood: string };
  /** 从内容中剔除的画风词 */
  removed: string[];
  /** 情绪与风格冲突（风格不承载这种情绪），保持风格基调 */
  moodConflict?: Mood;
};

const join = (parts: (string | false | null | undefined)[]) => parts.map((p) => (p || "").trim()).filter(Boolean).join("，");
const level = { low: "低", mid: "", high: "高" } as const;

export function compilePrompt(input: {
  content: string;
  filter?: boolean;
  characters?: string[];
  shotSize?: ShotSize;
  style: VisualStyle | null;
  mood?: Mood;
  /** 定妆照：只继承画风、质感和调色；构图、镜头、光影氛围会盖过「干净背景」的要求，背景还会被当成角色的一部分 */
  sheet?: boolean;
}): CompiledPrompt {
  const { style, mood } = input;
  const filtered = input.filter === false ? { text: input.content.trim(), removed: [] } : filterStyleWords(input.content);
  const content = filtered.text;

  // 情绪调制：风格卡定义了就用它的（在风格范围内），否则用通用氛围提示；风格不承载的情绪保持基调
  const denied = !!(mood && style?.deniedMoods.includes(mood));
  const tweak = mood && !denied ? style?.moodTweaks[mood] : undefined;
  const lighting = tweak?.lighting || style?.lighting;
  const colorGrade = tweak?.colorGrade || style?.colorGrade;
  const atmosphere = tweak?.atmosphere || style?.atmosphere;
  const moodSlot = mood && !denied && !tweak ? (moodHints[mood] ?? "") : "";

  const strength = style?.strength ?? "normal";
  const camera = input.sheet ? join([input.shotSize && shotSizeLabels[input.shotSize]]) : join([
    input.shotSize && shotSizeLabels[input.shotSize],
    strength !== "light" && style?.lens,
    style && (style.depthOfField === "shallow" ? "浅景深" : "深景深，前后景都清晰"),
    style?.composition,
  ]);
  const styleSlot = !style
    ? ""
    : input.sheet
      ? join([styleMediumLabels[style.medium], style.rendering, style.texture, style.colorGrade])
      : strength === "light"
      ? join([styleMediumLabels[style.medium], colorGrade, lighting])
      : join([
          styleMediumLabels[style.medium],
          style.rendering,
          style.texture,
          colorGrade,
          // 调色或渲染里已经写了就不重复
          level[style.saturation] && !`${colorGrade}${style.rendering}`.includes("饱和") && `${level[style.saturation]}饱和度`,
          level[style.contrast] && !`${colorGrade}${style.rendering}${lighting}`.includes("对比") && `${level[style.contrast]}对比度`,
          lighting,
          atmosphere,
          strength === "strong" && `整体统一为${styleMediumLabels[style.medium]}风格`,
        ]);
  const negative = [...new Set([...GLOBAL_NEGATIVE, ...(style?.negative ?? [])].map((x) => x.trim()).filter(Boolean))];
  const characters = input.characters?.length ? `画面人物——${input.characters.join("；")}` : "";
  const prompt = [content, characters, camera, styleSlot, moodSlot].filter(Boolean).join("。");
  const full = `${prompt}。画面中不要出现：${negative.join("、")}`;
  return { prompt, negative, full, hash: quickHash(full), slots: { content, characters, camera, style: styleSlot, mood: moodSlot }, removed: filtered.removed, moodConflict: denied ? mood : undefined };
}

/** 单个生成画面最多带几个建卡角色：再多模型基本画不对 */
export const MAX_SHOT_CHARACTERS = 3;

/** 镜头里出场的角色卡（按镜头上的顺序）；文案里已不再出场的角色不带入 */
export function shotCharacters(doc: Pick<ProjectDoc, "characters">, shot: Shot): CharacterCard[] {
  return shot.characterIds.map((id) => doc.characters.find((c) => c.id === id)).filter((c): c is CharacterCard => !!c && !c.absent).slice(0, MAX_SHOT_CHARACTERS);
}

type CompileDoc = Pick<ProjectDoc, "shots" | "lines" | "brief" | "visualStyle" | "characters">;

/** 为项目里的镜头编译：用户手写的提示词只替换内容槽（不过滤），角色和风格照样注入 */
export function compileShotPrompt(doc: CompileDoc, shot: Shot): CompiledPrompt {
  const custom = shot.prompt?.trim();
  const content = custom || shot.description.trim() || shot.onScreenText?.trim() || doc.lines.find((l) => l.id === shot.at.lineId)?.text || doc.brief.title;
  const characters = shotCharacters(doc, shot).map((c) => anchorText(c, lookAt(c, shot.at.lineId, doc.lines)));
  return compilePrompt({ content, filter: !custom, characters, shotSize: shot.shotSize, style: doc.visualStyle, mood: shotMood(doc, shot) });
}

/** 镜头的参考图：镜头自己的 > 各角色（上传 > 立绘 > 三视图），按出场顺序交错，保证每个角色至少有一张 */
export function shotReferenceIds(doc: Pick<ProjectDoc, "characters">, shot: Shot, max = 8): string[] {
  const perCharacter = shotCharacters(doc, shot).map(characterReferenceIds);
  const interleaved: string[] = [];
  for (let k = 0; perCharacter.some((refs) => refs[k]); k++) for (const refs of perCharacter) if (refs[k]) interleaved.push(refs[k]);
  return [...new Set([...shot.referenceAssetIds, ...interleaved])].slice(0, max);
}

/** 需要生成画面的镜头：信息卡、标题卡、金句卡、上传图片都不需要 */
export function needsGeneratedImage(shot: Shot) {
  return shot.kind !== "title" && shot.kind !== "quote" && shot.kind !== "upload" && shot.mode !== "motion";
}

/** 已生成的素材是否因描述或风格变化而过期 */
export function assetStale(doc: CompileDoc, shot: Shot) {
  return !!(shot.assetId && shot.assetPromptHash && (shot.kind === "image" || shot.kind === "video") && shot.assetPromptHash !== compileShotPrompt(doc, shot).hash);
}
