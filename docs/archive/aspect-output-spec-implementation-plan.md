# 输出规格、预览画幅与生图画幅解耦：可执行落地规划

> 目标：消除 16:9、9:16、预览画幅和 AI 素材原始比例之间的歧义，让每一个视频输出目标都有明确的画布规格、渲染任务和素材策略。
>
> 适用仓库：`/Users/huazi/Desktop/DO-Vedio`
>
> 本文是执行规格。执行时必须先读取根目录 `AGENTS.md`，保留工作树中已有用户改动；不要 reset、checkout 或覆盖无关文件。

## 1. 最终决策

项目中必须分开保存并展示三个概念：

1. **输出规格（Output Spec）**：这期视频要产出哪些版本，例如横屏 16:9 1080p 和竖屏 9:16 1080p。
2. **当前预览目标（Preview Target）**：播放器此刻正在查看哪个输出版本，只影响读取哪一个时间轴和播放器尺寸。
3. **生图素材画幅（Generation Aspect）**：AI 图片或视频请求使用的目标比例。它必须进入 provider 请求、缓存键、素材元数据和项目快照。

最终用户界面使用以下语义：

```text
输出规格：决定会生成哪些视频版本
当前预览：只决定现在查看哪个版本
素材策略：决定多输出画幅是否分别生成素材
```

### 1.1 新项目默认值

- 新项目默认只选择 `16:9 1080p / 30fps`。
- 用户明确选择“横竖双版”后，输出目标变为 `16:9` 和 `9:16` 两个规格。
- 旧项目迁移时保留原来的 `settings.aspects`：如果旧项目是双画幅，迁移后仍然是双画幅；不能静默减少旧项目的输出。
- 所有项目默认帧率为 `30fps`。
- 首版只开放固定预设，不开放任意宽高和任意帧率输入；高级自定义可以留出 schema 扩展位。

### 1.2 双画幅素材策略

当输出规格只有一个画幅时，所有需要生成的图片和视频都使用该画幅。

当输出规格包含两个画幅时，首版采用以下默认策略：

- 高重要度镜头（`importance=3`）、人物镜头、带画面文字的镜头、存在明确主体边缘风险的镜头：按画幅分别生成。
- 普通背景或低重要度镜头：允许共享一张主素材，在另一个输出画幅中使用 `object-fit: cover` 裁切。
- 用户可以在制作设置中切换为“全部分别生成”或“全部共享素材”。
- “全部分别生成”必须在开工确认中显示预计任务数和费用增加。
- 任何自动共享素材的决定都必须记录在素材元数据中，不能让用户误以为两个画幅使用了不同的生图结果。

推荐的默认策略名称为：`智能双版`。

## 2. 当前实现事实与问题边界

执行前必须以当前代码为准确认以下事实：

- `lib/core/types.ts` 中已有 `aspects = ["16:9", "9:16"]` 和 `aspectSize`。
- `settingsSchema.aspects` 当前默认值是两个画幅。
- `components/video-studio.tsx` 另有本地 `aspect` 状态，用于切换当前预览。
- `app/api/projects/[id]/timeline/route.ts` 根据 query 的 `aspect` 返回一个画幅的时间轴。
- `lib/core/timeline.ts` 根据 `aspectSize` 派生 `width`、`height`，帧率来自 `FPS = 30`。
- `lib/pipeline/plan.ts` 会为 `goal.aspects` 中的每一个画幅分别计划 render job。
- `remotion/shots/image.tsx` 和 `remotion/shots/video.tsx` 使用 `object-fit: cover`，因此同一素材在不同画幅中会被重新裁切。
- `lib/core/prompt-compiler.ts` 当前只编译主体、角色、镜头和风格，不编译画幅约束。
- `lib/pipeline/media-gen.ts` 的 `MediaRequest` 当前没有 `aspectRatio`、`width`、`height` 或 `fps`。
- `lib/providers/media/replicate.ts` 的请求没有比例参数。
- `lib/providers/media/openai-image.ts` 的 `/images/generations` 和 `/images/edits` 请求没有 `size` 参数。
- `lib/core/keys.ts` 的 `shotGenerationKey` 当前没有画幅字段。

因此当前链路实际上是：

```text
模型使用自身默认比例生成图片
  -> 项目保存一个 assetId
  -> 16:9 / 9:16 时间轴都复用该素材
  -> Remotion 在各自画布中 cover 裁切
```

这会造成三个可见问题：

