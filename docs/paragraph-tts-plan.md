# 段落级 TTS 模式：改造方案

> 状态：P0 探针、P1 基础重构、P2 段落模式（DashScope）、P3 Gemini 与降级链已完成（均为实验）；**P4 待实施，接手请直接看 §8**
>
> 日期：2026-09-29
>
> 目标：新增「合成粒度：逐句 / 段落」。段落模式先按段落合成、再切成单句，
> 减少逐句合成带来的句间音色、语气、韵律不连续，同时保留逐句的字幕、镜头锚点和缓存机制。

## 1. 现状与问题

| 环节 | 实现 | 对连贯性的影响 |
|---|---|---|
| 断句 | `lib/core/lines.ts` `splitSentences`：句末标点断开，超过 40 字再在逗号处拆 | 一个自然段通常 3–8 句 |
| 缓存键 | `lib/core/keys.ts` `ttsKey`：单句朗读文本 + 音色 | 模型看不到上下文 |
| 合成 | `lib/pipeline/stages/tts.ts`：一句一个任务 | 每句都用「开头起调、结尾落调」读，句间响度、语速、音高各自独立；Gemini 每次请求还会有音色漂移 |
| 对齐 | CosyVoice / Qwen 返回字级时间戳；Gemini 无，按字数均分 | — |
| 拼接 | `lib/core/timeline.ts` `layoutLines`：只取有效语音区间，句间插入固定停顿（段内 250ms、段间 700ms，或 `pauseAfterMs`） | 停顿是机械常数，丢掉了自然停顿和换气声 |

## 2. 已确认的决策

1. **段内停顿**：块内用实测的自然停顿；标注的 `pauseAfterMs` 只在块尾生效（它大多由标注模型自动写入，无法区分是否用户手设）。
2. **段落模式下的单句重录**：默认重录整段（保证一致）；次选项「单独录制此句」（`ttsIsolated`，该句自成一块）。
3. **首批开放**：先开放 CosyVoice（有时间戳、风险低）；Gemini 在切分误差与降级率达标后再开放。（P3 已按「实验」开放 Gemini，见 §7；转为推荐仍待盲听。）
4. **块大小**：默认 ≤ 8 句 / 300 字（约 70 秒），Gemini ≤ 5 句 / 200 字；常量在 `lib/core/blocks.ts` `BLOCK_LIMITS`，按探针数据调整。

## 3. 核心设计

### 3.1 分块（`lib/core/blocks.ts`，已实现）

- 不跨章节；优先在文案换行（自然段）处断开。句子不记录自然段，由 `paragraphIndexes` 在去掉空白的章节原文里顺序定位反推（兼容碎句跨换行并入上一句）。
- 超上限的自然段拆成字数相近的几块，拆分点优先选句末强停顿。（P3 改为动态规划：最少块数 + 字数均衡，见 §7。）
- `alone`（单独录制）的句子自成一块；`kind` 变化处（SSML / 纯文本）断开。

### 3.2 数据模型（P2）

- `voiceSettings.granularity: "line" | "paragraph"`（默认 `line`）。放在音色设置里，切换模式自动走「报价 → 后台生成 → 就绪后统一切换 → 可撤回」的现有换音色流程。
- `line.ttsIsolated?: boolean`。
- `TtsResult.block?: { key, index, count, gapAfterMs, confidence, splitSource, blockAssetId }`。

### 3.3 缓存键（P2）

- 块键 = hash(块内全部朗读文本 + 与 `ttsKey` 相同的音色字段 + 连接方式 + `STAGE_VERSION.ttsBlock`)。
- 段落模式单句键 = hash(块键 + 句序)。同一句在不同上下文读法不同，邻句一改本段就要重录（换取连贯的代价）。
- 逐句模式 `ttsKey` 不变，旧缓存全部有效。`lineTtsKeys` 按模式分支，下游（时间轴、句子接口、编排、换音色）不用改。

