# 爆款复创文案契约（T11）

集中式字典位于 `components/viral/copy.ts`，导出 `viralCopy` 和 `viralReferenceCount(count)`。主责 `omd-ux-writer`，模型 `gpt-6.1-sol`，推理强度 `high`。本任务仅修改字典和本文；使用条件、状态判断、按钮权限和请求处理由对应业务 Agent 负责。

## 消费约定

展示组件导入 `viralCopy`，业务容器可导入阶段、任务与采用标签。字典不决定显示哪个状态；使用条件来自真实草稿、任务、当前版本和制作影响。平台名称沿用 `VIRAL_PLATFORM_LABELS`，不要另建重复定义。

优先接入下列高影响文案；普通段落可继续保持就近表达，无需把每个自然段拆成零散字符串。

| 位置或条件 | 字典键 | 行为依据 |
| --- | --- | --- |
| 首页爆款复创入口 | `entry.title/placeholder/enter` | 仅带入文本并进入独立页面，不启动模型任务 |
| 参考字段帮助 | `fields.referenceHint`、`viralReferenceCount` | 参考事实不会自动转成本期素材；超限保留输入 |
| 来源备注 | `fields.referenceSourceHint` | 首版不抓取链接 |
| 素材与第一人称 | `fields.materialsHint/firstPersonHint` | 具体数字、亲历和证言必须有本期材料；第一人称观点正常表达 |
| 显式虚构故事 | `fields.story` | `contentKind=story`，不能伪装成真实个人经历 |
| 无可用文字模型 | `model.unavailable/configure/href` | 实际路由为 `/settings/providers`；输入仍在当前草稿 |
| 风格管理 | `model.manageStyle/styleHref` | 实际入口为 `/templates`；本期继续使用快照 |
| 保存失败 | `save.failedHint/retry` | 当前浏览器仍保留编辑，不宣称已持久保存 |
| 修订冲突 | `save.conflictHint/reload` | 本地待保存改动保留；读取远端后需要核对，不描述成放弃本地编辑 |
| 任务失败或停止 | `task.recoveryHint/resume` | 保留阶段与半稿；输入变更后从受影响阶段更新 |
| 任务处理中 | `task.lockedHint` | 标题、正文与相关输入只读，仍允许查看、复制和停止 |
| 半稿 | `script.incomplete/incompleteHint` | 可查看与复制，不能进入制作 |
| 上游设置改变 | `script.stale/staleHint/restore` | 保存不会自动生成；重新检查不能解除主题、角度等造成的正文过期 |
| 稿件长度与时长 | `script.estimateHint/calibrationHint/calibrate` | 字数和语速估算；超过目标 ±15% 给校准入口，不宣称精确配音时长 |
| 局部重写候选 | `script.candidateTitle/candidateHint/adoptCandidate` | 用户明确采用后才更新正文；人工修改稿不被自动检查覆盖 |
| 当前角度初次成稿 | `angles.generateScript` | 尚无正文时显示“按此角度成稿”；有旧稿才使用 `regenerateScript` |
| 检查问题等级 | `review.blocker/judgment/suggestion` | 与实际 blocker/judgment/suggestion 对应；评分不能代替具体问题证据 |
| 检查完成且无列出问题 | `review.noIssues/boundaryHint` | 不宣称“全部事实正确”“绝对原创”或“保证不侵权” |
| 检查或交接失败 | `review.failedHint`、`adoption.failedHint` | 保留当前正文，不提前跳转；按失败步骤重试 |
| 采用入口 | `adoption.use/checkFirst/open/updateSettings/sync` | 业务容器依据当前版本、检查和关联制作计算标签 |
| 同步原项目 | `sync.impactHint/replace` | 替换正文并使受影响制作内容需更新；保留旧版和旧成片；不会自动渲染 |
| 制作侧已编辑正文 | `sync.productionEdited` | 明确提醒替换会覆盖制作侧正文修改 |
| 保留原制作 | `sync.newProject` | 新建项目，原制作正文与成果保留 |

## 文案边界

拆解明确区分“文本观察”和“作用假设”。只依据纯文本不能证明实际流量原因、观看留存、画面或配乐；不展示爆款概率或原创百分比。独特表达提示用于了解与回避，不作为生成模板。

“已保存”仅在成功持久化后展示。`save.idle` 为“有改动待保存”，完全空白且未建草稿的访问应显示“尚未保存”或隐藏状态，不能让空白页面误示存在改动。失败提示只承诺本页内容仍在，不以浏览器缓存承诺关闭或跨设备后一定恢复。

主操作按真实后果命名。“检查并进入视频制作”意味着检查成功、必要问题已处理、交接成功才进入制作；“同步新版文案”先展示影响，不直接覆盖旧制作。切换模式和浏览候选不触发模型请求。

## 验证与移交

已静态核对：规格第 4–9 节、当前展示与业务容器、`draft-client.ts` 的失败保存与 reload 行为、`handoff.ts` 的制作替换与版本保留逻辑、现有模型中心及风格路由。字典没有加入业务判断或权限代码。

由 U/F 主责完成接入并核对实际分支；高影响文案交 `omd-microcopy` 和对应实现领域独立审查。最终以浏览器检查保存失败、旧设置、半稿、人工候选、无模型入口和同步影响为准；本任务未声称完成这些浏览器验证。
