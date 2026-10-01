# 动画设计层实施计划：P1–P3

> 承接 [visual-director-plan.md](./visual-director-plan.md) 的 M4「分层渲染」。
> 该计划把画面内容的生成链路做完了（M0–M2 已落地），但代码动画层一直是系统的短板：
> 信息卡不动、镜头之间没有转场、动效和风格脱节。本文是这条主线的续作。
>
> 前置工作（P0）已于 2026-09-30 完成，见 §2。

---

## 0. 执行者须知

### 0.1 你接手的是什么

P0 已经让「换一张视觉风格」这件事在代码画面上真实可见（配色 + 动效参数）。剩下的是把动画从
**每镜头一个 transform** 提升为**有配方、有节奏、有转场落差**的一套系统。

### 0.2 动手前必读

按顺序读，不要跳：

| 文件 | 你要理解什么 |
|---|---|
| `AGENTS.md` | 「项目更新记录」的约定；以及 **Next.js 是改动过的版本**，写 Next 代码前先读 `node_modules/next/dist/docs/` |
| `docs/visual-director-plan.md` §5.2 / §5.3 / §10 | 镜头 v2 的数据结构、规则层扩展、M4 的定义。**本文和 §5.2 有冲突的地方以本文为准**，理由见 §3.3 |
| `lib/core/motion.ts` | P0 新增的动效 preset 表，本文所有配方都建立在它之上 |
| `lib/core/timeline.ts` | 时间轴构建，动画参数在这里派生 |
| `lib/core/types.ts` | `Shot` / `Card` / `Motion` 的现有定义 |
| `lib/core/shots.ts` | `normalizeShots` —— 本文要照它的样子写 `normalizeAnimation` |
| `remotion/layers/anim.ts` | P0 新增的动效基元，所有渲染层从这里取参数 |
| `docs/changelog` 的 0.19.0 条目 | P0 到底改了什么 |

### 0.3 必须在执行期间遵守的约束

1. **绝不让大模型生成 JSX 或自由文本动画描述。** 它只能从封闭枚举里选配方、填结构化参数。
   理由：预览和渲染必须逐帧一致、参数必须可校验可缓存、局部重渲染必须可靠。
2. **绝对帧数不进项目文档。** 动画只在 `buildTimeline()` 里根据字级时间戳派生。
   改语速、换配音、改句子后动画能自动跟随，靠的就是这一条。
3. **`lib/core/` 和 `remotion/` 必须是纯函数或无副作用组件。** 不读数据库、不做网络请求、
   不猜内容。所有随机必须走 Remotion 的 `random(seed)`（纯函数），不能用 `Math.random()`。
4. **纯逻辑放 `lib/core/`，渲染放 `remotion/`。** `lib/core` 有单元测试，`remotion/` 没有
   （它靠真实渲染验证）。所以规则、推导、校验一律下沉到 `lib/core`。
5. **每个阶段结束必须跑** `npm run typecheck`、`npm run lint`、`npx vitest run`，
   并在 `lib/changelog.ts` 最前面追加一条记录。小修补和纯重构不用记。

### 0.4 现有的架构约定（沿用，不要另起炉灶）

- **失效传播**：`Shot.sourceHash` 决定镜头是否过期；`timelineHash` 决定成片是否要重渲染。
- **缓存键**：所有 LLM 调用的键在 `lib/core/keys.ts`，输入变了键就变。
- **并发模型**：Worker 按 stage 消费队列，`defineStage` 声明并发度与进度上报。
- **界面**：镜头级编辑在 `components/video-controls.tsx`，用存储层 `shotUpdate(store, id, fn)` 写回；
  风格级编辑在 `components/visual-style-editor.tsx`。

---

## 1. 统一术语

| 术语 | 含义 |
|---|---|
| **动画配方（recipe / family）** | 一类动画的骨架，如 `stat`（数字滚动）、`process`（流程路径）。封闭枚举 |
| **动效 token** | P0 的 `MotionProfile`：缓动、幅度、入场方向、圆角、纹理。由风格卡派生 |
| **动画锚点（anchor）** | 动画元素与旁白某个字对齐的时间点，如「说『十三亿』时数字开始滚动」 |
| **安全区（safeArea）** | 画面上没有被字幕、AI 标识、平台界面遮挡的可用矩形。**派生的，不是声明的** |
| **编排（choreography）** | 全片范围内的节奏分配：哪里强、哪里留白、哪里换转场 |