1. 生图模型返回的素材比例不受项目规格控制。
2. 预览切换容易被误解为重新生成了对应比例的素材。
3. 双画幅输出使用同一张图，人物、文字和主体边缘可能被裁掉。

## 3. 目标数据模型

### 3.1 输出规格类型

在 `lib/core/types.ts` 中新增固定输出规格：

```ts
export const outputSpecIds = ["landscape-1080p", "portrait-1080p"] as const;
export type OutputSpecId = (typeof outputSpecIds)[number];

export const outputSpecSchema = z.object({
  id: z.enum(outputSpecIds),
  aspect: z.enum(aspects),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.literal(30),
  label: z.string(),
}).strict();

export const outputSpecs: Record<OutputSpecId, OutputSpec> = {
  "landscape-1080p": { id: "landscape-1080p", aspect: "16:9", width: 1920, height: 1080, fps: 30, label: "横屏 1080p" },
  "portrait-1080p": { id: "portrait-1080p", aspect: "9:16", width: 1080, height: 1920, fps: 30, label: "竖屏 1080p" },
};
```

不要把 `label` 作为决定缓存和渲染的依据；缓存键只使用 `id/aspect/width/height/fps`。

### 3.2 兼容型项目设置

首版建议扩展当前 `settingsSchema`，保持旧字段可读：

```ts
export const assetFramingModes = ["smart-dual", "per-output", "shared"] as const;
export type AssetFramingMode = (typeof assetFramingModes)[number];

export const settingsSchema = z.object({
  // 兼容旧项目；新代码读取 outputSpecIds 优先。
  aspects: z.array(z.enum(aspects)).min(1).default(["16:9"]),
  outputSpecIds: z.array(z.enum(outputSpecIds)).min(1).default(["landscape-1080p"]),
  previewAspect: z.enum(aspects).default("16:9"),
  assetFraming: z.enum(assetFramingModes).default("smart-dual"),
  ...
});
```

实际落地时可以只保存规范化后的 `outputSpecIds`，但迁移和旧 API 必须继续接受 `aspects`。

推荐读取函数：

```ts
export function outputSpecsFor(settings: Settings): OutputSpec[];
export function normalizeSettings(settings: unknown): Settings;
export function previewSpecFor(settings: Settings): OutputSpec;
```

规则：

1. `outputSpecIds` 存在时，以它为准。
2. 只有旧 `aspects` 时，`16:9` 映射为 `landscape-1080p`，`9:16` 映射为 `portrait-1080p`。
3. `previewAspect` 不在输出规格中时，自动选择第一个输出规格，并写回规范化结果。
4. `outputSpecIds` 和 `aspects` 不一致时，保留 `outputSpecIds`，不要在渲染时临时猜测。

### 3.3 镜头素材变体

不要立即删除现有 `shot.assetId`，因为旧项目和已有素材必须继续可读。新增兼容字段：

```ts
export const shotAssetVariantSchema = z.object({
  assetId: z.string(),
  promptHash: z.string(),
  aspect: z.enum(aspects),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  source: z.enum(["generated", "shared", "legacy"]).default("generated"),
  sourceAspect: z.enum(aspects).optional(),
  generatedAt: z.string().optional(),
}).strict();
```

在 `shotSchema` 中新增：

```ts
assetVariants: z.partialRecord(z.enum(aspects), shotAssetVariantSchema).default({}),
```

兼容规则：

- 旧项目只有 `assetId` 时，把它视为 `source: "legacy"` 的共享素材。
- 当前输出画幅有对应 `assetVariants[aspect]` 时，优先使用该变体。
- 没有对应变体时回退到 `assetId`，并在时间轴 issues 中记录“当前画幅使用共享素材”。
- 用户切换画幅不会自动覆盖旧的 `assetId`。

## 4. 生图请求必须携带画幅

### 4.1 公共请求类型

修改 `lib/pipeline/media-gen.ts`：

```ts
export type GenerationFrame = {
  aspect: Aspect;
  width: number;
  height: number;
  fps?: number;
};

export type MediaRequest = {
  kind: "image" | "video";
  modelId: string;
  prompt: string;
  frame: GenerationFrame;
  references?: string[];
  seed?: number;
  firstFrame?: string;
  lastFrame?: string;
  controlImage?: string;
  meta: Record<string, unknown>;
};
```

图片请求可以忽略 `fps`，视频请求必须使用它；公共结构保持一致，避免两个 pipeline 再次分叉。

### 4.2 Provider adapter 映射

修改 `lib/providers/media/replicate.ts`：

