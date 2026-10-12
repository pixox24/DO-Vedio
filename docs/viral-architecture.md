# 爆款复创共享契约 v1

日期：2026-10-11。主责：`omd-ux-engineer`。数据定义、请求校验、状态、失效和时长均由 C 组单写；消费方需要变更时先提出字段及失败场景。

## 数据与 API

共享文件：`lib/viral/types.ts`、`schemas.ts`、`state.ts`、`invalidation.ts`、`duration.ts`。所有函数在服务器与浏览器共享，纯函数不读取存储、不启动模型调用； ID、时间戳由调用者传入。持久草稿 JSON 使用 `viralDraftSchema` 校验。

`ViralDraft` 以 `id/revision` 定址，包含 `input`、`analysis`、`angles/anglesSourceFingerprint/selectedAngleId`、`outline`、`versions/currentVersionId/candidateVersionId`、`review`、`task`、`adoptions`、`inputHistory` 和 `issueResolutions`。两模式只改视图，同一草稿及任务不变；活动任务切模式不写任务计划。完全空白草稿通过 `hasMeaningfulInput` 判断，不写入存储；首个有意义编辑才持久化。

输入每期使用用户选择的平台与产品文字模型，编码 Agent 的模型配置不参与产品模型选择。平台 `douyin/xiaohongshu/bilibili/xigua`；画幅仅现有 `9:16/16:9`。风格模板选择后复制为本期 `ViralStyleSnapshot`；以后管理页修改不更新本期快照。`materials` 的 id、类别、来源和 `user_provided/pending/verified` 状态均保存，角度、大纲、段落的 `materialIds` 可追溯。

统一 API 成功体 `{ ok: true, data: T }`，错误体 `{ ok: false, error: { code, message, fields?, currentRevision? } }`。读取和写入草稿的 `data` 为 `ViralDraft`，列表返回约定列表数据。HTTP 状态由 API 层映射。草稿写入先核对 `expectedRevision`，冲突不覆盖本地输入。

创建 `{input,mode?}` 使用 `viralCreateSchema`；PATCH 使用 `viralPatchSchema`，可保存输入、视图、角度/选择、大纲、手写正文、选择/采用候选版本、恢复版本设置及问题处理。通用机制只接受既有 `enabledMechanismIds`，不能用 PATCH 修改分析侧文字。PATCH 不触发模型调用。手写正文创建新版本并继承原稿 `basedOn`，不把手改冒充为根据新主题重生成。

`/commands` 命令：`quick/analyze/angles/outline/generate/rewrite/calibrate/review/stop/resume`，包括 `expectedRevision`；局部重写需 `rewrite:{segmentId,instruction}`。服务端草稿/任务保存与启动应原子处理。单草稿只允许一个写入任务。停止和续作由后台驱动，同一任务原计划/快照持久保存，不因切模式或离页新建任务。

浏览器业务层通过 `focusRequest:{token,target,field?}` 向展示层发出一次性定位请求：仅显式提交失败定位字段、快捷成功提交定位结果、采用后打开同步预览定位选择区。轮询和自动保存不产生请求；展示层展开字段祖先折叠，窄屏结果定位时将快捷输入折叠为可恢复的摘要。`errorOrigin` 区分保存、命令、读取、轮询和其他操作，恢复按钮分别重试保存、用户点击后重试本次命令、重读或续作后台失败任务；自动保存成功不清除尚未修改的命令字段提示。

热梗读取复用 `GET /api/memes`，不调用自动选梗模型。候选同时要求 `trust=verified` 和既有 `isCandidate` 规则；初始 `memes=[]`，用户主动勾选才写入 id/名称/含义/使用说明快照。示例故事不作为事实输入，词库刷新不替换既有选择；已保存但不再出现在候选中的选择仍可查看和移除。

## 上下文隔离

分析可保存原文定位、观察与作用假设、独特表达供 UI 和检查模型使用。`ViralGenerationContext` 严格 schema 只允许通用机制、本期任务、风格、素材、角度与大纲，不允许原文、分析引文、独特表达清单。机制含枚举 `archetype`，生成器用固定说明替换自由 `description`，防止摘要夹带原句。风格 sample 只供 UI 快照，生成侧移除或只使用已抽出的风格规则，不能作为具体事实。

检查引用片段、问题理由不可原样倒流进自动修订提示；修订侧使用处理类型和段落 id，发现疑似独特表达时从本期任务/论证重构该段。原文自动出现的具体事实不变成用户素材。此隔离由内容主责实际构造请求验证，不以 TypeScript 类型本身代替请求证据。

## 版本与检查

