/**
 * 解说风格模板 → Aix 视觉风格 的人工映射。
 *
 * Aix 的 `suitable_for` 是题材标签（封面 / 海报 / 概念插画），和项目的解说风格
 * 模板不是同一套词汇，无法直接匹配，所以这里维护一张校准表：每种解说风格给出
 * 若干个优先的 Aix id，按顺序取第一个可用的。
 *
 * 表是人工校准的资产：改这里等于改「新建项目默认拿到什么画面」。
 * id 失效（下架或拼错）时自动跳过，不会让推荐整体失败。
 */

export const templateVisualStyle: Record<string, string[]> = {
  // 严肃：克制、真实、信息密度高
  serious: ["Aix0001", "Aix0003", "Aix0012"],
  // 幽默：轻松、图形化、色彩明快
  humor: ["Aix0003", "Aix0006", "Aix0012"],
  // 吐槽：漫画感、强对比、节奏快
  roast: ["Aix0012", "Aix0008", "Aix0003"],
  // 悬疑：暗调、低饱和、强光影
  suspense: ["Aix0008", "Aix0001", "Aix0004"],
  // 科普：干净、结构清楚、信息图友好
  science: ["Aix0003", "Aix0001", "Aix0012"],
  // 温暖：柔和、手作、低对比
  warm: ["Aix0006", "Aix0001", "Aix0004"],
  // 激昂：强对比、动势强
  passion: ["Aix0012", "Aix0008", "Aix0003"],
  // 纪实：观察感、胶片、克制
  documentary: ["Aix0001", "Aix0008", "Aix0004"],
};

/** 没有任何匹配时的兜底顺序 */
const FALLBACK = ["Aix0001", "Aix0003", "Aix0004", "Aix0012"];

/** 某个解说风格模板的候选 Aix id（按优先级）；未知模板返回兜底表 */
export function candidatesForTemplate(templateId?: string): string[] {
  const list = (templateId && templateVisualStyle[templateId]) || FALLBACK;
  return templateId && templateVisualStyle[templateId] ? [...list, ...FALLBACK] : list;
}