- `ReplicateRequest` 增加 `aspectRatio?: "16:9" | "9:16"`、`width?`、`height?`。
- 具体模型支持 `aspect_ratio` 时传入 `16:9` 或 `9:16`。
- 具体模型只支持 `width/height` 时传入对应尺寸。
- 模型不支持比例参数时返回 capability 状态或明确的 `unsupported_aspect`，不能静默丢弃。

修改 `lib/providers/media/openai-image.ts`：

- `/images/generations` 和 `/images/edits` 请求增加 `size`。
- 16:9 使用服务商允许的横屏尺寸，9:16 使用服务商允许的竖屏尺寸。
- 如果服务商不支持 1920×1080，adapter 应根据 provider profile 选择等比例支持尺寸，再在本地记录真实输出宽高。
- 不能把 `size` 写在 prompt 里代替 API 参数；prompt 中的“横屏”只能作为辅助约束。

扩展 provider profile capability：

```ts
"aspect-ratio"
"custom-size"
```

具体模型没有 `aspect-ratio` capability 时，UI 要显示“该模型会生成后裁切”，并将这个决策写入 generation run。

### 4.3 Prompt 中的画幅提示

画幅 API 参数是权威约束，prompt 只补充构图安全区，不写过度具体的尺寸词：

```ts
function frameHint(frame: GenerationFrame) {
  return frame.aspect === "9:16"
    ? "竖屏构图，主体保持在中央安全区，顶部和底部预留字幕与平台界面空间"
    : "横屏构图，主体和关键动作保持在中央安全区，左右保留环境叙事空间";
}
```

不要把 `1920x1080` 直接拼进所有模型 prompt。尺寸由 adapter 负责，避免不同模型把尺寸文本误解成画面内容。

## 5. 生成键、任务和素材写回

### 5.1 生成键

修改 `lib/core/keys.ts`：

```ts
export function shotGenerationKey(
  doc: ProjectDoc,
  shot: Shot,
  kind: "image" | "video",
  modelId: string,
  frame: GenerationFrame,
) {
  return `shot:${quickHash({
    v: STAGE_VERSION.shotGeneration + 1,
    kind,
    modelId,
    frame: { aspect: frame.aspect, width: frame.width, height: frame.height, fps: frame.fps },
    ...
  })}`;
}
```

同一镜头的 `16:9` 和 `9:16` 必须生成不同的 key。分辨率或帧率改变时也必须失效对应缓存。

兼容调用策略：

- 新调用必须传 `frame`。
- 测试 fixture 和旧内部调用在迁移阶段可以使用 `defaultFrameForProject(doc)`，不能在生产路径使用固定 `16:9` 偷渡。

### 5.2 任务输入

修改以下任务输入：

- `ShotGenerateInput` 增加 `frame: GenerationFrame`。
- `app/api/projects/[id]/shots/generate/route.ts` 和单镜头 generate route 接受可选 `aspect` / `outputSpecId`，没有传入时从项目当前预览目标或唯一输出目标解析。
- 全量生成必须按 `assetFraming` 展开任务：
  - `shared`：每个镜头一个任务。
  - `per-output`：每个镜头 × 每个输出画幅一个任务。
  - `smart-dual`：根据镜头重要度、人物、文字和输出目标决定展开数量。

每个任务的 `input` 和 generation run `params` 必须包含：

```ts
{
  aspect: "16:9" | "9:16",
  width: number,
  height: number,
  fps: number,
  assetFraming: "smart-dual" | "per-output" | "shared",
  sourceAspect?: "16:9" | "9:16",
}
```

### 5.3 素材写回

生成成功后：

- `per-output` 写入 `shot.assetVariants[frame.aspect]`。
- `shared` 写入主 `assetId`，并为每个使用该素材的目标写入 `source: "shared"` 变体。
- `smart-dual` 按实际任务写入对应变体；没有生成的画幅由 timeline 回退共享素材。
- `assetPromptHash` 保留作为旧字段；新变体使用自己的 `promptHash`。

不要只更新 `assetId` 而丢掉旧的变体。用户切换输出规格后应能复用已有变体，不重复付费。

## 6. 时间轴、预览和渲染

### 6.1 Timeline API

修改 `app/api/projects/[id]/timeline/route.ts`：

- 接受 `outputSpecId`，兼容旧 `aspect` query。
- `outputSpecId` 解析为 `OutputSpec`，传给 `timelineFor` / `buildTimeline`。
- 返回的 Timeline 增加：