### 3.4 `tts-block` 步骤（P2）

1. 块内全部单句键命中且非强制 → 跳过。
2. 组装整段文本（CosyVoice 直接拼接；Gemini 连接方式按探针结论；Qwen SSML 整段一个 `<speak>`，句间插 `<break>` 制造可靠切点）。
3. 合成；语速校验判断漏读 / 重读 / 截断 / 句界切错（P3 实现为 `checkSplit`，阈值见 §7，取代最初的 ±45% 设想）。
4. 切分（`lib/pipeline/tts-split.ts`，已实现），PCM 帧级切片，切点两侧 8ms 淡入淡出。
5. 一个事务写入块内全部单句 `TtsResult`，不留半截。
6. 置信度低 → 降级链：整块 → 二分为两个半块（最多 2 层）→ 逐句。

### 3.5 切分算法（`lib/pipeline/tts-split.ts`，已实现）

- **有时间戳**：每句首字开始 / 末字结束；句界 ±80ms 内有静音就以静音为准（时间戳常把尾音算短），切在静音中点；否则切在能量最低处，置信度 0.6。
- **无时间戳**：10ms 帧电平，阈值随整段自适应（夹在 -65 ~ -30 dBFS）；≥ 80ms 的低能量段为候选；按字数比例得预期句界；动态规划单调选 N−1 个，代价 = 偏差² + 停顿偏短惩罚（强停顿期望 250ms，弱停顿 120ms）。候选不足 → 置信度 0，交给降级。（P3 已升级为「停顿对齐到标点」+「只计有声帧」估算预期位置，以 §7 为准。）

### 3.6 时间轴（P2）

同一块内相邻两句：句间停顿用 `block.gapAfterMs`，语音片段延长到切点（保留尾音与换气）。不改停顿时，时间轴上还原的就是原段落音频。镜头锚点、字幕、闪避都由逐句字时间派生，不改。

### 3.7 任务构造（`lib/pipeline/tts-jobs.ts`，已实现）

`ttsSteps` / `enqueueTtsSteps` 是配音任务的唯一构造入口：自动编排（`plan.ts`）、全部重录 / 补齐（`lines/tts`）、单句重录（`lines/[lineId]`）、换音色（`voice-change.ts` 的报价与排队）都走这里。P2 在这里按块合并任务。

### 3.8 表达控制兼容

| 模型 | 段落模式 |
|---|---|
| CosyVoice | 无逐句控制，直接适用，首批 |
| Qwen-Audio | `instruction` 作用整段；逐句情绪标签能否在段中生效需探针，否则带标签的句子自成一块；SSML 整块 SSML |
| Gemini | 本就只有全局表达；连贯收益最大、切分风险最高，第二批 |

### 3.9 界面（P4）

- 制作设置 → 配音：「合成粒度：逐句 / 段落（更自然，改句会整段重录）」。（P2 已完成）
- 句子面板：按块分组、整段试听、切分置信度徽标（精确 / 估算 / 已退回逐句）、重录下拉（重录本段 / 单独录制此句）。（待实施，任务拆解见 §8）

## 4. 分阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 探针 | `scripts/tts-paragraph-probe.ts`：逐句 vs 段落 A/B、客观连贯性指标、切分质量（CosyVoice 时间戳作为静音切分的标准答案）、盲听配对 | ✅ 已完成，见 §5 |
| P1 基础重构 | `tts-jobs` 统一任务构造；`ttsRequestOf` 统一请求构造；`blocks.ts`、`tts-split.ts` 及单测。行为不变，逐句缓存键不变 | ✅ 已完成 |
| P2 段落模式 · DashScope | `tts-block` 步骤、`tts-common` 共用函数、键、时间轴自然停顿、设置开关（实验）、重录按段提示 | ✅ 已完成，见 §6 |
| P3 Gemini | 静音切分上线、置信度、降级链、时长校验 | ✅ 已完成，见 §7 |
| P4 界面与发布 | 分组、整段试听、单独录制、按块报价；changelog | 待实施，见 §8 |
| P5 可选 | ASR 强制对齐；重录期间旧音频兜底；停顿缩放系数；Qwen 段内情绪标签 | 见 §8.7 |

