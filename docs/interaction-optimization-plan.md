# 视频制作模块交互优化：落地方案

> 状态：P0/P1/P2 已落地并通过检查；P3 待后续收口
>
> 日期：2026-09-30 ｜ **修订：2026-09-30（rev.2，评审后）**

当前落地范围已经覆盖本方案的 P0、P1、P2：成本提示和重试规则统一，重录与重生图保留回退路径，音色撤回会自动补齐缺失旧配音；配音批次、段落任务、镜头状态、渲染 ETA 和顶栏状态均已接入同一套任务口径。此次收口额外兼容了旧项目只有 `assetId`、没有 `candidates` 的镜头数据，重新生图后仍可切回原素材。P3 的刷新节流和按阶段分流仍是后续性能专项，不影响 P1/P2 的功能闭环。
>
> 目标：**操作极其高效流畅** —— 用统一的交互契约替代现在各面板各自为政的判断，
> 做到「便宜/可撤销的不打断，昂贵/不可逆的才打断，凡会产生任务的操作都能一键回退，
> 凡超过几秒的流程都有真实进度和停止入口」。
>
> **rev.2 改了什么**（评审发现的错误，逐条修正，未改动其余结论）：
> 1. §1.2 阈值 `minUnits: 8` → **12**：原值与同节表格、验收断言自相矛盾（8 句会命中 `>=8` 被误拦）。
> 2. §1.2 澄清「标签」与「弹窗」不是二选一：**标签永远都要有**，阈值只决定弹不弹。
> 3. §P2-4 渲染 ETA 换掉 `updatedAt` 基准（心跳每 10 秒刷新它，算出的 ETA 恒偏短且来回跳），
>    改为新增 `jobs.started_at`。
> 4. §P1-1 修正根因范围（改文案后重录本来就可撤销，只有同 key 才覆盖），
>    并修正一处符号名误判（曾误称 `commitCache` 不存在，实际定义在 `tts-common.ts:65`，是归档钩子的正确挂载点）。
> 5. §P1-2 措辞降级（旧图没丢，只是没有回头路）。
> 6. §1.4 补 `SentencePanel.error` 的分状态清理规则，防止把新增的成本提示一起清掉。
> 7. §0 / §2 把 P3-0、P2-0 提为「不排期、立刻做」。
> 8. §8 补 `npm run build`、`npm run smoke` 与 `/changelog` 渲染验收。
> 9. §P0-1 补段落模式金额会低估的说明。
>
> **上一轮评审结论的自我更正**：原文曾称「应用配音设置重复确认（问了两次）」——**不成立**，
> §2 末的「复核修正」已更正：`quote` 只用于拼文案，`confirm` 只有一次。
> 它真正缺的是按钮上的成本前置（P0-3），**不应删弹窗**。

---

## 0. 结论先行

后端编排（对账式 `produce`、按 key 的缓存与任务去重、换音色的草稿式切换）已经很扎实，
**不需要重构**。问题集中在交互层，而且只有三类：

| 类别 | 具体表现 | 归属 |
|---|---|---|
| **成本没有前置** | 最常花钱的入口（单句重录、单镜重生图、各处「重试」）按钮上既没有数量也没有金额；而低频批量操作每次都弹窗 | P0 |
| **不可逆 vs 可恢复的判断不一致** | 同类操作有的能撤回（换音色）、有的直接覆盖（重录/重生图），导致前者可以不弹窗、后者却只能靠弹窗兜底 | P1 |
| **进度/中断没有配对** | 文案、生图、成片都有流式进度和停止入口；配音批次提交后界面回到静止，且没有任何停止入口 | P2 |

外加两个必须修的正确性问题：

- **P3-0（严重）**：`components/video-studio.tsx:104` 的 `useEffect` 依赖整个 `store.doc`，
  本地每次改动都会触发一次 `refresh()`（4 个接口 + 播放器 seek）。在 `AutoTextarea` 里**每敲一个字就刷一次全页面**。
- **P2-1（严重）**：段落配音模式下，`plan.currentKeys` 推的是「成员句 key」，而任务 key 是「块 key」
  （`lib/pipeline/plan.ts:160` vs `lib/pipeline/tts-jobs.ts:26`），两者不匹配 →
  `JobStrip` 的配音格显示 0 个任务、没有进度、没有取消，且 `running` 判定不含配音（主按钮不禁用、「停止」不出现）。

### 分期总览

| 阶段 | 主题 | 产物 | 预估 |
|---|---|---|---|
| **P0** | 成本前置与后门修补 | 数量/金额标签统一、重试走同一规则、Worker 横幅改人话 | 1.5 人日 |
| **P1** | 让「可撤销」代替「弹窗」 | 重录可撤销、生图不丢旧图、撤回音色永远成功 | 3 人日 |
| **P2** | 进度、中断、状态可见 | 配音批次进度+停止、镜头任务服务端裁决、渲染 ETA、顶栏常驻状态区 | 4.5 人日 |
| **P3** | 性能与契约收口 | 刷新风暴治理、`refresh` 按来源拆分并节流 | 1.5 人日 |

**两个例外：不排期，立刻做。** 它们各自独立、不依赖上面任何一项，且是纯修复：

