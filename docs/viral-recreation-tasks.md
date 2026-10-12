# 爆款复创：Agent 分工与首版实施任务

日期：2026-10-11。状态：用户已授权实施，执行进度见 [实施记录](./viral-recreation-status.md)。

本计划以 [首版页面与交互规格](./viral-recreation-spec.md) 为需求依据，将首版交给固定自定义 Agent 实施。本文中的产物、测试和验收是任务要求；完成与验证状态记录在实施记录中，不以计划文字代替执行证据。

## 1. 固定配置与执行约束

Agent 配置源包位于 [agent-config/README.md](./agent-config/README.md)、`docs/agent-config/agents/*.toml` 和 `docs/agent-config/config.policy.toml`；运行配置安装至既有 `~/.codex/agents/` 与 `~/.codex/config.toml`。只合并本次 Agent、模型和并发策略，保留既有 provider、插件、MCP 等无关配置，仓库不保存含账号或连接信息的全局配置原文。

所有本期 Agent 固定使用 **`gpt-6.1-sol`**。任务指定的 `ultra` / `high` 是固定推理强度，执行过程中不临时换模型或降级。Agent 模型与产品里的「文字模型」是两套设置；本次配置不改变应用的模型目录、用户选项或产品默认文字模型。

| Agent | 固定模型 / 强度 | 本期职责 |
| --- | --- | --- |
| `omd-orchestrator` | `gpt-6.1-sol` / `ultra` | 协调依赖、写锁、派发与审查结论；仅写规划文档 |
| `omd-master` | `gpt-6.1-sol` / `ultra` | 产品决策与范围确认；仅写规划文档 |
| `omd-ux-engineer` | `gpt-6.1-sol` / `ultra` | 架构契约、状态与失效规则，以及全部前端业务接线 |
| `omd-backend-engineer` | `gpt-6.1-sol` / `ultra` | 复创持久化、任务生命周期和 API，排除交接与内容阶段 |
| `omd-content-engineer` | `gpt-6.1-sol` / `ultra` | 拆解、角度、素材依据、生成、事实隔离与检查 |
| `omd-video-integrator` | `gpt-6.1-sol` / `ultra` | 幂等采用、制作设置、文案同步、制作入口与最终集成 |
| `omd-ui-junior` | `gpt-6.1-sol` / `high` | 保留旧 Agent 名；同模型升级后仍只做纯展示组件和复创 CSS |
| `omd-ux-writer` | `gpt-6.1-sol` / `high` | 产品文案字典、字段提示、状态和错误措辞 |
| `omd-microcopy` | `gpt-6.1-sol` / `ultra` | 只读文案审查 |
| `omd-critic` | `gpt-6.1-sol` / `ultra` | 只读架构、事实边界、版本与幂等审查 |
| `omd-final-qa` | `gpt-6.1-sol` / `ultra` | 只读集成验收与证据核对 |
| `omd-designer-review` | `gpt-6.1-sol` / `ultra` | 只读设计与 UX 审查 |
| `omd-a11y-auditor` | `gpt-6.1-sol` / `ultra` | 只读无障碍审查 |
| `omd-persona-tester` | `gpt-6.1-sol` / `ultra` | 只读用户场景与内容质量验收 |
| `omd-ux-researcher` | `gpt-6.1-sol` / `high` | 仅写文档的样本设计与质量评估方法 |
| `omd-asset-curator` | `gpt-6.1-sol` / `high` | 可选资源整理；首版不必派发 |
| `omd-codex-image` | `gpt-6.1-sol` / `high` | 可选图像资产；首版不必派发 |
| `omd-kr-writer` | `gpt-6.1-sol` / `high` | 可选韩语内容；首版不必派发 |
| `omd-locale-adapter` | `gpt-6.1-sol` / `high` | 可选本地化；首版不必派发 |

源包另保留 asset / image / kr / locale 四类 Agent，均为 `gpt-6.1-sol` / `high`，首版不必派发。需要额外素材或本地化时先确认实际需求和路径主责，再纳入计划；不为了用齐 Agent 扩大首版范围。

每个实施者接手前先读 `lib/changelog.ts`、根 `AGENTS.md`、首版规格、本任务及配置范围。写 Next.js 代码前还需阅读当前安装版 `node_modules/next/dist/docs/` 中与路由、Server / Client Components、Route Handlers 等工作相关的指南，不凭旧版习惯实现。工作区已有修改先记录基线并保留，不重置或清理其他人的工作。

## 2. 唯一主责与允许写入矩阵

以下路径均相对仓库根目录。允许范围是上限，单个任务只允许写该任务列出的更小范围。**路径例外优先于目录通配符**；没有明确主责的接入点先交协调者补充文档分工，不能自行扩大范围。实施者的逐路径范围由 Agent 指令和本计划约束，不是操作系统对每条路径的独立强制隔离；所有审查 Agent 另使用 `read-only` 沙箱约束。

