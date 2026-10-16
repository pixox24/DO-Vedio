# 视频素材管线（Pexels）实施规划

日期：2026-10-16。执行基线：`51ad77f`（0.88.1）。分支：`feat/stock-pipeline`。

本文是实施依据。第 5–7 节的契约、改动清单和阶段验收是任务要求；完成状态另记。功能收口后按仓库约定移入 `docs/archive/`。

## 1. 目标与边界

在制作设置里新增第三个画面驱动管线 **`stock`（视频素材）**，与现有 `image`（图片驱动）、`video`（AI 视频驱动）并列。用户点「制作成片」走到分镜之后，系统自动按镜头检索 Pexels 视频素材、入库、写回，下游完全复用 AI 视频管线已经验证过的渲染与门禁链路。

| 项目 | 本次实施 | 明确不做 |
| --- | --- | --- |
| 管线枚举 | `visualPipeline` 增加 `"stock"`，默认仍 `image` | 同一项目内 image/video/stock 混合 |
| 分镜 | 复用 `videoStoryboardPrompt` 同一次调用，额外产出 `stockQuery` | 为 stock 单独写一套分镜提示词 |
| 素材来源 | Pexels API（`searchVideos` + `pickFile`），来源层可插拔 | 本地 `Video-asset-library/`（留接口，不接） |
| 挑选 | 检索后自动采用第 1 条匹配结果 | 候选选择 UI、整批审图 |
| 重搜 | 单镜头「重新搜索素材」，带已试素材游标 | 全片一键重搜 |
| 时长不足 | 检索时 `min_duration` 硬过滤，搜不到即 `PermanentError` | 循环播放、慢放拉伸、改 remotion |
| 画幅 | 按输出画幅检索对应方向，素材方向不符直接跳过 | 横屏素材裁给竖屏 |
| 费用 | 免费额度内（200 请求/小时），进账本记 0 元 | 付费库存源（Pixabay/Coverr 等） |

## 2. 已确认的决策

### 2.1 用户拍板

| # | 决策项 | 结论 |
| --- | --- | --- |
| 1 | 检索词来源 | **塞进分镜那次 LLM 调用**，存到独立的 `shot.stockQuery`（不放进 `videoPlanSchema`） |
| 2 | 挑选方式 | 自动采用最佳 1 条；不满意用「重新搜索素材」重搜（**带游标**） |
| 3 | 时长不足 | 检索时用 `min_duration` 硬过滤；搜不到抛 `PermanentError`，提示改描述或换 AI 视频 |
| 4 | 本地素材库 | 本次不接入，只用 Pexels API |

### 2.2 调研 MoneyPrinterTurbo 后追加的三条修正

来源：`app/services/material.py`（3042 行）、`material_cache.py`、`llm.py:1009`。实读结论已核对，非推测。

| # | 修正 | 理由 |
| --- | --- | --- |
| 1 | `stockQuery` 放**独立字段**，不进 `videoPlanSchema` | `videoGenerationSnapshot`（`lib/core/video.ts:113`）的哈希输入只有 `videoPlan` 与条件性 `description`。新增独立字段**不会让已有 AI 视频产物集体失效**。同时拿到 MPT 验证过的检索质量（prompt 硬约束「必须带主体」）与零额外调用 |
| 2 | 重搜必须带游标 | MPT 的 `_download_videos_by_script_order` 给每个关键词独立下标，只推进本轮真正尝试过的候选。我们若只清缓存重跑，**会拿到同一条结果** |
| 3 | 加一层 URL → assetId 缓存 | `putFile` 是 sha256 内容寻址（`lib/server/media.ts:108`），存储天然去重，但**没有「按 URL 复用」这一层**：同一素材被两个镜头选中会下载两次 |

### 2.3 采纳的 MPT 细节

| 细节 | 落点 |
| --- | --- |
| rendition 选「能填满画布的最小档」 | `pickFile`：先按方向过滤 → 再 `w >= 目标宽 && h >= 目标高` → `min(key = w*h)`。方向无法确认的素材**直接跳过**（避免竖屏混进横屏出黑边） |
| 空结果绝不写缓存 | 空列表同时表示「没结果」和「请求失败」，宁可下次重试也不缓存 |
| 缓存 key 不含 API Key | Key 只鉴权，不影响搜索结果。Key = `sha256({provider, query, orientation, minDurationMs, aspect})` |
| 密钥绝不落盘 | `_safe_public_url` 剥 query 与 userinfo。**我们的 `putBuffer(meta)` 会把 meta 写进 assets 表**（`lib/server/media.ts:147`），直接塞 Pexels 下载 URL 会永久落盘带签名的地址 |
| 并发默认串行 | `concurrency: 1`，别开高并发 |
| 失败分层 | 401/403 → `PermanentError`；429 → 可重试 `Error`（带 retry-after）；非 JSON / 网络错误分开识别 |
| 不要抄 | 素材池模型、一素材切多段、关键词只 5–8 个、「搜索永不抛错返回空列表」（MPT 自己在注释里承认为技术债，我们的 `PermanentError` vs 可重试 `Error` 已优于它） |

## 3. 架构：一条管线 + 可插拔来源

### 3.1 数据流

```
文案 → 断句标注 → 配音 → 识别角色场景 → 分镜（LLM）
                                              │
                          ┌───────────────────┴───────────────────┐
                          │ visualPipeline === "stock"            │
                          │ 同一次调用额外产出 shot.stockQuery     │
                          └───────────────────┬───────────────────┘
                                              │  shot.kind = "video" + videoPlan + stockQuery
                                              ▼
                              ┌───────────────────────────────┐
                              │  stage: shot-stock            │
                              │  1. 锁 / 快照 / requestHash   │
                              │  2. URL 缓存命中？直接写回     │
                              │  3. searchVideos(query)       │
                              │  4. pickFile（画幅 + 时长）    │
                              │  5. putStream 入素材库         │
                              │  6. 写回候选 + 变体 + 双哈希   │
                              └───────────────┬───────────────┘
                                              │ assetVariants[aspect].promptHash = 快照哈希
                                              ▼
        ┌─────────────────────────────────────────────────────────┐
        │  完全复用（对「字节从哪来」毫不知情）                    │
        │  lib/core/timeline.ts   videoSrc / videoPlayback / cut   │
        │  remotion/shots/video.tsx                                │
        │  videoRenderProblems    kind/videoPlan → 快照比对 → 时长  │
        │  mergeCandidateHistory / selectShotCandidate / 恢复机制    │
        └─────────────────────────────────────────────────────────┘
```

