# Aix 风格库接入分析与实施方案

> 目标：把桌面项目 `aix-style-library-project` 中的 Aix 风格库接入 DO·Vedio，让用户可以在项目中高效选择任意 active 风格，并把选择稳定地传递到分镜、生图、角色定妆和代码画面。
>
> 本文是接入设计，不包含本轮运行时代码改动。数据事实以 Aix 项目当前文件为准。

## 结论先行

推荐把 Aix 当作一个**版本化、只读的外部风格目录**接入，而不是把 160 条记录直接改写成当前的 10 张 `VisualStyle` 内置卡：

1. 在构建阶段从 Aix Skill 导入 active 风格、缩略图和版本摘要，生成项目自己的静态索引。
2. 在运行时用一个 TypeScript adapter 将 Aix 的结构化特征编译为当前提示词编译器所需的风格槽位，同时保留完整的 Aix 元数据。
3. 项目仍保存风格快照，而不是只保存 ID。快照中带 `aixId`、库版本、风格版本和内容摘要，后续库升级不会悄悄改变旧项目。
4. 风格选择器采用本地索引、即时搜索、缩略图懒加载和抽屉式详情；浏览与选择不调用 LLM、不生成样张、不产生费用。
5. Aix 的 6 张真实示例图只用于选择时的视觉证据，不默认作为生图参考图传给模型。这样能避免把示例中的主体、构图和场景误带进用户自己的镜头。

不建议 iframe 嵌入 Aix Web，也不建议让生产服务在运行时读取桌面绝对路径。前者无法自然接入项目快照和提示词链路，后者无法在构建、部署和其他机器上复现。

## 已有能力与缺口

### DO·Vedio 当前已经具备的链路

- `lib/visual-styles/builtin.ts` 有 10 张内置画面风格，并按解说模板排序推荐。
- `lib/visual-styles/store.ts` 管理内置 + 自定义风格；自定义风格写入 `data/visual-styles.json`。
- `GET/POST /api/visual-styles`、`PUT/DELETE /api/visual-styles/[id]` 已存在。
- `ProjectDoc.visualStyle` 保存完整风格快照；切换风格会通过 `assetPromptHash` 让旧图变为过期，旧素材仍保留。
- `lib/core/prompt-compiler.ts` 已把内容、角色、镜头、风格、情绪和负面词分槽编译。
- `lib/core/theme.ts` 从风格的 `palette` 派生 Remotion 信息卡主题。
- `style-preview` 已有固定的 3 个测试场景和按提示词 + 模型缓存的付费样张生成流程。
- `/styles` 和项目内「画面风格」面板都支持即时预览、项目内微调、恢复风格库版本和另存为新风格。

### Aix 当前数据事实

根据 `aix-style-library-project/skill/aix-style-library/library.json`、`catalog/index.json` 和实际目录：

| 项目 | 当前值 |
|---|---:|
| library version | `0.6.0` |
| active 风格 | 160 |
| illustration | 62 |
| graphic | 54 |
| painting | 30 |
| 3d | 10 |
| photographic | 4 |
| 每个风格缩略图 | 1 张 `thumbnail.webp` |
| Web 示例图 | 6 张，人物 2、物体 2、场景 2 |
| Skill 资源体积 | 约 8.3 MB |
| Web dist 资源体积 | 约 55 MB，其中示例图约 46 MB、缩略图约 8.4 MB |

Aix 的权威运行数据在 `skill/aix-style-library/styles/<ID>/style.json`；Web 的 `dist/data` 和 `dist/assets` 是由 Skill 与评测证据构建出的展示数据，不应该手工维护。当前根目录 README 仍保留 0.5.0/110 条的历史说明，接入时必须以 `library.json`、`catalog/index.json` 和实际资源校验结果为准。

### 两套模型的根本差异

当前 `VisualStyle` 是面向生成流水线的扁平模型，额外承担 Remotion 配色和情绪调制；Aix `style.json` 是面向风格检索、组合和发布校验的规范模型：

| Aix 字段 | 当前字段 | 结论 |
|---|---|---|
| `id`, `version`, `status` | `id` | 必须新增来源元数据，不能丢版本和状态 |
| `name`, `description` | 同名 | 可直接复用 |
| `category` | `medium` | 需要确定性映射，不能只按字符串拼接 |
| `features[]`（`axis/tier/text`） | `rendering`、`texture`、`colorGrade`、`lighting`、`composition` | 通过 adapter 按 tier 编译，不能把所有文本塞进一个 description |
| `avoid[]` | `negative[]` | 可映射，但要保留 `Nxx` ID 以支持冲突说明 |
| `suitable_for`, `weak_for`, `known_failures` | 无 | 保留给选择器、警告和质检，不自动当成提示词 |
| `provenance`, `quality` | 无 | 保留在目录和快照，便于授权及质量追溯 |
| `thumbnail`、6 张示例图 | 当前只支持生成资产 | 加入只读静态资源，不作为默认生图参考图 |
| Aix prepare 的 `balanced` | 当前 `normal` | `light → light`、`balanced → normal`、`strong → strong`；这是组合请求强度，不是 `style.json` 的独立字段 |