**勘误**：调研时曾认为 Worker 租约（60s）会在长请求中过期导致重复合成。复核 `worker/loop.ts`：主循环每 10 秒为所有运行中的任务续租，不存在该问题，已从计划中移除。

## 5. P0 探针结论

数据：`data/tts-probes/paragraph-p0-2026-09-29/`（4 段、22 句；复现：`npm run tts:paragraph-probe`）。

### 5.1 CosyVoice v3 Flash（已完成）

| 指标 | 逐句 | 段落 | 解读 |
|---|---:|---:|---|
| 语速离散度 CV | 0.121 | **0.088** | 段落模式节奏稳定 27%；逐句时孤立短句被读得明显更慢（如「他说，继续。」3.3 字/秒 → 段落中 4.1） |
| 相邻句响度差 | 1.20 dB | 1.16 dB | 基本持平，CosyVoice 逐句响度本就稳定 |
| 相邻句音高差 | 2.03 半音 | 2.56 半音 | **不能直接当作「更不连贯」**：句级音高差同时包含自然语调（段内降调、问句上扬），需以盲听为准 |
| 请求数 | 22 | 4 | — |
| 单次延迟 | 0.9–2.2 s/句 | 10.6–18.1 s/段 | 首段出声变慢；总吞吐因请求少而持平 |

**切分**：18 个句界全部拿到时间戳且句界处均有静音（置信度 1）。**只用静音切分时，18 个句界与时间戳切点完全一致（误差 0 ms）**，静音切分置信度 0.64–0.95。说明 §3.5 的静音 + 动态规划算法在干净的 TTS 音频上可靠。Gemini 音频可能带更多换气底噪，仍需实测。

**自然停顿比现在长得多**：实测句间停顿 280–820 ms（平均约 600 ms），而逐句模式固定 250 ms。按决策 1 使用自然停顿后，**同样文案的成片会长约 5–15%**（悬疑段最明显），分镜节奏随之变化。这是预期中「更自然」的一部分，但要在设置说明里告知用户；如用户反馈过慢，P2 可加一个全局停顿缩放系数（例如 0.7×），不影响缓存。

**块大小**：探针段落为 5–6 句 / 110–150 字，均在上限内，暂无数据支持调整 `BLOCK_LIMITS`。

### 5.2 Gemini 3.8 Flash

数据：`data/tts-probes/paragraph-p0-gemini-2026-09-29/`（经本机代理访问，见 §5.4）。

| 模式 | 相邻句响度差 | 相邻句音高差 | 语速离散度 CV | 语音总时长 |
|---|---:|---:|---:|---:|
| 逐句 | 1.21 dB | 1.72 半音 | **0.096** | 94 s |
| 段落，连接 `""` | 1.25 dB | 2.12 半音 | 0.123 | 84 s |
| 段落，连接 `"\n"` | 1.15 dB | 1.20 半音 | 0.186 | 91 s |

- 这三项代理指标上 Gemini 逐句本就稳定，段落模式没有客观优势；Gemini 的痛点是跨请求的音色漂移，这些指标测不到，需以盲听为准。
- 连接 `"\n"` 会把句间停顿拉长到约 1 秒、切分置信度最低 0.45；**Gemini 用 `""`**。
- 静音切分置信度（`""`）0.64–0.90，时长比 0.90–1.09，未见漏读 / 重读。
- 结论：维持计划，P2 只开放 DashScope；Gemini 在 P3 盲听确认收益后开放。（实际：P3 在盲听前以「实验」开放，靠语速校验与降级链兜底，见 §7。）

### 5.3 待人工完成