- **P3-0（刷新风暴）**：唯一直接决定「输入是否发涩、预览是否跳帧」的一项。
  它排在 P3 只是因为写在了第 6 节，**不代表优先级低**——它是全局体感最强的单点问题，建议今天就修。
- **P2-0（`currentKeys` 漏块键）**：正确性问题，会造成「主按钮不禁用、停止按钮不出现」。
  它不需要 UI 工作，一个函数调用 + 一个单测即可，不该等 P1 的 3 人日。

其余 P0 → P1 → P2 串行（有依赖）。

---

## 1. 交互契约（所有此后改动的唯一裁决依据）

### 1.1 决策矩阵

> **打断成本 < 返工代价 × 不可逆程度，才值得弹窗。**

| 可逆性 | 单次代价 | 处理方式 | 例子 |
|---|---|---|---|
| 可撤销 / 便宜 | 任意 | **不打断**：直接做 + 轻提示 + 通知里带「撤销」 | 单句重录（P1 后）、拆分/合并、改描述 |
| 昂贵但**可撤回** | 大 | **不打断**，成本前置到按钮，执行后一键回退 | 应用配音设置（已有草稿式语义 ✅） |
| 昂贵且不可逆 | 大 | **二次确认**，文案必须写清「花多少 / 影响几步 / 能不能退」 | 全部重录、全量生图、停止制作 |
| 破坏性且不可逆 | 任意 | **二次确认 + 危险态** | 重新生成全文/大纲、关闭 AI 标识 |

### 1.2 「该不该弹窗」的可执行阈值

避免再靠人感觉拍板，固化到一个纯函数模块 `lib/core/interaction.ts`（前后端共用、有单测）：

> **先分清两件事**：**标签永远都要有**（按钮上的「几句 · 约多少钱」），
> **弹窗才是有条件附加的**。两者不是二选一——弹窗了也照样要有标签。
> 下面这条阈值只决定「要不要弹窗」，不决定「要不要显示标签」。

```ts
export const CONFIRM_POLICY = {
  /** 贵到这个金额就值得问一句（元） */
  minCostYuan: 0.5,
  /**
   * 或者动到这么多付费单元（句 / 张）就值得问一句。
   * 语义是「值得打断的规模」，**不是**「一个段落的上限」——这两者容易混。
   * 一个满段落（8 句）必须落在阈值下方，否则最高频的「重录本段」会被误拦。
   * 故取 12（一个半段落），让 8 句落在下方、40 句落在上方。
   */
  minUnits: 12,
  /** 低于这个值不显示金额，只显示「不足 ¥0.01」 */
  readableCostYuan: 0.01,
};

export const needsConfirm = (u: { units: number; costYuan: number | null }) =>
  u.units >= CONFIRM_POLICY.minUnits || (u.costYuan ?? 0) >= CONFIRM_POLICY.minCostYuan;

export const costLabel = (costYuan: number | null) =>
  costYuan == null ? "" : costYuan >= CONFIRM_POLICY.readableCostYuan ? `约 ¥${costYuan.toFixed(2)}` : "不足 ¥0.01";

/** 按钮上的统一后缀：优先数量，金额只在可估且有意义时出现 */
export const costSuffix = (u: { units: number; unit: string; costYuan: number | null }) => {
  const cost = costLabel(u.costYuan);
  return [`${u.units} ${u.unit}`, cost].filter(Boolean).join(" · ");
};
```

代入真实单价（ `config/pricing.json`：CosyVoice ¥1/万字）后的落点：

| 操作 | units | 预估金额 | 结论 |
|---|---|---|---|
| 单句重录（20 字 ≈ 40 计费字符） | 1 句 | ¥0.004 | **不弹窗**，按钮显示「重录 · 1 句」 |
| 重录本段（8 句） | 8 句 | ¥0.03 | **不弹窗**（8 < 12，靠组头常显「8 句 · 约 ¥0.03」传达代价） |
| 全部重录（40 句） | 40 句 | ¥0.16 | **弹窗**（40 ≥ 12；金额远低于 0.5 元阈值，靠数量兜住） |
| 全量生图（20 镜 × 3 张） | 60 张 | 不可估（无图片单价） | **弹窗**（units=60），保留现有数量文案 |

> **修订（阈值定为 12，不是 8）**：初稿写 `minUnits: 8` 并把理由写成「一个段落的上限」，
> 但 8 句恰好命中 `units >= minUnits`，与同一节的表格（「重录本段 → 不弹窗」）自相矛盾，
> 且会让「重录本段」这个最高频操作被误拦——正是本节要避免的事。
> 阈值表达的是「值得打断的规模」，取 **12**（一个半段落）后：8 句在下方、40 句在上方，两处都正确。
> 金额阈值保留 0.5 元作为「未来接了贵 TTS / 贵图片模型」时的兜底。
> 若日后段落上限变化，**阈值要跟着重算**，并保证「一个满段落 < 阈值」这条不变式有单测兜住。

### 1.3 确认文案模板（三要素）

凡是走 `confirm()` 的确认框，文案必须包含三段，**顺序固定**：