最容易出错的字段是 `palette`：Aix 的核心规范没有当前项目所需的十六进制 Remotion 配色组。不能从例图场景臆造一套“风格颜色”并当成事实。首版应使用明确标记的适配主题（按 category 的通用调色，或构建时人工维护的 override），并允许用户在项目中微调；它只影响信息卡，不改变 Aix 风格提示词。

## 推荐架构

### 1. 数据边界

建议新增一个只读 source 层和一个运行时目录层：

```text
vendor/aix-style-library/
├── library.json
├── catalog/index.json
└── styles/Aix0001/
    ├── style.json
    └── thumbnail.webp

lib/aix/
├── schema.ts              # Aix 输入结构与版本校验
├── catalog.ts             # 读取构建产物、索引和查询
├── adapter.ts             # Aix -> VisualStyle / CompiledStyle
└── themes.json            # Remotion 适配主题（明确标记为 derived）

public/aix/
├── catalog.json           # 紧凑列表数据
├── thumbnails/Aix0001.webp
└── examples/Aix0001/01.webp ... 06.webp   # 可选，按需复制
```

`vendor` 是项目可复现的输入快照，只放运行所需的 Skill 数据、许可证和缩略图，不把 Skill 的脚本、评测原图、`evaluation/sources` 或 2.4 GB 的评测目录带进生产包。绝对路径 `/Users/huazi/Desktop/...` 只出现在一次性的导入命令中，不出现在运行时代码。

新增构建命令建议为：

```bash
npm run aix:sync -- --source /Users/huazi/Desktop/aix-style-library-project/skill/aix-style-library
npm run aix:check
```

`aix:sync` 应完成：读取 `library.json`、校验 `catalog/index.json`、只接收 `status=active`、复制规范 JSON 和缩略图、写入 `sourceDigest`，并生成 `public/aix/catalog.json`。版本、数量、缺图和路径越界任何一项失败都应让命令退出非零。

示例图不必进入第一阶段的默认构建。如果要展示详情页的 6 张证据图，构建脚本从 Web dist 的已压缩资源或最高版本评测批次复制 WebP，并把 `sourceVersion` 写入 manifest；不能把评测内部路径暴露给浏览器。

### 2. 类型设计

不要把 Aix 特有字段压扁后丢掉。建议在当前 `VisualStyle` 上增加可选来源元数据，保持旧项目和自定义风格兼容：

```ts
type VisualStyleSource =
  | { kind: "native"; legacy?: boolean }
  | {
      kind: "aix";
      aixId: string;             // 规范 ID，例如 Aix0001
      libraryVersion: string;    // 例如 0.6.0
      styleVersion: string;      // 例如 1.1.0
      contentHash: string;
      category: AixCategory;
      features: AixFeature[];
      avoid: AixAvoid[];
      suitableFor: string[];
      weakFor: string[];
      knownFailures: string[];
      provenance: AixProvenance;
      quality: AixQuality;
    };

type VisualStyle = ExistingVisualStyle & {
  source?: VisualStyleSource;          // 默认 { kind: "native" }
  themeSource?: "native" | "aix-derived" | "user";
};
```

项目保存的仍是 `doc.visualStyle` 快照。选择 Aix 风格时，快照同时保存：

- 规范 `aixId` 和显示名称；
- 选中时的库版本、风格版本和 `contentHash`；
- 完整 `features` / `avoid` / 适用与失败信息；
- adapter 生成的运行时字段；
- 当前项目的用户微调和 `themeSource`。

这样库升级、风格下架或名称修改都不会改变已经生成的项目。下次打开项目时可以比较 `aixId + contentHash`，明确显示“风格库有新版本”，由用户决定更新并重新标记图片过期。

### 3. Aix 到提示词的 adapter

adapter 应是纯函数，输入一个已校验的 Aix 记录和强度，输出当前编译器可理解的槽位及来源信息。建议规则：

| Aix axis | 运行时槽位 |
|---|---|
| `medium` | 通过 category + feature text 推导 `medium`，只使用受支持枚举 |
| `line` | 合并进 `rendering`，未来可单独增加 line 槽位 |
| `palette` | `colorGrade`；不生成十六进制颜色 |
| `lighting` | `lighting` |
| `texture` | `texture` |
| `composition` | `composition` |

强度选择必须遵循 Aix Skill 的 tier 规则：

- `light`：只取 `core`；
- `normal`：取 `core + support`；
- `strong`：取 `core + support + accent`。

`avoid` 进入负面槽，但仍保留其 `Nxx` 标识。`suitable_for`、`weak_for`、`known_failures` 只用于选择器提示、镜头级警告和质检，不要自动放进每一条生图 prompt，否则会把“适合人物”误当成画面内容。