### 3.2 为什么这是最小闭环

三个「不用改」的地方，决定了本次只在**素材获取**这一段写新代码：

1. **分镜层复用**。`videoStoryboardPrompt` 已经在产出 `videoPlan`（startState/action/camera/endState）与英文执行计划；`normalizeVideoShots`（`lib/core/shots.ts:235`）把镜头规格化成 `kind:"video"`、`motion:"none"`、上限 15s。stock 需要的信息这里已全有，只多一个 `stockQuery`。
2. **下游复用**。`lib/core/timeline.ts:379` 的 `videoPipeline` 标志负责 `videoSrc`、`videoPlayback` 的裁剪与末帧保持、转场强制 `cut`；`videoRenderProblems` 校验的是 `assetVariants[aspect]` + `getAsset().durationMs` 的探测结果——它对素材来源毫不知情。
3. **候选 / 采用 / 恢复机制复用**。`mergeCandidateHistory`、`selectShotCandidate`、`adoptReadyVideoCandidates` 只看 `assetVariants` 与 `promptHash`。

### 3.3 为什么不做成 `local` + `stock` 两个枚举值

`Video-asset-library/`（21 个 mp4 + `_index/manifest.json`）与 Pexels 方案**完全同构**：分镜复用 video 分支、下游复用 `kind:"video"` 通道，只有「素材从哪来」不同。所以合成**一条 `stock` 管线**，来源做成可插拔一层（`lib/providers/stock/`）。本次只写 `pexels.ts`，下次接本地库只是加一个文件，不用把第 6 节那张表重走一遍。

## 4. 三个必须照抄的契约

漏掉任何一条都不会报错，只会**静默卡住**。

### 4.1 写回时必须写两个哈希

`videoRenderProblems`（`lib/pipeline/video-generation.ts:52`）比对的是 `assetVariants[aspect].promptHash`；该值来自 `selectShotCandidate` → `variantFor(..., candidate.generationPromptHash)`（`lib/core/shot-asset.ts:41`）。

所以候选里 **`promptHash` 和 `generationPromptHash` 必须都等于快照哈希**。只写 `promptHash` 会让 `variant.promptHash` 落到兜底值 `"unknown"`（`shot-asset.ts:14`），门禁**永远报「视频缺失或已过期」，而且不报错、只卡住**。

`runVideoShot` 在 `lib/pipeline/stages/shot-generate.ts:243` 是老老实实两个都写的：

```ts
const fresh = assets.map((asset, candidateIndex) => ({
  id: `${input.attemptId}:${candidateIndex}`, assetId: asset, selected: false,
  kind: "video" as const, frame: { aspect: frame.aspect },
  promptHash: snapshot.hash, generationPromptHash: snapshot.hash,   // ← 两个都要
}));
```

### 4.2 写回要照抄 `runVideoShot` 的四步

`lib/pipeline/stages/shot-generate.ts:240-260`：

1. 重新取当前 shot，`ctx.current()` + pipeline 一致 + 未锁 + `快照哈希仍相等`，任一不满足返回 `null`（不写）
2. `mergeCandidateHistory(history, fresh, currentAssetId)` 合并而非替换
3. `selectShotCandidate(next, selected.id, { aspect, framing: videoAssetFraming(doc), aspects: outputSpecsFor(doc.settings).map(s => s.aspect) })`
4. 补 `width / height / generatedAt`（`shot-generate.ts:257`）

### 4.3 门禁只改一行

`videoRenderProblems` 的骨架（kind/videoPlan → sync → 快照哈希比对 → `getAsset().durationMs` 探测）对 stock 完全适用。**只把内部 `videoGenerationSnapshot(...)`（`video-generation.ts:50`）换成按 pipeline 分发的 `snapshotFor()`**，不抄第二份。`usableVideoCandidate`（`:61`）同样处理。

### 4.4 时长门禁的硬约束

`videoPlayback`（`lib/core/video.ts:136`）要求 `durationMs >= targetDurationMs - VIDEO_MAX_HOLD_MS`（100ms）才 `videoDurationReady = true`，否则 `videoRenderProblems` 直接卡住渲染。

→ 检索的 `min_duration` 必须 ≥ 目标时长（向上取整到秒），且 `pickFile` 后**再按实测时长复检**（Pexels 的 `duration` 字段是整数秒，实测可能短一点）。不足就跳到下一个候选，全不满足才 `PermanentError`。

### 4.5 重搜游标不进哈希（重要）

**不要**把 `excludeAssetIds` 放进快照哈希。理由：候选池被 `MAX_CANDIDATES = 8` 截断（`shot-generate.ts:37`），一旦有候选被淘汰，从文档推导的排除集就会变，哈希跟着翻转，**门禁会把当前正在用的素材误判成过期**。

正确做法：

- 快照哈希只由**文档里稳定可复现的输入**决定：`query`、`aspect`/`orientation`、`minDurationMs`、`targetDurationMs`、覆盖句的文本与配音。
- `excludeAssetIds` 只走**任务 input**，由重搜路由在入队时算好（= 该镜头当前候选的全部 `assetId`），stage 用它跳过已试过的素材。
- 因此重搜前后快照哈希不变，写回的 `promptHash` 始终是同一个稳定值，门禁天然通过。

## 5. 新增文件

| 文件 | 职责 | 关键导出 |
| --- | --- | --- |
| `lib/providers/stock/types.ts` | 来源层的公共类型与接口 | `StockClip`、`StockFile`、`StockSearchOptions`、`StockSource` |
| `lib/providers/stock/pexels.ts` | Pexels 实现，纯 HTTP，读服务端 `PEXELS_API_KEY` | `searchVideos(query, opts)`、`pickFile(clip, frame)` |
| `lib/providers/stock/index.ts` | 来源注册表与统一入口 | `stockSources`、`searchStock(query, opts)`、`stockConfigured()` |
| `lib/core/stock.ts` | 纯函数：检索词、快照、过期判定、画幅 | `stockQuery(shot)`、`effectiveStockQuery(shot)`、`stockFrame(doc)`、`stockSnapshot(...)`、`snapshotFor(...)`、`stockAssetStale(...)`、`stockExclusions(shot)`、`stockMinDurationSec(...)` |
| `lib/pipeline/stock-cache.ts` | 两层缓存：按快照哈希复用素材、按 URL 哈希复用下载 | `cachedStockAsset` / `rememberStockAsset` / `cachedStockFile` / `rememberStockFile` |
| `scripts/stock-probe.ts` | 真打 Pexels 的探测脚本（`npm run stock:probe`） | 检索、`pickFile`、失败分层、`size=medium` 与 `min_duration` 单位核实 |
| `lib/pipeline/stages/shot-stock.ts` | 新 stage，骨架照 `shot-reference.ts` | `shotStockStage`、`enqueueStockShot(...)`、`stockPrerequisite(...)` |
| `app/api/projects/[id]/shots/[shotId]/stock/route.ts` | 「重新搜索素材」入口 | `POST` |
| `app/api/stock/route.ts` | Key 状态 + 测试连接（设置面板用） | `GET`、`POST` |

