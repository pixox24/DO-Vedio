# ui2v 动效模板接入与内容匹配实施方案

> 状态：设计评估与落地计划
>
> 目标：在保持 DO-Vedio 时间轴、字幕、音频和 Remotion 成片一致性的前提下，引入 ui2v 的高质量动效设计语言，解决现有内置动画模板简单、重复、难看、与分镜语义不匹配的问题。
>
> 约束：本文件只描述接入方案，不改变当前渲染行为。真正接入前必须完成模板来源、许可证、依赖和真实渲染验证。

## 1. 结论先行

ui2v 不应该作为一个黑盒播放器直接嵌入 DO-Vedio，也不应该把网站上的模板原样复制到每一个镜头。正确的定位是：

```text
ui2v
  -> 提供高质量视觉语法、布局、图形和动效参考
  -> 经过 manifest 描述、许可证审计和适配
  -> 转换为 Remotion 可逐帧驱动的模板
  -> 由 DO-Vedio 的时间轴、字级时间戳、字幕安全区和音频统一编排
```

最重要的架构拆分是：

```text
semantic family = 这句话应该怎样表达
template         = 具体使用哪种视觉实现
style token      = 颜色、缓动、纹理、圆角和能量
timeline         = 何时开始、何时结束、何时响应旁白
```

当前项目把 family 和具体视觉实现绑在一起，所以 `stat`、`kinetic`、`process` 虽然名称不同，仍然共享相似的渐变、文字和入场结构。接入 ui2v 后，同一个 family 应该拥有多个模板变体，并能根据内容、画幅、风格和素材自动选择。

“完美匹配”不应理解为让模型自由挑选模板。可靠的目标是：模型负责内容语义，规则层负责模板选择，时间轴负责时序，渲染器负责视觉实现，质量门负责拒绝不合格结果。

## 2. 事实与范围

### 2.1 ui2v 公开页面提供的能力信号