当前 `compilePrompt` 的内容优先级仍然有效：用户明确主体、动作、文字、比例和构图在前，Aix 风格只决定“怎么画”。后续需要实现 Aix `prepare` 的冲突排除时，应增加结构化的 `excludedFeatureIds` 和 warnings，而不是依赖模糊字符串替换；至少返回 `STYLE_ADJUSTED` / `NEGATIVE_ADJUSTED` / `WEAK_FIT`。

Aix 的 6 张示例图不要默认放入 `referenceImages`：示例图的主体和构图不是用户意图，且不同模型对参考图权重不同。只有未来用户明确启用“用示例图保持风格”时，才按 provider capability 选择一张或多张，并把参考图列表加入生成缓存键。

### 4. 与现有项目链路的接点

| 链路 | 接入方式 | 影响范围 |
|---|---|---|
| 风格库 API | 保留现有 native/custom API；增加 Aix catalog 查询或 `source=aix` 分支 | 不破坏旧客户端 |
| 项目选择 | 选择结果直接写 `doc.visualStyle` 快照，沿用现有节流保存与乐观锁 | 不需要新数据库表 |
| 分镜 | 不改变分镜输出；仍只写“画什么” | 无需重跑分镜 |
| 生图 | `compileShotPrompt` 识别 `source.kind=aix` 并使用 adapter | 所有受影响镜头的 prompt hash 改变 |
| 角色定妆 | 与镜头共用同一个 style adapter；保留 `sheet=true` 的镜头覆盖规则 | 未锁定定妆过期，锁定项不自动覆盖 |
| 代码画面 | `themeOf` 读取 `themeSource` 和适配主题 | 信息卡视觉统一但不伪称为 Aix 原色 |
| 样张 | Aix 静态 thumbnail / examples 零费用；当前 3 场景生成样张继续作为“按模型预览” | 浏览风格不触发任务 |
| 过期与候选 | 沿用 `assetPromptHash`、候选组和旧素材保留 | 换风格只影响生图，不影响分镜与配音 |

不建议把 Aix 风格直接塞进 `builtinVisualStyles` 数组。那会让静态 bundle 变大、混淆来源、失去 `status/version/contentHash` 语义，也会让当前 `recommendVisualStyles` 误把没有 `suits` 的 Aix 风格当成普通 native 风格。

## 高效选风格的交互方案

选择器是这条主线的关键。目标不是让用户“逛一个 160 张卡片的网页”，而是让用户在几秒内找到并确认一个风格。

### 项目内入口

在现有「画面风格」面板中保留当前风格摘要，但把「换风格」改为全高抽屉：

1. 打开即聚焦搜索框，显示最近使用、当前解说风格推荐和全部风格数量。
2. 搜索支持 `0001`、`1`、`Aix0001`、名称、别名、标签、描述关键词；输入编号时精确命中置顶。
3. 左侧或顶部筛选：全部、插画、绘画、摄影、3D、平面；再加最近使用和收藏。
4. 卡片只加载 2:3 缩略图、ID、名称和最多两个标签；描述固定两行，卡片高度稳定。
5. 键盘支持 `⌘/Ctrl+K` 聚焦、上下左右移动、`Enter` 预览、`Esc` 返回；移动端搜索框固定在抽屉顶部。
6. 点击卡片先进入即时详情，不触发网络请求；详情显示 1 张主图、核心特征、适用/弱项/避免项和可选的 6 张证据图。
7. “使用此风格”是明确动作。没有已生成画面时立即应用；有旧画面时显示影响镜头数和预计重生成费用，再确认一次。

选择过程应区分“浏览中的临时焦点”和“已应用的项目快照”，避免用户上下移动时频繁保存、标记过期或触发确认。

### 推荐排序

推荐不能只依赖 Aix 原始标签。排序建议分三层：

1. 当前解说模板和内容性质的人工映射（项目已有 `suits` 体系可复用）；
2. 用户最近使用和收藏；
3. Aix 分类、标签和用户搜索相关性。

推荐结果要显示“推荐”原因，例如“适合知识科普”“与你最近使用的水彩相关”，但不要伪造分数、热度或质量评级。

### 160 张列表的性能预算

- 初始只请求或内联约 160 条紧凑 metadata；完整 feature 和示例信息按详情请求或从本地索引读取。
- 缩略图使用固定宽高比、`loading=lazy`、`decoding=async` 和 `sizes`；首屏只加载可见卡片。
- 结果网格使用 `content-visibility: auto` 或窗口化列表，避免 160 张卡同时参与布局和绘制。
- 搜索在客户端对规范化索引执行，输入 debounce 只用于 URL 同步，不等待服务器；目标 p95 小于 16 ms。
- 详情只预加载当前图和下一张，完整 6 图不阻塞主图。
- 选择卡片不请求样张生成接口，不调用 LLM，不产生费用；确认应用只写项目草稿，沿用现有 800 ms 节流保存。
- API 和静态资源使用 immutable cache；catalog 用 `libraryVersion/sourceDigest` 做缓存键。

