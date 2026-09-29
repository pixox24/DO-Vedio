# Google Gemini 3.8 TTS 生产接入方案

> 状态：Gemini 适配器、生产流水线与连接诊断已实现；持续灰度观察中
>
> 日期：2026-09-28
>
> 目标：在 DO·Vedio 中稳定接入 Google Gemini API 的 3.8 Flash / Flash-Lite TTS，用于生产视频配音；保持现有逐句缓存、字幕、分镜锚点、Worker 和 Remotion 链路可用。

## 1. 已确认的范围

### 1.1 本阶段必须完成

1. 新增一个 Google Gemini TTS 适配器 `lib/providers/tts/gemini.ts`。
2. 3.8 Flash 和 3.8 Flash-Lite 共用一套适配器，只通过模型目录切换模型 ID。
3. 保留现有统一 TTS 接口，但补齐风格指令、音频格式、usage、对齐来源和能力描述。
4. 先实现 Gemini API；本阶段不创建 `cloud-tts.ts`。
5. 用探针确认请求字段、音频响应格式、长稿完整性、跨段音色稳定性和费用口径后，再接入生产流水线。
6. 生产输出统一为当前剪辑链路可处理的 WAV PCM 音频，且不会对已经是 WAV 的响应重复包装 WAV 头。

### 1.2 本阶段不做

- 不接 Google Cloud Text-to-Speech、Chirp 3 HD 或 Vertex 专用通道。
- 不让浏览器直接调用 Google API；API Key 只在 Next.js 服务端和 Worker 使用。
- 不把 Gemini 的表达指令拼接到朗读正文中。
- 不把 Qwen 的 `[excited]`、`[sad]` 等文本标签发送给 Gemini。
- 不在没有探针数据时宣称 3.8 支持字级时间戳、SSML、数字语速、数字音高或数字音量。
- 不在 Google 请求失败时静默切换到 DashScope；切换服务商会改变声音、时长和字幕锚点，必须由用户明确选择。

## 2. 核心设计决策

### 2.1 AI Studio 与运行时 API 分离

AI Studio 是模型试用、文档和 API Key 管理入口。生产请求由服务端调用 Gemini API 的正式 HTTP 接口，不调用 AI Studio 页面，也不把 Key 暴露到浏览器。

建议环境变量：

```dotenv
GOOGLE_GEMINI_API_KEY=
GOOGLE_GEMINI_API_BASE_URL=
GOOGLE_GEMINI_API_VERSION=
GOOGLE_GEMINI_TTS_FLASH_MODEL=
GOOGLE_GEMINI_TTS_FLASH_LITE_MODEL=
GOOGLE_GEMINI_TTS_ENABLED=false
```

### 2.2 配置状态与连接测试

模型中心通过 `GET /api/providers` 读取当前服务端配置。Google 模型只有在 API Key（`GOOGLE_GEMINI_API_KEY` 或兼容别名 `GEMINI_API_KEY`）存在且 `GOOGLE_GEMINI_TTS_ENABLED=true` 时才显示为「可用」；Key 为空或功能开关关闭时会明确显示「待配置」。

设置页的「测试连接」按钮调用 `POST /api/providers/test`，使用当前模型和 `Kore` 音色发起一次短文本真实 TTS 请求，返回延迟、WAV 参数、usage 和分类错误，但不会写入项目素材、预览缓存或账本。服务端对同一模型/音色设置 5 秒冷却，并使用 15 秒超时，避免连续点击浪费配额。

Key 或功能开关来自 `.env` / `.env.local`，修改后需要重启 Web 和 Worker 才会被进程读取；不需要重新构建。连接测试本身不需要重启，重启完成后即可从模型中心验证新配置。未来若要做到运行中修改 Key，需要迁移到加密配置存储，并让 Provider 主动失效配置缓存。

模型 ID、API 版本、可用音色和价格都必须以首次探针时的官方模型目录为准。代码可以提供默认值，但不能把预览模型名称当成永久协议。

### 2.3 正文与风格指令严格分离