### 5.1 `lib/providers/stock/types.ts`

```ts
export type StockFile = { id: number; url: string; width: number; height: number; quality: string; fileType: string };
export type StockClip = {
  id: number; pageUrl: string; author: string; authorUrl: string;
  durationSec: number; width: number; height: number; files: StockFile[];
};
export type StockSearchOptions = { orientation?: "landscape" | "portrait"; minDurationSec?: number; perPage?: number };
export type StockSource = {
  id: string;
  label: string;
  configured(): boolean;
  search(query: string, opts: StockSearchOptions, signal: AbortSignal): Promise<StockClip[]>;
  pickFile(clip: StockClip, frame: GenerationFrame): StockFile | undefined;
};
```

### 5.2 `lib/providers/stock/pexels.ts`

- 端点：`GET https://api.pexels.com/videos/search?query=&orientation=&size=medium&per_page=&min_duration=`，头 `Authorization: <PEXELS_API_KEY>`。
- `1:1` 输出**不传** `orientation`（两个方向裁切都能用），与 MPT 一致；本项目只有 `16:9`/`9:16`，按 `aspect` 映射。
- `pickFile`：先滤 `fileType === "video/mp4"` → 再滤 `w >= frame.width && h >= frame.height` → 取 `min(key = w*h)`；无匹配返回 `undefined`（调用方跳到下一个候选）。
- 失败分层：`401/403` → `PermanentError("Pexels API Key 无效或权限不足")`；`429` → `Error` 并带上 `retry-after`（走任务系统重试语义）；非 JSON / 网络错误 → `networkError(e, "检索 Pexels 素材")`（复用 `lib/providers/http.ts`）。
- 请求一律带 `signal`，超时用 `longRequest` 之外的普通 fetch 即可（搜索是短请求），但**下载**用 `longRequest`（`lib/providers/http.ts:12`）。

### 5.3 `lib/core/stock.ts`

```ts
/** 规则派生的兜底检索词。分镜 LLM 已给 stockQuery 时不用它。必须可复现：它是缓存键的一部分。 */
export function stockQuery(shot: Shot): string;

/** stock 的输出画幅。与 videoFrame 同理：默认取第一个输出规格。 */
export function stockFrame(doc: ProjectDoc, frame?: GenerationFrame): GenerationFrame;

/** 检索方向：由画幅决定。竖屏素材给横屏用会被 cover 裁掉两侧，不做这件事。 */
export function stockOrientation(frame: GenerationFrame): "landscape" | "portrait";

/** 已试素材游标：该镜头当前候选的全部 assetId。只进任务 input，不进哈希。 */
export function stockExclusions(shot: Shot): string[];

export const STOCK_SNAPSHOT_VERSION = 1;

/** 与 videoGenerationSnapshot 同形：{ hash, key, timing }。哈希输入只含文档里稳定可复现的部分。 */
export function stockSnapshot(doc: ProjectDoc, shot: Shot, timeline: Timeline, frame: GenerationFrame): {
  hash: string; key: string; timing: VideoShotTiming; query: string; minDurationSec: number;
};

/** 复用 videoGenerationSnapshot 的骨架，只换哈希输入。门禁与编排都通过 snapshotFor 分发。 */
export function snapshotFor(doc: ProjectDoc, shot: Shot, timeline: Timeline, frame: GenerationFrame) {
  return isAiVideo(doc.settings.visualPipeline)
    ? videoGenerationSnapshot(doc, shot, timeline, frame)
    : stockSnapshot(doc, shot, timeline, frame);
}

export function stockAssetStale(doc: ProjectDoc, shot: Shot, timeline: Timeline, frame: GenerationFrame): boolean {
  return !!shot.assetId && shot.assetPromptHash !== stockSnapshot(doc, shot, timeline, frame).hash;
}
```

`stockSnapshot` 的哈希输入（对齐 `videoGenerationSnapshot` 的字段风格）：

```ts
quickHash({
  version: STOCK_SNAPSHOT_VERSION, pipeline: "stock",
  aspect: frame.aspect, orientation: stockOrientation(frame),
  query: shot.stockQuery ?? stockQuery(shot),
  minDurationSec, targetDurationMs: timing.targetDurationMs, requestDurationSeconds: timing.requestDurationSeconds,
  seed: shot.seed,
  lines: 覆盖句的 { id, text, spans },
  voices: 覆盖句的配音 { lineId, assetId, trimStartMs, startMs, durationMs },
  missingTtsLineIds: timing.missingTtsLineIds,
})
```

`key` 用 `stock:${hash}` 前缀。`timing` 直接复用 `videoShotTiming`（`lib/core/video.ts:25`）。

> 检索词退化策略：分镜没给 `stockQuery` 时用 `stockQuery(shot)` 兜底（从 `videoPlan.startState` / `action` 抽英文名词）。同时 `staleRanges` 在 stock 模式下会把「缺 `stockQuery`」视为过期，下一次分镜会补齐——所以兜底只是过渡，不是主路径。

### 5.4 `lib/pipeline/stages/shot-stock.ts`

执行顺序：

1. 取项目与镜头；`!isVideoForm(pipeline)` 或 `shot.kind !== "video"` 或 `!shot.videoPlan` → `PermanentError("视频镜头不存在，请重新导演")`
2. 已锁 → `PermanentError("镜头已锁定，请先解锁")`
3. `videoPlanNeedsSync(shot)` → `PermanentError("等待中文镜头要求同步到执行计划")`
4. 算 `snapshot = stockSnapshot(...)`；`input.requestHash !== snapshot.hash` → `PermanentError("素材输入已变化，请重新搜索")`
5. `!stockConfigured()` → `PermanentError("Pexels API Key 未配置，请在模型中心配置")`
6. **先查缓存**：`cacheGet('stock:' + snapshot.hash)`，命中且素材仍在 → 直接按第 10 步写回，不打网络
7. 再查 URL 缓存：`cacheGet('stock-url:' + md5(file.url))`（**query 参数必须参与 hash**），命中直接写回
8. `searchStock(query, { orientation, minDurationSec, perPage: 10 }, ctx.signal)`
   - 0 结果 → `PermanentError("没有找到「{query}」的素材，请改镜头描述或改用 AI 视频")`
   - 按返回顺序跳过 `input.excludeAssetIds` 命中的素材