```ts
outputSpecId: OutputSpecId;
aspect: Aspect;
width: number;
height: number;
fps: number;
```

### 6.2 Timeline 素材选择

修改 `lib/core/timeline.ts`：

```ts
function assetForAspect(shot: Shot, aspect: Aspect) {
  return shot.assetVariants[aspect]?.assetId ?? shot.assetId;
}
```

如果使用了共享或旧素材：

- 在 `Timeline.issues` 增加 info 级消息，而不是阻断播放。
- 消息只能在调试或镜头详情中显示，避免每个镜头都造成视觉噪音。
- 对人物、文字、主体边缘风险较高的镜头可以升级为 warn，并提示“建议生成该画幅专用素材”。

### 6.3 预览状态

修改 `components/video-studio.tsx`：

- 删除“预览画幅默认自由切换但不关联输出”的歧义。
- `previewAspect` 从项目设置初始化。
- 预览切换只在 `outputSpecIds` 中切换；如果当前项目只有一个输出规格，不显示无意义的切换按钮。
- 顶部同时显示：

```text
输出：横屏 16:9 · 竖屏 9:16
预览：16:9
素材：智能双版
```

- 切换预览只请求或读取另一画幅的 timeline，不创建 job，不调用 LLM，不调用生图。
- 预览加载状态必须按画幅缓存；切回已看过的画幅不重复请求。

### 6.4 渲染任务

修改 `lib/pipeline/plan.ts`：

- render job 仍然按输出规格一规格一任务。
- render key 增加 `outputSpecId`、`width`、`height`、`fps`。
- 同一 timeline 内容在不同画幅必须得到不同 render key。
- 输出设置变化时只让受影响的画幅过期；例如只改竖屏规格，不应让横屏成片过期。

渲染输入必须直接使用 `OutputSpec`，不要在 worker 内再次通过字符串判断宽高。

## 7. 顶部制作设置 UI

### 7.1 开工确认区

在 `components/video-studio.tsx` 当前“开工确认”中，将现在的两个 chip 改为输出规格选择：

```text
输出规格
[✓ 横屏 1080p] [ 竖屏 1080p]

素材策略
[智能双版 ▼]

预计输出：1 个视频
预计生图：12 张（其中 4 张按画幅分别生成）
```

选择“竖屏”后立即更新本地 state，不等待 API；保存仍复用现有项目节流保存机制。

### 7.2 设置面板

在项目设置中展示：

- 输出规格：横屏、竖屏、多选。
- 帧率：首版显示 `30fps`，只读或放入高级设置。
- 分辨率：由规格预设决定，首版显示 `1920×1080` 或 `1080×1920`。
- 素材策略：智能双版、全部分别生成、全部共享素材。
- 当前预览：横屏或竖屏。

不要把“风格缩略图的 9:16 显示比例”解释成生图画幅；风格选择器缩略图只是展示资源比例，不能改变项目输出设置。

### 7.3 费用确认

双画幅且选择分别生成时，确认文案必须明确：

```text
将为 4 个镜头分别生成横屏和竖屏素材。
预计新增生图任务：4 个。
横屏和竖屏会分别保存，后续切换预览不会重复生成。
```

只切换预览、只切换 output spec 的浏览状态或读取已有素材，不应产生费用。

## 8. 迁移策略

### 8.1 旧项目

迁移函数建议放在 `lib/core/types.ts` 附近或新建 `lib/core/output-spec.ts`：

```ts
export function migrateProjectOutputSettings(doc: ProjectDocInput): ProjectDoc;
```

规则：

1. 旧 `settings.aspects` 为 `['16:9']`：生成 `['landscape-1080p']`。
2. 旧 `settings.aspects` 为 `['9:16']`：生成 `['portrait-1080p']`。
3. 旧 `settings.aspects` 同时包含两者：生成两个 output spec，保持行为不变。
4. 没有 `previewAspect`：使用旧页面默认 `16:9`，但如果输出只有竖屏则使用竖屏。
5. 没有 `assetVariants`：保留 `assetId`，按共享 legacy 素材读取。
6. 不主动重新生成任何旧素材。
7. 不修改旧项目已经保存的 render 记录；读取时根据旧 `aspect` 兼容显示。

### 8.2 新项目

修改 `emptyDoc()` 和 `settingsSchema.default`：

- 新项目 `outputSpecIds = ['landscape-1080p']`。
- 新项目 `aspects` 如果仍保留，规范化为 `['16:9']`。
- `previewAspect = '16:9'`。
- `assetFraming = 'smart-dual'`。

