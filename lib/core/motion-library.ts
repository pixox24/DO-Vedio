import { focusPresetLabels, focusVisualWidth, presetWidths } from "./focus";
import { focusSfxMount, transitionSfxMount, type SfxRole } from "./sfx";
import { focusPresetIds, motions, transitionIns, type FocusPresetId, type Motion, type TransitionIn } from "./types";

export type MotionEnergy = "low" | "mid";
export type MotionFilter = "all" | "short" | "long" | "number" | "english";

export type MotionCatalogItem = {
  id: FocusPresetId;
  name: string;
  fit: string;
  rhythm: string;
  energy: MotionEnergy;
  width: readonly [number, number];
  sampleText: string;
  sampleSupport?: string;
  englishSlot: boolean;
  numberFit: boolean;
  sfx: SfxRole;
};

const energyLabel: Record<MotionEnergy, string> = { low: "低", mid: "中" };

const details: Record<FocusPresetId, Omit<MotionCatalogItem, "id" | "name" | "width" | "sfx">> = {
  "embedded-type": { fit: "3–8 字，前后大小嵌在一行", rhythm: "整行被揭开。前半略小，后半放大，像嵌进同一行。最后淡出。", energy: "mid", sampleText: "看见不同", englishSlot: false, numberFit: false },
  "number-space": { fit: "数字和百分数，周围留白", rhythm: "百分数和倍数从零涨到原值。年份保持原样。标签随后升起。", energy: "mid", sampleText: "85%", englishSlot: false, numberFit: true },
  "masked-slice": { fit: "3–8 字，从左被蒙版揭开", rhythm: "一行字从左侧揭开，中间留一道细切。退场淡出。", energy: "mid", sampleText: "成本太高", englishSlot: false, numberFit: false },
  "vertical-arc": { fit: "1–4 字，竖排配一道弧", rhythm: "短词竖着排，旁边一道弧。字从模糊里变清楚。数字和长句会改回横排。", energy: "mid", sampleText: "留白", englishSlot: false, numberFit: false },
  "offset-fade": { fit: "前后两截错开的短语", rhythm: "前半轻、后半重，整行从模糊里落到位置上。", energy: "low", sampleText: "方向不同", englishSlot: false, numberFit: false },
  "time-scale": { fit: "年份、时刻和带刻度的数字", rhythm: "适合逐步读的短句会逐字出现，旁边有刻度。数字仍按原值，不从零递增。", energy: "mid", sampleText: "2024", englishSlot: false, numberFit: true },
  "tilt-vertical": { fit: "1–4 字，微微倾斜的竖排", rhythm: "短词竖排并略微倾斜，从一侧揭开。", energy: "mid", sampleText: "转折", englishSlot: false, numberFit: false },
  "solid-outline": { fit: "前半描边、后半实心", rhythm: "一行里一半是空心，一半是实心，一起淡入。", energy: "low", sampleText: "虚实对照", englishSlot: false, numberFit: false },
  order: { fit: "2–8 字，旁边一个十字", rhythm: "字组轻轻升起，十字晚一步到位。", energy: "mid", sampleText: "三个原因", englishSlot: false, numberFit: false },
  diamond: { fit: "后半略微下沉的短语", rhythm: "后半个字往下错一截，从一侧揭开。", energy: "mid", sampleText: "看见不同", englishSlot: false, numberFit: false },
  pill: { fit: "需要安静收住的短语", rhythm: "字组从模糊里清楚，旁边一枚药丸。", energy: "low", sampleText: "只留重点", englishSlot: false, numberFit: false },
  "three-dots": { fit: "数字，旁边三个点", rhythm: "百分数从零涨上去，三个点跟着升起。", energy: "mid", sampleText: "85%", englishSlot: false, numberFit: true },
  steps: { fit: "每个字略低一点的短句", rhythm: "字像台阶一样逐个落下。适合能逐字读的短语。", energy: "mid", sampleText: "一步一步", englishSlot: false, numberFit: false },
  "four-dots": { fit: "字组配四个点", rhythm: "字和四个点一起淡入，点分布在字旁。", energy: "mid", sampleText: "四种视角", englishSlot: false, numberFit: false },
  "cross-space": { fit: "描边字加一个交叉", rhythm: "空心字从一侧揭开，交叉符号落在旁边。", energy: "mid", sampleText: "交叉留白", englishSlot: false, numberFit: false },
  chapter: { fit: "像章节名的短句", rhythm: "短句逐字出现，旁边留一个方块，像章节编号。", energy: "mid", sampleText: "第二章", englishSlot: false, numberFit: false },
  "serif-contrast": { fit: "宋体和黑体穿插", rhythm: "一半宋体、一半黑体，从模糊里一起清楚。", energy: "low", sampleText: "宋黑对照", englishSlot: false, numberFit: false },
  focus: { fit: "要被记住的短结论", rhythm: "一句短结论淡入，旁边一个空心圆。", energy: "low", sampleText: "记住这点", englishSlot: false, numberFit: false },
  "blur-slide": { fit: "4–8 字的观点，逐段从虚焦浮出", rhythm: "主字分成几段，位移、模糊和透明度一起到位。小字在主字还没收完时跟上，幅度更小。整行最后淡出。", energy: "low", sampleText: "方向比速度重要", englishSlot: true, numberFit: false },
  "ink-press": { fit: "2–6 字的名字或概念，逐字压印", rhythm: "十字先画出再淡出。主字逐字从大压到正常，字底闪一下。小字用打字机敲出。整行最后淡出。", energy: "low", sampleText: "过度思考", sampleSupport: "先记住", englishSlot: true, numberFit: false },
};