1. **花多少**：`将为 20 个镜头提交 60 张图片生成请求，费用由图片服务商收取。`
2. **影响几步**：`其中 12 个缺图、8 个描述或风格改过已过期；已完成或不相关镜头不受影响。`
3. **能不能退**：`出错不会丢失已有图片，可单独重试；服务商已接单的请求仍会计费。`

现有 `generateAll`（`components/video-controls.tsx:408`）已符合，把它抽成公共组件 `components/confirm-dialog.tsx`
（或直接给 `ConfirmOptions` 增加 `bullets?: string[]`，在 `components/feedback.tsx:58` 渲染成列表），
其他确认一律复用它。

### 1.4 反馈的单一真相来源

同一条错误现在最多出现在 4 个地方（页面 banner / JobStrip / SentencePanel / ShotCard / toast）。定级：

| 级别 | 承载体 | 内容 | 是否可重试 |
|---|---|---|---|
| **任务级**（默认） | `JobStrip` 对应格 + 卡片内联 | 失败原因 + 重试/取消 | ✅ |
| **动作级**（用户点按钮失败） | `toast` | 一句话 + 怎么补救 | 由卡片提供 |
| **阻塞级**（自动推进被卡） | 顶栏状态区 / `plan.goal.blocked` | 「没有可用文本模型」这类环境原因 | ❌ |

规则：**页面级 `error` banner 只承载动作级错误**（`components/video-studio.tsx:189`），
任务失败不得写进它；`SentencePanel.error` 在成功一次后必须清空。

> **`SentencePanel.error` 的清理要分状态，不能一刀切。** 它同时承担两类语义：
> 「动作级失败」（重录排队失败、试听失败 —— 该清）和 **P0-1 新增的成本提示**（不该被清）。
> 落地时把它拆成两个 state（`error` 与 `notice`），只清 `error`。
> 否则会出现「用户刚看完成本提示、点一下别处就没了」的倒退。

### 1.5 进度与中断的配对规则

> **有进度的地方必须有停止；停止必须只影响本次提交。**

| 流程 | 进度 | 停止 | 现状 |
|---|---|---|---|
| 文案生成/改写/去 AI 味 | ✅ 流式 + 段号 | ✅ AbortController | 保持不动 |
| 全量生图 | ✅ 单卡百分比 | ✅ 按 batchId | 保持不动 |
| 一键成片 | ✅ 步骤条 | ✅ `stop` | 保持不动 |
| **配音批次** | ❌ 提交后界面静止 | ❌ 无 | P2-1 补 |
| 渲染 | ⚠️ 只有「渲染中」 | 需与普通停止一致 | P2-4 补 ETA |

补充事实（写进验收）：Worker 心跳 10s（`worker/loop.ts:37`）→ 取消「运行中」任务最长 10s 生效，
且服务商已接单的部分仍会计费。**UI 必须有「正在停止…」中间态**，不能点了没反应（`StoryboardPanel` 已有此处理，作为范式）。

### 1.6 必须常驻可见、但现在「藏起来了」的状态

| 状态 | 现状 | 目标 |
|---|---|---|
| 新配音就绪进度（旧音频仍生效） | 只在「设置」标签页轮询（`video-controls.tsx:708`） | 顶栏常驻 |
| 成片已过期 | 只在 `RenderList` 徽章（`video-studio.tsx:294`） | 顶栏常驻 + 与主按钮联动 |
| Worker 离线 | 有横幅，但文案面向开发者 | 保留命令，换成「人话」 |
| 改文案会连带几句重新配音 | 无 | 顶栏/句子面板角标 |

---

## 2. 现状基线（改动前的盘点，用于验收对照）

| # | 操作 | 位置 | 现状 | 按 1.1 应为 |
|---|---|---|---|---|
| 1 | 单句重录 | `video-controls.tsx:284` → `:96` | 直接执行，无标签；段落模式才确认 | 直接执行 + 标签（P1 后带撤销） |
| 2 | 重录本段 | `:346` → `:96` | **弹窗**，写了句数与替代理念 | 按阈值裁决（多数场景→不弹，改撤销） |
| 3 | 补齐缺失 / 全部重录 | `:323-324` → `:110` | 弹窗 ✅，文案规范 ✅ | 保留，改走公共模板 |
| 4 | 单独录制此句 | `:208` → `:201` | 弹窗 | 保留（会连坐同段重录，属于「影响几步」明确 → 告知而非询问，P1 后改轻提示） |
| 5 | 单镜生成/重新生成图片 | `:564` → `:458` | 直接执行，无标签 | 直接执行 + 标签（P1 后旧图不丢） |
| 6 | 全量生成图片 | `:511` → `:408` | 弹窗 ✅ **文案样板** | 抽成公共组件 |
| 7 | 停止全量生图 | `:511` → `:428` | 弹窗 ✅（危险态+「后续可继续」） | 保留 |
| 8 | 拆分 / 合并镜头 | `:567-568` → `:485/:492` | 无确认 ✅（⌘Z 可撤销） | 保留；补「会让成片过期」提示 |
| 9 | 锁定句子/镜头 | `:277` / `:542` | 无确认 ✅ | 不动 |
| 10 | 应用配音设置 | `:647` | quote → confirm → apply，**只有 1 次确认** | ⚠️ 见下方修订 |
| 11 | 取消 / 撤回音色 | `:667` | 无确认（免费操作 ✅） | 撤回必须**永远成功**（P1-3） |
| 12 | 任务重试（JobStrip） | `job-strip.tsx:48` | 无确认、无成本 | 走统一阈值 + 标签 |
| 13 | 任务重试（ShotCard） | `:559` | 无确认、无成本 | 同上 |
| 14 | 关闭 AI 标识 | `:690` | 弹窗 + 危险态 ✅ | 保留 |
| 15 | 重新生成全文 / 大纲 | `workbench.tsx:215/:225` | 弹窗 + 危险态 ✅ | 保留 |
| 16 | 停止制作 | `video-studio.tsx:146` | 弹窗 ✅ | 保留 |
| 17 | 超预算继续 | `video-studio.tsx:134` | 弹窗 ✅ | 保留 |

