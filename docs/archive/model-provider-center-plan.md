# 模型与供应商中心实施计划

> 状态：Phase A 已完成，Phase B 已接入，Phase C 基础闭环实施中；自定义文本服务商接入已完成  
> 目标：为画面一致性、局部可控修改、生成结果到发布数据闭环建立统一的模型供应商基础设施。  
> 适用版本：Next.js 16.3.6、Node 22、Vercel AI SDK 7、Remotion 4

## 1. 背景与结论

当前项目已经通过 Vercel AI SDK 接入文本模型，并通过独立适配层接入 CosyVoice。下一阶段会同时增加图片、视频、参考图、角色一致性、镜头局部重算和发布数据分析。

这些能力不能只依赖一个 SDK。Vercel AI SDK 继续作为**文本模型层**；图片、视频、TTS、口型同步等能力都通过统一的 Provider Adapter 接口接入，每个供应商内部可以使用自己的 SDK、HTTP 或 WebSocket 协议。

本计划先完成供应商中心的基础层，不在这一阶段绑定某一家图片或视频供应商。

## 2. 目标

### 2.1 本阶段必须完成

1. 统一描述供应商、模型、能力、默认参数和价格。
2. 统一判断某个模型是否已配置、是否启用、支持哪些能力。
3. 统一保存模型配置元数据；内置服务商 Key 从服务端环境变量读取，自定义服务商 Key 由服务端加密保存，不写入项目文档和浏览器状态。
4. 让现有文本模型继续通过 Vercel AI SDK 工作，但模型列表从供应商注册表生成。
5. 新增设置中心，查看供应商、模型、能力、配置状态和价格。
6. 新增数据库迁移，保存模型配置覆盖和后续运行记录所需的结构。
7. 为图片、视频、TTS、对齐、口型同步预留适配器接口。

### 2.2 本阶段不做

- 不在没有确认 API 协议和价格前接入图片/视频供应商。
- 不把 API Key 明文写入 SQLite；自定义服务商只保存 AES-GCM 密文。
- 不修改现有项目文档结构来存放供应商密钥。
- 不把所有模型强行包装成 Vercel AI SDK 的 `LanguageModel`。
- 不在本阶段实现画面一致性算法、参考图工作流或发布平台 OAuth。

## 3. 目标架构

```text
设置中心 / 项目设置
          │
          ▼
Provider Registry（统一目录、能力和配置状态）
          │
          ├── Text Adapter      → Vercel AI SDK
          ├── Image Adapter     → 供应商 SDK / HTTP（后续）
          ├── Video Adapter     → 供应商 SDK / HTTP（后续）
          ├── TTS Adapter       → 现有 CosyVoice Adapter
          └── Align / LipSync   → 后续适配器
          │
          ▼
Generation Run / Ledger / Cache
          │
          ▼
项目素材、时间轴、发布数据分析
```

## 4. 数据模型

### 4.1 ProviderProfile

```ts
ProviderProfile {
  providerId: string
  modelId: string
  kind: "text" | "image" | "video" | "tts" | "align" | "lipsync"
  label: string
  capabilities: string[]
  configured: boolean
  enabled: boolean
  price: Record<string, number | boolean | string>
  defaults: Record<string, unknown>
  limits: Record<string, number | string>
}
```

数据库只保存 `enabled`、价格覆盖、默认参数和限制覆盖。`configured` 由服务端环境变量或安全的密钥管理器实时计算。

### 4.2 GenerationRun

后续每次图片、视频、TTS、文本调用都记录一次：

```ts
GenerationRun {
  id, projectId, jobId,
  providerId, modelId, kind,
  inputHash, params,
  status: "running" | "succeeded" | "failed" | "canceled",
  latencyMs, costYuan,
  outputAssets, error,
  createdAt, finishedAt
}
```

`inputHash` 必须包含模型版本、提示词、参考素材、随机种子、画幅、控制参数和步骤版本。这样局部修改时可以精确复用没有变化的镜头。

### 4.3 与现有表的关系

- `ledger`：继续作为费用流水，保证现有预算功能不受影响。
- `cache`：继续存不可变的步骤产物。
- `generation_runs`：记录一次调用的生命周期、延迟、输出素材和模型参数，用于质量和发布数据分析。
- `model_profiles`：保存供应商目录的项目级覆盖。

## 5. 实施阶段

### Phase A：基础注册表（本次实施）

- 新增 `lib/providers/types.ts`。
- 新增 `lib/providers/catalog.ts`，集中登记现有文本供应商、CosyVoice 和未来能力占位模型。
- 新增 `lib/providers/registry.ts`，合并内置目录和数据库覆盖，计算配置状态。
- 新增 `model_profiles`、`generation_runs` 迁移。
- 新增 `/api/providers` 和 `/api/providers/[providerId]/models` 读取接口。
- 新增 `/settings/providers` 设置中心页面。
- 现有 `lib/llm.ts` 的模型列表改为读取注册表；生成逻辑仍使用 Vercel AI SDK。