export const motionCatalog: MotionCatalogItem[] = focusPresetIds.map((id) => ({
  id,
  name: focusPresetLabels[id],
  width: presetWidths[id],
  ...details[id],
  sfx: focusSfxMount[id],
}));

const byId = new Map(motionCatalog.map((item) => [item.id, item]));

export function motionById(id: string | undefined) {
  return id ? byId.get(id as FocusPresetId) : undefined;
}

export function motionEnergyLabel(energy: MotionEnergy) {
  return energyLabel[energy];
}

export function filterMotionCatalog(filter: MotionFilter) {
  return motionCatalog.filter((item) => {
    const [min, max] = item.width;
    if (filter === "short") return min <= 3;
    if (filter === "long") return max >= 4;
    if (filter === "number") return item.numberFit;
    if (filter === "english") return item.englishSlot;
    return true;
  });
}

/** 字宽合适的在前。空文本不标不合，避免还没写字时整表都是警告。 */
export function motionChoices(text: string) {
  const width = focusVisualWidth(text);
  const known = width > 0;
  const fits = (item: MotionCatalogItem) => !known || (width >= item.width[0] && width <= item.width[1]);
  return [
    ...motionCatalog.filter(fits).map((item) => ({ item, mismatch: false as const })),
    ...motionCatalog.filter((item) => !fits(item)).map((item) => ({ item, mismatch: true as const })),
  ];
}

export type ShelfEnergy = "low" | "mid" | "high";
const shelfEnergyLabels: Record<ShelfEnergy, string> = { low: "低", mid: "中", high: "高" };

export type CameraCatalogItem = {
  id: Motion;
  name: string;
  fit: string;
  rhythm: string;
  energy: ShelfEnergy;
  sfx: null;
};

export type TransitionCatalogItem = {
  id: TransitionIn;
  name: string;
  fit: string;
  rhythm: string;
  energy: ShelfEnergy;
  sfx: SfxRole | null;
};

const cameraDetails: Record<Motion, Omit<CameraCatalogItem, "id" | "sfx">> = {
  "zoom-in": { name: "推进", fit: "画面慢慢靠近主体", rhythm: "镜头匀速推近，收尾略缓。幅度跟着画面风格走。", energy: "mid" },
  "zoom-out": { name: "拉远", fit: "从主体拉开，看见周围", rhythm: "从近处匀速拉远。适合把人或者物放回环境里。", energy: "low" },
  "pan-left": { name: "左移", fit: "画面向左掠过", rhythm: "画面保持一点放大，向左匀速移动。", energy: "mid" },
  "pan-right": { name: "右移", fit: "画面向右掠过", rhythm: "画面保持一点放大，向右匀速移动。", energy: "mid" },
  none: { name: "静止", fit: "镜头停住", rhythm: "画面不推也不移。适合已经很满的构图。", energy: "low" },
};

const transitionDetails: Record<TransitionIn, Omit<TransitionCatalogItem, "id" | "sfx">> = {
  cut: { name: "切镜", fit: "两镜直接相接", rhythm: "前一镜结束，这一镜立刻出现。", energy: "low" },
  fade: { name: "淡入", fit: "需要轻轻接上的两镜", rhythm: "这一镜从透明里显现。重叠的时间很短。", energy: "low" },
  wipe: { name: "擦除", fit: "从一侧揭开下一镜", rhythm: "这一镜沿一个方向擦开，边上留一道亮边。", energy: "mid" },
  whip: { name: "甩镜", fit: "章节或情绪突然转开", rhythm: "画面快速横移，并带一点模糊。适合章节开头。", energy: "high" },
  push: { name: "推入", fit: "下一镜把前一镜推走", rhythm: "这一镜从画面外推到位，前一镜被推出画外。", energy: "mid" },
  dissolve: { name: "溶解", fit: "两镜叠在一起化开", rhythm: "前一镜和这一镜短暂叠住，再化成下一镜。", energy: "low" },
};

export const cameraCatalog: CameraCatalogItem[] = motions.map((id) => ({ id, ...cameraDetails[id], sfx: null }));
export const transitionCatalog: TransitionCatalogItem[] = transitionIns.map((id) => ({ id, ...transitionDetails[id], sfx: transitionSfxMount[id] }));

const cameraByIdMap = new Map(cameraCatalog.map((item) => [item.id, item]));
const transitionByIdMap = new Map(transitionCatalog.map((item) => [item.id, item]));

export function cameraById(id: string | undefined) {
  return id ? cameraByIdMap.get(id as Motion) : undefined;
}

export function transitionById(id: string | undefined) {
  return id ? transitionByIdMap.get(id as TransitionIn) : undefined;
}

export function shelfEnergyLabel(energy: ShelfEnergy) {
  return shelfEnergyLabels[energy];
}