> **复核修正（重要）**：上一轮分析说「应用配音设置重复确认（问了两次）」——**不成立**。
> `applyVoice` 里 quote 只用于拼文案，确认只有 1 次（`video-controls.tsx:651-657`）。
> 它真正缺的是**按钮上的成本前置**：用户点「应用到项目」之前看不到任何金额，金额第一次出现在弹窗里。
> 所以本期的正确做法是：**把估算金额搬到按钮上**（P0-3），而不是删弹窗。

---

## 3. P0：成本前置与后门修补（1.5 人日）

### P0-1 句子接口补充成本字段，所有配音按钮带标签

**改法**

1. `app/api/projects/[id]/lines/route.ts`：返回体每行增加

```ts
costYuan: estimateTtsCost(voice.provider, voice.model, billedCharsOf(spoken))  // 段落模式同样按句估算
```

（`lineSpeech` 已算过 `spoken`，`billedCharsOf` / `estimateTtsCost` 已在 `lib/pipeline/pricing.ts`。）
2. `components/video-controls.tsx` 的 `LineInfo` 增加 `costYuan: number`。
3. 按钮文案：
   - 单句 `重录 · 1 句`（`:284`）
   - 组头 `重录本段 · 8 句 · 约 ¥0.03`（`:346`）
   - 批量按钮 `全部重录 · 40 句`（`:324`）、`补齐缺失 · 12 句`（`:323`）
   - 段落组头常显成本，用户改段落时就能看到代价
4. 图片按钮（`:564`）：无图片单价 → 只显示数量，`生成 1 张` / `重新生成 3 张`（`candidateCount` 已在 `StoryboardPanel`）。

**验收**：每处付费入口都能看到「几个单元 + 多少钱」；弹窗与否是另一件事（见 §1.2），**弹了也照样要有标签**；金额不到 1 分时显示「不足 ¥0.01」而不是「¥0.00」。

> **段落模式的金额会低估**：块内只缺 1 句也要重录整块，而按句累加会算少。
> 凡是「补齐缺失」这类按块计费的入口，标签要写成「12 句 · 约 ¥0.05 起」，
> 并在 tooltip 里说明「段落模式按整段计费，实际可能更高」。别给出一个偏低的确定数字。

### P0-2 堵「重试」的成本后门

现状：首次生成要确认，失败后「重试」不要（`job-strip.tsx:48`、`video-controls.tsx:559`）——同样调用服务商、同样计费。

**改法**：`重试` 按钮同样走 `needsConfirm()` + `costLabel()`：
- 单个：`<button>重试 · 1 句</button>`（够便宜，不弹）
- 批量：`重试 {n} 个 · 约 ¥{x}`；`n >= 8` 时弹窗（复用 P0-3 的模板）

**验收**：`tests/interaction-policy.test.ts` 覆盖：`needsConfirm({units:1,...}) === false`、`units:8 === false`、`units:12 === true`、`costYuan:0.6 === true`。
其中 `units:8 === false` 是**保护高频路径**的关键断言（一个满段落不得被拦），不要因为改阈值而顺手改掉它。

### P0-3 「应用到项目」按钮显示预估费用

**改法**（`video-controls.tsx:708`）：让 `dirtyVoice` 时自动取一次报价（已有 `/voice-change` 的 `quote` action），
按钮文案变成 `<button>应用到项目 · 8 句 · 约 ¥0.03</button>`；「放弃修改」旁边显示「待应用；当前配音不变」保持不变。
报价请求做 300ms 防抖 + 结果缓存（依赖 voice 的 JSON.stringify）。

确认弹窗文案改为走 §1.3 的公共模板（三要素）。

### P0-4 Worker 横幅改人话

`job-strip.tsx:71-79`：保留命令，补一句人话与后果：

> 生成服务未运行，配音、生图和渲染会一直排队。**任务不会丢失**，服务恢复后自动继续。
> 管理员请在项目目录执行 `npm run worker`；本地开发可用 `npm run dev:all`。

（「不会丢失」来自 `recoverExpired()` + 任务持久化的事实，属于降焦虑的正确信息。）

### P0 DoD

- `npm run typecheck && npm run lint && npm run test` 全绿
- 手动过一遍：所有付费按钮都有数量标签；两处「重试」有标签；设置按钮有金额

---

## 4. P1：用「可撤销」换掉弹窗（3 人日）

