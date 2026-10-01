import { describe, expect, it } from "vitest";
import { contrastInk, deriveTheme, extractColors, luminance } from "./palette";
import { deriveMotion } from "./motion";
import type { AixStyle } from "./schema";

const features = (pairs: [AixStyle["features"][number]["axis"], string][]): AixStyle["features"] =>
  pairs.map(([axis, text], i) => ({ id: `F${String(i + 1).padStart(2, "0")}`, axis, tier: "core" as const, text }));

describe("配色词表", () => {
  it("长词优先，深蓝不会被蓝抢先命中", () => {
    const c = extractColors("深蓝主调配亮黄点缀");
    expect(c.map((x) => x.token)).toEqual(["深蓝", "亮黄"]);
  });

  it("同色值的不同写法合并成一个，保留首次出现的位置", () => {
    // 「夜色」与「深蓝」同值，「纯黑」与「黑」同值
    expect(extractColors("纯黑白灰，无彩色").map((x) => x.token)).toEqual(["纯黑", "白", "灰"]);
  });

  it("无用色词时返回空，交给分类兜底", () => {
    expect(extractColors("高对比限定色板，大面积纯色底")).toEqual([]);
  });
});

describe("主题推导", () => {
  it("底色压深到能压住白字", () => {
    const t = deriveTheme("低饱和雾青底色与暖色局部对比", "photographic");
    expect(luminance(t.schemes[0][0])).toBeLessThan(0.35);
  });

  it("三色并列时强调色取面积最大的那个，不取被点名点缀的", () => {
    // 「米白底、朱红大圆、深灰黑剪影，辅以灰蓝暗绿微点缀」→ 强调色是朱红
    const t = deriveTheme("米白底、朱红大圆、深灰黑剪影三色构成，辅以灰蓝暗绿微点缀", "illustration");
    expect(t.accent).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(t.accent.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g * 1.5);
    expect(r).toBeGreaterThan(b * 1.5);
  });

  it("提供两组配色，让相邻镜头不雷同", () => {
    const t = deriveTheme("青蓝夜色与品红暖霓虹强对比", "photographic");
    expect(t.schemes).toHaveLength(2);
    expect(t.schemes[0][0]).not.toBe(t.schemes[1][0]);
  });

  it("解析不出颜色时按分类兜底", () => {
    expect(deriveTheme("高对比限定色板，大面积纯色底", "graphic").schemes[0]).toHaveLength(3);
  });

  it("浅色底用深字，深色底用浅字", () => {
    expect(contrastInk(["#f2ece1", "#cccccc", "#ffffff"]).text).toBe("#14161a");
    expect(contrastInk(["#101a2c", "#2b6f96", "#e0a05a"]).text).toBe("#f6f7f8");
  });
});

describe("动效推导", () => {
  it("水墨得到慢速非线性笔触，不是快速平推", () => {
    const m = deriveMotion({ category: "painting", features: features([["medium", "宣纸水墨绘制，墨色随水渗化"]]) });
    expect(m.preset).toBe("ink-bleed");
    expect(m.energy).toBeLessThan(0.7);
    expect(m.easing).toBe("cinematic");
    expect(m.texture).toBe("paper");
  });

  it("扁平几何得到硬边快速，圆角为直角", () => {
    const m = deriveMotion({ category: "graphic", features: features([["medium", "扁平色块构成，无渐变"]]) });
    expect(m.preset).toBe("geometric-editorial");
    expect(m.corner).toBe("sharp");
    expect(m.easing).toBe("expo");
  });

  it("霓虹特征覆盖媒介判断，切到界面感动效", () => {
    const m = deriveMotion({
      category: "photographic",
      features: features([["medium", "摄影式夜晚街拍"], ["lighting", "霓虹招牌的局部高光"]]),
    });
    expect(m.preset).toBe("neon-hud");
    expect(m.texture).toBe("scanline");
  });

  it("黏土定格得到回弹和圆角", () => {
    const m = deriveMotion({ category: "3d", features: features([["medium", "3D 黏土定格质感，造型圆润"]]) });
    expect(m.preset).toBe("clay-stopmotion");
    expect(m.corner).toBe("round");
    expect(m.easing).toBe("elastic");
  });

  it("舒缓的描述压低幅度，张力的描述抬高幅度", () => {
    const calm = deriveMotion({ category: "painting", features: features([["medium", "油画厚涂"], ["composition", "大面积留白与呼吸感"]]) });
    const punch = deriveMotion({ category: "graphic", features: features([["medium", "矢量平涂"], ["lighting", "硬光强对比戏剧光"]]) });
    expect(calm.energy).toBeLessThan(punch.energy);
    expect(punch.punchy).toBe(true);
  });

  it("认不出的媒介退回克制编辑，不报错", () => {
    const m = deriveMotion({ category: "illustration", features: features([["medium", "某种没见过的画法"]]) });
    expect(m.preset).toBe("editorial-restrained");
  });
});