9. 逐个候选：`pickFile(clip, frame)` → `putStream(fetch(file.url, { signal, ...longRequest }).body, 200MB, { meta })` → `getAsset(assetId).durationMs` 复检 ≥ `targetDurationMs - 100`。不足就跳到下一个；全不满足 → `PermanentError("找到的素材都比镜头短，请改用 AI 视频")`
10. 写回，严格照抄 4.1 / 4.2：候选 1 条（两个哈希都填）→ `selectShotCandidate(..., videoAssetFraming(doc))` → 补 `width/height/generatedAt`
11. `cachePut('stock:' + snapshot.hash, "stock", { assetId, clipId, author, pageUrl })`；`cachePut('stock-url:' + md5(url), ...)`
12. `beginGenerationRun({ providerId: "pexels", modelId: "pexels-video", kind: "video", inputHash: snapshot.hash, params: {...} })` + `finishGenerationRun`，让用量页能看到检索记录

stage 声明：

```ts
export const shotStockStage = defineStage<ShotStockInput, { shotId: string; assetId: string }>({
  name: "shot-stock",
  concurrency: 1,      // Pexels 免费额度 200 请求/小时，搜索与下载都算
  async run(input, ctx) { ... },
});
```

**`meta` 里绝不能放 Pexels 的下载 URL**（可能带签名/临时 token）。按白名单只写：`{ source: "pexels", clipId, author, pageUrl, shotId, projectId, stage: "shot-stock", frame }`。`pageUrl` 是人可点的网页地址，不是带凭据的下载地址。

### 5.5 `app/api/projects/[id]/shots/[shotId]/stock/route.ts`

照 `app/api/projects/[id]/shots/[shotId]/reference/route.ts` 写：

```
POST body: {}（可空）
校验：镜头存在 / isVideoForm / shot.kind === "video" / !!videoPlan / 未锁 / 未待同步
入队：enqueueStockShot(id, doc, shot, stockFrame(doc), {
        requestHash: stockSnapshot(...).hash,
        excludeAssetIds: stockExclusions(shot),      // ← 游标只在这里
      })
返回：{ job, shot, snapshotHash }
```

### 5.6 `app/api/stock/route.ts`

`providerKinds`（`lib/providers/types.ts:1`）是 `["text","image","video","tts","align","lipsync"]`，**没有 stock**。Pexels 不是生成式服务商，**不要往 `builtinModels`（`lib/providers/catalog.ts`）里塞 kind `video` 的条目**——那会污染视频模型下拉框。

改为独立的轻量路由：

- `GET` → `{ configured: !!process.env.PEXELS_API_KEY?.trim(), provider: "pexels", label: "Pexels" }`
- `POST` → 打一次 `searchVideos("nature", { perPage: 1 })` 做连通性测试，返回 `{ ok: true }` 或 `{ ok: false, message }`

设置面板拿它显示「Key 已配置 / 未配置」和「测试连接」。

## 6. 改动清单

> 口径：`=== "video"` 与 `!== "video"` 的判定共 **22 处源码 + 23 处前端**。加 `"stock"` 之后，**任何一处漏改都会让 stock 静默走进图片分支**——不报错，只是画面不对。

### 6.1 第一步：加两个帮手（Phase 0）

`lib/core/video.ts`：

```ts
export const videoFormPipelines = ["video", "stock"] as const;
export type VideoFormPipeline = (typeof videoFormPipelines)[number];
/** 画面形态是视频：决定时间轴编排、转场、渲染门禁走视频分支。 */
export const isVideoForm = (pipeline: string): pipeline is VideoFormPipeline =>
  (videoFormPipelines as readonly string[]).includes(pipeline);
/** 只有 AI 视频才需要参考图、标准图与视频模型。 */
export const isAiVideo = (pipeline: string) => pipeline === "video";
export const isStock = (pipeline: string) => pipeline === "stock";
```

**把「视频形态」和「AI 生成」彻底分开**，再动手改下面的表。

### 6.2 后端