### P1-1 让重录可撤销（消掉 P0/P2 里所有重录类弹窗的技术前提）

现状根因：`cachePut` 是 `INSERT OR REPLACE`（`lib/server/cache.ts:15`）。**注意 tts 的 key 只由文本+音色决定**
（`lib/core/keys.ts:95` 的 `ttsKey`），不含任何随机标记，所以：

- **改了文案再重录** → `spoken` 变 → key 变 → **旧音频在旧 key 上完好保留**，这条路径本来就已可撤销；
- **一字不改、只想换一版** → 同 key → 真的覆盖，只有这条需要归档。

> **范围修正**：初稿说「所以现在只能靠弹窗兜底」，这个前提被削弱了——最常见的重录场景（改完稿重录）
> 其实已有旧数据在库里。因此**先做小版本**：撤销时优先回退到旧的 key 缓存（零新增存储），
> 只有同 key 覆盖的场景才落 `tts_takes`。这样 P1-1 的收益提前拿到，归档表只承担它真正必要的那部分。

**改法**

1. 迁移里加一张归档表（写法参照 `lib/server/migrations.ts` 里的 `cache` 表）：

```sql
CREATE TABLE IF NOT EXISTS tts_takes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  result TEXT NOT NULL,
  archived_at INTEGER NOT NULL,
  reason TEXT            -- 'revoice' | 'voice-change' | 'manual'
);
CREATE INDEX IF NOT EXISTS idx_tts_takes_key ON tts_takes(project_id, cache_key, archived_at DESC);
```

2. `lib/pipeline/tts-common.ts` 增加 `archiveTake(projectId, key, reason)`：在写入前把旧 `cache` 行搬进 `tts_takes`；
   `cachePut` 在覆盖前调用它；只对 `force` 路径生效（重录 / 换音色），正常命中缓存的路径不产生归档记录。
   （实现入口：配音写缓存统一走 `lib/pipeline/tts-common.ts:65` 的 `commitCache`，
   逐句与段落块两条链路都经过它，归档钩子挂在这里即可覆盖全部重录路径。）
3. 新接口 `POST /api/projects/[id]/lines/takes/undo`，body `{ keys: string[] }`：
   从 `tts_takes` 取每个 key 的最新一条回写 `cache`（事务内，用现行写缓存逻辑回写），并删掉这条记录（只允许回一步）。
4. `components/feedback.tsx` 的 `toast` 增加可选 action：

```ts
toast(message, kind, action?: { label: string; run: () => void })
```
5. 单句/单段重录成功后：`toast("已重录 8 句", "success", { label: "撤销", run: undo })`，
   8 秒倒计时（比现在的 4.2s 长一点，够用户点）。

**验收**（`tests/tts-takes.test.ts`）：改文案后重录 → 撤销回退到旧 key 且不产生 take 记录；
同 key 重录 → 旧结果进 `tts_takes`；undo 后 `cacheGet(key)` 回到旧值；
undo 再点一次返回 409；自动重跑路径（非 force）不产生多余的 take。

### P1-2 生图不再丢旧图

现状：`lib/pipeline/stages/shot-generate.ts:48-58`，新候选到达时 `candidates` 被整体替换为新的一批，
旧图**从候选列表里消失**（`assetId` 本身仍指向旧图、旧图也没被删，所以不是「丢了」，
而是**没有回头路可走**——用户选了新候选之后，就再也切不回旧图了）。
注意措辞：不要升级成「数据丢失」，风险被高估会让这一项被误判为 P0。

**改法**：合并而非替换 —— 保留历史候选（去重、上限 8 个），**并保持旧 `assetId` 选中**，
由用户点新候选才切换；仅在 `candidateCount === 1` 且用户明确「重新生成」时也保留旧图为一个候选。

收益：单次重生图变成「可撤销」→ 按契约直接执行 + 数量标签即可，**无需确认**；
同时候选图面板（`:566`）天然变成「历史版本选择器」。

### P1-3 「撤回本次音色应用」永远成功

现状：`lib/server/voice-change.ts:125` 在旧音频不完整时直接抛错「无法直接撤回」，用户撞到一个自己无法预判的失败。

**改法**：改为「永远成功」——缺失的旧 key 自动排队补齐（走 `enqueueTtsSteps` + `keyPrefix: jobKey(projectId,"")`），
项目文档里的 `settings.voice` 立即回退，界面显示「正在恢复旧配音 3/8 句」，并复用 P2-1 的进度与停止入口。
`revertible`（`:47`）不再要求 `missing.length === 0`。

**验收**（扩展 `tests/voice-change.test.ts`）：删掉一条旧缓存后调用 `revertVoiceChange`，不抛错且补齐任务已入队。

### P1-4 拆分/合并/改描述的成片过期提示

`shotUpdate`（`:358`）会改 `TimelineShot` → 已有 `RenderList` 标记为过期，但用户不会联想到是自己刚才的操作导致的。

**改法**：这些操作后弹一条**轻提示**（不是确认）：
`toast("已合并镜头，现有成片需要重新渲染", "info")`，并在顶栏出现「成片已过期」（P2-5 的状态位）。

### P1 DoD