| 写入组 | 唯一主责 | 允许写入 | 必须排除 |
| --- | --- | --- | --- |
| P：协调规划 | `omd-orchestrator` | `docs/viral-recreation-tasks.md`、`docs/viral-recreation-status.md` | 应用代码、测试代码、其他人的决策和研究文件 |
| D：产品决策 | `omd-master` | `docs/viral-recreation-decisions.md` | 应用代码、未经确认修改首版范围 |
| R：研究样本 | `omd-ux-researcher` | `docs/viral-quality-protocol.md` | 应用代码、测试实现 |
| C：共享契约与状态 | `omd-ux-engineer` | `lib/viral/{types,schemas,state,invalidation,duration}.ts`、对应同名 `.test.ts`；`docs/viral-architecture.md` | 内容模块、持久化、交接模块 |
| B：后台 | `omd-backend-engineer` | `lib/server/viral/**`、`lib/pipeline/viral/**`、`app/api/viral/**`；`lib/server/{db,migrations,jobs}.ts` 的复创最小接入及对应同名测试；`tests/viral-persistence/**`、`tests/viral-jobs/**` | `lib/server/viral/handoff.ts`、`lib/server/viral/handoff.test.ts`；`lib/pipeline/viral/stages/**`；`app/api/viral/[id]/{adopt,sync}/**` |
| N：内容 | `omd-content-engineer` | `lib/viral/{analysis,angles,evidence,generation,review,style,prompts,export}.ts` 及对应同名 `.test.ts`；`lib/pipeline/viral/stages/**`、`tests/viral-content/**` | C 组共享文件、后台调度器、交接代码 |
| V：制作交接 | `omd-video-integrator` | `lib/server/viral/handoff.ts`、`lib/server/viral/handoff.test.ts`；`app/api/viral/[id]/{adopt,sync}/route.ts`；`lib/server/{projects,versions}.ts`、`app/api/projects/route.ts`、`app/projects/[id]/video/page.tsx`、`components/video-studio.tsx` 的最小接入；`tests/viral-handoff/**`；最终发布阶段的 `lib/changelog.ts` | 非交接后台、全部复创业务页面、其他人的模块 |
| U：纯展示 | `omd-ui-junior` | `components/viral/presentational/**`、`app/viral/viral.module.css` | 业务状态、持久化、API 请求、任务控制、检查/采用判断、交接、全局 CSS |
| W：文案 | `omd-ux-writer` | `components/viral/copy.ts`、`docs/viral-copy.md` | 状态与错误分类定义、业务判断、其他组件 |
| F：前端业务 | `omd-ux-engineer` | `app/viral/**`、`components/viral/**`；`components/home-composer.tsx`、`app/page.tsx`、`components/nav.tsx` 的复创最小接入；`tests/viral-ui/**` | U、W 组路径；制作页和 `components/video-studio.tsx`；后台、内容和交接模块 |
| Q：独立审查 | `omd-microcopy`、`omd-critic`、`omd-final-qa`、`omd-designer-review`、`omd-a11y-auditor`、`omd-persona-tester` | **无写入路径**；读取实现、运行或观察约定验收、返回报告 | 所有代码、测试和文档编辑；不接管修复 |

`types.ts`、`schemas.ts`、`state.ts`、`invalidation.ts`、`duration.ts` 及对应测试始终由 `omd-ux-engineer` 单独写入。其他 Agent 只能导入已冻结版本；需要新字段或变更规则时提交具体变更请求，由原主责更新和重新冻结。

`handoff.ts`、`handoff.test.ts` 虽位于后台目录，但完全归 V 组；`stages/**` 虽位于流水线目录，但完全归 N 组；`adopt/` 和 `sync/` 虽位于 API 目录，但完全归 V 组。后台与内容任务不能借目录通配符修改这些例外。

纯展示组件只接收数据、展示状态和回调；它们不保存草稿/稿件版本、不发请求、不计算失效或采用权限、不驱动任务、不读写制作项目。业务容器由 `omd-ux-engineer` 提供 props 与回调。`omd-ui-junior` 的旧名字不是降低能力或放宽边界的理由。

## 3. 实施任务清单

### T01 — 产品约束与决策基线

- **主责 / 配置：** `omd-master`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `docs/viral-recreation-decisions.md`。
- **前置依赖：** 已确认首版规格；固定 Agent 配置已准备。此任务属于实施启动后的决策落档，不在当前准备轮执行。
- **产物：** 记录首版范围、输入默认值、快捷与工作台的共同数据、检查处理级别、采用/同步语义、质量评估口径；将仍需实现者决定的技术细节交 T03，不重新增加链接抓取、转写或榜单功能。
- **验证：** 逐项对照规格第 1–9 节，确认空访问不创建项目、快捷默认只生成一篇、人工文字不得自动覆盖、制作设置与正文版本分离；所有决策有规格依据。
- **独立审查：** `omd-critic` 审约束；`omd-persona-tester` 审用户行为。
- **验收映射：** A01、A04、A18、A21、A24、A29–A32。

### T02 — 内容样本与人工质量评估方案

- **主责 / 配置：** `omd-ux-researcher`，`gpt-6.1-sol` / `high`。
- **允许写入：** `docs/viral-quality-protocol.md`。
- **前置依赖：** T01。
- **产物：** 定义无素材、含可追溯素材、待核实事实、第一人称经历、观点/科普/显式虚构、独特表达与公共事实等样本；覆盖四个平台和长短时长。明确与已有直接写稿流程使用相同主题、素材、平台及风格的人工对比方法。
- **验证：** 样本能暴露具体事实编造、角度仅换开头、固定投币结尾、风格样例事实搬入和机械改写；评估吸引力、论证、准确性、个人风格、机械改写感，不用模型自评分证明传播效果。
- **独立审查：** `omd-persona-tester`，`omd-critic`。
- **验收映射：** A05、A08、A16、A17、A19、A32，以及规格第 10 节的人工质量对比。