---

## 2. P0 已完成的内容（不要重做）

提交：`0.19.0 代码画面与视觉风格对齐`

| 改动 | 位置 | 效果 |
|---|---|---|
| 配色词表与主题推导 | `lib/aix/palette.ts`（新） | 从 Aix 的配色描述解析真实色值；160 张卡得到 42 组强调色（此前 5 组） |
| 动效推导 | `lib/aix/motion.ts`（新） | 从 medium/lighting/composition 文本推导 preset；水墨 energy 0.51、霓虹 1.46 |
| preset 表 | `lib/core/motion.ts`（新） | 12 个封闭 preset + `MotionProfile` schema |
| 动效基元 | `remotion/layers/anim.ts`（新） | `easingFn` / `easeAt` / `enterOffset` / `staggerDelay` / `useCorner` / `grainOpacity` |
| 主题透传 | `lib/core/theme.ts` | `VideoTheme.motion`；正文色随底色明暗翻转 |
| 推荐映射 | `lib/aix/template-map.ts`（新） | 解说模板 → Aix id 的人工校准表 |
| 运镜接风格 | `remotion/layers/motion.tsx` | 幅度和缓动来自 `MotionProfile` |
| 信息卡运镜 | `remotion/shots/placeholder.tsx` | 背景层推、内容层不动；纹理叠层；逐项 stagger |
| 标题/金句 | `title.tsx` / `quote.tsx` | 入场方向与缓动接风格 |
| 风格编辑器 | `components/visual-style-editor.tsx` | 新增「动效」分组 |

**已知遗留（本文要修的）**：

- `shot.motion` 是 5 值枚举，和新的 `MotionProfile` 各管一半，语义重叠。
- 纹理叠层 `Texture` 组件**未经真实渲染验证**（见 §9.1，这是 P1 的第一件事）。
- 现有项目的 `visualStyle` 是旧快照，没有 `motion` 字段，会兜底成 `editorial-restrained`。

---

## 3. 核心设计决策

### 3.1 四层结构

```
语义层   这句话在做什么：提观点 / 摆数据 / 比两件事 / 讲流程 / 制造转折
   ↓
配方层   选动画 family + 结构化参数（大模型只做到这一层）
   ↓
风格层   MotionProfile：缓动 / 幅度 / 入场 / 圆角 / 纹理（由风格卡派生，模型无权改）
   ↓
渲染层   Remotion 组件：useCurrentFrame + interpolate + spring + SVG + Canvas
```

### 3.2 为什么用封闭 preset 而不是自由维度

8 个动效维度的笛卡尔积是 10^5 量级，但互斥组合很多（锐利几何 + 弹性缓动 + 纸张纹理 = 丑）。
12 个 preset 覆盖了 Aix 160 张卡的媒介分布（vector 65 / oil 24 / comic 13 / photo 11 / 3d 10 /
ink 9 / cel 7 / watercolor 5 / print 5 / clay 1 / pixel 1）。自由微调只通过
`MotionProfile` 的几个标量字段开放，且只在用户手动编辑时。

### 3.3 和 visual-director-plan §5.2 的两处冲突（以本文为准）

| §5.2 的写法 | 本文的写法 | 理由 |
|---|---|---|
| `background.safeArea: "none" \| "left" ...` | **删掉**，改为 `buildTimeline()` 派生 | 让模型声明字幕在哪等于让它猜；猜错的后果是文字被盖住的静默失败，只有人眼看成片才发现 |
| `overlays: Overlay[]` 由模型产出 | 收窄为「与 family 正交的装饰层」，且**由风格 token 决定** | 「这里加个光晕」是美术指导的活，不是编剧的活；同时避免 `overlays` 和 `anchors` 职责糊在一起 |

另有一条 §5.2 没写、本文要补的：`transition` 不该由单个镜头声明，而该由**编排层按全片节奏决定**
（见 §6.3）。

### 3.4 时间轴重叠语义（P1 里风险最高的一项）