- 两条“重录”链路（句子、图片）都不弹窗且都可撤销
- 撤回音色 100% 成功
- `npm run typecheck && npm run lint && npm run test` 全绿

---

## 5. P2：进度、中断、状态可见（4.5 人日）

### P2-0 先修：`currentKeys` 漏掉段落任务键（正确性）

`lib/pipeline/plan.ts:160` 推的是每个成员句的 key，而任务 key 用 `ttsJobKeyOf`（`lib/pipeline/tts-jobs.ts:26`，块模式是块 key）。

**改法**：`currentKeys.push(...keys.map((item) => ttsJobKeyOf(item)));`

**验收**（`tests/plan-keys.test.ts`）：段落模式下返回的 `currentKeys` 包含块任务 key；
改一句文案后 `currentKeys` 里 tts 类 key 的**数量不变**（这是「进度条数字不骗人」的不变式，务必写成断言）。

### P2-1 配音批次：真进度 + 真停止

1. `lib/pipeline/tts-jobs.ts` 的 `enqueueTtsSteps` 增加 `batchId`，写进 `step.input`；
   `app/api/projects/[id]/lines/tts/route.ts` 生成 `batchId` 并在响应里返回（对齐 `shots/generate` 的既有做法）。
2. 新路由 `app/api/projects/[id]/lines/tts/cancel/route.ts`（POST，body `{ batchId }`）。
3. `lib/server/jobs.ts:212` 的 `cancelProjectJobBatch` 现在只支持单个 stage → 扩展为 `stages: string[]`，调用方传 `["tts","tts-block"]`。
4. `SentencePanel`：
   - `batchBusy` 不再在 `finally` 里立刻清空（`video-controls.tsx:130`），而是保持到**该批次任务全部结束**（按 `batchId` 过滤 `jobs`）；
   - 期间按钮变成 `停止重录（剩余 5 句）`，中间态 `正在停止…`（对齐 `stopBulkGeneration`）。
5. 进度口径：**区块级**（`第 2/3 段 · 第 5/8 句`），不做句子级细进度（单句 1–3 秒，细进度只会闪）。

**验收**（`app/api/projects/[id]/lines/tts/cancel/route.test.ts`，照 `shots/generate/route.test.ts` 写）：
停止只取消本批次，单独提交的重录任务不受影响；已完成音频保留。

### P2-2 镜头任务状态改由服务端裁决

现状：`StoryboardPanel` 在客户端用「stage 等于 `shot-generate` 且 target 等于该镜头 id」去 `jobs` Map 里 `findLast`（`video-controls.tsx:518`）。
Map 是插入序，同一个镜头改过描述后会产生**不同 key 的多条任务**，取到哪条不确定 → 会显示过期的「已就绪/生成失败」。

**改法**：新增只读接口 `GET /api/projects/[id]/shots/status`，服务端用 `shotGenerationKey` 现算当前权威 key，
返回：

```ts
{ [shotId]: { key: string; status: JobStatus; progress: number; message: string; error: string | null } }
```

前端不再自己 find；`assetsStale` 仍由客户端 `assetStale()` 判断。

**验收**：改过描述的镜头，一度成功的旧任务不再让卡片显示「已完成」。

### P2-3 顶栏常驻状态区 `StudioStatusBar`

放在主按钮行与 `JobStrip` 之间（`video-studio.tsx:243` 之前），汇总四类状态（P1.6 表）：
配音切换进度 / 成片已过期 / 已花费 / Worker 离线。每条都可点击跳到对应面板（`setPanel(...)`）。

数据所有权上移：`lib/client.ts` 新增 `useVoiceChange(id)`（2s 轮询 + 变更时回调），
由 `VideoStudio` 独占持有，`SettingsPanel` 改为接收 props（删掉它自己的 interval，`video-controls.tsx:633-637`）——
避免两个组件各轮询一次。

### P2-4 渲染 ETA

`lib/pipeline/render.ts:171` 已经在报 `progress` 和 `stitchStage`，缺的只是客户端估算。

> **注意：不能用 `updatedAt` 做基准。** 初稿写的 `(now - job.updatedAt) / job.progress * (1 - job.progress)` 是错的：
> `heartbeat()` 每次都会刷新 `updated_at`（`lib/server/jobs.ts:149`），而 Worker 心跳周期是 10 秒
> （`worker/loop.ts` 的 `setInterval(..., 10_000)`）。所以 `now - updatedAt` 恒在 0–10 秒之间，
> 渲染到 80% 时会算出「还需约 2 秒」，且每 10 秒被重置一次、数字来回跳。
> 这不是可接受的误差，是基准选错了。

**改法**

1. **加一个真实的时间基准**：`jobs` 表迁移新增 `started_at INTEGER`，
   `claim()`（`lib/server/jobs.ts:129`）领取时写入，`retryJob()` 里清空以便重新计时。
   这是唯一可靠的分母。
2. `JobStrip` 对 `render` 步显示「预计还需 m:ss」：
   `(now - startedAt) / progress * (1 - progress)`。
3. `progress < 0.05` 或 `startedAt` 为空时**不显示 ETA**，改显示「准备中」，避免开头几秒的数字剧烈跳动。
4. 兜底：ETA 超过 30 分钟时改显示「已进行 m:ss」，不报一个不可信的大数。