### T03 — 共享数据、API 与交接契约冻结

- **主责 / 配置：** `omd-ux-engineer`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `lib/viral/{types,schemas}.ts`、`lib/viral/{types,schemas}.test.ts`、`docs/viral-architecture.md` 的数据/API/交接契约章节。
- **前置依赖：** T01。
- **产物：** 草稿/输入/风格快照、任务与代次、阶段产物、角度与依据、完整/半稿候选、正文版本、人工编辑标识、检查版本、问题处理记录、独立交接设置、关联项目的数据结构及校验；明确 API 成功/错误/冲突结构、任务查询或流式事件、采用幂等键、同步冲突与项目正文对比基线。划清分析/比对上下文与生成上下文的数据边界。
- **验证：** 用边界与序列化测试验证空白/长度/枚举/时间范围、引用标识和跨模块协议；证明修改画幅不增正文版本、检查只能绑定确切正文与规则快照、原稿字段不能进入生成 DTO。`omd-critic` 通过后发布契约版本与文件清单。
- **独立审查：** `omd-critic`；交接协议另由 `omd-video-integrator` 只读会审。
- **验收映射：** A02、A03、A09–A18、A21–A25、A29–A32。

### T04 — 状态机、失效规则与时长默认值冻结

- **主责 / 配置：** `omd-ux-engineer`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `lib/viral/{state,invalidation,duration}.ts`、对应同名 `.test.ts`、`docs/viral-architecture.md` 的状态/失效/时长章节。若需调整 T03 文件，必须持有 C 组写锁并更新契约版本。
- **前置依赖：** T03 审查通过并冻结。
- **产物：** 真实阶段与可执行命令、单任务写入互斥、停止/失败/恢复规则、上游锁定、旧设置标记与「恢复此稿设置」；按规格逐项实现最早受影响阶段规则。时长复用 `lib/duration.ts` 计量，区分平台默认与手动值、正文目标与实际配音时长、画幅与正文。
- **验证：** 行为测试覆盖切模式任务不变、换主题后仅检查不能采用旧稿、模型选择只影响后续调用、风格快照显式更新、选角不即时覆盖旧稿、恢复设置先保留原输入快照、运行中正文只读、±15% 提示，以及手动时长/画幅跨平台保留。
- **独立审查：** `omd-critic`，`omd-persona-tester`。
- **验收映射：** A10–A15、A18、A20、A29–A32。

### T05 — 草稿、候选版本与阶段产物持久化

- **主责 / 配置：** `omd-backend-engineer`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `lib/server/viral/{drafts,repository,versions}.ts` 及同目录对应测试；`lib/server/{db,migrations}.ts` 及对应同名测试的复创最小接入。确需增加后台辅助文件时只允许 B 组且登记实际文件；排除 `handoff.ts`、`handoff.test.ts`。
- **前置依赖：** T03、T04 全部冻结。
- **产物：** 复创草稿/快照/任务/产物/版本与关联关系的存储和迁移；首个有效编辑才获得稳定 ID、空访问不落库、最近草稿恢复；版本化保存与冲突响应。采用映射的唯一约束由 T03 定义，本任务建表，T15 使用。
- **验证：** 隔离 SQLite 测试真实迁移、保存/恢复、并发版本冲突、旧版保留及唯一约束；全局风格模板更新不改本期快照；在实施前后对照已有存储与任务行为，保留工作区基线。
- **独立审查：** `omd-critic`。
- **验收映射：** A03、A09、A11、A13–A15、A18、A21、A25、A30、A31。

### T06 — 持久任务、API、停止与续作

- **主责 / 配置：** `omd-backend-engineer`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `lib/server/viral/**` 的任务文件与测试，排除 `handoff.ts`、`handoff.test.ts`；`lib/pipeline/viral/**` 的调度文件与测试，排除 `stages/**`；`app/api/viral/**`，排除 `[id]/adopt/**` 与 `[id]/sync/**`；`lib/server/jobs.ts` 与对应测试的复创最小接入。
- **前置依赖：** T05；先以冻结的内容阶段接口接线，真实完整流程再等待 T07–T10。
- **产物：** 草稿创建/保存/读取/列表与生成/停止/继续/事件读取 API；任务启动计划和输入快照持久化、实时正文读取、租约/代次隔离、阶段续作、终态与失败原因。页面离开继续运行，模式切换不能新建任务。沿用现有 jobs / pipeline 能力，不引入新编排框架。
- **验证：** API 与真实任务行为测试覆盖重复启动、刷新读同一任务、取消后迟到结果、失败续作只补缺段、输入变更后的最早失效阶段、模型不可用与保存失败。完成/停止/失败前后写入均核对代次与版本；后续任务不能被旧结果覆盖。
- **独立审查：** `omd-critic`；`omd-final-qa` 只读复核恢复链路证据。
- **验收映射：** A04、A10、A11、A13、A14、A25、A29、A30。

### T07 — 参考拆解与生成上下文隔离