盲听音频（A/B 随机，答案在 `ab-key.json`，试听后填写 `ratings.json`）：CosyVoice 4 对在 `paragraph-p0-2026-09-29/ab/`，Gemini 4 对在 `paragraph-p0-gemini-2026-09-29/ab/`。按计划，段落模式盲听偏好率 ≥ 70% 才从「实验」转为推荐。

### 5.4 Gemini 网络访问

国内网络直连 Google 返回 `User location is not supported`。本机有系统代理（lightningx，`127.0.0.1:19828`），但 Node 的 fetch 不读 Windows 系统代理。
新增 `GOOGLE_GEMINI_PROXY_URL`：**只让 Gemini 请求走代理**，DashScope 等国内服务继续直连；地区受限、代理未启动时给出明确提示。
不使用 `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY` 全局代理：它只在 `npm run up` 启动时生效（`next dev` 下静默无效），且会让所有国内服务与本机请求都绕道代理。

## 6. P2 实施记录

- **开关**：制作设置「合成粒度：逐句 / 段落（实验）」，仅对已开放的服务商可选（`PARAGRAPH_JOINERS`，P2 时为 `dashscope`，P3 加入 `google-gemini`）；切换走换音色流程。
- **键**：逐句键与改造前逐字一致（有快照测试），合成粒度不进入逐句键；单句块沿用逐句键和缓存；带情绪标签 / SSML、`ttsIsolated` 的句子自成一块。
- **任务**：`ttsSteps` 按块合并为 `tts-block` 任务，只缺一句也整块提交；单句「重录」在段落模式下变为「重录本段」并先确认。
- **切分**：有时间戳按时间戳 + 静音微调；置信度 < 0.5 退回逐句合成（写同样的键、不带块信息）。二分降级、时长校验留到 P3。
- **时间轴**：块内停顿 = 实测自然停顿；相邻切片首尾相接。真实 CosyVoice 端到端：5 句一次合成、切分置信度全为 1、72 字全部精确对齐；按时间轴重建的旁白与整段原音频残差 −80 dB（最大样本差 16/32768，仅切点淡入淡出）。样本：`data/tts-probes/p2-e2e/`。
- **待办（P4）**：句子面板按块分组、整段试听（接口已返回 `blockSrc`）、「单独录制此句」开关（字段 `ttsIsolated` 已就绪）。

## 7. P3 实施记录

- **Gemini 开放**（实验，按项目选择）：`PARAGRAPH_JOINERS` 加入 `google-gemini: ""`。是否从「实验」转为推荐仍以盲听为准（§5.3）。
- **语速校验**（`checkSplit`，`lib/pipeline/stages/tts-block.ts`）：阈值由 P0 探针 20 段实测标定——切对时单句语速为整段的 0.59–1.57 倍、整段 3.9–5.2 字/秒。
  - 整段语速 / 音色实测语速 ∉ [0.55, 1.8] → 漏读、截断或重读（无实测时参考 4.5 字/秒 × 语速倍率）。
  - 单句语速 / 整段语速 ∉ [0.45, 2.0] → 句界切错（少于 4 字的句子不参与）。
- **降级链**：整块 → 对半拆（字数均衡、优先句号，最多 2 层）→ 逐句。子块用 `块键#起-止` 作为 `block.key`，时间轴只在子块内沿用自然停顿。全部结果最后一次性写缓存，中途失败不留半截。
- **静音切分改为「停顿对齐到标点」**（`splitBySilence`）：
  - 停顿槽 = 句末（必须有停顿）+ 句内逗号处（可以没有）；静音可以不分配（换气、强调）。动态规划做单调对齐。
  - 预期位置改在「只计有声帧」的时间轴上按字数比例估算，停顿长短不再把后面的预期位置整体推后。
  - 真实问题：Gemini 读「……给出了答案。他说，……继续。」时逗号处的停顿比句间更长，旧算法切在「他说，|继续」，被语速校验拦下退回逐句；新算法一次通过。