这是唯一单位为「分钟」的步骤，值得给时间预期；其余步骤要么秒级、要么用进度条就够。

### P2-5 文案改动 → 配音影响的感知

SentencePanel 顶部（或段落组头）：`有 12 句因文案改动需要重新配音 · 约 ¥0.05` + 「补齐缺失」按钮（已存在）。
数据来源：`lines` 里 `!item.audio` 的行 + P0-1 的 `costYuan` 求和，零新增请求。

### P2 DoD

- 配音批次全程有进度和停止入口
- 顶栏四类状态常驻且单点更新
- `JobStrip` 数字在「改文案 / 改段落 / 停一半继续」三种扰动下都不漂移（有单测）

---

## 6. P3：性能与契约收口（1.5 人日）

### P3-0（严重，优先）每次按键都刷新全页面

`components/video-studio.tsx:104-106`：

```ts
useEffect(() => { if (store.doc) refresh(true); }, [store.doc, refresh]);
```

`store.setDoc` 每次 `setState` 都产生新对象 → 在任意 `AutoTextarea` 里每敲一个字触发：
4 个 HTTP 请求（timeline ×2 / renders / produce）+ 双 `requestAnimationFrame` 的 seek 还原。
这是「预览跳帧、输入发涩」的直接原因。

**改法**（三步）

1. `refresh` 依赖改为**粗粒度签名**而非整个 doc：

```ts
const docSig = useMemo(() => signatureOf(doc), [doc]);           // 影响 timeline/renders/produce 的字段
useEffect(() => { void scheduleRefresh(true); }, [docSig, id, aspect]);
```

   签名只含：`lines[*].{id,text,mood,voiceTag,ttsIsolated,locked}`、`shots[*].{id,assetId,kind,mode,shotSize,locked,sourceHash}`、
   `music`、`settings.{subtitle,voice,aspects,music,sfx,aiLabel}`、`characters[*].id`。
   **不含** `shots[*].description / prompt / seed / onScreenText`（打字高频字段）——它们由 SSE/`revision` 驱动最终一致性。
2. `refresh` 加 **300ms 防抖**；只在 `timeline.hash` 真的变化时才做「先 seek 回去、再恢复播放」的补偿（现在无条件做，是预览跳帧的来源之一）。
3. 把「SSE 每秒推 job」与「用户编辑」统一到同一个 debounced `scheduleRefresh` 入口，避免两条路径互相打架。

**验收**：在画面描述里连打 20 个字，Network 面板只出现 1 次 timeline 请求；`npm run test` 全绿。

### P3-1 `refresh` 按阶段分流

`video-studio.tsx:74-79` 一次拉 4 个接口。拆分：
- SSE `jobs` 事件只驱动 `JobStrip`（已有 `plan.currentKeys` 过滤），不驱动 timeline；
- `revision` 事件触发 full refresh；
- 第二个画幅的 timeline（`9:16`）改为懒加载（用户切到该画幅才拉）。

### P3-2 明确「不用动」的清单（避免回滚已有好设计）

| 机制 | 位置 | 结论 |
|---|---|---|
| Worker 失败退避 2s/8s/30s | `lib/server/jobs.ts:177` | 不动 |
| 租约过期回收 | `:234` + `worker/loop.ts:39` | 不动 |
| 文档三方合并 | `lib/client.ts:220` | 不动 |
| 任务执行代次校验 `isCurrentExecution` | `:118` | 不动 |
| 文案流式 + 段号进度 | `workbench.tsx` | 不动 |
| 单卡生图百分比 | `video-controls.tsx:549` | 不动 |

---

## 7. 改动清单（按文件）

| 文件 | 改动 | 阶段 |
|---|---|---|
| `lib/core/interaction.ts`（新） | 阈值策略 + `costLabel/costSuffix/needsConfirm` | P0 |
| `tests/interaction-policy.test.ts`（新） | 策略单测 | P0 |
| `app/api/projects/[id]/lines/route.ts` | 每行返回 `costYuan` | P0 |
| `components/video-controls.tsx` | 按钮成本标签、重试标签、quote 上按钮、候选项 props、停止重录 | P0/P1/P2 |
| `components/job-strip.tsx` | 重试标签+阈值、Worker 文案、渲染 ETA | P0/P2 |
| `components/feedback.tsx` | `ConfirmOptions.bullets`、`toast(action)` | P0/P1 |
| `lib/server/cache.ts` + `lib/pipeline/tts-common.ts` | take 归档 | P1 |
| `app/api/projects/[id]/lines/takes/undo/route.ts`（新） | 撤销上一次重录 | P1 |
| `lib/pipeline/stages/shot-generate.ts` | 候选合并、保留旧选中 | P1 |
| `lib/server/voice-change.ts` | 撤回必成功（自动补录） | P1 |
| `lib/pipeline/plan.ts` | `currentKeys` 用 `ttsJobKeyOf` | P2 |
| `lib/pipeline/tts-jobs.ts` | `enqueueTtsSteps` 支持 `batchId` | P2 |
| `lib/server/jobs.ts` | `cancelProjectJobBatch` 支持多 stage；`jobs.started_at`（claim 写入 / retry 清空） | P2 |
| `app/api/projects/[id]/lines/tts/{route,cancel/route}.ts` | 批次 id 与停止 | P2 |
| `app/api/projects/[id]/shots/status/route.ts`（新） | 镜头任务权威状态 | P2 |
| `components/studio-status-bar.tsx`（新） | 顶栏常驻状态区 | P2 |
| `lib/client.ts` | `useVoiceChange` | P2 |
| `components/video-studio.tsx` | 状态区挂载、refresh 节流与签名 | P2/P3 |