建议验收指标：抽屉打开到可输入小于 100 ms；首次可见缩略图 p95 小于 500 ms（本机部署）；输入到结果更新小于 50 ms；从详情点击应用到界面显示当前风格小于 100 ms；任何浏览动作都不新增 job。

## API 与状态设计

### 目录查询

可以在现有 `/api/visual-styles` 上增加兼容参数，也可以新增 `/api/style-library`。建议内部先统一到 `lib/aix/catalog.ts`，对外使用明确的 compact/full 视图：

```text
GET /api/style-library?source=aix&view=compact&q=水彩&category=illustration
GET /api/style-library/Aix0002
```

compact 返回：`id/version/name/description/category/tags/aliases/thumbnailPath/status`；full 返回完整 Aix 元数据和示例 manifest。`status=deprecated` 的风格不出现在新建项目的默认结果中，但旧项目仍可读，并显示 `replacement_id`（如果存在）。

现有 `/api/visual-styles` 继续服务 native/custom 风格，或者在兼容层中合并结果并增加 `source.kind`。不要让旧客户端收到需要 Aix 字段才能解析的响应；`source` 必须可选且默认 native。

### 应用与保存

项目已有 `useProject.setDoc`，因此首版不需要为“选风格”增加单独写接口：

```ts
setDoc((doc) => ({
  ...doc,
  visualStyle: aixSnapshotToVisualStyle(aixRecord),
}));
```

服务端仍在 `projectDocSchema` 解析时校验快照。保存冲突、撤销、版本历史沿用项目已有机制。只有“从库更新”才创建一次新的快照并让对应镜头过期；浏览、收藏和最近使用不应污染项目文档。

## 版本、授权和失败语义

### 版本同步

- 构建时写入 `libraryVersion`、`schemaVersion` 和 `sourceDigest`。
- 新项目只展示 `active`；`draft` 永不进入选择器；`deprecated` 只在旧项目、版本历史或用户精确搜索时显示。
- 项目保存 `styleVersion + contentHash`。当源库有新版本时，显示“有可用更新”，不能静默替换。
- 更新前展示受影响镜头、锁定的定妆和预计生图数量；用户确认后才应用。

### 失败和降级

沿用 Aix Skill 的错误边界：

- ID 无效或不存在：明确提示，不自动换号。
- 风格已弃用：展示 replacement suggestion，仍由用户确认。
- 缩略图缺失：该记录不可作为完整可用风格，不能伪装成正常卡片。
- source digest 不一致：构建失败或进入明确的 stale 状态，不在运行时偷偷修复。
- 无示例图但 `style.json` 完整：可以显示文字特征并标记证据缺失；不声称看过图片。
- provider 不支持参考图：仍可使用文本 adapter，不因为可选参考图使整条生成失败。

## 实施分期

### M0：数据导入与 adapter（建议先做）

- 固定 `vendor` 输入快照和 `aix:sync` / `aix:check`。
- 增加 Aix schema、compact catalog、静态缩略图服务。
- 增加 `aixSnapshotToVisualStyle` 和 tier 映射单元测试。
- 让一个项目可以选择 160 条 Aix 风格，并以 Aix snapshot 写入项目文档。

验收：160 个 active 风格可查、ID 唯一、缩略图完整；选择 Aix0001 后 `compileShotPrompt` 的内容槽不变，风格槽和负面槽来自对应 feature/avoid；刷新项目仍保留版本快照。

### M1：高效选择器

- 抽屉、搜索、筛选、最近使用、收藏、键盘操作。
- 详情主图和按需 6 图；小屏横向缩略图。
- 临时焦点与已应用快照分离；切换影响确认接入现有反馈组件。

验收：搜索/键盘/移动端路径完整；浏览不创建 job；p95 交互指标达到本文预算。

### M2：提示词与代码画面质量

- Aix tier 强度、冲突 warnings 和 `prepare` 结构化排除项。
- 5 类 derived Remotion 主题，允许项目内调色并标记来源。
- 角色定妆、镜头生图和候选缓存全部使用同一个 style source snapshot。

验收：同一分镜切换三个 Aix 风格时主体、动作、文字和比例不变；代码画面颜色跟随项目主题；旧图不被删除，可回切。

### M3：质量闭环与维护工具

- 可选的 6 张证据图构建、版本更新提示、弃用替代关系。
- 风格-模型失败率和人工质检回流；不把内部质量分数直接展示为用户评分。
- CI 中运行 `aix:check`、typecheck、lint、测试和 `/changelog` smoke。

## 测试与验收清单

### 数据和 adapter

- 160 active、五类数量、ID、版本、`contentHash` 和缩略图路径一致。
- `Aix0001`、`0001`、`1`、`aix-0001` 归一化到同一条记录；不存在的 ID 明确失败。
- `light/normal/strong` 只选择规定 tier；重复 feature 和负面项去重但不改变顺序。
- 已知 `weak_for` / `known_failures` 不会被误写进内容槽。
- 旧 native/custom 风格和旧项目文档通过 schema，未提供 `source` 时按 native 处理。