- **主责 / 配置：** `omd-content-engineer`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `lib/viral/analysis.ts`、`lib/viral/analysis.test.ts`、`lib/viral/prompts.ts`、`lib/viral/prompts.test.ts`；`lib/pipeline/viral/stages/analysis.ts` 及对应测试；`tests/viral-content/analysis*.test.ts`。
- **前置依赖：** T03、T04 冻结；采用 T02 已就绪的样本。
- **产物：** 带原文定位的开头承诺、推进、节奏、结尾分析；区分文本观察与作用假设，提取可迁移机制并将独特比喻/案例/金句留在比对侧。形成仅有机制、任务、风格与本期素材的生成请求边界。
- **验证：** 捕获真实构造请求，断言原文和独特表达不会进入角度、写稿、修订上下文；纯文字不声称实际镜头、配乐、留存或流量成因；来源具体事实不会自动入本期素材。
- **独立审查：** `omd-critic`；`omd-persona-tester` 审解释可理解性。
- **验收映射：** A05、A07、A16、A17。

### T08 — 本期任务、三种角度、依据与风格快照

- **主责 / 配置：** `omd-content-engineer`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `lib/viral/{angles,evidence,style}.ts`、对应同名 `.test.ts`；`lib/viral/prompts.ts`、`lib/viral/prompts.test.ts` 的本阶段增补；`lib/pipeline/viral/stages/{angles,style}.ts` 及对应测试；`tests/viral-content/{angles,evidence,style}*.test.ts`。
- **前置依赖：** T07；T02 质量样本。
- **产物：** 三项有实质差异的角度、主张、示例开头、路线、素材关联与缺失依据；快捷推荐理由与素材不足退路；用户提供/待核实/外部已核实资料分级；现有风格选择与本期快照规则。第一人称具体经历和具体承诺必须有本期素材，虚构只能显式选择。
- **验证：** 三角度差异可由人工解释；素材为空可生成不依赖缺失事实的路线；选择/编辑路线实际进入下一阶段；风格不覆盖选定角度、不搬入示例事实；未满足主题/平台/时长时不可生成角度。
- **独立审查：** `omd-critic`，`omd-persona-tester`。
- **验收映射：** A02、A05、A07–A09、A11、A12、A15、A16、A19。

### T09 — 大纲、正文、局部修改、时长校准与导出

- **主责 / 配置：** `omd-content-engineer`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `lib/viral/{generation,export}.ts`、对应同名 `.test.ts`；`lib/viral/prompts.ts`、`lib/viral/prompts.test.ts` 的本阶段增补；`lib/pipeline/viral/stages/{outline,generation,rewrite,calibrate}.ts` 及对应测试；`tests/viral-content/{generation,rewrite,duration,export}*.test.ts`。
- **前置依赖：** T08；使用 T06 冻结的阶段调用接口，可先独立测试再做真实任务接入。
- **产物：** 可编辑正时长大纲、选定角度的一篇分段/分章正文与新标题；平台节奏和时长适配；只生成候选的局部重写与可恢复校准；复用去 AI 味能力、默认热梗关闭，仅使用用户指定且已核实条目。所有文本处理完成后才交检查；复制和 Markdown 只输出当前标题及正文。
- **验证：** 大纲至少一段且各段时长为正；真实选择、路线和大纲编辑进入请求；短稿不套中长固定开场/投币结尾；旧版与旧段保留、未确认候选不替换人工正文；预计时长口径一致；导出无分析、证据标记与占位说明；不接收参考全文。
- **独立审查：** `omd-critic`，`omd-persona-tester`。
- **验收映射：** A04、A05、A09、A12、A14、A16、A19、A20、A27、A32。

### T10 — 检查分级、事实追溯与一次自动修订

- **主责 / 配置：** `omd-content-engineer`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `lib/viral/review.ts`、`lib/viral/review.test.ts`；`lib/viral/prompts.ts`、`lib/viral/prompts.test.ts` 的本阶段增补；`lib/pipeline/viral/stages/{review,revision}.ts` 及对应测试；`tests/viral-content/{review,isolation,revision}*.test.ts`。
- **前置依赖：** T09；T03、T04 的正文/检查版本及人工编辑契约。
- **产物：** 独立原文比对、具体片段/理由/建议与三档问题；本期事实素材追溯、问题处理记录；检查绑定当前正文与规则；未经人工编辑的自动稿最多一次定向修订且再检查，仍有阻断停在需要修改；人工编辑稿只给候选，显式采用才替换。
- **验证：** 公共事实/常见结构/纯相似分数不单独阻断，明显独特表达能定位；具体经历/数字/证言、事实占位、禁用词、半稿正确阻断；材料待核实与合理引用按处理记录再检查；改过一个段落也禁止整稿自动覆盖；所有文本后处理使旧检查失效，迟到检查不能写给新正文；无原创率、爆款概率或法律保证。
- **独立审查：** `omd-critic`，`omd-persona-tester`；对外措辞交 `omd-microcopy` 只读复核。
- **验收映射：** A05、A16–A18、A25、A29、A30、A32。

### T11 — 产品文案字典与错误恢复措辞