公开页面 [ui2v.com](https://ui2v.com/) 当前展示了：

- UI 到视频 / UI 动效社区定位。
- HyperFrames 动效包、真实浏览器库、本地 MP4 输出。
- Quick start 命令：`npx skills add illli-studio/ui2v --skill`。
- 支持 Codex、Cursor、Claude Code、ChatGPT、OpenCode 等 coding agent。
- 公开模板方向包括 `studio-ai-data-story`、`studio-kinetic-typography`、`studio-ai-agent-workflow`、`studio-infinite-canvas`、`studio-liquid-glass`、`hero-stack-cards` 等。

这说明 ui2v 至少包含一个面向 agent 的 skill / 模板入口和一个模板展示社区。`npx skills add ...` 本身不等于把模板注册进 DO-Vedio 的 Remotion registry；它更适合作为开发参考和模板生产辅助工具。

### 2.2 接入前必须确认的事实

在任何代码或资产进入生产渲染链之前，逐个模板确认：

1. 仓库 commit、模板版本和来源 URL。
2. 根目录和模板目录的 `LICENSE`。
3. 字体、图片、图标、音频和第三方依赖的单独许可证。
4. 是否依赖远程资源、登录态、第三方 API 或运行时 CDN。
5. 是否包含 CSS animation、CSS transition、`Date.now()`、`Math.random()` 或实时音频分析。
6. 是否能够固定时间、固定随机种子和固定视口。
7. 是否能适配中文、长文本、16:9 和 9:16。
8. 是否允许商业使用、修改和再分发。

在许可证未确认前，只能把模板当作设计参考，不能提交模板代码、图片、字体或导出视频到生产包。

### 2.3 如何使用本文

本文把内容分成两种状态：

- **现状事实**：带有仓库文件路径、现有行为或本次评估观察结果；执行前仍应以当前代码和公开来源复核。
- **目标方案**：以“必须 / 应该 / 不得”描述的实现约束；它们不是已完成能力，不能在产品界面中宣称已经支持。

按 Phase 0 到 Phase 5 顺序执行。每个阶段都必须先满足“进入条件”，完成交付物并通过“退出条件”，再开始下一阶段。任何许可证、渲染确定性、字幕安全区或时长校验失败，都停在当前阶段并走回滚策略，不用未验收模板继续开发。

建议把每次执行记录在一个独立变更单中，至少包含：执行日期、ui2v 来源 commit、DO-Vedio commit、Remotion/Chrome 版本、候选模板清单、自动检查输出、人工抽查视频和遗留风险。外部网站会变化，不能只记录模板名称而不记录版本和来源。

## 3. 当前项目的痛点诊断

### 3.1 视觉结构过于单一

[remotion/animation/registry.tsx](/Users/huazi/Desktop/DO-Vedio/remotion/animation/registry.tsx:24) 的 `Surface` 统一使用深、中、浅三色渐变、简单纹理和相似的文字布局。各 family 主要改变文字、面板和入场方式，缺少：

- 真实素材和动画层的组合。
- 可复用的玻璃、纸张、胶片、网格、遮罩、标签和图形原语。
- 具有层级关系的背景、中景、前景和标注。
- 真实的构图变化和内容相关的空间关系。

结果是“能动”，但不像经过设计的模板。

### 3.2 动画没有覆盖大部分素材镜头

[remotion/video.tsx](/Users/huazi/Desktop/DO-Vedio/remotion/video.tsx:24) 只有非 `image`、非 `video`、非 `upload`、非 `stock`、非 `chart` 的代码画面会进入 animation registry。AI 图片和视频镜头仍然主要依靠旧式 `motion` 运镜。

因此，静态图片即使使用了高级动画 family，也不能获得真正的内容层、标注层和合成层效果。解决“静态图只会缩放”的核心不是再增加一个 zoom preset，而是加入 overlay template 和 composite template。

### 3.3 分镜阶段没有真正选择动画语义

[lib/pipeline/stages/storyboard.ts](/Users/huazi/Desktop/DO-Vedio/lib/pipeline/stages/storyboard.ts:32) 的结构化输出包含 `kind`、`mode`、`card`、`motion` 和 `importance`，但没有独立的模板语义或 family。后续归一化会把旧 `motion` 映射为较宽泛的动画 family，导致不同内容最终落入相近的视觉表现。

需要把“内容理解”和“视觉模板选择”拆开：

- 分镜阶段识别内容意图、卡片结构、锚词、角色和素材。
- 纯函数 matcher 根据这些信号选择模板。
- 模型不能输出 JSX、任意 CSS 或模板内部实现。

### 3.4 当前指标不能完全证明动画质量

[lib/core/animation-metrics.ts](/Users/huazi/Desktop/DO-Vedio/lib/core/animation-metrics.ts:56) 的 `anchorErrorMs` 目前固定为 `0`，安全区检查只用 `bottomRatio > 0.48` 做粗略判断，并未计算真实元素边界与字幕区域的交集。

接入外部模板后，必须补充真实的锚点、文字容量、元素 bbox、画幅布局和预览/成片一致性检查，否则会出现“指标通过但画面难看或被遮挡”的假阳性。

## 4. 目标架构

```text
文案与字级时间轴
        |
        v
内容特征提取
数字 / 对比 / 流程 / 时间线 / 观点 / 角色 / 素材 / 文本容量 / 情绪
        |
        v
语义 family 分类
stat / compare / process / timeline / quote / callout / hero / overlay
        |
        v
模板 matcher
manifest 过滤 + 评分 + 风格匹配 + 画幅匹配 + 重复抑制 + 风险惩罚
        |
        v
全片编排
强度曲线 / 章节边界 / 留白 / family 冷却 / transition
        |
        v
TimelineShot
templateId + family + anchors + safeArea + assets + params
        |
        v
Remotion adapter
背景素材层 + ui2v 图形层 + 文字层 + 字幕层 + AI 标识层 + 音频层
```

DO-Vedio 仍然是唯一的时间轴真相来源。ui2v 模板不得自己决定镜头时长、字幕时长、音频位置或输出画幅。

## 5. 模板模型与数据契约

### 5.1 family 与 template 的职责

`family` 是稳定的语义协议，数量应保持克制；`templateId` 是可扩展的视觉实现，可以来自 ui2v 或项目原生模板。

```ts
type MotionFamily =
  | "editorial"
  | "kinetic"
  | "stat"
  | "compare"
  | "process"
  | "timeline"
  | "callout"
  | "quote"
  | "hero"
  | "overlay";

type MotionTemplateManifest = {
  id: string;
  source: "native" | "ui2v";
  sourceUrl: string;
  sourceCommit?: string;
  templateVersion: string;
  license: string;
  licenseStatus: "pending" | "approved" | "rejected";
  licenseEvidenceUrl?: string;
  licenseNotes?: string;
  family: MotionFamily;
  variant: "restrained" | "technical" | "expressive";
  supportedAspects: ("16:9" | "9:16")[];
  minDurationMs: number;
  maxDurationMs: number;
  maxTextChars: number;
  requiresAsset: boolean;
  supportsImageLayer: boolean;
  supportsVideoLayer: boolean;
  preferredSafeArea: "bottom" | "center" | "full";
  renderMode: "remotion" | "browser-capture";
  energy: "low" | "medium" | "high";
  tags: string[];
  dependencies: { name: string; version: string; license?: string }[];
  fallbackTemplateId: string;
};
```

`templateId` 不由大模型直接生成。模型可以产出 family、intent、card、anchors 和 focus；template matcher 再根据 manifest 选择具体模板。用户可以锁定模板，但锁定值必须经过 manifest 校验。

`AnimationSpec` 应独立保存可选的 `templateId`：

```ts
type AnimationSpec = {
  family: MotionFamily;
  templateId?: string;
  intensity: 1 | 2 | 3;
  anchors: { lineId: string; char: number; role: "enter" | "emphasis" | "exit"; target: string }[];
  params: Record<string, string | number | boolean>;
};
```

模型不得生成 `overlays` 数组、JSX 或任意 CSS。`focus`、人物和对象等字段只表达内容语义；实际使用哪些装饰层由模板 manifest 和风格 token 共同决定，并由 matcher 选择。这样既保留内容匹配能力，也避免编剧输出“加光晕、加扫描线”这类不可审计的美术指令。

对于 `source === "ui2v"` 的模板，进入 registry 的最低条件是 `licenseStatus === "approved"`、`sourceCommit` 和 `templateVersion` 均存在、至少有一个目标画幅、`fallbackTemplateId` 指向已注册模板，并且 `renderMode` 对应的时间确定性检查通过。`preferredSafeArea` 只是模板的布局偏好，不能覆盖时间轴根据真实字幕和 AI 标识派生的安全区。

### 5.2 模板适配器接口

Remotion 适配器只接收可序列化的输入：

```tsx
type MotionTemplateProps = {
  shot: TimelineShot;
  durationInFrames: number;
  anchors: NonNullable<TimelineShot["animation"]>["anchors"];
  params: Record<string, string | number | boolean>;
};

type MotionTemplateRenderer = (props: MotionTemplateProps) => React.ReactNode;
```

适配器内部必须使用 `useCurrentFrame()`、`useVideoConfig()` 和确定性函数。禁止依赖 CSS `animation`、CSS `transition`、时间墙、随机数和网络请求。复杂模板可以使用 SVG、Canvas 或 `@remotion/three`，但必须保证预览和最终渲染使用同一时间驱动。

项目只加载 400、700、900 三个字重。适配器和样式 token 只能使用这三个真实字重，不能把 550、600 等中间值当作可用字体；否则浏览器会触发合成加粗，导致预览与成片的字宽和换行漂移。

每个适配器还必须明确三种结果：正常渲染、可诊断的资源缺失状态、回退模板。未注册的 `templateId`、不支持的画幅、超出文字容量或未通过许可证门禁时，渲染器必须选择 `fallbackTemplateId` 并记录原因，不能返回空节点或静默显示普通占位卡。

### 5.3 推荐文件边界

```text
lib/core/motion-templates.ts       manifest schema、模板类型、校验
lib/core/template-matcher.ts       纯函数匹配与评分
lib/core/template-features.ts      从 shot / card / line 提取内容特征
remotion/animation/template-registry.tsx
remotion/animation/templates/      ui2v 移植后的 Remotion 模板
remotion/animation/overlays/        图片和视频上的叠加模板
vendor/ui2v/                        仅放已审计、已固定版本的允许代码
scripts/ui2v-audit.ts               来源、许可证、依赖和 manifest 检查
tests/template-matcher.test.ts      匹配规则测试
tests/template-manifest.test.ts     manifest 与许可证门禁测试
```

如果某个模板无法安全移植，不能把它塞进 `remotion/animation/templates` 假装是原生模板，应明确标记为 `browser-capture`，并单独走渲染缓存。

## 6. ui2v 模板的选取与分层使用

### 6.1 首批模板方向

官网展示的模板名称只能作为候选设计方向，实际代码必须通过许可证和真实渲染审计。首批建议覆盖以下六类：

| 内容语义 | 候选方向 | 首批用途 |
|---|---|---|
| 数据、指标、比例 | `studio-ai-data-story` | 数字、统计、趋势、科普 |
| 重点词、观点、结论 | `studio-kinetic-typography` | 金句、强调句、结论 |
| 流程、步骤、系统关系 | `studio-ai-agent-workflow` | 三到五步的流程说明 |
| 时间顺序、历史跨度 | `studio-infinite-canvas` | 时间线和章节推进 |
| 科技界面、状态信息 | `studio-liquid-glass` | HUD、产品界面、技术信息 |
| 片头、章节高光 | `hero-stack-cards` | 开场、章节切换、重点转折 |

首批不要超过六个完整模板；先确认中文、竖屏、字幕和渲染性能，再扩展到每个 family 三种视觉变体。

### 6.2 三种使用层级

1. **微型原语**：玻璃面板、扫描线、纸张纹理、节点、标签、遮罩、光带、游标、分割线。它们可以在多个模板之间复用。
2. **镜头模板**：完整的 stat、compare、process、timeline、quote、callout 和 hero 布局。
3. **章节模板**：片头、章节转场、章节高光和片尾。它们可以使用更复杂的动画，但数量必须少。

不要把每个 ui2v 页面都当成一个不可拆分的组件。真正能长期复用的是设计原语、时间曲线和布局规则。

### 6.3 图片与视频镜头的合成方式

```text
背景层：AI 图片 / 视频 / 上传素材
图形层：ui2v 的框、节点、标签、遮罩、扫描线、数据面板
文字层：镜头自身的短文本
字幕层：DO-Vedio 统一字幕和逐字高亮
品牌层：AI 标识、Logo、片头片尾
音频层：旁白、配乐、音效
```

例如：

- `liquid-glass` 应作为图片上的半透明信息面板，而不是替换图片。
- `callout` 应读取 `shot.focus`，在图片中的人物、物件或区域上绘制引线。
- `ai-data-story` 可以把数字和趋势叠加到真实素材上。
- `kinetic-typography` 只显示短结论，不重复整句字幕。

这一步是解决“静态图片只能推进和拉远”的最高价值改造。

## 7. 内容到模板的匹配规则

### 7.1 内容特征提取

从现有 `Line`、`Shot`、`Card`、字级时间和素材信息提取：

- 是否有数字、百分比、金额、倍数或年份。
- 是否存在两个明确的比较对象。
- 是否存在三个到五个步骤或项目。
- 是否存在事件顺序或时间跨度。
- 是否是观点、结论、警告、引用或 CTA。
- 是否有角色、图片、视频、焦点坐标或图表。
- 文本字数、字幕行数、关键词数量和可用安全区。
- 句子情绪、镜头重要度、章节位置和目标画幅。

### 7.2 确定性评分

建议使用固定评分，不让模型直接输出模板名称：

```text
score =
  semanticFit  * 0.40
  + assetFit    * 0.20
  + textFit     * 0.15
  + aspectFit   * 0.10
  + moodFit     * 0.10
  + novelty     * 0.05
  - riskPenalty
```

`riskPenalty` 至少包含：文本超长、字幕密度过高、模板不支持目标画幅、需要缺失素材、与上一镜头重复、模板复杂度过高、许可证状态不明。

### 7.3 内容匹配表

| 分镜信号 | 首选 family | 模板行为 |
|---|---|---|
| 数字、百分比、金额、年份 | `stat` | 数字滚动、刻度线、单位和标签分层出现 |
| 两个对象、两种观点 | `compare` | 两侧进入、中心分隔、避免重复播字幕 |
| 三到五个步骤 | `process` | 节点、路径、顺序和完成状态逐步出现 |
| 历史跨度、先后关系 | `timeline` | 横屏横向推进，竖屏纵向推进 |
| 短结论、金句、警告 | `quote` / `kinetic` | 关键词强调、短文本分组、禁止整句复述 |
| 图片局部重点 | `callout` / `overlay` | 聚焦框、引线、标签，读取 `focus` |
| 章节开头、重大转折 | `hero` | 允许更强入场和章节转场 |
| 普通叙述、情绪铺垫 | `editorial` | 低能量、留白、少量运动 |

### 7.4 全片重复抑制

- 同一 `templateId` 连续最多出现一次。
- 同一 family 连续最多出现两次。
- 十秒内最多两个高强度模板。
- 三十秒内至少保留一个强度为 1 的镜头。
- 章节开始可以使用重型模板，普通句子使用轻量模板。
- 同一篇视频中模板选择应有冷却时间和章节偏好。
- 用户锁定的模板优先保留，但仍必须经过安全区和文本容量校验。

## 8. 时间轴、字幕和渲染一致性

模板必须使用 DO-Vedio 的时间轴，不得重新计算音频和字幕时间。

### 8.1 锚点

`enter`、`emphasis`、`exit` 锚点继续由 `lineId + char` 表示，由 `buildTimeline()` 转换为相对帧。模板只消费相对帧，不直接读取原文时间戳。

### 8.2 字幕安全区

安全区继续由真实字幕 cues 派生。模板 manifest 的 `preferredSafeArea` 只是布局偏好，不能覆盖时间轴派生结果。

最终布局需要满足：

```text
template element bbox ∩ subtitle bbox = empty
template element bbox ∩ AI label bbox = empty
```

横屏和竖屏必须使用独立布局规则。竖屏不是把横屏缩放，而是重新决定文字、节点、引线和图片的排列方向。

### 8.3 转场

继续使用当前“重叠而不缩短”的时间轴语义。不要把 ui2v 模板自身的 scene transition 直接接入音频时间轴，也不要使用会缩短总时长的 `TransitionSeries`。

ui2v 模板只负责镜头内部动画；镜头之间的 `transitionIn` 仍由 `choreography()` 根据章节边界、情绪和全片强度决定。

### 8.4 内容与动画缓存

渲染缓存继续拆分：

- `contentHash`：素材、文字、音频、字幕和布局内容。
- `animationHash`：template、family、参数、转场和 style motion token。
- `timelineHash`：完整时间轴兼容键。

修改模板或转场不应让所有内容资产重新生成。浏览器捕获模板要把模板版本、浏览器版本、视口、帧率和输入参数纳入独立缓存键。

### 8.5 与现有镜头契约的兼容约束

- `safeArea` 必须由真实字幕、AI 标识和画幅布局派生；分镜模型不能声明字幕位置来“满足”安全区检查。
- 镜头之间继续使用重叠区间实现转场；`TransitionSeries` 会缩短总时长，不能接入由字级时间戳驱动的音频和字幕时间轴。
- `stock`、`chart`、`composite` 和 `real` 不能作为未实现类型继续存在。接入前要么保留明确的真实渲染分支并覆盖测试，要么从类型和模型输出中删除；不得让 `default` 分支静默落到占位卡。
- ui2v 只增加视觉模板，不改变 `Shot` 的内容来源、音频、字幕、输出画幅或资源授权语义。

## 9. 分阶段执行计划

### 9.0 阶段门总表

| 阶段 | 进入条件 | 退出条件 | 任一条件失败时 |
|---|---|---|---|
| Phase 0 审计 | 当前 P0 基线可复现 | 六个候选模板有来源、许可证、依赖、画幅和回退记录 | 模板只保留为参考，不进入 registry |
| Phase 1 适配器 | 候选模板许可证已批准 | manifest、registry、版本和 `animationHash` 门禁通过，旧项目行为不变 | 关闭模板 flag，回退原生 family |
| Phase 2 移植 | 适配器可离线加载 | 六个模板的两种画幅、中文、字幕安全区和关键帧 fixture 通过 | 只保留已通过的模板，其余回退 |
| Phase 3 overlay | 至少一个模板已稳定渲染 | 图片、视频、上传素材均可切换 overlay，且不覆盖字幕/标识 | overlay 默认关闭，底层素材照常渲染 |
| Phase 4 匹配 | 模板输出已可序列化 | matcher 决策稳定、可解释，重复和强度预算通过 | 使用原生 family 或用户锁定模板 |
| Phase 5 浏览器模板 | 确有 DOM/WebGL 等不可移植依赖 | 固定浏览器和缓存通过，失败可回退 | 禁用该 browser-capture 模板，不阻塞主链路 |

### Phase 0：模板资产与许可证审计

目标：不改渲染行为，先知道哪些东西能够合法、稳定地进入项目。

任务：

0. 先完成现有动画基线的真实渲染：运行 `npm run animation:probe`，检查 `Texture` 的 `feTurbulence` 和 `mixBlendMode: overlay` 在 Chromium/Remotion 中是否可见、不会盖住文字，并比较横屏/竖屏输出。失败时按 [motion-design-plan.md](./motion-design-plan.md) §4.1 退回 Canvas 噪点或关闭纹理，不把未验证的纹理带入模板移植。
1. 固定 ui2v 仓库 URL 和 commit。
2. 导出公开模板目录，记录模板名称、来源、依赖和许可证。
3. 检查字体、图片、图标、音频和远程资源的授权。
4. 为候选模板建立 manifest。
5. 删除无法确认来源、无法固定时间或无法适配中文的模板。
6. 选出六个首批模板。

交付物：

- `docs/ui2v-template-inventory.md`
- `lib/core/motion-templates.ts`
- `scripts/ui2v-audit.ts`
- 每个候选模板的 source URL、commit、license 和风险等级。

清单至少使用以下字段，避免“看过官网”被误当成可发布依据：

```text
id | sourceUrl | sourceCommit | templateVersion | renderMode | license
licenseStatus | licenseEvidenceUrl | dependencies | assets | supportedAspects
maxTextChars | remoteRequests | deterministic | fallbackTemplateId | risk | reviewer | checkedAt
```

验收：所有首批模板均有来源、许可证、视口、依赖和失败降级说明。

进入下一阶段前运行：

```bash
node --version
npm run typecheck
npm run lint
npx vitest run
```

`npm run animation:probe` 生成的横屏和竖屏视频还必须用 `ffprobe -v error -show_streams -show_format` 检查容器、帧率、时长和视频流；两者失败时先修复或记录基线差异，不把 ui2v 引入作为掩盖现有问题的手段。

### Phase 1：适配器和 manifest

目标：让模板可以在不影响旧模板的情况下被注册、校验和渲染。

任务：

1. 新增 manifest schema 和 registry。
2. 新增 `MotionTemplateProps` 和 `MotionTemplateRenderer`。
3. 让 `templateId` 成为 animation spec 的独立字段。
4. 未注册模板必须明确降级为原生模板或显示诊断状态，不能静默变成普通占位卡。
5. 加入模板版本和 `animationHash`。

验收：旧项目没有 `templateId` 时行为不变；错误模板能显示明确诊断；同一输入在 Player 和最终渲染中一致。

退出条件还包括：模板 registry 可以在没有网络的环境中完成加载；manifest 的 `licenseStatus`、画幅、文字容量和回退目标均由 schema 校验；`animationHash` 变化不会触发生图、配音或素材库阶段。

### Phase 2：移植六个首批模板

建议顺序：

1. 数据卡。
2. 重点标注。
3. 流程图。
4. 对比卡。
5. 时间线。
6. 片头 / 章节高光。

每个模板必须同时完成：

- Remotion 组件。
- 16:9 布局。
- 9:16 布局。
- 中文长文本布局。
- 字幕安全区。
- intensity 1 / 2 / 3。
- 0%、25%、50%、75%、100% 帧检查。
- 无素材时的明确降级。
- 预览和 final 渲染对比。

每个模板都要保留一组固定输入 fixture，至少包含短中文、长中文、数字/单位、标点、无素材和三行字幕。fixture 的输入哈希、输出帧位置和人工判定结果应随模板版本保存，后续升级只能通过新增版本或明确批准的快照更新。

### Phase 3：图片和视频 overlay

目标：让 ui2v 模板覆盖生成图片、视频和上传素材。

任务：

1. 把 `ImageShot` 和 `VideoShot` 放进可选的模板合成层。
2. 支持 `focus`、`shotSize`、`assetFraming` 和素材画幅。
3. overlay 模板不能覆盖字幕和 AI 标识。
4. 图片和视频底层仍由原组件渲染，模板只增加图形和信息层。

验收：同一个图片镜头可以在无 overlay、轻 overlay、高光 overlay 三种状态之间切换；素材本身不需要重新生成。

### Phase 4：匹配器和全片编排

目标：让模板与内容匹配，而不是随机套模板。

任务：

1. 新增 `template-features.ts`。
2. 新增纯函数 `matchTemplate()`。
3. 把 `card.variant`、数字溯源、关键词、mood、importance、chapter 和素材信息纳入评分。
4. 加入连续重复、模板冷却和强度预算。
5. 支持用户锁定模板，并在不满足安全区时给出可解释提示。

验收：固定评测集上的模板选择稳定；相同输入不会因对象顺序或随机数产生不同模板；连续镜头没有明显重复。

匹配器必须输出可解释的决策记录：候选模板、各项得分、被拒绝的门禁、最终模板和回退原因。生产日志只记录摘要，不把模型自由文本或完整素材内容写入日志。

### Phase 5：特殊浏览器模板

只为真正依赖 DOM、Canvas、WebGL 或复杂浏览器 API 的少数模板提供 `browser-capture`。

限制：

- 只用于片头、片尾、章节高光或品牌镜头。
- 必须固定浏览器、视口、帧率和时间源。
- 必须先缓存中间结果。
- 不允许每个普通镜头单独启动浏览器。
- 浏览器捕获失败时降级到同语义的 Remotion 模板。

## 10. 质量门与人工测试

### 10.0 每次变更的固定执行顺序

1. 先运行纯逻辑检查：`npm run typecheck`、`npm run lint`、`npx vitest run`。
2. 再运行动画基线：`npm run animation:probe`、`npm run animation:eval`；确认 16:9 和 9:16 输出文件存在且可被 `ffprobe` 读取。
3. 对新增或修改的模板运行固定 fixture，检查 0%、25%、50%、75%、100% 帧。
4. 最后用制作页执行一次预览、一次样片和一次成片，比较相同时间点的画面、字幕、音频和总时长。

任何一步失败都要把失败命令、输入 fixture、浏览器/Remotion 版本和回退结果写入变更单；不要只在最终视频“看起来还行”时放行。

### 10.1 自动检查

每个模板加入以下检查：

- manifest schema 校验。
- 许可证字段存在且状态为允许使用。
- 模板只读序列化 props。
- 不使用 CSS animation / transition。
- 不使用非确定性随机数或时间墙。
- 16:9 / 9:16 都能渲染。
- 短文本、中文长文本、数字和标点都不溢出。
- 模板元素与字幕 bbox 不相交。
- 模板元素与 AI 标识 bbox 不相交。
- 不重复显示整句字幕。
- 数字模板的数字必须来自旁白或已校验 card。
- 模板渲染耗时不超过基线 1.5 倍。

### 10.2 固定评测集

每次新增模板都跑以下五篇内容：

1. 虚构故事：两名主角、一名配角、跨章节时间跨度。
2. 硬核科普：数字、流程和多行字幕密集。
3. 观点评论：大量抽象句和短结论。
4. 历史人物：时间线和真实人物呈现限制。
5. 第一人称内容：角色、观点和 CTA 混合。

每篇内容至少跑四种视觉风格、两个画幅和 draft/final 两档。

### 10.3 人工抽查步骤

1. 打开制作页，确认分镜卡显示 family 和 template 名称。
2. 播放预览，观察模板是否在字级锚点附近进入或强调。
3. 把字幕改成三行，确认模板自动避让。
4. 切换 16:9 和 9:16，确认布局重新编排而非简单缩放。
5. 修改视觉风格，确认颜色、纹理、缓动和圆角变化，但内容语义不变。
6. 连续播放十个镜头，确认没有连续重复模板和转场。
7. 修改一个动画参数，确认预览刷新，已有成片标记过期。
8. 生成样片，逐帧对比预览和成片。
9. 用 `ffprobe` 检查音频时长，确认转场没有改变旁白和字幕时间。
10. 关闭素材或模拟模板失败，确认降级状态可解释且不会出现空白帧。

高级设置的实际触发路径也必须验收：修改 family、template、强度或转场后，先看到预览刷新和成片“已过期”标记；点击“生成样片”或“生成成片”才提交新的渲染任务。只改变动画参数时不应重新生成图片、视频、配音或字幕资源。

## 11. 风险、取舍与回滚

### 风险一：模板许可证不清楚

处理：只允许有明确 source、commit 和许可证的模板进入 registry；其余保留为设计参考。

### 风险二：浏览器模板渲染慢

处理：默认 Remotion 原生适配；浏览器捕获只用于少量高光模板；增加复杂度和耗时门禁。

### 风险三：中文文本破坏设计

处理：manifest 声明最大字符数和布局策略；中文长文本优先降级到可扩展模板，不强行缩小字号。

### 风险四：模板把字幕遮住

处理：safe area 由时间轴派生，模板只能提出布局偏好；最终用 bbox 相交检测拒绝不合格布局。

### 风险五：视觉过度统一或过度混乱

处理：模板使用风格 token 统一色彩、缓动、纹理和圆角；choreography 控制 family 冷却、章节高光和留白。

### 风险六：升级外部模板造成结果漂移

处理：固定 commit、模板版本和浏览器版本；升级必须通过固定评测集，旧版本保持可回滚。

### 回滚策略

1. `templateId` 缺失时回退到现有原生 family。
2. 单个模板失败时按 family 回退到原生 renderer。
3. 整批 ui2v 模板异常时关闭 feature flag，保留已有时间轴和渲染记录。
4. 不删除旧模板、不覆盖旧素材、不修改旧项目的视觉快照。
5. 浏览器捕获模板独立缓存和独立开关，不能阻塞普通渲染。

## 12. 完成定义

以下条件全部满足，才算完成 ui2v 接入：

- 首批模板完成许可证和来源审计。
- 每个模板都有 manifest、版本和降级策略。
- family 与 template 已分离。
- 六个首批模板支持 Remotion 原生逐帧渲染。
- 至少三个模板可以叠加到图片或视频镜头上。
- 16:9 和 9:16 均通过安全区检查。
- 预览和 final 的关键帧一致。
- 音频、字幕和总时长不因模板或转场变化而改变。
- 固定评测集通过重复率、文本溢出、数字溯源、锚点和渲染性能门禁。
- 模板选择由内容特征和确定性 matcher 驱动，而不是随机或由模型输出 JSX。
- 外部模板失败时能回退到当前原生动画，不出现静默占位或黑帧。

同时满足以下运营条件才允许打开默认 feature flag：

- Phase 0 的模板清单和许可证证据可供复查。
- 固定评测集连续两次通过，且两次使用同一输入哈希得到相同的模板选择和关键帧结果。
- 至少一名执行者按 §10.3 完成横屏和竖屏人工抽查，并保存视频、日志和问题记录。
- 关闭 feature flag 后，旧项目、旧渲染记录和原生模板均可正常打开和重新渲染。

最终形态应当是：ui2v 负责提供更成熟的视觉语言和模板来源，DO-Vedio 负责内容理解、分镜语义、时间轴、字幕、音频、风格一致性、缓存和最终渲染。只有这样，模板数量增加后，画面质量和系统可靠性才会一起提升。