`visual-director-plan` 没有讨论转场。我们的结论是：

**不要用 `@remotion/transitions` 的 `TransitionSeries`。** 它会缩短相邻场景的总时长，
而音频和字幕由 `layoutLines` 的字级时间戳驱动（`lib/core/timeline.ts:83`），
任何缩短总时长的操作都会让声画错位。

**做法**：给 `TimelineShot` 加 `overlapInMs` / `overlapOutMs`，让相邻镜头的渲染区间**重叠**
而不是缩短。总时长不变，重叠区间内两个镜头同时存活，转场组件读取两侧的 `progress`。

这样时序仍然 frame-native，音频不受影响。**先做 2 镜头的原型验证**（§5.1），
确认 Player 和 renderer 行为一致再铺开。

---

## 4. P1：动画数据模型 + 转场原型

**目标**：把动画从「一个 motion 枚举」升级为可表达配方、锚点、转场、装饰层的数据模型，
并验证重叠式转场在时序上安全。

### 4.1 任务 4.0 —— 先验证 P0 的遗留（半天，**必须最先做**）

P0 的 `remotion/shots/placeholder.tsx` 里，`Texture` 组件用 data-URI SVG +
`feTurbulence` + `mixBlendMode: overlay` 画颗粒/纸纹。这段代码**从未在无头浏览器里跑过**。

```bash
# 起项目，用已有项目出一段样片（或 /run skill）
npm run dev
```

检查：

1. 纹理是否正常显示（不发黑、不变成纯色块、不糊住文字）
2. `mixBlendMode: overlay` 在 Remotion 的 Chrome 里是否按预期工作
3. 对比 draft 与 final 两档渲染，纹理是否一致
4. 逐帧对比 Player 预览与渲染结果（`scale: 0.5` 的草稿即可）

**如果纹理有问题**，退回方案：用 Canvas 逐帧绘制噪点，或直接去掉纹理叠层（
`MotionProfile.texture` 保留但渲染层不实现）。**不要带着未验证的纹理往下做。**

### 4.2 任务 4.1 —— 动画数据模型

**新增 `AnimationSpec`**（`lib/core/types.ts`）：

```ts
export const animationFamilies = [
  "none", "editorial", "kinetic", "stat", "compare",
  "process", "callout", "timeline", "collage", "hud", "ink",
] as const;
export type AnimationFamily = (typeof animationFamilies)[number];

/** 动画锚点：角色表明它在句子里的作用。位置由 lineId + char 决定，时间在 timeline 里算 */
export const anchorRoles = ["enter", "emphasis", "exit"] as const;

export const animationAnchorSchema = z.object({
  lineId: z.string(),
  char: z.number().int().min(0).default(0),
  role: z.enum(anchorRoles),
  /** 锚在哪个元素上（对应 family 渲染器里的具名元素，如 "value" / "unit" / "label"） */
  target: z.string().default(""),
});

export const animationSpecSchema = z.object({
  family: z.enum(animationFamilies).default("none"),
  /** 1 克制 / 2 常规 / 3 强调。全片预算由编排层校验（§6.3） */
  intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  anchors: z.array(animationAnchorSchema).default([]),
  /** 配方参数：必须是扁平的标量，便于校验和缓存。键由各 family 自己解释 */
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type AnimationSpec = z.infer<typeof animationSpecSchema>;
```

**加到 `Shot`**（`lib/core/types.ts` 的 `shotSchema`）：

```ts
animation: animationSpecSchema.optional(),
/** 转场：由编排层填，不由分镜模型填 */
transitionIn: z.enum(["cut", "fade", "wipe", "whip", "push", "dissolve"]).optional(),
```

**加到 `TimelineShot`**（`lib/core/timeline.ts`）：

```ts
/** 已解析成帧的动画：时间由字级时间戳算出，渲染层直接用 */
animation?: {
  family: AnimationFamily;
  intensity: 1 | 2 | 3;
  /** 已换算成镜头内的相对帧数 */
  anchors: { frame: number; role: "enter" | "emphasis" | "exit"; target: string }[];
  params: Record<string, string | number | boolean>;
};
/** 与前后镜头的重叠帧数，转场用 */
overlapInFrames?: number;
overlapOutFrames?: number;
```