内部请求必须把朗读文本和表达控制建模为两个字段：

```ts
type GeminiSpeechRequest = {
  text: string;          // 必须逐字朗读的正文
  stylePrompt?: string;  // 语气、情绪、节奏、角色表达
  model: string;
  voice: string;
  options?: Record<string, unknown>;
};
```

`text` 来自现有 `spoken` 文本，不能加入“请用沉稳语气朗读”之类的前缀。`stylePrompt` 使用 3.8 官方请求结构中的独立字段；如果实际 API 仍要求不同的结构，适配器按官方协议组装请求，但业务层仍保持字段分离。

这样可以防止模型把指令念出来，也能让缓存键、人工评测和 UI 预览分别记录正文与表达参数。

### 2.4 音频响应按内容检测，不按猜测处理

Gemini 适配器必须实现 `normalizeAudio()`：

1. MIME 为 WAV 且文件头是 `RIFF` / `WAVE`：原样保留，不再添加 WAV 头。
2. MIME 为 `audio/L16`、PCM 或响应没有容器头：按响应提供的采样率、声道和位深只包装一次 WAV 头。
3. 如果返回 MP3、OGG 或其他容器：解码或转换成统一 WAV，再进入素材库。
4. 解析后的采样率、声道、位深、编码、字节数、时长写入资产元数据。
5. 文件头、MIME、PCM 长度和计算出的时长不一致时，任务失败并标记为 `invalid-audio`，不能把损坏文件交给 Remotion。

现有 `pcmToWav()` 只能用于裸 PCM。Gemini 适配器不得无条件调用它。

## 3. 与现有项目的边界

当前项目已有可复用的生产链路：

- [`lib/providers/tts/types.ts`](../lib/providers/tts/types.ts) 定义 TTS Provider、请求和音频结果。
- [`lib/pipeline/stages/tts.ts`](../lib/pipeline/stages/tts.ts) 负责 Worker 任务、缓存、账本、素材和时间戳映射。
- [`lib/core/keys.ts`](../lib/core/keys.ts) 负责朗读文本和音色缓存键。
- [`lib/core/align.ts`](../lib/core/align.ts) 把服务商时间映射回原字幕。
- [`lib/core/timeline.ts`](../lib/core/timeline.ts) 用真实音频时长驱动字幕、镜头和 Remotion。
- [`scripts/tts-probe.ts`](../scripts/tts-probe.ts) 已有探针报告、音频保存和 Markdown 输出能力。

需要改造的硬编码边界：

| 文件 | 改造内容 |
|---|---|
| `lib/providers/tts/types.ts` | 增加 `stylePrompt`、`audio`、`usage`、`alignmentSource`、Google 错误类型和扩展 transport。 |
| `lib/providers/tts/gemini.ts` | Gemini API 请求、响应解析、音频归一化、错误分类、Flash/Flash-Lite 模型目录。 |
| `lib/core/types.ts` | provider 从固定 DashScope 扩展为 `dashscope` / `google-gemini`，增加非敏感 Google 选项。 |
| `lib/pipeline/stages/tts.ts` | 通过 provider factory 调度；不再固定 `dashscopeTts()`；按真实 usage 记账。 |
| `lib/core/keys.ts` | 缓存键加入模型、voice、style、音频输出、对齐策略和所有影响时长/音色的选项；提升 TTS stage 版本。 |
| `lib/pipeline/artifacts.ts` | `voice_stats` 使用完整 voice fingerprint，避免不同 Google 参数共用语速统计。 |
| `app/api/voices/route.ts` | 返回 provider、model、voice、capabilities、limits 和配置状态。 |
| `app/api/voices/preview/route.ts` | 按 provider factory 试听，并限制预览文本和并发。 |
| `app/api/projects/[id]/lines/tts/route.ts` | 成本估算和排队逻辑改为 provider 无关。 |
| `components/video-controls.tsx` | 按能力显示控件；不再用模型名称前缀判断表达能力。 |
| `config/pricing.json` | 增加 Google 的模型和计费单位；未核实价格必须标记为未验证。 |
| `.env.local.example` | 增加 Google 服务端配置说明，不写入任何真实密钥。 |