### 项目行为

- 选择风格不会自动调用 preview、image generation 或 worker job。
- 生成中的旧画面继续可用；应用新 Aix 风格后只标记相关生图资产过期。
- 项目保存、刷新、撤销、历史恢复保留 Aix 版本快照。
- 弃用风格旧项目可正常打开，新项目默认隐藏并显示替代建议。

### 交互与性能

- 搜索输入、精确编号、标签筛选、空结果、图片失败、加载中和网络错误都有明确状态。
- 桌面四列和移动端双列/横向缩略图下卡片尺寸稳定，无布局跳动。
- 键盘焦点、Esc 返回、Enter 应用、`prefers-reduced-motion` 和屏幕阅读器标签可用。
- 记录抽屉打开、首图可见、搜索更新、应用反馈和错误率，不记录用户 prompt 原文。

完成 M0/M1 后直接把 Aix 设为唯一系统风格来源。当前 10 张内置风格不保留为运行时 fallback；旧项目中的历史快照仍可读取，但新项目和“推荐风格”只能从 Aix active catalog 产生。

## 可直接执行的落地规格

前面的章节说明为什么这样设计。本节把实现收敛成一套可以交给编码模型逐项执行的规格。实现时不要在几个候选方案之间重新设计；如果发现数据无法满足某一条，先修正导入器或明确报错，不要静默降级成旧内置风格。

### 0. 交付边界

本次完整交付必须包含：

1. 将桌面 Aix Skill 数据导入仓库并生成可复现的静态目录。
2. 让 Aix active 风格成为新项目唯一的系统风格来源。
3. 在 `/styles` 和项目「画面风格」面板中搜索、筛选、预览和选择 160 个 Aix 风格。
4. 选择后的风格继续通过 `ProjectDoc.visualStyle` 快照进入分镜生图、角色定妆和 Remotion 主题。
5. 移除 `builtinVisualStyles` 的运行时依赖、推荐逻辑和测试；不再显示旧的 10 张内置卡。
6. 保留已有自定义风格能力，但把它们标记为“我的风格”，不参与系统默认推荐。用户从 Aix 风格“另存为”得到的记录也属于“我的风格”。
7. 为导入、adapter、快照、过期传播、旧项目兼容和选择器交互补齐测试。

不在本次交付中：在线调用 Aix Python Skill、把 Aix Web 作为 iframe、把 6 张证据图默认传给生图模型、重写分镜或配音流水线。

### 1. 文件级变更清单

#### 新增文件

```text
vendor/aix-style-library/library.json
vendor/aix-style-library/catalog/index.json
vendor/aix-style-library/styles/<AixID>/style.json
vendor/aix-style-library/styles/<AixID>/thumbnail.webp
vendor/aix-style-library/LICENSE.md

lib/aix/schema.ts
lib/aix/catalog.ts
lib/aix/adapter.ts
lib/aix/recommend.ts
lib/aix/themes.ts

scripts/aix-sync.ts
scripts/aix-check.ts

app/api/style-library/route.ts
app/api/style-library/[id]/route.ts

tests/aix-catalog.test.ts
tests/aix-adapter.test.ts
tests/aix-recommend.test.ts
tests/style-library-api.test.ts
```

如果仓库不希望提交二进制缩略图，`vendor` 仍必须提交 JSON、许可证和资源 manifest，缩略图应在 `aix:sync` 阶段复制到 `public/aix/thumbnails`；不能让生产构建依赖用户桌面路径。

#### 修改文件

| 文件 | 必须完成的修改 |
|---|---|
| `package.json` | 增加 `aix:sync`、`aix:check`；不覆盖已有 `library:ingest`（它是音乐曲库命令） |
| `lib/core/types.ts` | 增加 Aix schema、`visualStyleSourceSchema`、`themeSource`；旧字段默认按 native 处理 |
| `lib/visual-styles/store.ts` | 删除 `builtinVisualStyles` 依赖；系统列表改为 Aix active 快照 + 用户自定义；推荐改调用 `lib/aix/recommend.ts` |
| `app/api/visual-styles/route.ts` | 仅返回/创建用户自定义风格，不能再隐式拼接旧内置风格 |
| `app/api/visual-styles/[id]/route.ts` | 只允许更新/删除用户自定义；Aix ID 返回明确的只读错误 |
| `lib/client.ts` | 新增 `useStyleLibrary`，支持 compact/full 数据；保留 `useVisualStyles` 作为“我的风格”兼容 hook |
| `app/styles/page.tsx` | 页面数据改为 Aix catalog + 我的风格两个来源；“新建风格”使用空白草稿，不再复制 `builtinVisualStyles[0]` |
| `components/visual-style-panel.tsx` | 使用新的 Aix picker；保留当前快照、影响确认、项目微调和另存为 |
| `components/visual-style-editor.tsx` | 编辑器继续服务用户自定义/项目微调；显示 Aix 来源信息时不得允许修改只读 metadata |
| `lib/core/prompt-compiler.ts` | 继续消费 adapter 生成的运行时字段；若增加 warnings，必须保持 `prompt/full/hash` 现有契约 |
| `lib/core/theme.ts` | 对 Aix 快照读取 `themeSource` 和 derived theme；缺失时使用明确的 Aix category fallback，不恢复旧 builtin theme |
| `lib/server/projects.ts` | `ensureProjectVisualStyle` 改为从 Aix 推荐产生快照；旧快照解析失败时返回可诊断错误 |
| `app/api/visual-styles/preview/route.ts` | Aix 静态证据不走付费 preview；按模型生成的 3 张 preview 仍可由自定义风格显式触发 |
| `lib/visual-styles/builtin.ts` | 完成迁移后删除 |
| `lib/visual-styles/builtin.test.ts` | 删除，测试迁移到 `tests/aix-*` |
| `lib/changelog.ts` | 运行时功能完成后在数组最前面新增一条版本记录 |
| `docs/visual-director-plan.md` | 将“10 张内置卡”改为 Aix catalog；记录本规格与实际差异 |