**兼容旧字段**：`Shot.motion` 保留，但降级为「family 为 none 时的兜底运镜」。
在 `normalizeAnimation` 里做一次单向推导：`motion` 有值且 `animation` 为空 → 按 §5.3 的映射
转成 `animation.family`，同时清空 `motion` 以避免双轨规则打架。

> **为什么必须清空而不是双轨**：`lib/core/shots.ts:183` 有一条「相邻运镜不同」的规则。
> 如果 `motion` 和 `animation` 并存，这条规则和新的 family 规则会互相覆盖，结果不可预测。

### 4.3 任务 4.2 —— `normalizeAnimation`（纯函数 + 单元测试）

放在 `lib/core/animation.ts`（新），照 `lib/core/shots.ts` 的 `normalizeShots` 的样子写。

```ts
export function normalizeAnimation(
  shots: Shot[],
  lines: Line[],
  times: Map<string, LineTime>,
  profile: MotionProfile,
): Shot[]
```

规则：

| 规则 | 说明 |
|---|---|
| 锚点必须落在覆盖范围内 | 锚点所在句子不在镜头覆盖区间 → 丢弃该锚点 |
| 锚点时间必须有序 | 按 `char` 排序；乱序则重排 |
| 同一 target 只有一个 enter | 重复则保留最早的 |
| 连续同 family 上限 | 连续 3 个镜头同 family（且非 none）→ 第 3 个降级为 `none` |
| 相邻转场不重复 | 连续 2 个镜头同 `transitionIn`（且非 cut）→ 第 2 个改 `cut` |
| 强度预算 | 任意 10 秒窗口内 intensity ≥ 2 的镜头最多 2 个，超出的降 1 级 |
| 留白 | 任意 30 秒窗口内至少要有一个 intensity = 1 的镜头 |
| 与字幕不重复 | family 会输出文字时（stat/kinetic/compare），校验其 `params` 里的文字不与对应字幕完全相同；重复则丢弃该 spec |

最后一条复用 `lib/core/cards.ts` 的 `bare()` + `repeatsCaption()` 思路。

**测试要求**（`lib/core/animation.test.ts` 新建）：每条规则至少一个用例，含边界
（空镜头表、单镜头、全部同 family、锚点在范围外）。

### 4.4 任务 4.3 —— 时间轴重叠 + 转场原型

**第一步：只做 2 个镜头的原型，验证时序。**

在 `lib/core/timeline.ts` 的 `buildTimeline` 里：

```ts
// 转场重叠：不缩短时长，而是让相邻镜头在重叠区间同时存活
const transitionMs = 400; // 由 profile.punchy 和 intensity 决定
sorted.forEach((s, k) => {
  const overlapIn = k > 0 && s.transitionIn && s.transitionIn !== "cut" ? transitionMs : 0;
  ...
});
```

`remotion/video.tsx` 里，`Sequence` 的 `durationInFrames` 要加上重叠帧
（`durationInFrames={dur + overlapOutFrames}`），并传 `overlapInFrames` /
`overlapOutFrames` / `transitionIn` 给渲染层。

**第二步：验证清单（这是本任务的核心，不要跳过）**

- [ ] 全片总时长不变（`timelineHash` 之外的 `durationInFrames` 与改动前一致）
- [ ] 字幕位置不变（对比同一时间码的帧）
- [ ] 旁白音频不变（用 `ffprobe` 比对音轨时长）
- [ ] Player 预览与渲染结果逐帧一致
- [ ] 竖屏同样正确
- [ ] `remotion/root.tsx` 的空时间轴仍能通过 `calculateMetadata`

**第三步：转场组件**（`remotion/layers/transitions.tsx`，新）

先实现 4 个，够用了：

| 转场 | 实现 | 适合 |
|---|---|---|
| `fade` | 两层透明度交叉 | 时间流逝、回忆、章节收束 |
| `wipe` | 遮罩按方向擦除 | 章节推进；形状按 `profile.corner` 决定圆角 |
| `whip` | 两层反向位移 + 方向性模糊 | 空间相邻、节奏加快 |
| `push` | 新画面推走旧画面 | 并列、递进 |