## 4. 统一 TTS 合约

### 4.1 能力描述

模型目录不能只记录模型名称，还要记录能力。建议增加：

```ts
type TtsCapability =
  | "style-prompt"
  | "multi-speaker"
  | "ssml"
  | "word-timestamps"
  | "sentence-timestamps"
  | "raw-pcm"
  | "wav"
  | "numeric-rate"
  | "numeric-pitch"
  | "numeric-volume";
```

Flash 和 Flash-Lite 即使共用请求结构，也要分别登记 capabilities、limits、价格、最大文本长度和推荐并发。

### 4.2 请求

现有 DashScope 字段需要保留兼容，但新接口不应继续把所有服务商参数压成同一种数字语义：

```ts
type TtsRequest = {
  text: string;
  model: string;
  voice: string;
  stylePrompt?: string;
  textType: "PlainText";
  output: {
    encoding: "LINEAR16" | "WAV";
    sampleRateHertz?: number;
  };
  alignment: "provider" | "estimated";
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
};
```

Gemini 3.8 没有经过探针验证的数字语速、音高、音量字段时，UI 不显示对应精确滑块。表达控制使用 `stylePrompt`；需要后处理的增益、变速或变调必须单独标记为后处理，不能假装是模型原生能力。

### 4.3 结果

```ts
type TtsUsage = {
  unit: "characters" | "input-tokens" | "output-tokens" | "seconds" | "unknown";
  quantity: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  costSource: "provider" | "pricing-table" | "unknown";
};

type TtsResult = {
  audio: Buffer;
  mime: "audio/wav";
  sampleRate: number;
  channels: number;
  durationMs: number;
  words: SynthWord[];
  alignmentSource: "provider" | "forced" | "estimated";
  usage: TtsUsage;
};
```

没有时间戳时返回空 `words`，并明确 `alignmentSource: "estimated"`。不能用空数组伪装成已对齐。

### 4.4 错误分类

统一错误类型：

```ts
type TtsErrorCode =
  | "auth"
  | "invalid-request"
  | "model-unavailable"
  | "quota"
  | "rate-limit"
  | "timeout"
  | "upstream"
  | "invalid-audio"
  | "safety"
  | "aborted";
```

- `429`、临时网络错误、`5xx`：指数退避并重试，遵守 `Retry-After`。
- 鉴权、模型不存在、参数错误、内容安全拒绝：永久失败，给用户可读原因。
- 用户取消：停止请求，不创建新的重试任务。
- 响应成功但没有有效音频：按 `invalid-audio` 处理，不写缓存。

## 5. Gemini 适配器实现方案

### 5.1 请求生命周期

1. 验证模型、voice、文本长度和 stylePrompt 长度。
2. 生成请求 fingerprint；fingerprint 不包含 API Key。
3. 组装 3.8 官方请求体，正文和表达字段分开。
4. 设置响应为音频模式，使用 AbortSignal 和总超时。
5. 检查 HTTP 状态、错误结构、响应候选和音频 MIME。
6. 找到音频 Base64/二进制内容后执行 `normalizeAudio()`。
7. 计算时长，解析 usage；没有 provider 费用时只计算估算值。
8. 返回统一 `TtsResult`，由现有 TTS stage 写入资产、缓存和账本。

### 5.2 请求与正文完整性

适配器必须要求模型“只朗读正文”，但不能把要求拼到 `text` 中。正文内容始终来自：

```text
原文字幕 -> 读音标注 -> spoken -> Gemini text
```

字幕原文、读音替换文本、stylePrompt、模型和 voice 分开记录。任何模型返回的额外解释都不能进入音频正文；如果 3.8 提供可验证的文本输出或响应元数据，应在探针中检查，否则通过长稿尾句人工听评确认。

### 5.3 音频格式策略

