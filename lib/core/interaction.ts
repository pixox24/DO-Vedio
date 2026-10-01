/**
 * 交互契约：什么时候该打断用户、以及怎么把代价写清楚。
 *
 * 判断依据是「打断成本 < 返工代价 × 不可逆程度，才值得弹窗」。
 * 这里只负责两件事，都是纯函数，前后端共用：
 *   1. 要不要弹窗（needsConfirm）—— 只看规模，不看别的
 *   2. 按钮/提示上怎么显示代价（costLabel / costSuffix）
 *
 * 注意：**标签永远都要有，阈值只决定弹不弹**。两者不是二选一，
 * 弹了窗也照样要在按钮上显示数量和金额。
 */

export const CONFIRM_POLICY = {
  /** 贵到这个金额就值得问一句（元） */
  minCostYuan: 0.5,
  /**
   * 或者动到这么多付费单元（句 / 张）就值得问一句。
   * 语义是「值得打断的规模」，**不是**「一个段落的上限」——这两者容易混。
   * 一个满段落（8 句）必须落在阈值下方，否则最高频的「重录本段」会被误拦。
   * 故取 12（一个半段落），让 8 句落在下方、40 句落在上方。
   */
  minUnits: 12,
  /** 低于这个值不显示金额，只显示「不足 ¥0.01」 */
  readableCostYuan: 0.01,
};

export type PaidUnits = {
  /** 付费单元数量：句、张…… */
  units: number;
  /** 单元量词，用于拼「8 句」「3 张」 */
  unit: string;
  /** 预估金额（元）；null 表示无法估算（例如没有图片单价） */
  costYuan: number | null;
};

/** 是否值得打断用户问一句 */
export function needsConfirm(u: { units: number; costYuan: number | null }) {
  return u.units >= CONFIRM_POLICY.minUnits || (u.costYuan ?? 0) >= CONFIRM_POLICY.minCostYuan;
}

/**
 * 金额文案。无法估算时返回空串（调用方只显示数量），
 * 不足一分显示「不足 ¥0.01」而不是会让人误以为免费的「¥0.00」。
 */
export function costLabel(costYuan: number | null) {
  if (costYuan == null) return "";
  if (costYuan <= 0) return "";
  return costYuan >= CONFIRM_POLICY.readableCostYuan ? `约 ¥${costYuan.toFixed(2)}` : "不足 ¥0.01";
}

/**
 * 按钮上的统一后缀：优先数量，金额只在可估且有意义时出现。
 * 例：「8 句 · 约 ¥0.03」「3 张」「不足 ¥0.01」。
 */
export function costSuffix(u: PaidUnits) {
  const cost = costLabel(u.costYuan);
  return [`${u.units} ${u.unit}`, cost].filter(Boolean).join(" · ");
}

/**
 * 段落配音模式下按句累加会低估：块内只缺一句也要重录整块。
 * 这类入口用这个把金额标成「约 ¥0.05 起」，不要给出偏低的确切数字。
 */
export function costSuffixAtLeast(u: PaidUnits) {
  const cost = costLabel(u.costYuan);
  return [`${u.units} ${u.unit}`, cost && `${cost} 起`].filter(Boolean).join(" · ");
}