| 文件:行 | 改什么 | 漏了会怎样 |
| --- | --- | --- |
| `lib/core/types.ts:526` | `z.enum(["image","video","stock"])`；新增 `stockSettingsSchema`（`perPage`/`minDurationSec`/`orientation`/`maxCandidates`）挂到 `settingsSchema` | zod 拒绝，选不到 |
| `lib/core/types.ts:231` | `shotSchema` 加 `stockQuery: z.string().optional()` | 字段被 schema 剥掉，检索词丢失 |
| `lib/core/video.ts:52` | `missingVideoStandards` 用 `isAiVideo()` 包住 | stock 被要求先出标准图 |
| `lib/core/timeline.ts:379` | `videoPipeline = isVideoForm(...)` | **视频镜头被叠加图片运镜**，且转场不强制 cut |
| `lib/core/preset.ts:121,184` | 管线名映射加 stock（「视频素材」）；video 组一并套用 `stock` 检索参数，摘要同步列出 | 预设变更摘要显示错误、检索参数套不上 |
| `lib/prompts.ts:575` | `StoryboardPayload.visualPipeline` 加 `"stock"` | 类型不过 |
| `lib/prompts.ts:592` | 分发到 `videoStoryboardPrompt` | 产出图片分镜，没有 `videoPlan`，检索词无从派生 |
| `lib/prompts.ts:650` | `videoStoryboardPrompt` 加 stock 分支：要求 `stockQuery`（1–3 词、纯英文、**必须含主体**），并放宽「禁止 real/stock 素材卡」那句（stock 模式就是要真实素材） | 检索质量差 / schema 拒绝 |
| `lib/pipeline/video-generation.ts:30` | `videoPrerequisite` 用 `isVideoForm` + `isAiVideo` 分包；stock 分支检查 `!!shot.stockQuery` | stock 被要求先出参考图 |
| `lib/pipeline/video-generation.ts:42` | `videoRenderProblems` 用 `isVideoForm` | **门禁直接返回 `[]`**，画面缺失也不报 |
| `lib/pipeline/video-generation.ts:50,61` | `videoGenerationSnapshot` → `snapshotFor` | 门禁与候选判定拿不到 stock 快照，卡住 |
| `lib/pipeline/video-generation.ts:71` | `adoptReadyVideoCandidates` 用 `isVideoForm` | 恢复时不自动采用已有素材 |
| `lib/pipeline/video-generation.ts:122` | `enqueueShotReference` 用 `isAiVideo`（保持只服务 AI 视频） | — |
| `lib/pipeline/plan.ts:169,187` | `shotsReady` 抽出 `videoShotsReady(doc)`，stock 额外要求 `!!shot.stockQuery` | 排不出步骤，成片卡在「等待分镜」 |
| `lib/pipeline/plan.ts:171` | `lockedNonVideo` 用 `isVideoForm` | 锁定镜头被误判 |
| `lib/pipeline/plan.ts:212` | 分支改 `isVideoForm`，内部按 `isAiVideo` 分流：AI 走参考图/视频模型，stock 走 `shot-stock` | **stock 排不出任何步骤** |
| `lib/pipeline/plan.ts:290` | `mediaKeys` 已含 stock key（沿用 `stock:${hash}`），确认 `currentKeys` 收得到 | 进度条把正在跑的当旧任务，显示 0、没有取消入口 |
| `lib/pipeline/plan.ts:342` | `planForGoal` 的 stage 白名单加 `"shot-stock"` | 步骤键被加 goalId 后缀，与 `currentKeys` 对不上 |
| `lib/pipeline/plan.ts:343` | `currentKeys` 白名单加 `key.startsWith("stock:")` | 同上 |
| `lib/pipeline/plan.ts:358,366` | 自动选参考图模型、`adoptReadyVideoCandidates` 都用 `isAiVideo` 包住 | 白写一个没用的模型设置 |
| `lib/pipeline/plan.ts:387` | `maxAttempts: 1` 的 stage 白名单加 `"shot-stock"` | 429 之外的重试语义不一致 |
| `lib/pipeline/plan.ts:442` | `activeMedia` 的 stage 列表加 `"shot-stock"` | 有 stock 任务在跑时误判为「已无活跃媒体」，提前收掉目标 |
| `lib/pipeline/plan.ts:460` | `advance` 的 `referenceSettled` 加 `job.stage === "shot-stock"` | 目标被 blocked 后 stock 完成也不推进 |
| `lib/pipeline/video-plan-sync.ts:32,51,96` | 用 `isVideoForm`；stock 模式改用独立的 `stockPlanSchema`（`stockQuery` **必填**），写回时一并更新 `shot.stockQuery` | 改了中文描述，检索词与素材都不更新 |
| `lib/pipeline/auto-portrait.ts:52` | 用 `isAiVideo` | 白排一堆没用的自动立绘 |
| `lib/pipeline/stages/storyboard.ts:107` | `staleRanges` 用 `isVideoForm`，stock 额外要求 `!!shot.stockQuery` | 缺检索词时不重做分镜 |
| `lib/pipeline/stages/storyboard.ts:260` | `const video = isVideoForm(...)`；新增 `const stock = isStock(...)` | 分镜走图片分支 |
| `lib/pipeline/stages/storyboard.ts:288` | `visualPipeline: video ? (stock ? "stock" : "video") : undefined` | 提示词分发错误 |
| `lib/pipeline/stages/storyboard.ts:312,337` | stock 用 `stockDraftSchema`（`stockQuery` 必填） | 检索词缺失 |
| `lib/pipeline/stages/storyboard.ts:55,66` | `videoDraftSchema` 抽出 `videoShotDraft(stock: boolean)`；`toVideoShots` 透传 `stockQuery: entry?.stockQuery` | `.strict()` 直接拒绝新字段 |
| `lib/pipeline/stages/storyboard.ts:352` | 已比对 pipeline 全等，无需改（stock 自带新值） | — |
| `lib/pipeline/stages/shot-reference.ts:18,35` | 用 `isAiVideo` | stock 触发参考图生成 |
| `lib/pipeline/stages/shot-generate.ts:242` | 用 `isAiVideo` | stock 结果被 AI 视频写回逻辑覆盖 |
| `lib/pipeline/stages/index.ts:20` | `allStages` 注册 `shotStockStage` | 任务找不到 stage |

**保留 `video-plan-sync`**：它不是 AI 视频专属的，管的是「中文描述 → 英文执行计划」同步。stock 改了中文描述同样要重新同步，否则检索词和素材都过期。

### 6.3 API 路由

| 文件:行 | 改什么 | 漏了会怎样 |
| --- | --- | --- |
| `app/api/projects/[id]/shots/reference/route.ts:26,52` | 用 `isAiVideo` | stock 能提交参考图任务 |
| `app/api/projects/[id]/shots/generate/route.ts:27,29` | `kind` 兜底不能直接用 pipeline 值（`"stock"` 不是合法 kind）；用 `isAiVideo ? "video" : "image"` | kind 非法 |
| `app/api/projects/[id]/shots/[shotId]/generate/route.ts:31,42` | 用 `isAiVideo` | stock 能触发 AI 视频生成 |
| `app/api/projects/[id]/shots/[shotId]/reference/route.ts:20,44` | 用 `isAiVideo` | 同上 |
| `app/api/projects/[id]/shots/status/route.ts:34,87` | 用 `isVideoForm` | 分镜卡状态显示错误 |

### 6.4 前端

| 文件:行 | 改什么 | 漏了会怎样 |
| --- | --- | --- |
| `components/studio/settings-panel.tsx:59,60` | 下拉加「视频素材（Pexels）」；`value as "image" \| "video"` 断言放宽 | UI 里选不到 |
| `components/studio/settings-panel.tsx:62` | 包住 AI 视频专属设置块；新增 stock 块（Key 状态 + 测试连接 + `perPage`/`minDurationSec`） | 显示错误设置 |
| `components/studio/settings-panel.tsx:34,37` | 自动补参考图模型改用 `isAiVideo` | 白填参考图模型 |
| `components/studio/storyboard-panel.tsx:47` | `isVideoForm` → `VideoStoryboardPanel`；stock 隐藏参考图区、显示检索词、加「重新搜索素材」 | 落到图片分镜面板，没有 videoPlan 编辑与重搜入口 |
| `components/video-studio.tsx:53` | `produceSteps(bilingual, pipeline)` 第二参数从 boolean 改成管线类型；stock 插入「检索素材」而非「参考图 + 视频」 | 进度条步骤名与阶段视图对不上 |
| `components/video-studio.tsx:62,65,74` | `stepHints` 分流：stock 的提示是「待检索素材 · N 镜」，没有参考图确认 | 提示错误 |
| `components/video-studio.tsx:519,554,587,676` | 「继续制作 / 生成成片」的判定与文案 | 主按钮行为错误 |
| `components/video-studio.tsx:709,714,715,717,718` | `produceSteps` 调用、`stageViews`、`onOpenStage`、blocked 提示 | 阶段视图指向不存在的参考图面板 |
| `components/video-studio.tsx:849,856,907,909,910,918` | 素材策略文案、facts、确认弹窗文案 | 文案与实际不符（stock 不产生服务商费用，但要提示额度） |