必须在测试中区分新项目默认值和旧项目迁移值，避免 schema 默认值覆盖旧数据。

## 9. API 契约

### 9.1 生成接口

单镜头和批量生成接口允许：

```json
{
  "modelId": "...",
  "kind": "image",
  "outputSpecId": "portrait-1080p",
  "assetFraming": "per-output"
}
```

服务端必须重新从项目文档解析 `OutputSpec`，不能信任客户端提交的 width、height 和 fps。客户端只提交 `outputSpecId`。

### 9.2 Timeline 接口

支持：

```text
GET /api/projects/:id/timeline?outputSpecId=portrait-1080p
```

旧 query 仍支持：

```text
GET /api/projects/:id/timeline?aspect=9:16
```

如果两者同时存在，以 `outputSpecId` 为准。

## 10. 测试计划

### 10.1 Schema 与迁移

新增 `tests/output-spec.test.ts`，覆盖：

- 预设规格解析正确。
- 新项目默认只有横屏规格。
- 旧单横屏项目迁移后仍只有横屏。
- 旧单竖屏项目迁移后仍只有竖屏。
- 旧双画幅项目迁移后仍是双画幅。
- 缺少 `previewAspect` 时能推导合法预览目标。
- 不合法的 output spec id、空输出列表和不支持 fps 被拒绝。
- 旧 shot 只有 `assetId` 时能解析。
- 新 shot 的 `assetVariants` 能解析。

### 10.2 生图请求

扩展 `lib/providers/media/replicate.test.ts` 和新增 OpenAI image adapter 测试：

- 16:9 request 传递横屏比例或尺寸。
- 9:16 request 传递竖屏比例或尺寸。
- 不支持比例参数的模型返回明确 capability / fallback 结果。
- 参考图路径不会丢失 frame 参数。

### 10.3 生成键和缓存

扩展 `lib/core/keys.test.ts`：

- 同一镜头、同一模型、不同 aspect 得到不同 key。
- 同一 aspect、不同 width/height 得到不同 key。
- 同一镜头只改变 previewAspect 不改变 shot generation key。
- style、prompt、参考图改变仍然让对应画幅过期。

### 10.4 Timeline 与素材选择

扩展 `lib/core/timeline.test.ts`：

- 横屏 timeline 使用 `assetVariants['16:9']`。
- 竖屏 timeline 使用 `assetVariants['9:16']`。
- 没有变体时回退 legacy `assetId`。
- 回退时产生 info/warn issue，不阻断 timeline。
- width、height、fps 与 output spec 一致。

### 10.5 Pipeline

扩展 `tests/pipeline-model.test.ts` 或新增 `tests/aspect-pipeline.test.ts`：

- 单画幅只提交一套生图任务和一个 render job。
- `per-output` 双画幅提交两套素材任务和两个 render job。
- `shared` 双画幅只提交一套素材任务和两个 render job。
- `smart-dual` 只为高风险镜头展开双任务。
- 重新运行 pipeline 不重复提交已经存在的画幅变体。
- 修改竖屏输出设置不会让横屏 render 过期。

### 10.6 UI 行为

使用现有测试方式或 Playwright 验收：

- 开工确认显示输出规格而不是模糊的“画幅切换”。
- 选择输出规格是即时本地状态更新。
- 切换预览不新增 job、不调用生图 API。
- 只有一个输出规格时不显示第二个预览切换选项。
- 双画幅分别生成时显示额外任务和费用。
- 旧项目打开后仍显示其原来的横竖输出目标。

## 11. 执行顺序

必须按以下顺序实施，完成一阶段并通过检查后再进入下一阶段：

### 阶段 A：基线和纯函数

- 阅读 `AGENTS.md`、当前 changelog、相关文档和 `git status`。
- 新增 `lib/core/output-spec.ts`。
- 新增 output spec、迁移函数、素材策略类型。
- 不改 provider、不改 UI。
- 运行：

```bash
npm run typecheck
npm test -- --run tests/output-spec.test.ts
```

### 阶段 B：ProjectDoc schema 迁移

- 修改 `settingsSchema`、`shotSchema`。
- 接入 `normalizeSettings` 或项目读取时迁移。
- 保留旧 `aspects` 和旧 `assetId` 兼容。
- 更新 `emptyDoc()` 新默认值。
- 运行 schema、旧项目和全量 typecheck 测试。

### 阶段 C：生成请求与 provider