已完成：供应商目录、配置覆盖、设置中心、图片/视频占位模型、Adapter 合约、Claude 旧 ID 兼容和 API 路由。

### Phase B：统一运行记录

- 新增 `GenerationRun` 生命周期 helper，供 Stage 执行器记录调用。
- annotate、TTS、storyboard、render 接入 GenerationRun。
- 将供应商、模型、参数、输入哈希和输出素材统一入账。
- 失败、取消、重试都能在运行记录中查询。

已完成本轮接入：annotate、TTS、storyboard、render 会在真实生成或渲染调用前创建运行记录，成功、失败、取消都会收口；可通过 `/api/projects/:id/generation-runs` 查询。任务重试会创建新的运行记录，旧记录保留。

尚未完成：发布数据指标表，以及运行记录在设置中心的可视化。GenerationRun 与 ledger 已通过 `ledger_id` 关联；未知价格的图片/视频调用仍记录为 0 元，待供应商价格确认后补充计费策略。

### Phase C：画面一致性和局部修改

- `ImageAdapter`、`VideoAdapter` 接入第一家真实供应商。
- 增加参考图、角色卡、场景卡、seed、首尾帧和控制图字段。
- 生成多个候选并记录候选之间的关系。
- 镜头级锁定、局部重算、相邻镜头一致性检查。

已完成本轮基础闭环：ProjectDoc 增加角色卡、场景卡、参考图、seed、首尾帧、控制图和候选素材字段；Replicate 图片/视频适配器支持异步预测与轮询；镜头生成按输入哈希入队，锁定镜头拒绝重算，单镜头支持 1 到 4 个候选并可切换当前候选。制作页分镜板已提供生成入口。

尚未完成：角色卡和场景卡的独立编辑面板、第一家供应商的真实线上验收，以及相邻镜头的自动一致性评分。

### 自定义服务商连接器

已完成：设置中心支持填写名称、Base URL、OpenAI Compatible 或 Anthropic 接口类型和 API Key；服务端自动尝试 `/v1/models` 和 `/models` 拉取模型，Key 使用 `PROVIDER_ENCRYPTION_KEY` 加密保存，模型启用后通过现有 `/api/models` 和 Vercel AI SDK 进入文案生成流程。自定义服务商可删除，Key 不会通过 API 返回。

### Phase D：发布数据闭环

- 增加平台发布适配器和 OAuth 凭据存储。
- 记录导出版本、标题、封面、平台、发布时间和发布结果。
- 接入播放量、完播率、前 3 秒流失、点赞、评论、收藏、转发等指标。
- 将指标回写到脚本开场、镜头节奏和封面候选的质量分析中。

## 6. 安全和配置原则

- API Key 不进入 `ProjectDoc`、`localStorage`、URL、日志和 `generation_runs.params`。自定义服务商 Key 使用 `PROVIDER_ENCRYPTION_KEY` 通过 AES-GCM 加密后写入服务端数据库，API 返回只包含 Key 已配置状态和脱敏提示。
- 设置页只显示“已配置 / 未配置”和脱敏后的环境变量名。
- 自定义 Base URL 可覆盖默认地址，但必须经过 URL 校验。
- 供应商调用超时、限流、余额不足和内容审核错误必须分类，沿用现有重试策略。
- 价格未核实的模型标记 `verified: false`，预算估算显示为“待核实价格”。

## 7. 验收标准

### 本次 Phase A

1. `/settings/providers` 能显示文本和 TTS 供应商、模型、能力和配置状态。
2. `/api/models` 与设置中心使用同一份注册表，现有文案生成不回归。
3. 配置 API Key 的模型能显示为已配置，未配置模型不会出现在旧的模型下拉框。
4. `npm test`、`npm run typecheck`、`npm run lint`、`npm run build` 全部通过。
5. 数据库迁移可重复启动，旧数据库自动升级。
6. 图片、视频模型尚未接入时，设置中心明确显示“适配器未接入”，不伪装为可用。

### 后续总体验收

- 修改一个镜头只新增该镜头必要的 GenerationRun，未变化镜头复用缓存。
- 锁定的角色、场景和镜头在局部重算后保持不变。
- 每个发布版本都能追溯到模型、参数、素材、费用和最终平台表现。

## 8. 风险与回滚

- Provider Registry 是读取层，现有 `lib/llm.ts` 保留兼容入口；如果迁移出现问题，可以回退到原有 `compatible` 定义。
- 新迁移只追加，不修改已有迁移。
- 供应商目录中未知模型默认禁用，避免误触发计费。
- 数据库中的模型覆盖删除后恢复内置默认值。
