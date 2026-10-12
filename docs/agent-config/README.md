# Sol 6.1 自定义 Agent 配置

日期：2026-10-11。适用项目：`/Users/huazi/Desktop/DO-Vedio`。本次交付只包含配置和实施任务规划，爆款复创尚未实现。

## 配置落点

- 可审阅、可版本管理的完整 Agent 源文件：[`agents/`](agents/)。
- 已安装位置：`/Users/huazi/.codex/agents/*.toml` 和 `/Users/huazi/.codex/config.toml`。原仓库没有 `.codex/` 配置；本次替换已有全局配置，避免同时维护两套同名角色。**2026-10-11 用户在终端安装成功，实际主配置、19 个 Agent 文件与备份已核对。** 新会话加载新配置，已有运行中的 Agent 不保证热切换。
- [`config.policy.toml`](config.policy.toml) 只列出全局主模型和子 Agent 默认值。它是合并片段，不是用来覆盖整个全局配置的文件。现有自定义 provider、模型目录、插件、MCP 和项目设置保留。完整全局配置与备份可能包含连接资料，因此不复制进仓库。
- [`roles.json`](roles.json) 是供人或校验脚本读取的角色索引，`excluded_files` 优先于 `allowed_files`，不是 Codex 配置字段或权限插件。
- 产品规格：[`../viral-recreation-spec.md`](../viral-recreation-spec.md)；每项实施任务：[`../viral-recreation-tasks.md`](../viral-recreation-tasks.md)。

## 固定模型与强度

主模型与每个自定义 Agent 均固定为 `gpt-6.1-sol`。主线程 `ultra`；关键实现和所有独立审查 `ultra`；纯展示、文案创作、资料和资产任务 `high`。默认未指名子 Agent 同样使用 Sol 6.1 / ultra，禁止自动转向低级模型。

`max_concurrent_threads_per_session = 3` 不包含主线程，形成最多一个主线程加三个子线程。并发容量不代表同一文件可以同时写入。角色模型和推理强度写在各 TOML 内，派发时直接选配置角色，不再临时判断模型。

这些设置只控制编码 Agent；应用内的「文字模型」仍是产品现有用户配置，本轮不修改它。模型目录已确认 high/ultra 是本地支持的档位；未为验证配置发送付费模型请求。