#### 必须清理的引用

执行 `rg` 后，以下引用必须为零，测试 fixture 除非已改为 Aix fixture：

```text
builtinVisualStyles
recommendVisualStyles
recommendedVisualStyle
cinematic-real
noir-suspense
warm-handdrawn
flat-infographic
clay-3d
cyber-neon
retro-film
comic-pop
```

`anime`、`ink`、`comic` 等仍可能是 `styleMediums` 的合法运行时枚举，不能因为它们曾出现在旧内置卡中就删除；它们是 adapter 的目标媒介，不是旧风格记录。

### 2. 导入器的精确契约

#### `scripts/aix-sync.ts`

命令：

```bash
npm run aix:sync -- --source /Users/huazi/Desktop/aix-style-library-project/skill/aix-style-library
```

行为必须是：

1. 解析 `--source`，默认值为空；没有 source 时退出 2，不猜桌面路径。
2. 读取 `library.json`、`catalog/index.json`。
3. 校验 `schema_version`、`library_version`、`source_digest`、ID 唯一性和 semver 格式。
4. 只接受 `status === "active"` 的目录项；当前应得到 160 条。
5. 对每条目录项读取对应 `styles/<id>/style.json` 和 `thumbnail.path`，禁止路径跳出 source 根目录。
6. 校验 style JSON 的 ID、版本、状态、feature ID、avoid ID、授权字段和质量字段。
7. 将 JSON 和缩略图复制到 `vendor/aix-style-library`，写出 `public/aix/catalog.json` 和 `public/aix/catalog-meta.json`。
8. `catalog.json` 只含 picker 所需的 compact 字段；full style 在服务端按 ID读取，客户端详情可按 ID请求。
9. 使用临时目录写文件，全部成功后原子替换目标目录；失败不能留下半套 catalog。
10. 输出 `libraryVersion`, `activeCount`, 各 category 数量和 `sourceDigest`，方便 CI 记录。

`public/aix/catalog-meta.json` 最少包含：

```json
{
  "schemaVersion": "1.0",
  "libraryVersion": "0.6.0",
  "sourceDigest": "...",
  "activeCount": 160,
  "generatedAt": "2026-09-30"
}
```

#### `scripts/aix-check.ts`

不读取外部 source，只检查仓库内的 `vendor` 和 `public/aix`。失败条件包括：数量不一致、ID 不唯一、active 风格缺 JSON、缩略图缺失、路径包含 `..`、catalog metadata 不一致、JSON schema 不通过。成功时输出一行摘要并退出 0。

### 3. Aix 运行时类型和 adapter 契约

`lib/aix/schema.ts` 要用 Zod 定义与 `style.json` 对应的 schema，禁止把外部 JSON 在业务代码中当作 `unknown as ...` 使用。建议导出：

```ts
export const aixFeatureSchema = z.object({
  id: z.string().regex(/^F\d{2}$/),
  axis: z.enum(["medium", "line", "palette", "lighting", "texture", "composition"]),
  tier: z.enum(["core", "support", "accent"]),
  text: z.string().min(1),
});

export const aixStyleSchema = z.object({
  schema_version: z.literal("1.0"),
  id: z.string().regex(/^Aix\d{4,8}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: z.enum(["draft", "active", "deprecated"]),
  name: z.string().min(1),
  description: z.string(),
  category: z.enum(["illustration", "painting", "photographic", "3d", "graphic"]),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  thumbnail: z.object({ path: z.literal("thumbnail.webp"), media_type: z.literal("image/webp"), alt: z.string() }),
  features: z.array(aixFeatureSchema),
  avoid: z.array(z.object({ id: z.string().regex(/^N\d{2}$/), text: z.string().min(1) })),
  suitable_for: z.array(z.string()),
  weak_for: z.array(z.string()),
  known_failures: z.array(z.string()),
  provenance: aixProvenanceSchema,
  quality: aixQualitySchema,
  replacement_id: z.string().nullable(),
});
```