- **分块改为动态规划**（`chunk`）：先取满足上限的最少块数，再按字数均衡、优先句号选拆分点。旧贪心算法会把 6 句的阿波罗段拆成 2 + 3 + 1，现为 2 + 4。已有段落模式项目中超长段的块键会变化，下次生成时整段重录。
- **验证**
  - CosyVoice 地面真值（时间戳）：新静音切分 18 个句界误差仍全部为 0 ms（`paragraph-p3-cosyvoice-2026-09-29/`）。
  - 已保存的 8 段 Gemini 音频离线重切：连接 `""` 的 4 段全部通过校验。
  - 真实 Gemini 端到端：阿波罗段 2 块均一次通过（「他说，继续。」留在段内）；工地段整块置信度 0.49，自动拆为 2 + 3 两块后均通过。
- **句子面板**：标出「已拆小合成」「切分不可靠，已逐句合成」（接口字段 `block.outcome`）。

## 8. P4 接手计划（新会话 / 新 Agent 从这里开始）

> 本节自包含：不需要读之前的对话。先读 §8.1–8.3 了解现状与约束，再按 §8.4 的任务顺序实施。
> P0–P3 的设计与数据见 §3、§5–§7；若与早期章节冲突，以 §6、§7 为准。

### 8.1 当前状态（2026-09-29 P3 结束时）

- **后端已完成**：段落模式的分块、缓存键、`tts-block` 步骤、切分、语速校验、降级链、时间轴自然停顿都已上线（实验）。DashScope 与 Gemini 都可选段落模式。
- **前端已完成**：制作设置里的「合成粒度」下拉；句子面板每句显示「段落 i/N」小标签和结果提示，段落模式下「重录」变为「重录本段」并先确认。
- **前端未完成（P4 的内容）**：按块分组展示、整段试听、单独录制此句、按块报价与计数文案、发布说明。
- **测试**：`npx vitest run` 共 301 个用例全部通过；`npm run typecheck`、`npm run lint` 通过。
- **未提交**：以上全部改动都在工作区，尚未 commit。工作区里还有本功能开始前就存在的其他未提交改动（登录、Remotion 等），**提交时不要混在一起**，需按文件挑选（本功能的文件见 §8.2）。
- **待人工**：盲听 8 对（§5.3），决定段落模式能否从「实验」转为推荐。P4 不依赖盲听结果。

### 8.2 本功能涉及的文件（按职责）

| 职责 | 文件 |
|---|---|
| 分块、服务商开放表 `PARAGRAPH_JOINERS`、`strongEnd` | `lib/core/blocks.ts`（测试 `lib/core/blocks.test.ts`） |
| 缓存键 `ttsBlockKey` / `ttsBlockLineKey`、`TtsResult.block`、`isTtsStage` | `lib/core/keys.ts`（测试 `lib/core/keys.test.ts`，含逐句键快照） |
| 数据模型 `voice.granularity`、`line.ttsIsolated` | `lib/core/types.ts`、`lib/core/lines.ts`（`rebuildLines` 继承 `ttsIsolated`） |
| 时间轴自然停顿、`sameBlock` | `lib/core/timeline.ts`（测试 `lib/core/timeline.test.ts` 末尾） |
| 每句配音键与块信息 `lineTtsKeys`、`measuredCpmOf` | `lib/pipeline/artifacts.ts` |
| 配音任务唯一构造入口 `ttsSteps` / `enqueueTtsSteps` / `ttsJobKeyOf` | `lib/pipeline/tts-jobs.ts`（测试 `tests/tts-jobs.test.ts`） |
| 合成 + 记账 + 写缓存共用 | `lib/pipeline/tts-common.ts` |
| 段落步骤、`checkSplit`、`halve`、降级链 | `lib/pipeline/stages/tts-block.ts`（测试 `tests/tts-block.test.ts`） |
| 音频解码、切片、静音检测、切分算法 | `lib/pipeline/tts-split.ts`（测试 `lib/pipeline/tts-split.test.ts`） |
| Gemini 专用代理、地区错误提示 | `lib/providers/tts/gemini.ts`、`.env.local.example` |
| 句子接口（返回块信息） | `app/api/projects/[id]/lines/route.ts` |
| 重录接口 | `app/api/projects/[id]/lines/tts/route.ts`（全部 / 补齐）、`app/api/projects/[id]/lines/[lineId]/route.ts`（单句 / 本段） |
| 换音色报价与排队 | `lib/server/voice-change.ts` |
| 前端：句子面板、制作设置 | `components/video-controls.tsx`（`SentencePanel` 约第 40 行起，`SettingsPanel` 约第 475 行起） |
| 前端：任务进度条多步骤汇总 | `components/job-strip.tsx`、`components/video-studio.tsx` |
| 探针 | `scripts/tts-paragraph-probe.ts`（`npm run tts:paragraph-probe`） |
| 发布记录 | `lib/changelog.ts`（0.11.0、0.12.0 两条已写） |