- 给 `MediaRequest` 增加 frame。
- 修改 Replicate 和 OpenAI-compatible adapter。
- 增加 provider capability 和 fallback 结果。
- 在 generation run 参数中记录真实 frame。
- 运行 provider tests、typecheck、lint。

### 阶段 D：缓存键、任务展开和素材变体

- 修改 `shotGenerationKey`。
- 修改 shot generate routes、`shot-generate.ts`、`media-gen.ts`。
- 实现 shared/per-output/smart-dual 展开。
- 实现 `assetVariants` 写回和 legacy fallback。
- 运行 generation key、pipeline、asset tests。

### 阶段 E：Timeline、预览和渲染

- 修改 timeline API 和 `timelineFor`。
- 使用画幅变体选择素材。
- 修改 render key 和 render job input。
- 预览按 output spec 缓存。
- 运行 timeline、render、pipeline tests。

### 阶段 F：顶部设置 UI

- 修改 `components/video-studio.tsx` 开工确认。
- 修改项目设置面板。
- 分开显示输出规格、当前预览和素材策略。
- 加入双版费用与任务数确认。
- 运行 lint、typecheck、UI smoke。

### 阶段 G：最终验收

依次运行：

```bash
npm run aix:check
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

启动 Next 后检查：

- 新项目默认只有横屏输出。
- 旧双画幅项目仍有横屏和竖屏输出。
- 只选横屏时，生图请求和素材尺寸为横屏。
- 只选竖屏时，生图请求和素材尺寸为竖屏。
- 双版分别生成时，两种素材都存在且互不复用。
- 双版共享素材时，UI 明确显示共享状态。
- 预览切换只改变播放器画布，不新增生成任务。
- 横屏和竖屏的成片尺寸、帧率正确。
- 风格选择器的 9:16 缩略图不改变项目生图比例。

## 12. 性能与费用门槛

- 选择输出规格必须是本地即时状态更新，不等待 worker 或 LLM。
- 切换预览不得创建 job。
- 已有画幅变体必须复用，不因切换预览重复生图。
- 双版智能策略必须在开工前显示预计任务数。
- 目录、timeline 和素材变体读取应有本地缓存。
- 首屏预览只加载当前画幅，第二画幅按用户切换懒加载。
- 画幅参数必须加入任务 key，避免错误复用比重复生成更严重的问题。

建议验收指标：

| 指标 | 门槛 |
|---|---:|
| 输出规格点击到界面更新 | <100ms |
| 预览画幅切换到播放器尺寸更新 | <100ms（已有 timeline） |
| 预览切换新增 job | 0 |
| 单画幅生图重复提交 | 0 |
| 双画幅分别生成的 key 冲突 | 0 |
| 旧项目打开失败 | 0 |

## 13. 主要风险与处理

### 风险 1：模型不支持目标比例

处理方式：provider capability 显式标记；在开工确认显示“生成后裁切”；记录实际尺寸和 fallback 原因；不要假装模型按目标比例生成。

### 风险 2：双版费用翻倍

处理方式：默认智能双版；在用户确认前显示任务数和费用；支持全部共享素材和全部分别生成。

### 风险 3：角色在两种画幅中不一致

处理方式：分别生成时继续传递角色定妆参考、场景参考和相同 seed；generation run 记录 `sourceShotId`、`aspect` 和参考素材；不能把横屏结果当竖屏角色参考的唯一来源。

### 风险 4：旧项目已有图片比例不匹配

处理方式：旧素材标记为 legacy/shared；继续可播放；只在镜头详情中提示建议生成画幅专用素材，不自动产生费用。

### 风险 5：用户把预览切换误解为重新生成

处理方式：UI 文案固定使用“输出规格”和“当前预览”；切换预览时不显示生成中的状态，不写 generation run。

## 14. 完成定义

只有同时满足以下条件，才能声称该功能完成：

1. 项目设置、预览、生成请求和渲染任务使用同一套 `OutputSpec`。
2. 生图 provider 请求真正携带目标画幅或明确返回不支持原因。
3. `16:9` 与 `9:16` 的生成 key、素材变体和 render key 完全隔离。
4. 旧项目和旧素材可读，不自动重新生成、不丢失旧结果。
5. 双画幅任务数和费用在用户确认前可见。
6. 预览切换不创建任务、不调用 LLM、不调用生图模型。
7. 新项目不再默认隐式生成双画幅；双画幅是用户明确选择的输出规格。
8. schema、provider、key、timeline、pipeline、UI 和迁移测试全部通过。