| 自定义 Agent | 模型 | 推理 | 沙箱 | 固定职责 |
| --- | --- | --- | --- | --- |
| [`omd-orchestrator`](agents/omd-orchestrator.toml) | `gpt-6.1-sol` | `ultra` | `workspace-write` | 任务编排与交付负责人；按固定角色分配任务、维护依赖、写锁和验收记录。 |
| [`omd-master`](agents/omd-master.toml) | `gpt-6.1-sol` | `ultra` | `workspace-write` | 产品与设计决策负责人；冻结首版范围、默认规则与可观察的完成条件。 |
| [`omd-ux-engineer`](agents/omd-ux-engineer.toml) | `gpt-6.1-sol` | `ultra` | `workspace-write` | 架构契约、前端业务交互与版本状态负责人；处理草稿、过期状态、锁定和跨模式一致性。 |
| [`omd-backend-engineer`](agents/omd-backend-engineer.toml) | `gpt-6.1-sol` | `ultra` | `workspace-write` | 持久化、任务执行与 API 负责人；处理输入快照、续作、取消和过期写入。 |
| [`omd-content-engineer`](agents/omd-content-engineer.toml) | `gpt-6.1-sol` | `ultra` | `workspace-write` | 内容引擎与事实、原创检查负责人；实现参考隔离、新角度、风格与最终稿检查。 |
| [`omd-video-integrator`](agents/omd-video-integrator.toml) | `gpt-6.1-sol` | `ultra` | `workspace-write` | 视频交接与最终集成负责人；处理幂等采用、已有制作冲突和非破坏性同步。 |
| [`omd-ui-junior`](agents/omd-ui-junior.toml) | `gpt-6.1-sol` | `high` | `workspace-write` | 保留历史名称的纯展示组件 Agent；已升级 Sol 6.1，不承担关键逻辑。 |
| [`omd-ux-writer`](agents/omd-ux-writer.toml) | `gpt-6.1-sol` | `high` | `workspace-write` | 界面文案负责人；明确输入、阶段、问题与可恢复操作。 |
| [`omd-microcopy`](agents/omd-microcopy.toml) | `gpt-6.1-sol` | `ultra` | `read-only` | 独立微文案审查员；核对按钮、错误和高影响提示与实际行为一致。 |
| [`omd-critic`](agents/omd-critic.toml) | `gpt-6.1-sol` | `ultra` | `read-only` | 独立高风险审查员；审查契约、事实隔离、并发版本、持久化和幂等交接。 |
| [`omd-final-qa`](agents/omd-final-qa.toml) | `gpt-6.1-sol` | `ultra` | `read-only` | 独立终验 Agent；按 A01–A32 及真实制作闭环提供证据和未覆盖项。 |
| [`omd-designer-review`](agents/omd-designer-review.toml) | `gpt-6.1-sol` | `ultra` | `read-only` | 独立视觉与交互审查员；核对结果优先布局、模式一致性与响应式状态。 |
| [`omd-a11y-auditor`](agents/omd-a11y-auditor.toml) | `gpt-6.1-sol` | `ultra` | `read-only` | 独立无障碍审查员；验证标签、键盘、焦点、状态播报和可达性。 |
| [`omd-persona-tester`](agents/omd-persona-tester.toml) | `gpt-6.1-sol` | `ultra` | `read-only` | 独立用户场景测试员；测试快捷低介入和工作台可控编辑的完整旅程。 |
| [`omd-ux-researcher`](agents/omd-ux-researcher.toml) | `gpt-6.1-sol` | `high` | `workspace-write` | 产品与使用证据研究员；补充资料、区分观察与假设，不决定高风险实现。 |
| [`omd-asset-curator`](agents/omd-asset-curator.toml) | `gpt-6.1-sol` | `high` | `workspace-write` | 资源整理与资产 Agent；选择适合现有设计体系的图标和辅助素材。 |
| [`omd-codex-image`](agents/omd-codex-image.toml) | `gpt-6.1-sol` | `high` | `workspace-write` | 图像需求与资产交付 Agent；将已授权画面要求整理为可审阅资产。 |
| [`omd-kr-writer`](agents/omd-kr-writer.toml) | `gpt-6.1-sol` | `high` | `workspace-write` | 韩语内容作者；基于明确任务和真实资料调整语气与长文表达。 |
| [`omd-locale-adapter`](agents/omd-locale-adapter.toml) | `gpt-6.1-sol` | `high` | `workspace-write` | 本地化作者；在指定语言与地区适配内容，保留事实和功能语义。 |

`omd-ui-junior` 名称保留以兼容已有用法，实际已升级为 Sol 6.1 / high；只能做纯展示。`omd-kr-writer`、`omd-locale-adapter`、资源与图像角色保留，但首版任务不强制调用。

## 写入范围与单写者

以下是各角色的最大修改范围。每个实际任务再收窄，任务范围必须是角色范围的子集；没有写入范围的审查员通过回复输出报告。相对路径以项目根目录为准，`[id]` 是真实 Next.js 动态目录名，不能用普通 glob 字符类误匹配。

**路径清单属于角色协作指令，不能宣称操作系统强制逐路径隔离。** `sandbox_mode = "read-only"` 提供实际只读边界；`workspace-write` 允许工作区写入，但 Agent 仍必须遵守本角色清单。CLI/主线程的显式模型覆盖仍可能覆盖配置，任务协调者禁止绕过这些固定值。