### 8.3 必须遵守的约束与已知坑

**不变量（改动后必须仍然成立）**
1. 逐句模式的 `ttsKey` 不能变：`lib/core/keys.test.ts` 里有快照（`tts:ff9e1909…` 等），变了会让所有旧项目的配音缓存失效。
2. 所有配音任务都经 `ttsSteps` 构造；不要在路由或组件里手拼任务输入。
3. 判断「是不是配音任务」用 `isTtsStage(stage)`，不要写 `stage === "tts"`（段落任务的 stage 是 `tts-block`）。
4. 段落模式下一句的任务键是**块键**（`ttsJobKeyOf(item)`），查任务状态、失败计数都要用它。
5. 修改分块或切分算法会改变块键或切分结果 → 已有段落模式项目下次生成时整段重录（花钱）。算法级改动要在 changelog 里说明；需要强制失效时递增 `STAGE_VERSION.ttsBlock`。

**环境坑**
- **Node 版本**：需要 ≥ 22.13（依赖 `node:sqlite`）。这台机器的默认 shell 用的是 `F:\node-v22.0.0`，跑测试会有 47 个失败（`No such built-in module: node:sqlite`）。先执行 `export PATH="/c/Program Files/nodejs:$PATH"`（v24.19）。
- **换行符**：仓库 `core.autocrlf=true`，工作区文件是 CRLF、提交时规范为 LF，属正常现象，不要做全文件换行转换。
- **用 Python/heredoc 改文件时转义会出错**：`"\n"` 曾被写成真实换行导致语法错误。多行或含转义的替换优先用编辑工具（Edit）。
- **vitest 5**：`vi.fn().mockImplementation(fn)` 会在测试体里先无参调用一次 `fn`，实现里要写 `req?.text`。
- **`.mts` 临时脚本**里 `@next/env` 要用默认导入：`import env from "@next/env"; env.loadEnvConfig(...)`。
- **开发服务器**：用户自己在 3000 端口跑着 `next dev`（不要 kill）。需要额外起服务时换端口；若 3000 已有同目录的 dev server，Next 会拒绝再起第二个，此时直接对 3000 做只读请求即可。
- **Gemini**：国内网络需 `.env` 里的 `GOOGLE_GEMINI_PROXY_URL=http://127.0.0.1:19828`（本机 lightningx 系统代理端口，可能变化）；改 `.env` 后要重启 Web 与 Worker。
- **真实服务商测试会花钱**：CosyVoice 一段约 ¥0.015；Gemini 按 token 计费。端到端验证优先用临时 `DATA_DIR`（`mkdtemp`）直接调用 stage，不碰用户的 `data/app.db`。

### 8.4 P4 任务拆解（建议按顺序）