- **主责 / 配置：** `omd-ux-writer`，`gpt-6.1-sol` / `high`。
- **允许写入：** `components/viral/copy.ts`、`docs/viral-copy.md`。
- **前置依赖：** T01、T03、T04；T10 后补齐冻结的检查级别措辞，不自行定义错误码或业务状态。
- **产物：** 字段标签/占位/帮助、主页入口、阶段状态、旧设置提示、停止续作、输入上限、缺失素材、无模型、保存/检查失败、检查并进入制作、设置更新、同步影响和保留旧制作文案；说明预计时长及人工判断边界。
- **验证：** 文案与真实条件一一对应；不显示伪百分比/倒计时，不承诺原创率或精确配音时长；错误告诉用户保留了什么及可执行动作；按钮名称同时适用于视觉显示与可访问名称。
- **独立审查：** `omd-microcopy`，`omd-a11y-auditor`。
- **验收映射：** A01–A03、A06、A07、A11、A14、A17、A20、A24–A26、A29–A32。

### T12 — 响应式纯展示组件与样式

- **主责 / 配置：** `omd-ui-junior`，`gpt-6.1-sol` / `high`。
- **允许写入：** `components/viral/presentational/**`、`app/viral/viral.module.css`。
- **前置依赖：** T03、T04、T11 的初版字典；组件 props 和展示状态由 T03 冻结。
- **产物：** 表单布局、模式和阶段导航、角度卡、大纲/正文展示、参考定位、证据/风格辅助栏、检查列表、操作栏、折叠报告、空态/失败态的纯展示组件；沿用暗色和亮绿，正文为视觉中心，1440/1024/390px 适配。
- **验证：** props 示例覆盖等待/流式/半稿/完成/需修改/失败/停止/旧设置等真实状态；无请求、业务 store、采用判断或交接代码；语义标签、键盘路径、焦点与减弱动效可用；操作栏不遮正文，窄屏无横向溢出。开发服务启动后的视觉检查由页面主责提供环境。
- **独立审查：** `omd-designer-review`，`omd-a11y-auditor`；`omd-critic` 只读核对展示边界。
- **验收映射：** A06、A07、A08、A14、A20、A25、A26、A29。

### T13 — 主页入口、草稿恢复与业务表单

- **主责 / 配置：** `omd-ux-engineer`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `app/viral/page.tsx`、`app/viral/[id]/page.tsx`、所需 `app/viral/layout.tsx`；`components/viral/**` 中输入/草稿业务容器及对应测试，排除 U、W 组；`components/home-composer.tsx`、`app/page.tsx`、`components/nav.tsx` 的复创最小接入；`tests/viral-ui/{entry,inputs,drafts}*.test.ts`。
- **前置依赖：** T04、T05、T06、T11、T12。
- **产物：** 首页「爆款复创」空/有文本进入、私有文本带入而不进 URL、不调用模型；首个有效编辑保存与稳定路由、最近草稿、新建与恢复；字段级校验、无平台预选、平台默认与用户设置区别、真实模型选择摘要和配置入口、风格快照选择、输入保存及旧设置提示。
- **验证：** 首页其他模式回归；Enter 换行与 ⌘/Ctrl+Enter 进入；超限完整保留；刷新恢复、空访问不建草稿；无模型保留输入；默认时长/画幅随平台变化而手动值保留；明确选模板才更新快照；任务仍运行时新建/恢复不会重新归属或停止原任务。
- **独立审查：** `omd-designer-review`，`omd-a11y-auditor`，`omd-critic`。
- **验收映射：** A01–A03、A07、A11、A13、A15、A25、A26、A30、A31。

### T14 — 快捷流程与原创工作台业务接线

- **主责 / 配置：** `omd-ux-engineer`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `app/viral/**`、`components/viral/**` 的流程、正文编辑、版本、检查和交接业务容器及对应测试，排除 U、W 组；`tests/viral-ui/{workflow,editor,versions,review,handoff}*.test.ts`；C 组共享文件若确需修订，先重新取得 C 组写锁并履行契约变更流程。
- **前置依赖：** T13、T07–T10；交接入口先按冻结协议接线，最终闭环等待 T15、T16。
- **产物：** 一次提交到成稿与检查、逐步真实正文、两模式同草稿/同任务、工作台分步操作；可编辑角度/路线/大纲、候选确认、历史稿/设置恢复、复制导出、停止续作、局部重写与校准；按状态与版本执行只读、失效、检查和采用权限，模式不改变运行计划。
- **验证：** 完整用户行为而非仅快照测试：切模式无新调用、浏览角度不调用、保存输入不自动生成、选角不覆盖、旧设置稿不能靠重新检查采用、任务期间标题/正文只读、停止保留半稿、人工改稿检查不覆盖；流式更新不抢编辑焦点或强制滚动；接线后执行浏览器视觉与 console 检查。
- **独立审查：** `omd-critic`，`omd-designer-review`，`omd-a11y-auditor`；`omd-persona-tester` 审双模式实际流程。
- **验收映射：** A04、A06–A14、A18、A20、A25–A27、A29、A30、A32。

### T15 — 首次采用、幂等创建与制作设置交接

- **主责 / 配置：** `omd-video-integrator`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `lib/server/viral/handoff.ts`、`app/api/viral/[id]/adopt/route.ts`、`tests/viral-handoff/adopt*.test.ts`、`tests/viral-handoff/settings*.test.ts`；`lib/server/projects.ts`、`app/api/projects/route.ts` 的交接最小接入。
- **前置依赖：** T03、T04、T05、T06、T09、T10；T14 可并行进行前端接线。
- **产物：** 先保存/必要检查再采用的服务端校验；完整正文和大纲快照、来源稿件版本及独立交接设置；并发安全幂等创建或复用关联项目；默认制作预设的音色/字幕/画面风格与本期画幅优先级；只改画幅显式更新原项目设置。
- **验证：** 真实事务/API 测试连续点击、并发请求、失败后重试只映射一个项目，保存或检查失败不跳转；同稿同设置复用、仅设置变化也复用原项目；默认预设为横屏时短口播仍用本期竖屏；采用后的项目正文与快照一致且不含参考/分析；运行任务、半稿、旧设置稿不能交接。
- **独立审查：** `omd-critic`；`omd-final-qa` 只读复核事务与失败证据。
- **验收映射：** A18、A21–A23、A25、A29–A31。