### 6.5 不改但要确认

- `lib/core/shots.ts:235 normalizeVideoShots`：`{ ...original }` 展开（`:243`）与子镜头 `{ ...shot }`（`:269`）都会带上 `stockQuery`。**这是期望行为**：一个 >15s 的镜头被拆成两半时，两半用同一个检索词、但被游标错开，拿到同一素材族的两条不同片段，正好形成一个动作内的切点。
- `lib/core/production.ts:12`：`setupFingerprintForDoc` 已把 `visualPipeline` 计入指纹，切管线自动让确认失效，无需改。
- `lib/core/video.ts:113 videoGenerationSnapshot`：**不要动**。新增独立字段 `stockQuery` 不进它的哈希，已有 AI 视频产物不失效。
- `lib/providers/types.ts:1 providerKinds`：**不要加 `"stock"`**。Pexels 不是生成式服务商。

## 7. 分阶段实施

每阶段结束必须 `npm run typecheck`（或仓库既有校验脚本）通过，并保持现有 `image` / `video` 两条管线的测试全绿。

### Phase 0 — 判定收口（不改变任何行为）

1. `lib/core/video.ts` 加 `isVideoForm` / `isAiVideo` / `isStock`
2. 把 6.2 / 6.3 表里**纯判定**的 22 处改成帮手调用（此阶段不新增 `"stock"` 枚举值）
3. `shot.stockQuery` 字段先不加

**验收**：`typecheck` 通过；`lib/core/video.test.ts`、`tests/video-*.test.ts`、`tests/plan-keys.test.ts`、`lib/core/reference-status.test.ts` 全绿。
**回滚**：纯机械替换，`git revert` 单个提交即可。

### Phase 1 — 枚举与检索词

1. `lib/core/types.ts`：加 `"stock"`、`stockSettingsSchema`、`shot.stockQuery`
2. `lib/prompts.ts`：`StoryboardPayload` 加 `"stock"`；`videoStoryboardPrompt` 加 stock 分支（`stockQuery` 硬约束：JSON 数组外的单字段、1–3 词、纯英文、**必须含主体**、不许出现中文与标点）
3. `lib/pipeline/stages/storyboard.ts`：`videoShotDraft(stock)` 双 schema、`toVideoShots` 透传、`staleRanges` / `shotsReady` 的 stock 条件
4. `lib/pipeline/video-plan-sync.ts`：stock 模式下同步时一并刷新 `stockQuery`
5. `lib/core/preset.ts`：管线名映射

**验收**：切到 stock 后重做分镜，每个未锁镜头都有非空英文 `stockQuery`；`videoGenerationSnapshot` 的哈希与改动前**逐位一致**（对同一 doc + frame 断言相等）——这是「已有 AI 视频不失效」的证明。
**回滚**：新字段可选、新枚举值未被任何 stage 使用，回滚安全。

**完成记录**（commit：见分支 `feat/stock-pipeline`）

| 落地项 | 实际位置 | 备注 |
| --- | --- | --- |
| 枚举与设置 | `types.ts` `visualPipeline` 加 `"stock"`、`stockSettingsSchema`、`shotSchema.stockQuery` | `stockSettingsSchema` 无 `.strict()`，旧文档解析后自动补默认值 |
| 检索词契约 | `storyboard.ts` `stockQueryField`（`/^[a-z]+(?: [a-z]+){1,3}$/`，2–4 词）+ `videoPlanSync.ts` `stockQuerySchema` | 两处同口径：分镜产出与描述同步都必须在打远端前拦住中文/长句 |
| 双 schema | `storyboard.ts` `videoShotFields` 抽出 → `videoDraftSchema` / `stockDraftSchema` / `draftSchemaFor(stock)` | `DraftEntry` 的 `stockQuery` 可选，`toVideoShots` 用 `...(entry?.stockQuery ? {...} : {})` 透传，video 管线不产生该字段 |
| 分镜过期判定 | `storyboard.ts` `staleRanges` 增加 stock 分支 | 有镜头缺 `stockQuery` 时整段重做；`plan.ts` `shotReadyForPipeline` 同步加条件 |
| 描述同步 | `videoPlanSync.ts` 一次调用同时产出 4 项执行计划 + `stockQuery`，分落 `videoPlan` / `shot.stockQuery` | stock 模式 `maxRetries: 1`；缓存命中但缺检索词按未命中处理；漏写检索词直接抛错，不静默写回 |
| 并发保护 | `storyboard.ts` `semanticShots` 纳入 `stockQuery` | 生成期间有人改了检索词，该范围不覆盖（并发编辑优先） |
| 预设 | `preset.ts` `pipelineLabels` / `orientationLabels`、video 组一并套用 `stock`、摘要新增「素材最短时长 / 素材方向」 | 摘要与实际应用同一套分组，维持「摘要说会变、实际没变」的既有不变量 |
| 仓库卫生 | `.gitignore` 忽略 `/Video-asset-library/` 与 `/.workbuddy-ai/` | 前者是用户自备媒体，后者是本地工作数据 |

**验收证据**：

- 新增 `tests/video-stock-sync.test.ts`（6 例）：缺检索词按整段过期、AI 视频管线不受该条件影响、同步一次写回计划与检索词、AI 视频模式不索要也不写回检索词、模型漏写/写坏检索词时任务失败、保存后自动排队。
- `lib/core/video.test.ts` 新增「素材检索词与 AI 视频快照解耦」5 例：补 `stockQuery` 后哈希逐位不变、整项目切到 stock 后哈希不变（同时确认改 `videoPlan` 仍会让哈希变化）、schema 保留该字段、>15s 拆分两半共用同一检索词、检索参数默认值与越界拒绝。
- `lib/core/preset.test.ts` 新增 3 例：video 组一并套用检索参数且摘要一致、未勾选该组时不碰、旧预设补默认值。
- `npm run typecheck` 通过；全量 `npx vitest run --maxWorkers=4 --testTimeout=20000` = **125 文件 / 1006 测试全绿**。