#### P4-1 句子接口补字段（后端，小）
- `app/api/projects/[id]/lines/route.ts` 的 `block` 里加 `splitSource: tts?.block?.splitSource ?? null`（徽标区分「精确切分」/「估算切分」要用）。
- 同一计划块拆小后各子块的 `blockAssetId` 不同，整段试听需要知道子块：加 `subKey: tts?.block?.key ?? null`（子块键形如 `块键#起-止`）。
- 验收：接口返回新字段；`npx tsc --noEmit` 通过。

#### P4-2 句子面板按块分组（前端，主体）
- 数据：`GET /api/projects/[id]/lines` 的 `lines[].block = { key, index, count, confidence, blockSrc, outcome, splitSource, subKey }`；`block` 为 `null` 表示逐句（逐句模式、单句自然段、单独录制、带情绪标签 / SSML 的句子）。
- 把连续且 `block.key` 相同的句子包进一个分组容器：
  - 组头：`第 a–b 句 · N 句`、状态徽标、整段试听（P4-3）、「重录本段」按钮（复用现有 `revoice(lineId)`，它已带确认框）。
  - 组内每句保持现有行 UI（原文、朗读、单句试听、锁定、词典、表达标签），去掉现在的「段落 i/N」小标签和每句上的「重录本段」按钮（移到组头），单句行只保留「单独录制此句」入口（P4-4）。
  - 任务状态：同一块只有一个任务，组内各句的 `job` 相同，只在组头显示一次（排队中 / 合成中 / 失败原因）。
- 徽标映射（按组内各句 `outcome` 汇总）：
  - 全部 `block` 且 `splitSource === "provider"` → 「精确切分」
  - 全部 `block` 且 `splitSource === "vad"` → 「估算切分」（Gemini）
  - 含 `halved` → 「已拆小合成」；含 `line` → 「切分不可靠，已逐句合成」
  - 任一 `confidence < 0.8` → 追加「切分待复核」
  - `outcome` 为 `null`（还没音频）→ 「未配音」
- 逐句模式或 `block === null` 的句子渲染不变。
- 验收：段落模式项目里同段句子成组显示；逐句项目外观与现在一致；定位句子、词典选词、锁定等原有交互不受影响。

#### P4-3 整段试听（前端，小）
- 用 `components/ui.tsx` 的 `AudioButton`（不传 `startMs/endMs` 即播放整个文件）播放 `blockSrc`。
- 组内 `blockSrc` 全相同 → 一个按钮「整段试听」；拆小后有多个不同的 `blockSrc` → 每个子块一个按钮（「试听第 a–b 句」），用 `subKey` 分组去重。
- 退回逐句（`outcome === "line"`）的句子没有 `blockSrc`，不显示整段试听。
- 验收：能听到段落原音频；拆小的段落能分别试听各子块。

#### P4-4 单独录制此句（前后端）
- 字段 `line.ttsIsolated` 已在 schema、`rebuildLines`、`lineTtsKeys` 中生效（测试：`tests/tts-block.test.ts`「单独录制的句子自成一块」）。只缺 UI。
- 入口：段落模式下每句一个开关 / 菜单项「单独录制此句」；已单独录制的显示「取消单独录制」。带情绪标签或 SSML 的句子本来就自成一块，显示为不可切换的说明文字。
- 交互：切换会让本句改用逐句键、同段其余句子重新分块（块键变化）→ **整段都要重录**。先 `confirm` 说明「本句将单独录制，同段其余 N−1 句也会重新合成」，确认后 `store.setDoc` 改 `ttsIsolated`，`await store.flush()`，再调用 `POST /api/projects/[id]/lines/tts {mode:"missing"}` 补齐。
- 已知限制：重录完成前这些句子显示「未配音」、时间轴按估算时长静音（P5「旧音频兜底」解决）。
- 可加测试：`lib/core/lines.test.ts` 验证文案改动后 `ttsIsolated` 随句子 ID 保留。
- 验收：切换后同段按新分块生成；取消后恢复合并；锁定、标注写回不会清掉 `ttsIsolated`（已核实：`lib/pipeline/stages/annotate.ts` 的 `applyAnnotations` 用 `{ ...l, … }` 展开，保留该字段）。