优先请求 Gemini 官方支持且稳定的线性 PCM/WAV 输出。统一内部格式为：

- WAV
- PCM 16 bit
- 单声道
- 采样率以实际响应为准并写入元数据

不在适配器中强行改变音频时长。最终视频混音和响度标准化仍由现有 `render` 阶段处理。

## 6. 项目数据与缓存

### 6.1 VoiceSettings

建议保持旧字段兼容，同时增加 Google 部分：

```ts
voice: {
  provider: "google-gemini";
  model: string;
  voiceId: string;
  instruction: string;
  google?: {
    stylePrompt: string;
    locale?: string;
    outputEncoding?: "LINEAR16" | "WAV";
    sampleRateHertz?: number;
    alignment: "provider" | "estimated";
  };
}
```

API Key、完整请求头和服务端连接信息绝不能进入 ProjectDoc。

### 6.2 缓存键

`ttsKey()` 必须包含：

- stage 版本
- `spoken` 和 textType
- provider、model、voice
- stylePrompt/instruction
- locale
- 输出编码、采样率
- 对齐策略
- 所有会改变音频的 providerOptions

修改这些字段时只重新生成受影响的句子。缓存命中必须保证不发起上游请求。

`voiceKeyOf()` 和 `voice_stats` 也要使用同一份完整 fingerprint，避免 Flash 与 Flash-Lite、不同 style 或不同 voice 共用实测语速。

### 6.3 GenerationRun 与账本

GenerationRun 记录非敏感参数：模型、voice、style fingerprint、文本长度、音频时长、延迟、重试次数、alignmentSource 和 usage。不要记录完整正文或 API Key，除非后续明确需要并完成脱敏。

账本需要支持不同单位。Google 接口没有返回真实金额时：

- `quantity` 记录 provider usage；
- `costYuan` 记录价格表估算；
- `costSource` 标记为 `pricing-table`；
- 不能把估算金额写成实际扣费。

## 7. 探针与基准测试

### 7.1 模型矩阵

对每个模型至少测试：

- 3.8 Flash
- 3.8 Flash-Lite
- 至少一个中文主音色
- 同一音色在两个模型中的表现

如果官方模型目录中的实际 ID 与上述名称不同，只替换配置，不改变探针结构。

### 7.2 文本用例

每个模型和 voice 都执行以下样本：

1. 普通中文旁白。
2. 年份、百分比、小数、单位和混合数字。
3. 英文缩写、URL、产品名和中英文混排。
4. 人名、地名、专有名词和词典读音替换。
5. 严肃、悬疑、温暖、兴奋等 stylePrompt。
6. 长句和多标点。
7. 逗号、分号、破折号、段间停顿。
8. 接近模型输入上限的长稿。
9. 明确的尾句标记，例如“本段最后一句是：测试结束。”。
10. 六段连续短句，使用同一 voice 和同一 style，检查跨段音色、响度、语速和情绪稳定性。

### 7.3 自动记录

每次探针保存：

```ts
type ProbeRecord = {
  text: string;
  model: string;
  voice: string;
  stylePrompt: string;
  status: "succeeded" | "failed" | "skipped";
  elapsedMs: number;
  httpStatus?: number;
  retryCount: number;
  mime: string;
  sampleRate?: number;
  channels?: number;
  audioBytes?: number;
  durationMs?: number;
  usage?: TtsUsage;
  estimatedCost?: number;
  audioPath?: string;
  audioSha256?: string;
  errorCode?: string;
  error?: string;
  humanRating?: HumanRating;
};

type HumanRating = {
  textCompleteness: 1 | 2 | 3 | 4 | 5;
  pronunciation: 1 | 2 | 3 | 4 | 5;
  styleAdherence: 1 | 2 | 3 | 4 | 5;
  pauseNaturalness: 1 | 2 | 3 | 4 | 5;
  crossSegmentConsistency: 1 | 2 | 3 | 4 | 5;
  tailComplete: boolean;
  notes: string;
};
```