### Phase 2 — 来源层与缓存

1. `lib/providers/stock/types.ts`、`pexels.ts`、`index.ts`
2. `lib/core/stock.ts`：`stockQuery` / `stockFrame` / `stockOrientation` / `stockExclusions` / `stockSnapshot` / `snapshotFor` / `stockAssetStale`
3. `app/api/stock/route.ts`（Key 状态 + 测试连接）

**验收**：
- 用 `PEXELS_API_KEY` 手工打一次 `searchVideos("nature", { orientation: "portrait", minDurationSec: 6 })`，返回 ≥1 条，`pickFile` 选出的档 `w/h` 均 ≥ 目标且面积最小。
- 同一 query 连打两次，第二次命中缓存、不产生网络请求。
- 空结果**不写缓存**（断言 `cacheHas` 为 false）。
- 无 Key 时 `stockConfigured()` 为 false，路由返回 `configured: false`。

**完成记录**

新增 `lib/providers/stock/{types,pexels,index}.ts`、`lib/core/stock.ts`、`lib/pipeline/stock-cache.ts`、`app/api/stock/route.ts`、`scripts/stock-probe.ts`（`npm run stock:probe`）。

| 落地项 | 关键点 |
| --- | --- |
| 来源接口 | `StockSource` 只回答「素材从哪来」：不碰 shot、不碰快照、不碰任务系统。接本地素材库只是再加一个实现 |
| 请求构造 | `orientation` / `min_duration` / `size=medium` / `per_page`（上限 80）全在服务端过滤；`min_duration` **向上取整**，宁可少拿也不能拿回一条比镜头短的 |
| 失败分层 | 401/403 → `PermanentError`；429 → `PexelsError(status 429, retryAfterMs)`；其余 HTTP → `PexelsError(status)` 交给 `isRetryable`；非 JSON → 不挂状态码（网关偶发 HTML 错误页要允许重试）；网络错误 → `networkError`；**AbortError 原样抛出**，否则取消会被当成网络抖动而重试 |
| 响应解析 | 逐条容错：字段缺失/档位缺 link 的条目丢掉，不让一条坏数据毁掉整次检索；但**缺 `videos` 列表要报错**，不静默返回空数组 |
| `pickFile` | mp4 → 宽高都不小于目标 → 方向一致 → 面积最小；同面积按 id 取，保证同一素材每次选到同一档 |
| `stockSnapshot` | 哈希只含检索词、方向、时长下限、目标时长、覆盖句文本与配音、seed。**`excludeAssetIds` 与候选都不进哈希** |
| `snapshotFor` | 按管线分发，门禁与编排不再各写一份 `isAiVideo ? :` |
| 缓存层 | 独立成 `lib/pipeline/stock-cache.ts`（原计划把它放在 stage 里，但 Phase 2 的验收要断言缓存行为，放在这里才可独立验证）。两层：按快照哈希复用「这一镜定了哪条素材」、按 URL 哈希复用「这个文件下过了」。**没有「缓存空结果」的入口**；命中要求 `getAsset` 仍在库 |
| 密钥不落盘 | 缓存键是 URL 的哈希、值是 `assetId`，带签名的下载地址既不做键也不做值；素材 `meta` 只放人可点的 `pageUrl` |
| 独立路由 | `/api/stock` 只做 Key 状态与连通性测试，**没有**把 Pexels 加进 `providerKinds` / `builtinModels` |

**验收证据**

- `npm run stock:probe` 真打 Pexels，**11 项全通过**：竖屏 `nature` + `min_duration=6` 返回 15 条且全部 ≥6s、全部 `height>width`；15/15 条都有合格档且宽高 ≥1080×1920、面积最小；横屏同理；无效 Key 抛 `PermanentError`。
  - 顺带核实了两个不能靠猜的假设：**`min_duration` 的单位确实是秒**；**`size=medium` 不会筛掉竖屏结果**（无 size 15 条 / 有 size 15 条），所以保留该参数。
- 缓存三条不变量各有独立测试（`lib/pipeline/stock-cache.test.ts` 6 例）：命中复用、空结果不写缓存、素材被 GC 后视为未命中、URL 缓存跨镜头复用、签名地址不以明文进库。
- `lib/core/stock.test.ts` 14 例：**候选与游标变化后快照哈希逐位不变**（§4.5 的反向断言）、检索词/方向/时长下限/覆盖句变化后哈希必变、规则派生检索词可复现、`snapshotFor` 分发正确。
- `lib/providers/stock/pexels.test.ts` 19 例 + `index.test.ts` 4 例 + `tests/stock-api.test.ts` 7 例。
- `npm run typecheck` 通过；全量测试 **129 文件 / 1050 测试全绿**（含缓存测试后 130 文件 / 1056 测试）。

### Phase 3 — stage 与编排

1. `lib/pipeline/stages/shot-stock.ts`（含 `enqueueStockShot`、`stockPrerequisite`）
2. `lib/pipeline/stages/index.ts` 注册
3. `lib/pipeline/plan.ts` 的 stock 分支与全部键白名单
4. `lib/pipeline/video-generation.ts`：`videoRenderProblems` / `usableVideoCandidate` 换 `snapshotFor`；`videoPrerequisite` 分包

**验收**：
- 3–5 个镜头的小项目跑通：分镜 → `shot-stock` → 写回 → `videoRenderProblems` 返回 `[]` → 排得出 render。
- 把某个镜头的素材换成一条比镜头短的视频（手工改 assets 表 `duration_ms`），`videoRenderProblems` 报「视频时长不足或尚未探测」。
- 断言写回的候选 `promptHash === generationPromptHash === 快照哈希`。
- 断言 `assets.meta` 里**没有** Pexels 下载 URL。
- 重搜一次：新素材 ≠ 旧素材（游标生效），且快照哈希**不变**。

### Phase 4 — 前端

1. `settings-panel.tsx`：第三个选项 + stock 设置块 + Key 状态
2. `video-studio.tsx`：`produceSteps` 改签名、`stepHints` 分流、文案
3. `storyboard-panel.tsx`：`isVideoForm` 分流；`VideoStoryboardPanel` 内 stock 形态（隐藏参考图区、显示 `stockQuery`、加「重新搜索素材」按钮打 5.5 的路由）