| Agent | 最大允许修改范围 |
| --- | --- |
| `omd-orchestrator` | `docs/viral-recreation-tasks.md`<br>`docs/viral-recreation-status.md` |
| `omd-master` | `docs/viral-recreation-spec.md`<br>`docs/viral-recreation-decisions.md` |
| `omd-ux-engineer` | `docs/viral-architecture.md`<br>`lib/viral/types.ts`<br>`lib/viral/types.test.ts`<br>`lib/viral/schemas.ts`<br>`lib/viral/schemas.test.ts`<br>`lib/viral/state.ts`<br>`lib/viral/state.test.ts`<br>`lib/viral/invalidation.ts`<br>`lib/viral/invalidation.test.ts`<br>`lib/viral/duration.ts`<br>`lib/viral/duration.test.ts`<br>`app/viral/**`<br>`components/viral/**`<br>`components/home-composer.tsx`<br>`app/page.tsx`<br>`components/nav.tsx`<br>`tests/viral-ui/**` |
| `omd-backend-engineer` | `lib/server/viral/**`<br>`lib/pipeline/viral/**`<br>`app/api/viral/**`<br>`lib/server/db.ts`<br>`lib/server/db.test.ts`<br>`lib/server/migrations.ts`<br>`lib/server/migrations.test.ts`<br>`lib/server/jobs.ts`<br>`lib/server/jobs.test.ts`<br>`tests/viral-persistence/**`<br>`tests/viral-jobs/**` |
| `omd-content-engineer` | `lib/viral/analysis.ts`<br>`lib/viral/analysis.test.ts`<br>`lib/viral/angles.ts`<br>`lib/viral/angles.test.ts`<br>`lib/viral/evidence.ts`<br>`lib/viral/evidence.test.ts`<br>`lib/viral/generation.ts`<br>`lib/viral/generation.test.ts`<br>`lib/viral/review.ts`<br>`lib/viral/review.test.ts`<br>`lib/viral/style.ts`<br>`lib/viral/style.test.ts`<br>`lib/viral/prompts.ts`<br>`lib/viral/prompts.test.ts`<br>`lib/viral/export.ts`<br>`lib/viral/export.test.ts`<br>`lib/pipeline/viral/stages/**`<br>`tests/viral-content/**` |
| `omd-video-integrator` | `lib/server/viral/handoff.ts`<br>`lib/server/viral/handoff.test.ts`<br>`app/api/viral/[id]/adopt/route.ts`<br>`app/api/viral/[id]/sync/route.ts`<br>`lib/server/projects.ts`<br>`lib/server/versions.ts`<br>`app/api/projects/route.ts`<br>`app/api/projects/route.test.ts`<br>`app/projects/[id]/video/page.tsx`<br>`components/video-studio.tsx`<br>`tests/viral-handoff/**`<br>`lib/changelog.ts` |
| `omd-ui-junior` | `components/viral/presentational/**`<br>`app/viral/viral.module.css`<br>`docs/viral-wireframes.md` |
| `omd-ux-writer` | `components/viral/copy.ts`<br>`docs/viral-copy.md` |
| `omd-microcopy` | **无：代码、文档和配置只读。** |
| `omd-critic` | **无：代码、文档和配置只读。** |
| `omd-final-qa` | **无：代码、文档和配置只读。** |
| `omd-designer-review` | **无：代码、文档和配置只读。** |
| `omd-a11y-auditor` | **无：代码、文档和配置只读。** |
| `omd-persona-tester` | **无：代码、文档和配置只读。** |
| `omd-ux-researcher` | `docs/viral-research.md`<br>`docs/viral-quality-protocol.md` |
| `omd-asset-curator` | `public/viral/**`<br>`docs/viral-assets.md` |
| `omd-codex-image` | `public/viral/generated/**`<br>`docs/viral-image-brief.md` |
| `omd-kr-writer` | `docs/locales/ko/**` |
| `omd-locale-adapter` | `docs/locales/en/**`<br>`docs/locales/ja/**`<br>`docs/locales/zh-TW/**` |

宽泛路径的例外优先：