### T16 — 同步新版、保留原制作与双向来源入口

- **主责 / 配置：** `omd-video-integrator`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `lib/server/viral/handoff.ts`、`app/api/viral/[id]/sync/route.ts`、`tests/viral-handoff/sync*.test.ts`、`tests/viral-handoff/navigation*.test.ts`；`lib/server/{projects,versions}.ts`、`app/projects/[id]/video/page.tsx`、`components/video-studio.tsx` 的交接最小接入。
- **前置依赖：** T15；T14 提供冻结的同步选择和影响展示接口。
- **产物：** 依据制作侧正文与上一采用快照的差异识别人工作业；同步前展示断句/配音/分镜/成片影响、显式选择原项目同步或保留原制作新建；同步保留旧文案及成片版本、标记受影响产物待更新；采用从断句开始、不从标题再写稿、不自动开始渲染；制作页返回来源草稿。
- **验证：** 制作侧人工正文修改可发现而非仅看 revision；取消同步不覆盖项目；同步冲突与重复请求保持明确映射，失败不破坏旧版本；原项目更新不抹旧成片，新建路径保留原制作；后续制作仍由既有开工/成片操作触发；来回打开复用既有项目。
- **独立审查：** `omd-critic`，`omd-persona-tester`，`omd-final-qa`。
- **验收映射：** A21、A23、A24、A25、A31。

### T17 — 全流程、设计、无障碍与内容质量验收

- **主责 / 配置：** `omd-final-qa`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** 无；只读实施代码、既有测试与验证产物，返回报告给 `omd-orchestrator` 记录至 `docs/viral-recreation-status.md`。不编写测试、不修复；用户场景操作只针对原主责准备的隔离测试实例。
- **前置依赖：** T06–T16 的实现与原主责自测完成；主责提供隔离测试数据、可访问的应用/Worker 和命令回执。需要写入的样本环境由对应实施者准备。
- **产物：** A01–A32 逐项证据、通过/失败/阻塞/未执行状态，四平台与双模式场景结果、真实恢复/停止/失败/采用/同步链路，以及质量对比记录。测试替身只证明确定性规则；真实模型请求边界和实际输出需另有样本证据。
- **验证：** `omd-final-qa` 串联完整故事；`omd-designer-review` 检查视觉重心和响应式，`omd-a11y-auditor` 检查键盘/标签/焦点，`omd-microcopy` 检查可理解性与承诺，`omd-persona-tester` 检查真实用户选择和内容质量，`omd-critic` 检查事实隔离、版本一致与并发幂等。发现回对应 Txx 主责修复后，仅复验受影响行为和必要回归。
- **独立审查：** `omd-critic` 复核证据与未决风险；`omd-persona-tester` 复核端到端场景。两者与主责均保持只读。
- **验收映射：** A01–A32、人工质量对比；A28 的发布记录与最终命令/页面证据由 T18 补齐。

### T18 — 最终集成、重大功能记录与发布验收收口

- **主责 / 配置：** `omd-video-integrator`，`gpt-6.1-sol` / `ultra`。
- **允许写入：** `lib/changelog.ts`；确有集成缺陷时仅限 V 组的交接接入和 `tests/viral-handoff/**`。其他模块缺陷由原主责修复，最终集成者不取得全仓库写权限。
- **前置依赖：** T17 问题由原主责处理并复验；T01–T16 必要产物就绪。
- **产物：** 核对首页→复创→检查→采用/同步→断句制作闭环；在 `changelog` 数组最前面新增真实完成的重大功能记录，按当时最新版本使用下一语义化版本、实际日期、主题与摘要，按 `feature` / `improvement` / `fix` / `infra` 写用户影响；发布证据交协调者落档。
- **验证：** 运行相关行为测试和必要现有制作回归，执行 `npm run typecheck`、`npm run lint`；在真实应用确认 `/changelog` 正常渲染且记录只来自 `lib/changelog.ts`。未执行或失败项明确记载并回原主责处理，不能用本文宣称完成。
- **独立审查：** `omd-final-qa` 复核最终命令、页面和全流程证据；`omd-critic` 复核版本/交接与范围。
- **验收映射：** A21–A24、A28、A31；最终关闭 A01–A32 的实施验收记录。

## 4. 写锁与并行批次

协调者在 `docs/viral-recreation-status.md` 维护任务状态、当前写锁、契约版本、审查结论与验收证据。写锁按真实文件领取，同一 Agent 的多个任务也不同时修改同一文件；测试文件与源码锁一起领取。任务只在依赖就绪、允许路径清楚时派发。