**验收**：切到 stock 后进度条出现「检索素材」且不出现「参考图」；分镜面板能改 `stockQuery`、能点重搜并看到新素材；设置面板显示 Key 已配置。

### Phase 5 — 收口

1. 端到端跑一部 5 分钟片子（≥60 镜），记录：检索请求数、缓存命中率、`PermanentError` 次数、成片时长与素材时长的差值分布
2. 更新 `docs/ARCHITECTURE.md`（第 71 行附近的管线表加 stock）
3. 本文移入 `docs/archive/`

## 8. 测试计划

| 层 | 用例 | 断言 |
| --- | --- | --- |
| 纯函数 | `stockSnapshot` 稳定性 | 同 doc 两次调用哈希相同；改 `stockQuery` / 画幅 / 覆盖句文本 / 配音任一 → 哈希变 |
| 纯函数 | **AI 视频哈希不受影响** | 加 `stockQuery` 前后，`videoGenerationSnapshot(...).hash` 相等 |
| 纯函数 | `stockExclusions` | 等于候选全部 assetId；不参与哈希（改候选集不影响 `stockSnapshot.hash`） |
| 纯函数 | `pickFile` | 方向不符跳过；`w/h` 不足跳过；多个合格档取面积最小 |
| 纯函数 | `stockQuery` 兜底 | 从 `videoPlan` 抽词、可复现、非空、纯 ASCII |
| provider | Pexels 失败分层 | 401 → `PermanentError`；429 → 可重试；非 JSON → 可读错误 |
| provider | 密钥脱敏 | 报错信息与 `assets.meta` 中都不含 Key 与下载 URL 的 query |
| stage | 写回契约 | 两个哈希都等于快照哈希；`assetVariants[aspect]` 与 `shot.assetId` 指向同一素材 |
| stage | 并发与取消 | `ctx.current()` 为 false 时不写回；中途取消不留半截素材 |
| stage | 时长门禁 | 素材比镜头短 200ms → 跳过该候选；全部不足 → `PermanentError` |
| 编排 | 键对齐 | `plan.steps` 里 stock 步骤的 key 出现在 `plan.currentKeys` 里 |
| 编排 | 重搜键稳定 | 重搜前后 `stockSnapshot.hash` 相同，`excludeAssetIds` 不同 |
| 编排 | 已有素材采用 | 手动把 stock 素材写入候选后 `produce`，不重复提交 `shot-stock` |
| 回归 | 现有两条管线 | `image` / `video` 的全部既有测试不变 |

## 9. 风险与对策

| 风险 | 后果 | 对策 |
| --- | --- | --- |
| **Pexels 额度**（200 请求/小时，搜索+下载都算） | 一部 5 分钟片约 60–100 镜，一次成片可能打掉一半额度，重搜几次见底 | ① 检索结果按快照哈希缓存进 DB（不是优化，是必需品）② URL → assetId 缓存 ③ `concurrency: 1` ④ 429 明确提示「Pexels 额度已用尽，请稍后再试」⑤ 分镜卡显示剩余可用次数 |
| **横屏素材给竖屏用** | `videoAssetFraming` 默认 `shared`，会走 `variant.sourceAspect` 分支重算快照，画面被 cover 裁掉两侧 | 按 `stockOrientation(frame)` 检索对应方向；`pickFile` 跳过方向无法确认的素材。**不靠裁切** |
| **检索词质量决定成败** | `videoPlan` 的英文是写给生成模型的长句，直接丢给 Pexels 搜出来很差 | 分镜那次调用一并产出 `stockQuery`，prompt 里写死「1–3 词 + 必须带主体 + 纯英文」；返回值在打远端前校验契约 |
| **素材时长不足** | `videoDurationReady = false`，渲染被门禁卡住 | 检索时 `min_duration` 过滤 + 下载后按实测 `durationMs` 复检；不足即 `PermanentError` 并给出「改描述或改用 AI 视频」的可操作提示 |
| **密钥落盘** | `putBuffer(meta)` 会把 meta 写进 assets 表；带签名的下载地址会永久落盘 | `meta` 按白名单重建，只存 `clipId` / `author` / `pageUrl`；日志与错误信息做密钥脱敏（原始值与 URL 编码值都替换） |
| **`=== "video"` 漏改** | 静默走进图片分支，不报错、只是画面不对 | Phase 0 先把判定收口成 `isVideoForm` / `isAiVideo`，再动枚举；第 6 节表格逐项勾掉 |
| **重搜拿到同一条** | 用户点了重搜但画面没变 | 游标只走任务 input，路由从该镜头候选推导 `excludeAssetIds` |

## 10. 端到端验收清单

- [ ] 设置里能选「视频素材（Pexels）」，Key 未配置时有明确提示与测试连接入口
- [ ] 切到 stock 后重做分镜，每镜都有英文 `stockQuery`
- [ ] 点「制作成片」后进度条出现「检索素材」，不出现「参考图」
- [ ] 每个镜头自动拿到一条素材，画面与旁白语义相符（人工抽查 ≥10 镜）
- [ ] 不满意的镜头能在分镜面板改 `stockQuery` 或点「重新搜索素材」换到不同素材
- [ ] 修改某镜的中文描述后，该镜的检索词与素材标记为过期并自动重搜；**其他镜头不受影响**
- [ ] 素材全部比镜头短的极端情况下，给出可操作报错而不是静默卡住
- [ ] 成片能渲染出来，转场为 cut，无图片运镜叠加
- [ ] 用量页能看到 `pexels` 的检索记录；`assets.meta` 里没有带凭据的 URL
- [ ] 切回 `image` / `video` 两条管线，行为与改动前完全一致
- [ ] `docs/ARCHITECTURE.md` 已更新，本文已归档

## 11. 后续（不在本次范围）

1. **本地素材库来源**：`lib/providers/stock/local.ts` 读 `Video-asset-library/_index/manifest.json`，命中就零成本零网络。几乎免费的大杠杆，但需要解决「`putFile` 是移动不是复制」（`lib/server/media.ts:108`）——必须先 copy 到 tmp。
2. **多来源编排**：`searchStock` 按 `stockSources` 顺序尝试，本地优先、未命中再打 Pexels。
3. **候选选择 UI**：复用 `shot.candidates` 与现有候选机制，把 top-3 检索结果都入库让用户挑。
4. **额度仪表**：记录每小时请求数，接近上限时提前降级为「只用缓存」。
5. **更多库存源**：Pixabay / Coverr 作为 `stockSources` 的新成员。