`dissolve` 和 `cut` 在 P1 可以先不分实现（`cut` 就是不加重叠）。

**注意**：转场组件必须只读 `useCurrentFrame()` 和父层传下来的重叠边界，
不能自己去猜其他镜头的信息。

### 4.5 任务 4.4 —— 界面

`components/video-controls.tsx` 的「高级」折叠区（约 837 行）：

- `shot.motion` 的下拉（推进/拉远/左移/右移/静止）保留，但**只在 `animation.family === "none"` 时显示**
- 新增 family 下拉（先只放 P1 已实现的；未实现的禁用并标注「开发中」）
- 新增 `transitionIn` 下拉
- `intensity` 用三段 `SegmentedControl`

**注意**：`lib/core/types.ts` 声明的 `stock` / `chart` 两种 `ShotKind`，以及 `composite` / `real`
两种 `ShotMode`，至今在 `remotion/video.tsx:31` 的 `default` 分支里静默降级成 `PlaceholderShot`。
本次要么实现，要么从类型里删掉。**不要再留这种空承诺。**

### 4.6 P1 验收

- `npm run typecheck` / `npm run lint` / `npx vitest run` 全绿
- §4.4 第二步的验证清单全部打勾
- 新增测试覆盖 `normalizeAnimation` 的每条规则
- 至少一条真实项目出一段带转场的草稿样片

**预计**：4–5 天。

---

## 5. P2：六个动画家族

**目标**：把高频内容形态各配一个动画家族，全部同时支持横屏和竖屏。

### 5.1 任务 5.1 —— Layer Registry

**新增 `remotion/animation/registry.tsx`**：

```tsx
export const animationRenderers: Record<AnimationFamily, AnimationRenderer | undefined> = {
  none: undefined,
  editorial: EditorialReveal,
  kinetic: KineticPhrase,
  stat: StatBurst,
  compare: CompareSplit,
  process: ProcessPath,
  callout: CalloutFocus,
  timeline: undefined,   // P3
  collage: undefined,    // P3
  hud: undefined,        // P3
  ink: undefined,        // P3
};
```

**关键约定**：

- `registry` 里没有的 family **必须报错或明确降级**，不能像 `video.tsx:31` 那样静默兜底
- 每个渲染器只接收：`{ shot, durationInFrames, anchors, params }` + 从 context 取的主题
- 渲染器**不读业务数据、不猜内容、不做网络请求**

### 5.2 任务 5.2 —— 实现顺序与要点

按这个顺序做，前一个验证完再开下一个：

**① `stat`（最高频，先做）**

- 数字滚动：`interpolate` 配 `Easing.out(Easing.cubic)`，但**注意 P0 的 `easeAt` 已经带风格缓动**，直接复用
- 单位延后出现（`staggerDelay(profile, 3)`）
- 背景刻度线随数字一起生长
- **数字必须来自 `card.stat.value`，而它已经被 `sanitizeCard` 校验过出自旁白** —— 不要绕过

**② `kinetic`**

- 词组拆分：`card.headline` 按标点/词边界切分
- 关键词擦入：`clipPath: inset()` 配合 `easeAt`
- 字重与位置变化：用 `interpolate` 的 `outputType: "font-weight"`
  - **约束**：`outputRange` 里必须是**数字字重**（100–900），不能写 `"400"` 这类字符串
    —— Remotion 的 `interpolateFontWeight` 会按字重表插值，字符串会走另一条分支
  - **约束**：本项目只加载了 **400 / 700 / 900** 三个字重（`remotion/fonts.ts`）。
    插值到 550 这类中间值会触发合成加粗，和设计稿不一致。
    建议只在 400↔700 或 700↔900 之间插值，并且在 `final` 档渲染时验证观感

**③ `compare`**

- 分屏推入，中央分割线随 `intensity` 决定粗细
- 两侧依次出现，顺序由 `profile.enterFrom` 决定方向
- 复用 `card.sides`（已校验为两个不同的短词）

**④ `process`**

- SVG 路径绘制：`strokeDasharray` + `strokeDashoffset`
- 节点依次亮起，箭头跟随路径
- **横竖屏要两套路径**（竖屏是纵向清单，横屏是横向流程）