`ViralScriptVersion` 保存标题、分段、`completedSegmentIds`、`complete`、`manuallyEdited`、`basedOn` 及父版本。流式非空段落不等于已完成；续作只复用明确完成的段落。半稿可读与复制，不能采用。每次手工编辑创建新版本，旧版本保留。局部重写产物是候选版本；用户明确 PATCH `adoptCandidateVersionId` 才切当前版本。候选必须完整且父版本仍是当前稿件；用户在候选生成后又手改时返回冲突，不能直接把较新人工稿覆盖成旧候选。

检查绑定确切 `versionId`、标题/分段精确指纹、`ViralReviewRules` 和参考原文指纹。这里的指纹是规范 JSON/原文精确字符串，用于内容一致性，不是相似度或法律评分。`reviewIsCurrent` 必须同时核对这些内容。检查中手写正文不可编辑；晚响应不替换新版本。

`assessAdoption` 依次判断活动任务、完整稿、上游旧设置、当前检查及未解决 blocker/judgment。建议优化不阻断。上游旧设置独立于检查结果：主题/角度改后，哪怕用新规则重检通过，仍不能采用旧设置正文。用户可以更新受影响阶段，或 `restoreVersionId` 恢复该稿的生成设置；恢复前保存快照，保留当前模型及制作画幅。

自动检查最多对未经人工编辑的稿件修订一次；重新检查仍阻断则终止自动修订。`canAutoRepair` 对任意人工编辑稿返回 false。主动校准和局部修改保留人工编辑保护，新稿需重新检查。

## 任务和失效

任务保存 `id/generation/status/command/plan/stage/completedStages/snapshot/workingVersionId/cancelRequested/error`。快照包含输入、机制、选择/大纲以及检查启动时正文 id/指纹。后台每次 checkpoint/阶段提交核对任务 id、代次、活动状态、停止标志及输入快照（`canAcceptTaskResult`）；提交成功后更新快照中的阶段自有角度/大纲。停止后的返回、旧任务的代次和较新上游输入均不可写入。运行态包括 queued/running/stopping，均锁定上游和正文；模式切换与查看、复制仍允许。

`getInvalidation` 返回最早阶段、所有下游阶段、原因，以及独立画幅/模型变更标记。参考稿→analysis；创作任务、素材、平台、目标时长、启用机制→angles；角度/路线和语速→outline；大纲、语言风格、视角、去 AI 味/指定梗→generation；禁用词/避免内容→review。画幅仅交接，模型只影响新调用。输入仅保存，旧产物持续可见；明确命令才执行 `getTaskPlan`。

分析按原文指纹、角度按任务/机制指纹、大纲按角度/语速指纹复用，风格改动不会要求重做原分析或角度。`angleContextCompatible` 对比上次角度生成语境，只有平台/时长适配可保留选定路线；主题、参考、素材、受众等改变后真正更新角度时采用新推荐，保存时仍保留旧选择供查看。稿件过期按实际输入内容比较，不依赖某个容易伪更新的 revision 号。

## 时长和制作交接

时长以秒保存，允许 30–1800 秒。抖音/小红书默认 120 秒、9:16；B站/西瓜默认 300 秒、16:9。未手改的值跨平台跟随默认，手改的值保持；`durationIsManual/aspectRatioIsManual` 分别记录。正文估算复用 `lib/duration.ts` 中口播计数及 200/250/300 字每分钟，标题/章节名称不计入配音。超出 ±15% 显示校准建议，仅是预计值。

正文版本和 `handoff.settingsVersion` 分离。仅画幅改变不新建正文版本/检查；服务器 reducer 按实际画幅变化递增设置计数。`handoffSettings` 保存平台、时长、语速、视角、风格和画幅。`settingsFingerprint` 排除变化计数，以实际内容确定相同交接；`adoptionKey` 使用草稿 id、稿件版本和实际设置身份。相同版本设置重复采用应复用项目，画幅变更更新原项目而不是创建新项目。

采用 API `{expectedRevision,versionId,settingsVersion}`；同步另含 `{projectId,strategy:'replace'|'new_project',expectedProjectScript}`。`ViralAdoption.adoptedScript` 是最后采用正文基线，用来比较制作页人工编辑。`latestAdoptionsByProject/currentVersionAdoption/currentAdoption` 只认可各项目最新的采用快照，历史版本曾采用不能冒充制作当前仍使用它。参考原文/详细分析不得写入制作稿。未检查返回 `needs_review`，前端明确启动检查后重试；交接事务内不运行模型。冲突采用/同步由制作交接主责实现事务及影响预览。

## 验证

本组行为测试覆盖边界输入/半稿/原文 DTO 禁止、最早失效、主题和角度改后仅重检仍旧设置、人工编辑继承基线、画幅/模型独立、模式任务不变、活动写入互斥、晚响应隔离、平台默认/手动和口播估算。独立架构审查、真实持久任务/模型请求捕获及完整制作交接由对应实施任务补齐；本文件不将未执行的端到端验收标为通过。