`lib/aix/adapter.ts` 必须导出纯函数 `aixToVisualStyle(style, meta)`。其输出必须通过现有 `visualStyleSchema.parse`。确定性规则：

- ID 使用 `aix:${style.id}`，原始 ID 只放 `source.aixId`；避免和旧项目或用户 UUID 冲突。
- `category` 映射：`photographic → photo`、`illustration → illustration`、`painting → oil`（若存在明确水彩标签则 `watercolor`）、`3d → 3d`、`graphic → flat-vector`。
- `medium` feature 的文本优先用于 `rendering`，`line` 追加到 `rendering`；不得把未经支持的媒介字符串写入 `styleMediums`。
- `palette` → `colorGrade`，`lighting` → `lighting`，`texture` → `texture`，`composition` → `composition`。
- `avoid[].text` → `negative[]`，保留原顺序并按精确文本去重。
- `description` 只作为卡片说明，不拼进 prompt。
- `suits` 不从 Aix 自由文本猜测；由 `lib/aix/recommend.ts` 的显式映射和搜索相关性决定。
- `palette` 使用 `lib/aix/themes.ts` 的 derived theme，并设置 `themeSource: "aix-derived"`。
- `source` 保存完整 Aix 元数据、`libraryVersion`、`styleVersion`、`contentHash` 和资源路径。

adapter 测试必须使用至少 Aix0001、一个 illustration、一个 graphic、一个 3d 和一个含多个 tier 的 fixture，断言 prompt 内容槽未被 metadata 污染。

### 4. API 契约（不要保留模糊候选）

#### `GET /api/style-library`

参数：

```text
source=aix                 # 当前固定为 aix
view=compact|full          # 默认 compact
q=<搜索词>                  # 可选；服务端搜索用于深链接/无 JS 降级
category=<category>        # 可选
status=active|deprecated    # 默认 active
limit=1..200               # 默认 160
```

compact 响应：

```ts
{
  meta: { libraryVersion: string; sourceDigest: string; total: number },
  items: Array<{
    id: string;
    version: string;
    status: "active" | "deprecated";
    name: string;
    description: string;
    category: AixCategory;
    tags: string[];
    aliases: string[];
    thumbnailPath: string;
    thumbnailAlt: string;
  }>
}
```

#### `GET /api/style-library/[id]`

只接受规范化的 `Aix0001`，支持 `0001`、`1`、`aix-0001` 的输入归一化。返回 `{ meta, style, assets }`，`style` 是完整 Aix 记录，`assets` 只包含仓库内相对路径。不存在、非 active 或资源缺失分别返回 404、409、500，不自动换号。

#### 现有 `/api/visual-styles`

调整为用户自定义风格 API：

- `GET` 只返回 `data/visual-styles.json` 中的用户风格；
- `POST` 创建用户风格；
- `PUT/DELETE` 只接受随机 UUID；
- 对 `aix:*` 或旧 builtin ID 返回“系统风格只读”错误。

这样 `/api/style-library` 是唯一系统风格来源，旧 native CRUD 不会和 Aix 版本数据混在一个数组里。

### 5. 旧项目和删除内置风格的迁移规则

这是移除 10 张内置风格时最重要的行为约束：

1. **不删除旧项目数据。** 旧项目的 `doc.visualStyle` 已保存完整运行时字段，即使其 ID 不再出现在 catalog，也必须可以打开、继续编译 prompt 和渲染。
2. 读取旧快照时 `source` 缺失按 `{ kind: "native", legacy: true }` 补默认；界面显示“历史风格（当前库已移除）”，不提供把它当作新系统风格推荐的入口。
3. `ensureProjectVisualStyle(projectId)` 在 `visualStyle === null` 时只能调用 Aix 推荐；不能再 import 旧 builtin，也不能返回 null 让生成链路自行猜风格。
4. 旧项目切换到 Aix 后，旧快照仅存在于版本历史/撤销记录中；新快照必须写 `source.kind="aix"`。
5. `data/visual-styles.json` 中的用户自定义风格保留，显示为“我的风格”；它们不参与系统推荐，不能冒充 Aix 版本。
6. 若用户明确要求“连我的风格也完全禁用”，再增加独立迁移开关；本次默认不删除用户数据，避免不可逆数据损失。
7. 删除 `lib/visual-styles/builtin.ts` 前先完成上述旧快照兼容测试；不能用 `git rm` 先删再让旧项目解析失败。

### 6. 推荐算法的确定性实现

`lib/aix/recommend.ts` 不读取模型、不调用网络。先按以下显式表给出候选，再用搜索相关性稳定排序：

```ts
const templateSignals = {
  serious: ["graphic", "photographic", "painting"],
  humor: ["illustration", "3d", "graphic"],
  roast: ["graphic", "illustration", "photographic"],
  suspense: ["photographic", "graphic", "painting"],
  science: ["graphic", "illustration", "3d"],
  warm: ["illustration", "painting", "photographic"],
  passion: ["graphic", "3d", "photographic"],
  documentary: ["photographic", "painting", "graphic"],
} as const;
```