**⑤ `callout`**

- 放大局部 + 聚焦框 + 引线 + 标签
- 依赖 `shot.focus`（已存在）和 `safeArea`（见任务 5.3）
- 引线不能穿过字幕区

**⑥ `parallax`**（对应 visual-director-plan §5.2 的 `composite` 雏形）

- 背景层（生成图）与内容层分离，`translate = pan * depth * k`
- 这是「画面 + 动画层」的最小实现，先做两层，不做三层

### 5.3 任务 5.3 —— 安全区派生（纯函数）

**放在 `lib/core/timeline.ts`**，不放在渲染层。

```ts
/** 镜头覆盖区间内字幕占据的画面比例（0–1），用来给动画层留位置 */
export function subtitleBand(
  cues: Cue[],
  shot: { startMs: number; endMs: number },
  layout: { portrait: boolean },
): { bottomRatio: number; sideRatio: number }
```

要点：

- 输入是**实际存在的 cue**，不是「字幕开关」这个布尔值
- 返回的是比例，不是像素 —— 渲染层再乘 `height`
- 竖屏的避让区比横屏大（见 `remotion/layout.ts:14` 的 `subtitleBottom`）
- 渲染层的 `paddingBottom: portrait ? u * 36 : pad * 1.3`（`placeholder.tsx` 现在硬编码）改为读这个值

**验收**：把字幕临时加长到三行，动画层自动上移，不需要改任何镜头数据。

### 5.4 P2 验收

- 6 个 family 在横屏和竖屏下都不遮挡字幕（用 §5.3 的派生值自动保证）
- 每个 family 至少一条视觉样片
- 同一份稿件跑一遍，连续 10 个镜头不出现明显重复（人工判断 + `family` 直方图）
- 声画同步误差 < 100ms（对应 visual-director-plan §10 的 M4 验收标准）
- 渲染时间不超过 P0 基线的 1.5 倍（用同一项目对比）

**预计**：6–8 天。

---

## 6. P3：编排层、风格专属家族、剩余转场

### 6.1 任务 6.1 —— 编排层（`choreography` 纯函数）

**为什么需要**：分镜是按句子范围分块独立调用大模型的
（`lib/pipeline/stages/storyboard.ts:179`），`partialContext` 只给前后各一个镜头摘要。
所以「相邻别雷同」「每 30 秒要有留白」这类**全局**约束在块边界必然失效。

**做法**：在配方产出后加一个纯函数层，不改 LLM 调用：

```ts
export function choreograph(
  shots: Shot[],
  lines: Line[],
  times: Map<string, LineTime>,
  profile: MotionProfile,
): Shot[]
```

输入信号（**全部是现成的，不需要新的 LLM 调用**）：

- `Line.mood` —— 标注阶段已产出；`lib/core/prompt-compiler.ts:49` 的 `shotMood` 已实现按字数加权投票
- `Shot.importance` —— 分镜模型已产出
- 镜头时长 —— 由 `layoutLines` 算出
- 章节边界 —— `doc.segments`

输出：

- 强度曲线：激昂/紧张 → 3，忧伤/温暖 → 1，其余 2
- 每章最多 1 个「高光镜头」（用重型转场 + intensity 3）
- 每 30 秒至少一个低强度区间
- 转场分配：章节边界用重型，句子边界用轻型，镜内不用

### 6.2 任务 6.2 —— 风格专属家族

| family | 触发条件（`MotionProfile.preset`） | 要点 |
|---|---|---|
| `ink` | `ink-bleed` | SVG 路径生长、墨色扩散、笔触遮罩 |
| `collage` | `print-halftone` / `clay-stopmotion` | 图形切片、纸张错位、套印偏移 |
| `hud` | `neon-hud` | 网格、扫描线、故障闪烁、标签定位 |
| `timeline` | 任意 | 年份滑入、节点连接、横向推进 |

**`hud` 要克制**：glow 和故障闪烁最多同时出现 2 处，否则从「科技感」变成「廉价特效」。
这一条写进 `normalizeAnimation` 的规则里。

### 6.3 任务 6.3 —— 剩余转场与增强