---

## 8. 验收方式（每期都要跑）

```bash
npm run typecheck
npm run lint
npm run test
npm run build          # 迁移与类型改动会在这里才暴露
npm run smoke          # 确认无素材占位画面仍能渲染
```

按 AGENTS.md 的要求，落地后还必须**手动打开 `/changelog` 确认页面正常渲染**
（§10 的条目是改 `lib/changelog.ts` 的地方，页面只渲染这份数据，写坏了不会在 typecheck 里报错）。

新增/修改的测试：

| 测试 | 断言 |
|---|---|
| `tests/interaction-policy.test.ts` | 阈值策略在 units/cost 边界的行为 |
| `tests/plan-keys.test.ts` | 段落模式 `currentKeys` 含块键；改一句后 tts key 数量不变 |
| `tests/tts-takes.test.ts` | 归档/回退/不可二次回退/非 force 不产生 take |
| `app/api/projects/[id]/lines/tts/cancel/route.test.ts` | 只停本批次、已完成音频保留、停止后可继续补齐 |
| `app/api/projects/[id]/shots/status/route.test.ts` | 描述改动后不再返回旧任务状态 |
| `tests/voice-change.test.ts`（扩展） | 旧音频缺失时撤回成功并补录 |

手工回归清单（做成 checklist 放进 PR）：

1. 空项目 → 一键成片 → 全程无阻塞感、可随时停止
2. 改一句 → 只重录一句（步骤条确认只动了 1 个任务）→ 通知里点「撤销」还原
3. 改大纲/全文 → 重新生成确认带危险态
4. 段落模式：整段重录、单独录制、撤销、切字幕
5. 全量生图 → 停止 → 继续 → 单镜重生不丢旧图
6. Worker 关闭 → 横幅人话 + 任务不丢 + 恢复后自动继续
7. 连打 20 个字，Network 只有 1 次 timeline 请求

---

## 9. 风险与非目标

| 风险 | 应对 |
|---|---|
| `tts_takes` 表随重录增长 | 每 key 只保留最近 1 条；`pruneJobs` 同批清理 30 天前记录 |
| 图片成本不可估 | 只显示「N 张」；后续若要金额，先在 `config/pricing.json` 补 `image` 段再补 `costEstimate` |
| 取消「运行中」任务最长 10s 生效 | UI 必须有中间态（P0-4 已列），并在停止文案里写明「已发出的请求仍可能计费」 |
| P1-1 改动触碰写缓存的核心路径 | 只在 `force` 分支生效；先写单测再改各 stage 的 `cachePut` 调用点 |

**非目标**：本方案不改编排算法、不改缓存键设计、不改 Agent/模型相关的任何逻辑；
不引入新的 UI 组件库（复用 `components/ui.tsx` 现有原语）。

---

## 10. changelog 记录草案（按 AGENTS.md，在 `lib/changelog.ts` 最前面追加）

> 版本号在落地时按实际发布顺序确定；下面是可直接粘贴的内容框架。

```ts
{
  version: "0.15.0",
  date: "2026-09-30",
  title: "制作流程交互契约统一",
  summary: "统一了「什么时候打断、什么时候给进度、什么时候给停止」的判断标准：便宜或可撤销的操作不再弹窗，重录和重新生图可以随时回退，配音批次也有进度和停止入口。",
  items: [
    { kind: "improvement", title: "成本前置到按钮", detail: "每一处会调用服务商的入口都直接显示「几句 / 几张 · 约多少钱」，不用点开才知道代价；低于一分的显示「不足 ¥0.01」。" },
    { kind: "improvement", title: "重试不再是免确认后门", detail: "失败任务的重试与首次生成适用同一套成本规则与数量标签。" },
    { kind: "feature", title: "重录与重新生图可撤销", detail: "单句、整段重录和单镜重新生成图片都会保留上一次结果，完成后 8 秒内可从通知里「撤销」。" },
    { kind: "feature", title: "配音批次可停止", detail: "批量重录、补齐缺失和系统自动配音现在和全量生图一样有区块级进度与「停止本次」入口，已完成音频不受影响。" },
    { kind: "improvement", title: "顶栏常驻状态", detail: "音色切换进度、成片是否过期、已花费金额和生成服务状态统一显示在顶部，不必切到设置或翻到成片列表。" },
    { kind: "fix", title: "段落配音的任务进度不再丢失", detail: "段落模式下任务键口径修正，步骤条能正确显示配音进度、失败原因并提供取消。" },
    { kind: "fix", title: "编辑画面描述时不再反复刷新页面", detail: "预览与时间轴刷新改为按内容签名触发并合并请求，输入长文本时不再卡顿或跳帧。" },
  ],
}
```