| 批次 | 可派发任务 | 并行限制与放行条件 |
| --- | --- | --- |
| B0 | 固定配置校验、任务计划准备 | 当前所在批次；不派发应用实现任务 |
| B1 | T01 | 产品约束单独落档并经独立审查 |
| B2 | T02、T03 | 研究文档与契约可并行；T03 审查通过后冻结第一版契约 |
| B3 | T04 | `types/schemas/state/invalidation/duration` 按顺序单写；状态/失效与交接契约冻结后才放行消费方 |
| B4 | T05、T07、T11 | 后台持久化、内容拆解、文案并行；各持独立路径；T11 未定义业务状态 |
| B5 | T06、T08、T12 | T05/T07/T11 各自完成即按依赖进入；后台调度与内容阶段按冻结接口消费；纯展示与业务状态隔离 |
| B6 | T09、T13 | 内容生成和前端输入/恢复并行；T06 已具备真实保存与任务 API |
| B7 | T10 | 内容共享 `prompts.ts` 单写串行；后续可修订文案，但写 `copy.ts` 仍仅 T11 主责 |
| B8 | T14、T15 | 前端业务与服务端幂等交接并行，冻结协议；前端不写 adopt API，制作主责不写复创容器 |
| B9 | T16；T14 必要接线收口 | 交接 T15→T16 串行；跨复创页/制作页改动分别回 F/V 原主责 |
| B10 | T17 专项只读审查 | 只读审查可并行；修复领取原文件写锁，复验针对新提交 |
| B11 | T18 | 最终集成与 changelog 单写；最终 QA 核实实际执行证据 |

单个 Agent 的 T07→T08→T09→T10 顺序执行，`prompts.ts` 不发生并发改写；T05→T06、T13→T14、T15→T16 同样串行。批次表示依赖与隔离，不要求不同任务等待无关任务；依赖齐全且并发配额允许时可推进下一批次。

关键锁与契约变更规则：

1. **C 组写锁：** 始终只授予 `omd-ux-engineer`。T03→T04 完成及 `omd-critic` 审查通过后，将类型、校验、状态、失效、版本与 API/交接协议一起冻结。
2. **全局最小接入锁：** `lib/server/db.ts`、`migrations.ts`、`jobs.ts` 仅 B 组；`projects.ts`、`versions.ts`、`app/api/projects/route.ts` 仅 V 组。已有修改作为基线保留；两个主责不能通过迁移或接入任务互写对方文件。
3. **目录例外锁：** `handoff.ts`、`handoff.test.ts`、`adopt/**`、`sync/**` 永久排除后台写权限；`stages/**` 永久排除后台调度写权限。接口消费方先用已冻结接口，再由原主责解决缺口。
4. **前端锁：** F/U/W 单主责；展示 props 的契约修改回 `omd-ux-engineer`，字典修改回 `omd-ux-writer`，CSS 修改回 `omd-ui-junior`。不通过“顺手修一下”跨界。
5. **契约改动：** 使用者提交字段/行为/失败场景和受影响任务；协调者标记相关任务暂缓依赖，原主责持锁修改，独立审查通过后更新契约版本和消费方。不能私自 fork 另一套类型/状态或用类型断言绕过协议。
6. **审查与修复：** 审查者只返回任务编号、文件/位置、复现、影响、建议与复验条件。协调者交回原主责，修复后由原审查者复验；所有 reviewer 保持 read-only，不写实现、测试或报告文件。

## 5. A01–A32 完整覆盖与证据要求

每项验收必须记录运行环境、输入/前置状态、观察结果和可复核证据。下表是计划覆盖，全部状态初始为 **待执行**；不能以“相关模块已写好”代替行为证据。