- `dissolve`（与 `fade` 区分：dissolve 带噪点过渡）
- 光带划过、色差抖动（按 `profile.texture` 启用）
- 音频响应：`@remotion/media-utils` **已在 node_modules 里**（传递依赖），
  但频谱分析**必须先生成缓存**，不能让每个组件实时重复计算
- `@remotion/three`：只给极少数重点镜头，**默认不给每个镜头上 3D**
  （会显著拉长渲染时间，和 draft/final 两档渲染的成本模型冲突）
- `@remotion/lottie`：只用于品牌标识和固定图标资产

**唯一需要新装的包是 `@remotion/transitions`**，但我们不用它的 `TransitionSeries`
（理由见 §3.4）。如果最终确认不需要，就不装。

### 6.4 P3 验收

- 固定评测集（visual-director-plan §11 的 5 篇稿子）各跑一遍，保留结果对比
- 机械指标全过（见 §7）
- `timelineHash` 的过敏问题已解决（见 §8.2）

**预计**：8–12 天。

---

## 7. 质量指标

### 7.1 机械指标（能进 CI，**这一层比人工打分重要**）

新增 `lib/core/animation-metrics.ts`（纯函数）+ `tests/animation-metrics.test.ts`：

| 指标 | 怎么算 | 阈值 |
|---|---|---|
| 锚点误差 | 动画帧 vs 该词的字级时间戳 | 全片 < 100ms |
| 信息重复率 | family 输出文字 vs 对应字幕的编辑距离 | 无完全重复 |
| 数字溯源 | `card.stat.value` 是否出现在覆盖句里 | 100%（`sanitizeCard` 已有此校验） |
| family 熵 | 全片 family 分布的信息熵 | > 某阈值（先测基线再定） |
| 连续重复 | 最长同 family / 同转场 run | ≤ 2 |
| 运动时长占比 | 有强运动的帧数 / 总帧数 | 40–70% |
| 安全区越界 | 动画元素 bbox ∩ 字幕 bbox | 空 |
| 强度曲线方差 | intensity 序列的方差 | > 0（不恒定） |

前三条复用现有基础设施（`sanitizeCard`、字级时间戳），后五条是纯几何计算。

### 7.2 人工抽查（每阶段一次，不做回归）

visual-director-plan §11 的固定评测集：

1. 虚构故事（2 主角 + 1 配角，含时间跨度）
2. 硬核科普（大量数据和流程）
3. 观点评论（大量抽象句）
4. 历史真实人物
5. 第一人称 UP 主吐槽

每篇固定测 4 类视觉风格（覆盖 deep/light、繁/简、有彩/无彩）。

---

## 8. 已知风险

### 8.1 渲染时长（高）

分层 + 转场 + 纹理会让 draft 预览变慢。

**对策**：`Quality` 分档（`lib/pipeline/render.ts` 已有 `draft` / `final`）。
draft 关掉纹理叠层和粒子；`MotionProfile.texture === "none"` 的风格本身就轻。
在 `getBundle` 的签名缓存之外，另记一个「动画复杂度」指标，超阈值时给出提示。

### 8.2 `timelineHash` 过敏（高）

`lib/core/timeline.ts:248` 用整条时间轴算哈希来决定成片是否要重渲染。
动画参数进去后，**改一个转场就会让整片重渲染**。

**对策**：拆成两个哈希：

```ts
export function contentHash(t: Timeline)  // 决定「内容变了，需要重渲染」
export function animationHash(t: Timeline) // 决定「只是动画参数变了」
```

渲染记录里存两个；只有 `contentHash` 变了才必须重渲染，`animationHash` 变了给出「可选重渲染」提示。

### 8.3 向后兼容（中）

现有项目存的是旧 `visualStyle` 快照，没有 `motion` 字段 → 兜底成 `editorial-restrained`。
现有 `Shot` 没有 `animation` 字段 → 兜底成 `none`。

**对策**：不写迁移脚本（风险高于收益）。在项目界面给一次提示：
「视觉风格有动效新能力，重选风格即可启用」。`normalizeAnimation` 保证旧数据能跑。

### 8.4 过度动画（中）

信息密度高的科普内容，画面越多动效越乱。