输出 `report.json`、`report.md` 和音频目录。人工评分单独保存，不能由音频哈希或时长变化推断情绪质量。

### 7.4 发布前门槛

初始建议门槛，实际值可在探针后调整：

- 有效音频率 100%；
- 正文无增读、漏读，尾句完整率 100%；
- WAV 头和 MIME 一致率 100%；
- 缓存命中时上游请求数为 0；
- 临时错误重试后成功率不低于 99%；
- 短句 p95 延迟目标不超过 8 秒；
- 同一 voice 跨段一致性人工评分平均不低于 4/5；
- 最终成片响度继续满足现有 `-14 ±1 LUFS` 目标。

## 8. 性能与可靠性

### 8.1 请求粒度

默认继续逐句合成。这样能保持：

- 改一句只重录一句；
- 失败只重试当前句；
- 字幕和镜头锚点可以复用；
- 缓存粒度和当前 Worker 一致。

长稿不应默认一次性发送。只有在探针证明多段音色连续性明显更好，并且具备可靠分段对齐方案时，才增加“连续段落模式”。

### 8.2 并发与限流

- Google provider 初始并发建议为 2，探针确认配额后再提升到 3。
- 并发按 provider/model 单独限制，不影响图片或其他 TTS。
- 对 `429` 使用指数退避、随机抖动和 `Retry-After`。
- 对长稿设置总超时和单请求超时，不能让 Worker 永久占用租约。
- 上游请求使用幂等 fingerprint；任务重试不能重复写入不同缓存结果。

### 8.3 取消与恢复

- 用户停止制作时，通过现有 `AbortSignal` 取消 fetch。
- 取消不写缓存、不记成功账单。
- 已成功的句子保留，下一次从缺失句继续。
- 新音频成功写入后才替换旧缓存，避免失败导致项目失声。

## 9. 用户体验与 UI

### 9.1 设置页面

设置页按以下顺序组织：

1. Provider：Google Gemini / DashScope。
2. Model：3.8 Flash / 3.8 Flash-Lite，并显示速度、质量、价格和配置状态。
3. Voice：音色下拉、性别/风格、试听按钮。
4. Style：自然语言表达指令，提供中文示例和最大长度提示。
5. Advanced：语言、输出格式、对齐策略；默认折叠。
6. Budget：显示本次预计调用量和费用估算。

UI 只能根据模型 capabilities 显示控件。模型不支持的 SSML、数值 pitch 或时间戳不能显示为可操作项。

### 9.2 试听

- 默认使用短的中文样本文本，避免试听请求过大。
- 修改 model、voice 或 style 后，试听按钮显示当前配置状态。
- 试听请求单独缓存，不计入项目生产账本；可记录限流指标。
- 试听结果显示音频时长、模型和 voice，失败时显示可执行的错误信息。

### 9.3 逐句表达

现有句子面板的 `voiceTag` 改为 provider capability 驱动：

- Gemini：生成句级 stylePrompt 覆盖或情绪指令。
- DashScope：保留现有情绪标签和 SSML。
- 不支持句级表达的模型：显示只读提示，而不是无效选择框。

修改某一句的表达，只重新排队该句。修改全局 voice/model/style 时，明确提示受影响句数和预估费用，再让用户确认重录。

### 9.4 对齐质量提示

句子列表和时间轴区分：

- `精确对齐`：服务商返回或后续 forced alignment。
- `估算对齐`：按字符均分，字幕和镜头锚点可能有误差。

不能用一个统一的“已完成”状态掩盖对齐质量差异。

## 10. 安全与隐私

- `GOOGLE_GEMINI_API_KEY` 只在服务端环境变量读取。
- API Key 不进入 ProjectDoc、浏览器状态、错误消息、缓存键、日志或 GenerationRun 参数。
- 日志只记录模型、voice、文本长度、请求 fingerprint、状态和延迟，不默认记录正文。
- 设置页明确提示：启用 Google provider 会把配音文本发送到 Google Gemini API。
- 试听接口限制文本长度、用户频率和并发，避免被当作开放代理。
- 生产环境使用 HTTPS，错误响应不能回显完整上游响应或请求头。