- `components/viral/presentational/**` 与 `app/viral/viral.module.css` 由 `omd-ui-junior` 主责；`components/viral/copy.ts` 由 `omd-ux-writer` 主责。UX 业务层可导入，不并发修改；确需改动时由协调者移交单写锁。
- `public/viral/generated/**` 由图像角色主责，从资源整理角色的通配范围中排除。
- `lib/pipeline/viral/stages/**` 由 `omd-content-engineer` 主责，后端调度角色不得修改。
- `lib/server/viral/handoff.ts`、`handoff.test.ts` 和 `app/api/viral/[id]/{adopt,sync}/route.ts` 由 `omd-video-integrator` 主责，从后端通配范围中排除。
- `lib/viral/{types,schemas,state,invalidation,duration}.ts` 及其测试只有 `omd-ux-engineer` 写入；契约冻结后内容、后端与交接角色通过导入使用。
- `lib/server/{db,migrations,jobs}.ts` 仅由后端作必要接入；`lib/server/{projects,versions}.ts` 与制作侧接入文件仅由视频交接角色作必要修改。已有用户改动必须保留。
- 全局/项目 `.codex`、凭据与 provider 不属于应用实现角色的写入范围。用户本轮授权的配置维护由主线程执行。其他项目需要明确根目录与文件范围，不自动套用 DO-Vedio 路径。

## 审查与任务派发规则

任何涉及生成上下文、事实来源、版本失效、人工编辑保护、持久化续作、事务或制作交接的逻辑，只派给 ultra 实现角色，并由 `omd-critic` 独立审查。界面和文案角色不得代为完成。所有审查员是 Sol 6.1 / ultra / read-only；审查发现交还原实现负责人，不让审查员写修复。

只读 QA 不能用脚本、浏览器或申请放宽沙箱来改文件。需要写缓存/截图的测试由实现负责人执行，再交原始证据给 QA 复核；测试环境操作只使用隔离数据。未执行验收标记为未执行，不将规划写成上线记录。

推荐任务委派格式：

```text
交给自定义 Agent：omd-backend-engineer
配置：gpt-6.1-sol / ultra / workspace-write（直接使用角色配置，不覆盖）
任务：T06；本次只修改任务内列出的具体文件
输入：冻结契约 + 当前输入/状态规则
验收：对应 A 编号 + 实际验证证据
独立审查：omd-critic
```

## 兼容与验证

依据 [official OpenAI documentation：Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)，Agent 文件使用顶层 `name`、`description`、`developer_instructions`，以及 `model`、`model_reasoning_effort`、`sandbox_mode`；不使用旧 `[agent]`、`instructions`、`allowed_tools` 或虚构 `allowed_paths`。

本地 CLI 为 `0.155.1`；实际诊断证实旧 16 个 `[agent]` 文件因 `unknown field agent` 被忽略。配置源包需验证 TOML 解析、19 个角色名称唯一、全部模型为 Sol 6.1、六个只读审查角色均为 ultra、所有任务的主责/范围/强度与配置一致，以及 A01–A32 全覆盖。

全局全量 `--strict-config` 检查目前受原有 `disable_response_storage` 字段阻挡（CLI 报 unknown configuration field）。本轮保留该无关原设置，不把它删除以制造全量通过，也不声称远端 provider 已实测。主模型、Agent 策略和新文件单独校验。

## 安装与恢复

可审阅的安装脚本是 [`install.py`](install.py)。它默认只检查；使用 `--apply` 才会备份并安装。安装命令：

```sh
python3 /Users/huazi/Desktop/DO-Vedio/docs/agent-config/install.py --apply
```

只检查配置包与合并结果（不写全局文件）：

```sh
python3 /Users/huazi/Desktop/DO-Vedio/docs/agent-config/install.py --check
```

替换前备份现有主配置与全部 16 个 Agent 文件；新增三名角色，不删除其他设置。安装核对准备时的原文件摘要，发现配置被其他进程改动则停止，不覆盖新变化。配置主文件最后替换；若发生写入失败，恢复本轮已写文件。

成功后脚本返回 `installed: true` 和实际备份目录 `~/.codex/backups/sol61-agents-<时间>/`，完整配置内容不会打印。恢复时按备份 `manifest.json` 的原文件清单还原；新增角色单独列在 `new_paths`，仅在恢复本次安装时移除，不删除其他 Agent。

不要把 `config.policy.toml` 整个复制到 `~/.codex/config.toml`；只合并其中两项主模型策略与 `[agents]`。重新打开 Codex 或开启新会话后核对角色目录，已有运行中的 Agent 不保证热切换。若以后重新运行旧 OMD 安装器，可能覆盖这些手工更新的角色，应重新检查并从此源包恢复。