**对策**：`intensity` 预算（§4.3）+ 全局强度滑杆（克制/标准/张扬），默认「标准」。
默认值应该偏克制，让用户主动加，而不是主动减。

### 8.5 转场与 AI 标识冲突（低）

AI 标识在右上角（`remotion/layers/ai-label.tsx`），转场不能让它闪烁或消失。

**对策**：标识渲染在所有转场之上（保持现有层级），并在验证清单里加一条
「转场期间标识持续可见」。

### 8.6 生图型镜头的运镜天花板（低但要注意）

一张静态图做再多 transform 也不会有信息量。

**对策**：真正的高价值区在**画面 + 动画层的合成**（visual-director-plan 的 `composite` 模式）。
P2 的 `parallax` 是这块的最小实现，**不要期待给静态图加运镜能解决观感问题**。

---

## 9. 每阶段的执行检查表

复制这一段到你的工作笔记里逐条打勾。

### 通用（每个阶段结束）

- [ ] `npm run typecheck` 通过
- [ ] `npm run lint` 通过
- [ ] `npx vitest run` 全绿
- [ ] `lib/changelog.ts` 最前面加了新条目（有行为变化才加）
- [ ] `npm run dev` 起得来，`/`、`/styles`、`/changelog` 返回 200
- [ ] 至少一条真实项目出样片人工看过

### 每个新 family

- [ ] 横屏正确
- [ ] 竖屏正确
- [ ] 不遮挡字幕（靠 §5.3 的派生值，不是靠硬编码 padding）
- [ ] 不遮挡 AI 标识
- [ ] `params` 里的文字不与字幕重复
- [ ] 只有 `intensity = 1` 时也看起来是完整的画面（不是「减法后的残次品」）
- [ ] registry 里没有的 family 会明确报错或降级，不静默兜底

### 每次碰转场

- [ ] 全片总时长不变
- [ ] 音频时长不变（`ffprobe` 比对）
- [ ] 字幕时间码不变
- [ ] Player 与 renderer 逐帧一致
- [ ] 转场期间 AI 标识持续可见

---

## 10. 分工建议

如果多个 Agent / 会话并行，建议这样切（**按文件边界切，不要按功能切**）：

| 工作流 | 独占文件 | 依赖 |
|---|---|---|
| **A. 数据模型** | `lib/core/types.ts`、`lib/core/animation.ts`、`lib/core/timeline.ts` | 必须先做，其他都等它 |
| **B. 渲染基座** | `remotion/video.tsx`、`remotion/layers/transitions.tsx`、`remotion/layers/anim.ts` | 等 A 的接口冻结 |
| **C. 家族实现** | `remotion/animation/*.tsx`、`remotion/animation/registry.tsx` | 等 B 的转场接口 |
| **D. 提示词与流水线** | `lib/prompts.ts`、`lib/pipeline/stages/storyboard.ts` | 等 A 的 schema 冻结 |
| **E. 界面** | `components/video-controls.tsx`、`components/visual-style-editor.tsx` | 等 A 的 schema 冻结 |
| **F. 指标** | `lib/core/animation-metrics.ts`、`tests/animation-metrics.test.ts` | 可以立即并行 |

**串行约束**：A → B → C。D / E / F 在 A 的 schema 冻结后即可并行。

**冲突高发区**：`lib/core/types.ts` 和 `lib/core/timeline.ts` 被多方读写。
建议由 A 一个人负责到接口冻结为止，之后其他人只 import 不改。

---

## 11. 参考

- 现有实现：`lib/core/motion.ts`、`lib/aix/motion.ts`、`remotion/layers/anim.ts`
- 上游计划：`docs/visual-director-plan.md`（§5.2 镜头 v2、§5.3 规则层、§10 M4）
- 管线总览：`docs/video-pipeline-p0-p1.md`
- Remotion 版本：`4.0.528`（`package.json`）
  - 已内置：`Easing`、`spring`、`interpolate`（含 `posterize`、`outputType: "font-weight"`）、`random`
  - 已在 node_modules（传递依赖）：`@remotion/media-utils`、`@remotion/canvas`、`@remotion/media`
  - **需要新装**：`@remotion/transitions`（但按 §3.4 我们可能不需要）