#### P4-5 按块计数与报价文案（前后端，含一个 bug）
- **Bug（已核实）**：`app/api/projects/[id]/lines/tts/route.ts` 返回 `count: jobs.length`，`components/video-controls.tsx` 的 toast 显示「已排队 ${result.count} 句配音」；段落模式下 `jobs.length` 是块数不是句数。改为返回 `{ count: rows.length, jobs: jobs.length }`，文案「已排队 M 句（K 个段落任务）」。
- 全部重录确认框（`batchRevoice`）：段落模式下写明「M 句，合并为 K 个段落任务」。
- 换音色报价 `quoteVoiceChange`（`lib/server/voice-change.ts`）：加 `jobs` 字段 = `ttsSteps(...)` 的长度；`SettingsPanel.applyVoice` 的确认文案在段落模式下补充段落任务数。费用估算已按块计算（`ttsSteps` 的 `cost`），不用改。
- 验收：段落模式下 toast 与确认框的句数正确。

#### P4-6 设置说明与发布
- `SettingsPanel` 的「合成粒度」提示补一句：段落模式句间停顿更舒展，同样文案成片约长 5–15%。
- `lib/changelog.ts` 最前面新增一条（如 `0.13.0`，`feature` / `improvement` 分类），写分组、整段试听、单独录制、计数修正。
- 本文档：§4 表格 P4 改为已完成，追加「P4 实施记录」。
- 验收：`npm run typecheck`、`npm run lint`、`npx vitest run` 全部通过；`/changelog` 页面正常渲染新条目。

#### P4-7 手工验证清单（浏览器）
1. 新建项目，写两个自然段（每段 4–6 句，至少一句像「他说，继续。」这样带逗号的短句），制作设置选 DashScope + 段落 → 应用。
2. 句子面板：同段成组，徽标「精确切分」；整段试听有声音；时间轴预览里句间停顿自然、无爆音。
3. 对某句切「单独录制此句」→ 确认框 → 同段重录 → 该句单独、其余成组。
4. 「重录本段」→ 确认框句数正确 → 只重录该段。
5. 切到 Gemini + 段落（需代理）→ 徽标「估算切分」；若出现「已拆小合成」，整段试听按子块分别可听。
6. 切回逐句 → 面板恢复原样，旧逐句缓存直接复用（不重新计费）。

### 8.5 P4 不做的事
- 不改切分 / 分块算法（改了会导致重录，见 §8.3 第 5 条）。
- 不做停顿缩放系数、强制对齐（放 P5）。
- 不把段落模式改为默认；「实验」标签保留到盲听达标。

### 8.6 盲听如何决定「推荐」
- 音频：§5.3 的 8 对。每对随机 A/B，答案在各目录的 `ab-key.json`，结果填 `ratings.json`。
- 段落模式偏好率 ≥ 70%（分服务商统计）→ 去掉该服务商的「实验」字样，可考虑新项目默认段落模式；Gemini 若不达标，可在 `PARAGRAPH_JOINERS` 中移除 `google-gemini` 关闭。

### 8.7 P5 待办（可选，按用户反馈排期）
- **停顿缩放系数**：若用户觉得段落模式偏慢，给 `voice` 加全局系数（如 0.7×），只影响时间轴排布，不进缓存键。
- **重录期间旧音频兜底**：改句 / 单独录制后，新音频就绪前让未改动的句子继续播放旧音频（需记录每句上次可用的配音键）。
- **强制对齐**：用带字级时间戳的 ASR 给 Gemini 音频对齐，`alignmentSource: "forced"`，字幕从「估算」变为「精确」。
- **Qwen-Audio 段内情绪标签**：探针验证 `[excited]` 等标签能否在整段中间生效；能的话，带标签的句子不必自成一块。