| 验收 | 实施任务 / 主责 | 核心证据 | 独立验收 |
| --- | --- | --- | --- |
| A01 首页空/有文本入口 | T11 / writer；T13 / ux-engineer | 浏览器进入、完整私有文本带入、模型请求计数为零、其他模式回归 | final-qa、a11y-auditor |
| A02 必填与无效时长 | T03/T04/T13 / ux-engineer；T08 / content-engineer | 空白/未选平台/时间边界的校验测试与字段错误，输入保留 | final-qa、microcopy |
| A03 超长参考与素材 | T03/T13 / ux-engineer；T05 / backend-engineer | 上限边界与完整超限文本保留、请求不处理部分文本 | final-qa |
| A04 一次快捷到一篇稿 | T06 / backend-engineer；T08–T10 / content-engineer；T14 / ux-engineer | 一次启动的同一任务、真实阶段与唯一全文、无逐步强制确认 | final-qa、persona-tester |
| A05 具体事实与风格样本隔离 | T07/T08/T09/T10 / content-engineer | 无素材/第一人称/数字/证言样本，实际请求与输出追溯 | critic、persona-tester |
| A06 正文优先结果 | T11 / writer；T12 / ui-junior；T14 / ux-engineer | 桌面/窄屏正文、标题/字数/估算时长、默认折叠报告、编辑/采用状态 | designer-review、final-qa |
| A07 仅参考先拆解 | T07/T08 / content-engineer；T13/T14 / ux-engineer | 工作台仅参考拆解成功、角度前缺项提示 | final-qa、persona-tester |
| A08 三角度实质差异 | T08 / content-engineer；T12 / ui-junior；T14 / ux-engineer | 三项问题/路线/展开差异及依据可见，T02 评估表 | persona-tester、critic |
| A09 编辑角度/路线/大纲成稿 | T05 / backend-engineer；T08/T09 / content-engineer；T14 / ux-engineer | 实际生成请求使用编辑后的结构、旧稿恢复、正文可朗读 | final-qa、persona-tester |
| A10 模式切换不变任务 | T04/T14 / ux-engineer；T06 / backend-engineer | 同一任务 ID/计划/产物，切模式新增请求为零 | final-qa、critic |
| A11 改输入仅保存 | T04/T13/T14 / ux-engineer；T05/T06 / backend-engineer | 旧设置标记、产物/选择保留、保存不生成 | final-qa、critic |
| A12 换风格只更新相应阶段 | T04/T14 / ux-engineer；T08/T09/T10 / content-engineer | 分析/角度保留、新语言规则正文、检查版本变更 | critic、final-qa |
| A13 刷新/离开恢复 | T05/T06 / backend-engineer；T13/T14 / ux-engineer | 同一持久任务与阶段、恢复不重复调用，页面离开继续 | final-qa、critic |
| A14 失败/停止续作 | T06 / backend-engineer；T09 / content-engineer；T14 / ux-engineer | 完成段保留、只补缺失、半稿不可采用、迟到结果隔离 | final-qa、critic |
| A15 模板更新不改快照 | T03/T04/T13 / ux-engineer；T05 / backend-engineer；T08 / content-engineer | 模板外部更新前后本期快照一致，显式选择才更新 | critic、final-qa |
| A16 参考未入生成请求 | T03 / ux-engineer；T07–T10 / content-engineer | 分析/比对与角度/正文/修订请求分别捕获，后者不含全文/独特表达 | critic |
| A17 公共事实与独特表达区分 | T07/T10 / content-engineer；T11 / writer | 正/反样本具体片段与理由、纯相似分不阻断、无指标保证 | critic、persona-tester、microcopy |
| A18 人工改稿检查后交接 | T04/T14 / ux-engineer；T10 / content-engineer；T15 / video-integrator | 新正文版本对应报告、保存/检查先完成、手写文字不被自动覆盖 | critic、final-qa |
| A19 四平台差异 | T08/T09 / content-engineer | 同主题四平台真实样本，深度/节奏/结尾与时长对应 | persona-tester |
| A20 ±15% 时长校准 | T04/T14 / ux-engineer；T09 / content-engineer；T11 / writer | 正负阈值、比较/恢复、重检，预计值与实配音标签区分 | final-qa、persona-tester |
| A21 采用并发与失败幂等 | T05 / backend-engineer；T15/T16 / video-integrator | 并发/重复点击/失败重试的事务与 API 测试、唯一映射、失败不跳转 | critic、final-qa |
| A22 本期画幅优先 | T15 / video-integrator | 横屏预设+短平台采用后的竖屏输出，同时保留默认音色/字幕 | final-qa |
| A23 从已采用正文断句 | T15/T16 / video-integrator | 已采用正文与制作输入一致、第一阶段断句、不调用标题写稿、不读分析 | final-qa、persona-tester |
| A24 制作人工编辑与新版同步 | T14 / ux-engineer；T16 / video-integrator | 正文差异判定、影响预览、取消不覆盖、两种明确选择、旧成片保留 | critic、persona-tester、final-qa |
| A25 模型/保存/检查失败 | T06 / backend-engineer；T10 / content-engineer；T11 / writer；T13/T14 / ux-engineer；T15/T16 / video-integrator | 每类失败注入、已有输入/产物保留、就近恢复、模型配置入口 | final-qa、microcopy |
| A26 三尺寸与纯键盘 | T11 / writer；T12 / ui-junior；T13/T14 / ux-engineer | 1440/1024/390px 截图、键盘流程、标签/焦点、流式不抢焦点 | designer-review、a11y-auditor |
| A27 当前稿复制/导出 | T09 / content-engineer；T14 / ux-engineer | 选定版本标题与正文、无报告/标记/占位，浏览器复制与下载 | final-qa |
| A28 行为测试与更新记录 | T17 / final-qa；T18 / video-integrator | 相关测试、typecheck/lint 实际回执、首条 changelog 及 `/changelog` 渲染 | final-qa、critic |
| A29 写入任务期间只读互斥 | T04/T14 / ux-engineer；T06 / backend-engineer；T10 / content-engineer；T15 / video-integrator | UI 与 API 同时禁止写/重写/重检/采用，查看/复制/停止可用 | critic、final-qa |
| A30 重检不抹旧设置 | T04/T14 / ux-engineer；T06 / backend-engineer；T10 / content-engineer；T15 / video-integrator | 换主题/角度再只检查仍过期，更新阶段或恢复输入后才可采用 | critic、final-qa |
| A31 默认/手动与设置独立交接 | T04/T13 / ux-engineer；T15/T16 / video-integrator | 抖音→B站默认跟随、手动值保留、摘要准确、仅画幅不重写/不重复建项 | critic、final-qa |
| A32 自动修订与人工文字保护 | T04/T14 / ux-engineer；T09/T10 / content-engineer | 一次自动修订后再检仍阻断则停；任意人工编辑后检查不自动替换 | critic、persona-tester、final-qa |

实施收口以真实行为和质量证据为准。确定性测试由各模块原主责在任务中编写，审查 Agent 不写代码；内容质量还必须记录人工对照样本。重大功能更新记录只在 T18 确认首版已完成后添加，当前准备轮不新增发布记录、不将待执行验收标为通过。