## 11. 测试计划

### 11.1 单元测试

- Gemini 请求体组装：正文和 stylePrompt 分离。
- Flash / Flash-Lite 模型切换。
- Base64、inlineData 和 MIME 解析。
- 已有 WAV 原样通过。
- 裸 PCM 只包装一次 WAV 头。
- 错误状态分类和 Retry-After 解析。
- `ttsKey()` 覆盖全部 Google 参数。
- 旧 DashScope VoiceSettings 解析不回归。
- usage 和 estimatedCost 的单位转换。

### 11.2 集成测试

- 使用本地 mock HTTP 服务验证超时、429、500、空音频和损坏音频。
- 验证任务重试、取消、缓存命中和旧音频保留。
- 验证生成记录、账本和资产元数据一致。
- 验证无 timestamps 时 `aligned=false` 和时间轴估算提示。

### 11.3 真实探针

真实 API 探针不进入 CI，使用显式环境变量运行。没有 Key 时必须跳过并说明原因，不把“未配置”当作接口失败。

## 12. 分阶段发布

### Phase 0：协议探针

- 确认 3.8 Flash / Flash-Lite 的真实模型 ID、请求字段、响应字段、MIME、音频容器、usage 和价格口径。
- 扩展 `scripts/tts-probe.ts`，生成 JSON、Markdown 和人工试听目录。
- 未通过长稿尾句和跨段稳定性测试前，不接入项目生产按钮。

### Phase 1：适配器与内部测试

- 新增 `gemini.ts`、音频归一化和错误分类。
- 增加 catalog、环境变量、mock 测试和 feature flag。
- 只允许内部项目选择 Google provider。

### Phase 2：生产流水线接入

- provider factory 接入 TTS stage、试听、批量重录和计费。
- 更新缓存键、usage、GenerationRun、voice_stats 和资产元数据。
- 接入设置页、句子面板、对齐质量提示。

### Phase 3：小范围灰度

- 选取真实中文项目，分别测试 Flash 和 Flash-Lite。
- 观察成功率、p95 延迟、429、成本估算偏差、尾句完整率和人工评分。
- 发现模型或 API 不稳定时只关闭 Google feature flag，不影响 DashScope。

### Phase 4：默认生产

- 两个模型都通过发布门槛后，允许项目默认选择 Google。
- 持续保存每周探针结果，检测模型更新、音色变化和价格变化。
- 新增重大功能后按仓库规则更新 `lib/changelog.ts`，并运行 typecheck、lint 和 `/changelog` 页面检查。

## 13. 完成定义

本方案完成的判定不是“接口返回 200”，而是同时满足：

1. Flash 和 Flash-Lite 都能稳定生成有效音频。
2. stylePrompt 不会被朗读，正文没有增读或漏读。
3. 已有 WAV 不会被重复包装，生成文件可被浏览器、FFmpeg、Remotion 正常读取。
4. 长稿最后一句完整，跨段同一 voice 的音色、音量和语速稳定。
5. 修改一句只重录一句，缓存命中不产生上游费用。
6. 429、超时、取消、损坏音频和安全拒绝都有正确的恢复或提示。
7. 生产 UI 不展示模型不支持的参数，用户能看见模型、voice、style、费用估算和对齐质量。
8. 真实探针、单元测试、集成测试、`npm run typecheck`、`npm run lint` 和最终 `/changelog` 检查全部通过。

## 14. 官方资料

- [Google AI Studio 文档](https://aistudio.google.com/docs)
- [Gemini API 文档](https://ai.google.dev/gemini-api/docs)
- [Gemini TTS / Speech Generation](https://ai.google.dev/gemini-api/docs/speech-generation)
- [Gemini API Generate Content](https://ai.google.dev/api/generate-content)

实现阶段必须以当前官方文档、模型目录和实际 API 响应为准；本计划中的模型名、字段和价格只作为接入边界，不替代运行前探针验证。
