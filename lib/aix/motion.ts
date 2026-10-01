import { motionProfile, motionPresets, type MotionPresetId, type MotionProfile } from "../core/motion";
import type { AixStyle } from "./schema";

/**
 * Aix 风格 → 动效参数。
 *
 * 风格卡本来只回答「怎么画」。这里让同一张卡也回答「怎么动」：
 * 缓动曲线、入场节奏、运镜幅度、纹理——全部从已有的 medium / lighting /
 * composition / texture 文本里推导，不新增 Aix schema 字段。
 * 换一张 Aix 风格，代码画面的节奏跟着换。
 */

/** medium 文本 → preset。顺序敏感：先匹配更具体的媒介 */
const MEDIUM_RULES: { test: RegExp; preset: MotionPresetId }[] = [
  { test: /水墨|宣纸|墨线|墨形|蚀刻|木刻/, preset: "ink-bleed" },
  { test: /水彩|湿画|晕染/, preset: "painterly-soft" },
  { test: /黏土|定格|手工捏制/, preset: "clay-stopmotion" },
  { test: /像素/, preset: "pixel-step" },
  { test: /丝网|版画|喷绘|专色平涂/, preset: "print-halftone" },
  { test: /赛璐璐|日系|动漫/, preset: "cel-animation" },
  { test: /漫画|美漫|线稿|钢笔|排线/, preset: "comic-panel" },
  { test: /油画|厚涂|画布|表现主义/, preset: "painterly-soft" },
  { test: /摄影|写实|照片|胶片|街拍/, preset: "documentary-observant" },
  { test: /三维|3D|渲染|雕塑|粒子/, preset: "concept-render" },
  { test: /矢量|平涂|扁平|色块|几何|剪影|海报|图形/, preset: "geometric-editorial" },
  { test: /概念|数字绘画|数字手绘|插画/, preset: "editorial-restrained" },
];

/** 有夜景 / 霓虹 / 发光特征时切到界面感动效（覆盖 medium 的判断） */
const NEON_RULE = /霓虹|荧光|发光线条|自发光|故障|HUD|光轨|屏幕光|赛博/;
/** 张力：硬光、强对比、戏剧光 —— 提高幅度，让切点更有力 */
const PUNCH_RULE = /硬光|硬边|强对比|戏剧光|高对比|撞色|放射|冲击/;
/** 舒缓：柔光、留白、浅景深、雾 —— 压低幅度 */
const CALM_RULE = /柔光|留白|负空间|浅景深|朦胧|安静|呼吸/;

/** 风格文本 → 动效参数 */
export function deriveMotion(style: Pick<AixStyle, "features" | "category">): MotionProfile {
  const textOf = (axis: AixStyle["features"][number]["axis"]) => style.features.filter((f) => f.axis === axis).map((f) => f.text).join("；");
  const medium = textOf("medium");
  const all = `${medium}；${textOf("palette")}；${textOf("lighting")}；${textOf("composition")}；${textOf("texture")}；${textOf("line")}`;

  const matched = MEDIUM_RULES.find((r) => r.test.test(medium))?.preset ?? "editorial-restrained";
  const preset = NEON_RULE.test(all) && matched !== "ink-bleed" && matched !== "pixel-step" ? "neon-hud" : matched;

  const base = motionProfile(preset);
  let energy = base.energy;
  let punchy = base.punchy;
  if (PUNCH_RULE.test(all)) {
    energy = Math.min(1.5, energy * 1.12);
    punchy = true;
  }
  if (CALM_RULE.test(all)) energy = Math.max(0.45, energy * 0.85);

  return { ...base, energy: Number(energy.toFixed(2)), punchy };
}

/** 供测试和展示：某个 preset 的基准参数 */
export { motionPresets, motionProfile };