排序键依次为：精确 ID、name/alias 命中、templateSignals category、tag 命中、`id` 数字升序。相同输入必须得到相同顺序。UI 只显示“推荐”及原因，不显示未经定义的推荐分数。

### 7. `/styles` 与项目选择器的落地步骤

#### `/styles`

1. 首次加载 `useStyleLibrary({ view: "compact" })`，显示 `meta.total` 和 `meta.libraryVersion`。
2. 160 张卡片使用固定 2:3 容器，`thumbnailPath` 通过 `next/image` 或原生 `<img>` 懒加载。
3. 查询、分类和排序完全在客户端对 compact 数据执行；URL 同步 `q/category/sort`。
4. 点击卡片打开详情抽屉/详情路由，按 ID请求 full 数据；Aix 详情只读，按钮为“用于当前项目”或“复制风格 ID”。
5. 页面上的“新建风格”创建的是用户自定义空白草稿，不从任何旧 builtin 复制。

#### 项目「画面风格」面板

1. `useStyleLibrary` 与 `useVisualStyles` 并行加载；Aix 为主列表，“我的风格”作为次级筛选。
2. picker 打开后立刻聚焦搜索框；搜索状态全部保存在组件 state，不在每次按键时保存项目。
3. 选择卡片只更新临时 `pendingStyle`；详情中的“使用此风格”才调用现有 `apply`。
4. `apply` 计算 `staleCount`，沿用现有确认组件；无已生成镜头时不弹阻断确认。
5. 应用 Aix 后直接把 `aixToVisualStyle` 的快照写入 `doc.visualStyle`，随后由已有 `useProject` 节流保存。
6. 当前风格卡显示 `Aix0001 · v1.1.0 · library 0.6.0`；若库有新版本显示更新按钮，但不自动更新。
7. AIX 静态 thumbnail/证据图显示为“库示例”；`StyleSamples` 的付费模型预览仍明确标为“按模型生成”，两者不能混淆。

### 8. 测试命令和完成门槛

实现每个阶段都必须运行：

```bash
npm run aix:sync -- --source /Users/huazi/Desktop/aix-style-library-project/skill/aix-style-library
npm run aix:check
npm run typecheck
npm run lint
npm test -- --run
```

完成前还必须启动 Next 并检查：

```text
/styles
/changelog
任意项目的「画面风格」面板
```

最小自动化验收：

- catalog active 数量为 160，分类计数为 62/54/30/10/4；
- `Aix0001`、`0001`、`1`、`aix-0001` 得到同一条记录；
- 任意 active Aix 风格都能通过 `visualStyleSchema` 和 `projectDocSchema`；
- 选择 Aix 风格不创建 job、不调用 preview API；
- prompt 内容槽在换 Aix 风格前后完全一致，style/negative/hash 按预期变化；
- 旧 builtin 快照可以打开，新项目不会出现旧 builtin；
- `rg "builtinVisualStyles|recommendVisualStyles|recommendedVisualStyle" app components lib tests` 无结果；
- `/changelog` 正常渲染，并新增本次重大功能记录。

只有以上门槛全部通过，才删除旧 builtin 文件并关闭任何兼容 feature flag。最终生产包不应依赖 `/Users/huazi/Desktop`，也不应在用户首次打开风格选择器时运行 Python、扫描 160 个目录或触发付费生图。

## 交给执行模型的开工指令

把本文交给编码模型时，使用下面的执行边界：

```text
先阅读仓库根目录 AGENTS.md、当前文档和现有 git status。工作树中已有的用户改动必须保留，不要 reset、checkout 或覆盖无关文件。

按本文“可直接执行的落地规格”顺序实施：先 aix:sync/aix:check 与 schema，再 adapter 和快照，再 API，再选择器，最后删除 builtin 引用并补齐迁移测试。每完成一个阶段都运行该阶段规定的检查；不要只写计划，也不要在运行时代码仍依赖旧 builtin 时声称完成。

Aix 是唯一系统风格来源。新项目不得回退到旧 10 张风格；旧项目内已有的完整历史快照必须可读。用户自定义风格可以保留，但必须与 Aix 分成“我的风格”和系统风格两条来源。

所有选择动作必须是本地即时状态更新；浏览不能调用 LLM、Worker、preview 或付费模型。所有写入项目的 Aix 风格都必须是带 libraryVersion/styleVersion/contentHash 的快照。

实现完成后运行 npm run typecheck、npm run lint、npm test -- --run，并启动 Next 检查 /styles、/changelog 和项目画面风格面板。只有测试、旧项目兼容、160 条 catalog 校验和 UI 性能门槛全部通过，才删除 lib/visual-styles/builtin.ts 及其测试，并在 lib/changelog.ts 最前面记录这次主线功能。
```
