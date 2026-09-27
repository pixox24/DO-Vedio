# 视频制作管线 · P0 / P1 实施方案

> 状态：待确认 ｜ 适用版本：Next.js 16.3.6、Node 22.23、Remotion 4.0.x
>
> 已确定的前提：画面以 AI 生图为主、配少量视频（P2 起）｜全部用云端 API ｜全自动出成片 ｜同时出 16:9 和 9:16 ｜单人或小团队在内网使用

---

## 0. 目标与范围

**P0 地基**：项目、媒体文件和任务都放到服务端；另起一个独立的 Worker 进程执行长任务；网页实时显示进度。
**P1 有声样片**：从现有文案一键生成**可直接投稿的图文解说成片**（配音、字幕、占位画面和文字卡、配乐及自动压低、横竖两版 MP4 + SRT）。

P1 **不做**：AI 生图和生视频、视觉设定集、花字音效「叮」、时间轴拖拽编辑器、工程文件导出。这些属于 P2 及以后，但 P1 的数据结构会给它们留好扩展位。

### 验收标准

| 阶段 | 验收标准 |
|---|---|
| P0 | ① 清空浏览器数据后，稿件不丢 ② 任务执行到一半时杀掉 Worker，重启后自动接着跑 ③ 关掉页面再打开，进度还在，而且实时更新 ④ 上传一个 200MB 的视频，浏览器里能拖动播放（支持 Range 请求） |
| P1 | ① 一篇 5 分钟的稿子点「一键成片」，无需人工干预，得到 16:9 和 9:16 两条 MP4 以及 SRT ② 只改第 3 句，账本里只多一次 TTS 调用，其余镜头不重算 ③ 字幕和声音肉眼看不出错位（误差 < 100ms）④ 成片整体响度在 -14 ±1 LUFS（用 `ffmpeg -af ebur128` 验证）⑤ 锁定的镜头重跑分镜后保持不变 ⑥ 成片带 AI 生成角标和元数据标识 |

---

## 1. 关键技术选型

| 事项 | 选择 | 理由和备注 |
|---|---|---|
| 数据库 | **SQLite**，使用 Node 自带的 `node:sqlite` | 零运维、没有原生编译（仓库曾经装过 Windows 的二进制包，说明可能跨平台开发）。开启 WAL 后，web 和 worker 两个进程可以同时读写。在 Node 22 上会打印 ExperimentalWarning，不影响功能。所有调用收口在 `lib/server/db.ts`，出问题时换成 `better-sqlite3` 只需要改这一个文件 |
| 媒体存储 | 本地磁盘 `data/media/`，文件按内容哈希命名 | 同一内容天然去重；以后换 MinIO 或 OSS，只需要改 `lib/server/media.ts` |
| 任务队列 | 数据库里的 `jobs` 表 + Worker 轮询 + 租约 | 不需要 Redis；进程崩溃后，租约过期的任务会自动回到队列 |
| Worker 运行方式 | `tsx worker/index.ts`，是独立的 Node 进程 | 直接复用 `lib/`（包括现有的 `llm.ts`），支持 `@/` 路径别名 |
| 进度推送 | SSE（`text/event-stream`），由 Route Handler 每秒轮询一次数据库 | 单机场景足够用，不需要 WebSocket 服务 |
| 合成 | **Remotion 4**：浏览器预览用 `@remotion/player`，最终渲染用 `@remotion/renderer` | 两者共用 `remotion/` 下的同一套组件，所见即所得 |
| 音频处理 | 系统自带的 **FFmpeg**（本机已装 ffmpeg-full），路径可用 `FFMPEG_PATH` 覆盖 | 用于响度两遍归一、写入元数据、处理曲库 |
| TTS | **阿里云百炼 CosyVoice**（WebSocket 接口），复用现有的 `DASHSCOPE_API_KEY` | 支持 `word_timestamp_enabled`，能返回字级和句级时间戳。默认用 `cosyvoice-v3-flash`，可切换到 `-plus` 或 `v3.5` |
| WebSocket 客户端 | `ws` 包 | Node 自带的 WebSocket 不方便设置 `Authorization` 请求头 |
| 字体 | 思源黑体 / Noto Sans SC（OFL 开源协议），放进仓库，用 `@remotion/fonts` 加载 | 服务端渲染时不依赖系统字体，横竖两版输出一致 |
| 帧率和分辨率 | 30fps，1920×1080 / 1080×1920 | 样片可以用 0.5 倍分辨率快速渲染 |

> **Remotion 授权**：营利组织 3 人及以内可以免费商用；4 人及以上需要购买 Company License。自动化管线一般对应 Automators 方案（按渲染次数计费，有每月最低消费）。人数超过 3 人前，需要到官网核实条款。

---

## 2. 核心设计：用户文档 + 机器产物 → 派生时间轴

这是整个方案最重要的一点：**时间轴不存储，每次都从两类数据计算出来**。

```
 Project 文档（用户可编辑，带 revision）      机器产物（按缓存键存储，不可变）
 ├ brief / script（现有文案）                 ├ cache 表：key = hash(步骤版本+输入+参数)
 ├ lines[]  断句和读音标注                    │   annotate 结果、TTS 结果（音频 + 字级时间戳）
 ├ shots[]  分镜（锚定在句子上，可锁定）      │   分镜草稿、情绪标签
 ├ music    选曲结果和参数                    └ assets 表：媒体文件（按内容哈希）
 └ settings 音色、画幅、字幕样式、预算
                 │                                         │
                 └──────────── buildTimeline() ────────────┘
                              纯函数，放在 lib/core
                                     ▼
                  Timeline（播放器预览 = 最终渲染的 inputProps）
```

带来的好处：
- **改动自然只重算局部**：改了第 3 句，它的 TTS 缓存键变了，只有这一句需要重录。后面的句子起止时间由 `buildTimeline` 自动平移；镜头锚定在句子上，时长自然跟着变，不用改任何镜头。
- **还没配音也能预览**：没有音频的句子按「音色实测语速」估一个时长，放一段静音占位，所以样片随时可看。
- **Worker 基本不改用户文档**：它写的是缓存和素材；只有分镜、标注这类结果需要合并进文档，而且会带上 revision 校验（见 §4.4）。

---

## 3. 数据模型（`lib/core/types.ts`，用 zod 定义）

```ts
type Aspect = "16:9" | "9:16";

Project {
  id, title, revision: number, createdAt, updatedAt,
  brief: Brief, modelId, sections: Section[], segments: Segment[], metadata,   // 现有字段原样保留
  lines: Line[],
  shots: Shot[],
  music: { enabled: boolean, cues: MusicCue[], gainDb: number } ,
  settings: {
    aspects: Aspect[],                        // 默认两种都出
    voice: { provider: "dashscope", model, voiceId, rate: number, pitch: number, volume: number },
    subtitle: { enabled: boolean, burnIn: boolean, stylePreset: string },
    aiLabel: { enabled: boolean },            // 默认开启，见 §8
    budgetYuan: number | null,
    autoRun: { pauseAfterPreview: boolean },  // 全自动为默认，可以改成出样片后暂停
  },
}

Line {                    // 一句旁白 = TTS 的最小单位
  id,                     // 稳定 ID：文本改动时按 diff 继承，见 §5.1
  segmentIndex,
  text,                   // 字幕显示用：原文，一个字不改
  spans: { text, say?: string, ssml?: string }[],  // 读音标注：say 是替换读法，例如 “2025” → “二零二五”
  pauseAfterMs: number,   // 句后停顿
  keywords: string[],     // 关键词：P1 做字幕高亮，P2 做花字
  mood?: Mood,
  locked: boolean,
}

Shot {                    // 镜头连续覆盖整条时间轴，只存起点，终点就是下一个镜头的起点
  id,
  at: { lineId, char: number },   // 锚点：某句的第几个字，char=0 表示句首；时间由字级时间戳算出
  kind: "title" | "quote" | "placeholder" | "upload"      // P1
      | "image" | "video" | "stock" | "chart",            // P2 以后
  description,            // 画面描述（P1 显示在占位卡片上，P2 用作生图提示词的来源）
  prompt?: string,
  onScreenText?: string,  // 文字卡或标题卡上的文字
  motion: "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "none",
  importance: 1 | 2 | 3,  // P3 用它决定哪些镜头做成视频
  assetId?: string, focus?: { x: number, y: number },   // 上传的图片；focus 用于横竖版裁剪
  sourceHash: string,     // 覆盖范围内句子文本的哈希，用于判断镜头是否过期
  locked: boolean,
}

MusicCue { trackId, fromLineId, toLineId, fadeInMs, fadeOutMs }

Asset { hash, kind: "audio"|"image"|"video"|"subtitle", mime, bytes, durationMs?, width?, height?,
        meta: { provider?, model?, params?, costYuan? }, createdAt }

Job { id, projectId, stage, key, target?, status: "queued"|"running"|"succeeded"|"failed"|"canceled",
      progress, message, attempts, maxAttempts, runAfter, lockedBy, leaseUntil,
      costEstimate, costActual, error, result, createdAt, updatedAt }
```

**派生出来的 Timeline**（`buildTimeline(project, cache, { aspect })` 的返回值，也就是 Remotion 的 inputProps）：

```ts
Timeline {
  fps: 30, width, height, durationMs,
  voice:  { lineId, src, startMs, durationMs, trimStartMs, estimated: boolean }[],
  words:  { lineId, char, startMs, endMs }[],
  shots:  { shotId, kind, startMs, endMs, props }[],
  cues:   { startMs, endMs, text, highlights: [from, to][] }[],   // 按画幅断行
  music:  { src, startMs, endMs, fadeInMs, fadeOutMs, envelope: [ms, gainDb][] }[],
  sfx:    { src, atMs, gainDb }[],
  overlay:{ aiLabel: boolean },
  issues: { level, message, lineId? }[],   // 例如「第 12 句还没有配音」
}
```

---

## 4. P0 地基

### 4.1 数据库（`lib/server/db.ts`）

- 数据库文件是 `data/app.db`（`data/` 已在 `.gitignore` 中）。打开后设置 `PRAGMA journal_mode=WAL; busy_timeout=5000; foreign_keys=ON`。
- 迁移：`lib/server/migrations/001_init.sql`、`002_...sql` 按编号执行，执行记录写在 `schema_migrations` 表里。web 和 worker 启动时都会跑迁移，放在 `BEGIN IMMEDIATE` 事务里，不会并发冲突。
- 表结构：

| 表 | 主要列 |
|---|---|
| `projects` | `id` PK, `title`, `doc` JSON, `revision` INT, `created_at`, `updated_at`, `deleted_at` |
| `assets` | `hash` PK, `kind`, `mime`, `bytes`, `duration_ms`, `width`, `height`, `meta` JSON, `created_at` |
| `cache` | `key` PK, `stage`, `result` JSON, `created_at` |
| `jobs` | 字段同 §3，另建索引 `(status, stage, run_after)` 和 `(project_id, updated_at)` |
| `renders` | `id`, `project_id`, `aspect`, `quality`, `timeline_hash`, `video_hash`, `srt_hash`, `created_at` |
| `ledger` | `id`, `project_id`, `job_id`, `provider`, `model`, `unit`, `quantity`, `cost_yuan`, `created_at` |
| `lexicon` | `id`, `scope`（`global` 或项目 ID）, `word`, `say`, `ssml`, `note` |
| `voice_stats` | `voice_key` PK, `chars`, `speech_ms`, `samples` |
| `workers` | `id` PK, `pid`, `started_at`, `heartbeat_at` |

### 4.2 媒体存储（`lib/server/media.ts`）

- `putFile(tmpPath, meta)` 和 `putBuffer(buf, meta)`：边写边算 sha256，文件存到 `data/media/ab/cd/<hash>.<ext>`，先写临时文件再 rename，保证原子性，同时写入 `assets` 表。
- `GET /api/media/[hash]`：以流的方式返回文件，支持 `Range` 请求（返回 206），带 `Cache-Control: public, max-age=31536000, immutable`。播放器的拖动进度和视频预览都依赖这一点。
- `POST /api/media`：用 `multipart/form-data` 上传图片（≤20MB）或音频。服务端用文件魔数校验类型，用 ffprobe 读时长和宽高。
- 垃圾回收（P1 末尾再做）：`npm run gc` 标记-清除所有没被项目、缓存、渲染记录引用的素材。

### 4.3 项目迁到服务端

- 接口：`GET/POST /api/projects`，`GET/PATCH/DELETE /api/projects/[id]`。
- `PATCH` 的请求体是 `{ revision, patch }`。revision 不一致时返回 `409` 和最新文档；前端提示「文档已在别处修改」，并提供「载入最新 / 覆盖」两个选项。小团队场景，这种乐观锁就够了。
- 前端用 `useProject(id)` 替换 `usePersistent`：保存节流和页面关闭前补存的逻辑照搬；流式写稿时文字先更新本地 state，节流后再保存。
- 页面结构：
  - `/`：项目列表（新建、打开、删除）
  - `/projects/[id]`：现有的创作页（`app/page.tsx` 的内容整体移过来）
  - `/projects/[id]/video`：制作页（P1）
- **一次性导入**：如果 localStorage 里有 `do-vedio:draft`，列表页顶部提示「导入浏览器里的草稿」，导入后清掉本地数据。
- 现有的文案类接口（`/api/angles`、`outline`、`section`、`rewrite`、`metadata`）保持无状态，不用改。

### 4.4 任务系统（`lib/server/jobs.ts` + `worker/`）

**提交任务**：`enqueue({ projectId, stage, key, target, costEstimate })`
- 同一个 `key` 已经在排队或运行中时，直接返回已有任务，不重复提交。
- 缓存里已经有这个 `key` 的结果时，不再提交任务，直接当作完成。

**领取任务**（原子操作，SQLite 3.35 及以上支持 RETURNING）：
```sql
UPDATE jobs SET status='running', locked_by=?, lease_until=?, attempts=attempts+1, updated_at=?
WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_after<=? AND stage IN (…有空闲并发的步骤…)
            ORDER BY priority, created_at LIMIT 1)
RETURNING *;
```

**租约和心跳**：每 10 秒续一次租约，租约有效期 60 秒。Worker 启动时和每分钟一次，把 `running` 状态但租约已过期的任务改回 `queued`。这就是「杀掉 Worker 后能接着跑」的实现方式。

**重试**：只有可重试的错误（网络错误、429、5xx）才重试，按 2 秒、8 秒、30 秒指数退避，最多 3 次。**内容审核被拒**和参数错误不重试，直接标记 `failed`，并写明原因。

**取消**：`POST /api/jobs/[id]/cancel` 把任务标记为 `canceled`。Worker 续租约时发现任务被取消，就触发 AbortSignal 中止任务。

**并发**：每个步骤单独限流，默认 `llm: 2`、`tts: 3`、`render: 1`，可以用环境变量 `WORKER_CONCURRENCY_<STAGE>` 调整。

**步骤接口**（`lib/pipeline/stages/*.ts`）：
```ts
interface Stage<I, O> {
  name: string; version: number;              // 版本号变化时，旧缓存自动失效
  key(input: I): string;                      // hash(name, version, input)
  estimate?(input: I): CostEstimate;
  run(input: I, ctx: { signal, progress(p, msg), putAsset, ledger, log }): Promise<O>;
  apply?(doc: Project, output: O): Project;   // 需要合并进文档时使用，带 revision 校验
}
```
`apply` 在 `BEGIN IMMEDIATE` 事务里执行「读文档 → 合并 → 写回，revision+1」。如果用户在任务执行期间改了相关句子（`sourceHash` 对不上），就放弃合并这部分，改为提交一个新任务。

**Worker 进程**（`worker/index.ts`）：启动时跑迁移、检查 FFmpeg 和 Chrome、注册 `workers` 心跳；主循环每 500ms 领取一次任务；收到 SIGTERM 时等当前任务结束（最长 30 秒）后再退出。

**Worker 在线提示**：`workers.heartbeat_at` 超过 30 秒没更新时，页面顶部显示「后台任务进程未运行」，并给出启动命令。一套系统跑两个进程时，这个提示很关键。

### 4.5 进度推送

- `GET /api/projects/[id]/events`：返回 SSE 流。服务端每秒查一次，只发送 `updated_at` 比上次新的任务，以及文档 revision 的变化。每 15 秒发一次心跳注释；通过 `request.signal` 感知客户端断开。
- 前端用 `useProjectEvents(id)` 维护一份任务表，驱动进度条；收到 revision 变化后重新拉取文档和时间轴。
- 通用组件 `<JobStrip>`：显示每个步骤的状态、进度、费用和错误，并提供取消、重试按钮。

### 4.6 运行方式

```jsonc
// package.json scripts（新增）
"worker":   "tsx worker/index.ts",
"dev:worker": "tsx watch worker/index.ts",
"dev:all":  "concurrently -n web,worker \"next dev\" \"npm:dev:worker\"",
"start:all": "concurrently -n web,worker \"next start -H 0.0.0.0\" \"npm:worker\""
```
内网生产环境建议用 pm2 或 systemd 分别托管两个进程。备份方法：先执行 `sqlite3 data/app.db ".backup data/backup.db"`，再复制 `data/media/`。

### 4.7 P0 新增依赖

`tsx`、`concurrently`（开发依赖）。数据库和 SSE 都不需要额外的包。

---

## 5. P1 有声样片

### 5.1 断句与读音标注（步骤 `annotate`，每个文案段落执行一次）

1. **规则断句**（`lib/core/lines.ts`，纯函数）：在 `。！？；…` 处断开；超过 40 字的句子再在 `，、：` 处拆开，保证每句不超过约 9 秒，方便分镜。句子文本严格取自原文。
2. **大模型标注**：输入断好的句子和读音词典（全局 + 项目），输出每句的 `spans`（多音字、数字、英文、符号怎么读）、`pauseAfterMs`、`keywords` 和 `mood`（情绪，供配乐使用）。
3. **校验**：`spans` 的原文拼起来必须和 `text` 完全一致，否则丢弃这句的标注，退回到只做规则替换（数字转中文读法等），保证不改原文。
4. **稳定 ID**：文案改动后，用新旧句子列表做 LCS diff。文本没变的句子保留原 ID，于是配音缓存和镜头锚点都不动；变了的句子分配新 ID。
5. **读音词典**：`GET/PUT /api/lexicon`。在制作页选中一个字就能「加入词典」，默认作用于当前项目，也可以设为全局。
6. **缓存键**：`hash(annotate@v1, 段落文本, 词典哈希, modelId)`。

### 5.2 TTS 配音（步骤 `tts`，每句执行一次）

**服务商适配层**（`lib/providers/tts/`）：
```ts
interface TtsProvider {
  id: string;
  voices(): Voice[];                        // 音色列表：名称、性别、风格、是否支持时间戳和 SSML
  synthesize(req: { text?: string; ssml?: string; voice; rate; pitch; volume }, signal): Promise<{
    audio: Buffer; format: "mp3" | "wav"; sampleRate: number; durationMs: number;
    words?: { text: string; startMs: number; endMs: number }[];
  }>;
  price(chars: number): number;             // 单价从 config/pricing.json 读，需要人工核实后填写
}
```

**DashScope CosyVoice 实现**（`dashscope.ts`）：
- 用 WebSocket 连接北京地域的推理接口，依次发送 run-task、continue-task、finish-task；二进制帧是音频，JSON 事件里带句级和字级时间戳（毫秒）。
- 请求参数带上 `word_timestamp_enabled: true`。**不是所有音色都支持时间戳**，音色列表只开放支持时间戳的音色。
- 每个模型只能用它自己的那组音色，所以音色选择器按模型分组。
- ⚠️ 接入时需要对照官方文档逐项核对：消息格式、所选模型是否支持 SSML（`<phoneme>`、`<break>`）、单次文本长度上限、并发限制、单价。

**读音怎么传给 TTS**：`spans` 生成两种朗读文本：音色支持 SSML 时生成 SSML，否则生成替换后的纯文本。同时生成一张「朗读字符 → 原文字符」的映射表，TTS 返回的字级时间戳通过这张表对回原文，字幕始终显示原文。

**没有字级时间戳时的兜底**：按字数把整句时长分给每个字，并在 `issues` 里提示。预留 `lib/providers/align/` 接口，以后可以接入强制对齐工具。

**不重新编码音频**：用首字的开始时间和末字的结束时间算出 `trimStartMs` 和语音有效区间，播放时从有效区间开始，保留原始文件。

**缓存键**：`hash(tts@v1, 朗读文本或SSML, provider, model, voiceId, rate, pitch, volume)`。换音色会整片重录，改一句只重录一句。

**语速实测**：每次合成成功后，更新 `voice_stats` 里「有效语音时长 / 字数」的累计值。写稿页选好音色后，用实测语速代替固定的 200 / 250 / 300 字每分钟来估算时长（`duration.ts` 增加一个 `charsPerMinute` 参数）。

**逐句合成还是整段合成**：P1 先逐句合成，因为能单句重录、缓存粒度细。它的缺点是句与句之间的语气可能不连贯，需要试听评估；如果明显不连贯，改成「整段合成 + 句级时间戳切分」，缓存粒度随之变成段落。

### 5.3 时间轴（`lib/core/timeline.ts`，纯函数）

- 每句的开始时间 = 上一句的结束时间 + `pauseAfterMs`。默认停顿：同一段落内 250ms，段落之间 700ms，片头留 500ms，片尾留 1500ms。
- 没有音频的句子，按 `字数 / 实测语速` 估算时长，标记 `estimated: true`，预览时显示为静音占位。
- 最后输出 `Timeline`（结构见 §3）。它同时服务三个地方：播放器、渲染器和 SRT 导出，保证三者一致。

### 5.4 字幕（`lib/core/subtitles.ts`，纯函数）

- 用 `Intl.Segmenter("zh", { granularity: "word" })` 分词，保证不把一个词拆到两行。
- 每行最大字数：16:9 为 16 字，9:16 为 12 字。优先在标点处断行，并去掉行尾标点。
- 每条字幕的时间取自字级时间戳，最短 0.8 秒；同一句内相邻两条之间不留空隙。
- 关键词在字幕里算出 `highlights`，渲染时用强调色显示（P2 升级成花字）。
- 导出 SRT：每个画幅各生成一份（两者断行不同）。字幕同时烧录进画面（`subtitle.burnIn`，默认开）。

### 5.5 分镜（步骤 `storyboard` + 规则 `lib/core/shots.ts`）

**大模型负责内容**：输入所有句子（ID、文本、时长、关键词、所属章节），输出镜头草稿：锚点、类型、画面描述、屏幕文字、运镜、重要程度。

P1 可用的镜头类型：
| 类型 | 画面 |
|---|---|
| `title` | 章节标题卡：每章开头自动生成 |
| `quote` | 金句卡：大字排版，重点词高亮 |
| `placeholder` | 占位画面：渐变或纹理背景，配合画面描述、关键词和缓慢运镜。P2 会替换成 AI 生图，版式已经定好 |
| `upload` | 用户上传的图片：带运镜和按焦点裁剪 |

**规则负责节奏**（`normalizeShots`，纯函数，有单元测试）：
- 镜头连续覆盖整条时间轴，第一个镜头从 0 开始。
- 短于 1.5 秒的镜头并入相邻镜头；长于 6 秒的镜头在句内逗号处（依据字级时间戳）拆开。开场 15 秒内每个镜头控制在 1.5–3.5 秒。
- 静态画面必须带运镜；相邻镜头不能用同一种运镜。
- 锁定的镜头原样保留，规则只能调整它两侧的镜头。

**增量重算**：句子改动后，锚点所在句子被删除的镜头移到下一个还在的句子；`sourceHash` 变化的镜头标记为过期。重跑分镜时**只把过期范围发给大模型**，锁定的镜头和没过期的镜头不动。

**分镜板界面**：镜头卡片横向排列，显示类型、时长、文字、缩略图。支持修改类型和文字、上传图片、设置焦点、锁定、从某个位置拆分、与下一个合并。

### 5.6 配乐与音效（步骤 `music`，以及纯函数 `lib/core/mix.ts`）

**曲库**：`data/library/music/` 放音乐文件，并配一份 `library.json`：
```json
{ "id": "suspense-01", "file": "suspense-01.mp3", "title": "…", "moods": ["悬疑","紧张"],
  "bpm": 90, "loopable": true, "license": "…", "source": "…" }
```
- 情绪类别：悬疑、紧张、轻松、温暖、激昂、史诗、科技、忧伤、中性。
- `npm run library:ingest`：把每首曲子统一响度到 -20 LUFS，转成素材存储，并校验授权字段必填。**曲目需要你自己准备有版权的音乐**，这里只负责管理。
- 音效放在 `data/library/sfx/`。P1 只做一个：章节转场时的「嗖」。

**选曲**：把相邻、情绪相同的句子合并成一个配乐片段（少于 20 秒的片段并入相邻片段）。每个片段按情绪匹配选曲，尽量不重复；曲子比片段短时，循环播放或接下一首。片段交界处交叉淡化 1.5 秒。用户可以在配乐面板里换曲、调音量、关闭配乐。

**自动压低（ducking）**：音乐的音量曲线由纯函数算出，不用在 FFmpeg 里做侧链压缩。
- 人声区间取每句的有效语音区间，间隔小于 600ms 的区间合并。
- 有人声时，音乐比人声低约 12dB；人声停顿超过 1.2 秒时，音乐抬高 6dB。压下用 200ms，恢复用 500ms。这些参数都能在设置里调。
- 在 Remotion 里通过 `<Audio volume={(frame) => …}>` 使用这条曲线，**浏览器预览和最终成片听到的一致**。

### 5.7 合成与渲染

**Remotion 组件**（`remotion/`，只依赖 `lib/core`）：
```
remotion/
  Root.tsx              注册一个合成，宽高从 inputProps 读取
  Video.tsx             依次渲染 shots、voice、music、sfx、字幕、角标
  shots/Title.tsx  Quote.tsx  Placeholder.tsx  Upload.tsx   每个版式都按 useVideoConfig() 适配横竖屏
  layers/Subtitles.tsx  AiLabel.tsx  Motion.tsx（运镜）
  fonts.ts              加载思源黑体
```
- **横竖屏**：同一套分镜和时间轴，版式组件根据宽高比自动排版。9:16 下字幕放在大约 70% 的高度，字号更大，并避开平台界面的遮挡区；上传的图片按 `focus` 焦点裁剪。
- **预览**：制作页用 `<Player>` 播放 `/api/projects/[id]/timeline?aspect=…` 返回的时间轴，素材地址指向 `/api/media/…`。
- **Remotion 打包配置**：`bundle({ webpackOverride })` 里配置 `@/` 路径别名。打包产物按 `remotion/` 源码的哈希缓存在 `data/bundles/`。

**渲染步骤 `render`**（每个画幅一个任务）：
1. `buildTimeline` → 算出 `timeline_hash`。如果 `renders` 表里已经有同样的哈希和画质，直接复用。
2. Worker 在 `127.0.0.1` 的随机端口起一个只读静态服务，对外提供 `data/media`，供无头 Chrome 加载素材。
3. 调用 `renderMedia`：h264 编码，yuv420p，AAC 音频。`final` 画质用 1080p、crf 18；`draft` 样片用 0.5 倍分辨率、crf 28，速度快几倍。渲染进度通过心跳上报。
4. FFmpeg 后处理：`loudnorm` 两遍法，目标 I=-14 LUFS、TP=-1 dBTP，视频流直接复制不重编码；写入 AIGC 元数据（见 §8）；加 `-movflags +faststart`。
5. 生成 SRT；视频和 SRT 都存为素材，写入 `renders` 表。
- **环境准备**：Remotion 首次运行需要下载 Chrome Headless Shell。内网机器需要提前执行 `npx remotion browser ensure`。

### 5.8 一键成片：「对账」式编排（`lib/pipeline/plan.ts`）

不写固定的流程脚本，而是像 make 一样，每次比较「目标」和「现状」：
```ts
planPipeline(doc, cacheLookup, { aspects, until: "preview" | "render" }): PlannedJob[]
// 段落没有标注 → annotate；句子没有配音 → tts；没有镜头或镜头过期 → storyboard；
// 没有配乐 → music；时间轴完整且 until = "render" → 每个画幅一个 render
```
- 在「一键成片」、用户编辑、任何任务完成这三个时机都执行一次对账，所以整个流程会自己往前推进。同一个对账可以重复执行，不会产生重复任务（见 §4.4 的去重）。
- `POST /api/projects/[id]/produce { aspects, until, dryRun }`：`dryRun` 模式只返回任务清单和费用预估，不真正提交。
- **费用和预算**：执行前先显示预估（TTS 字数 × 单价 + 大模型调用次数 × 平均单价）。超过项目预算时，必须用户二次确认。每一次服务商调用都记一笔账，制作页显示累计花费。
- 默认一路跑到出 MP4；打开 `pauseAfterPreview` 后，会停在「样片可预览」这一步，等用户确认。

### 5.9 制作页 `/projects/[id]/video`

```
┌ 顶栏：一键成片 · 费用预估 / 已花费 · 画幅切换 16:9 | 9:16 · Worker 状态 ────────────────┐
│ 步骤条：标注 ▸ 配音 ▸ 分镜 ▸ 配乐 ▸ 渲染（每步显示进度、错误、重试）                     │
├──────────────────────────┬─────────────────────────────────────────────────────────┤
│ 句子列表                 │  预览播放器（Remotion Player）                          │
│ · 文本 + 读音标注         │                                                         │
│ · 试听 / 重录 / 锁定      │                                                         │
│ · 时长、是否估算          ├─────────────────────────────────────────────────────────┤
│ 点击句子 → 播放器跳转     │  分镜板（镜头卡片，横向滚动）                            │
│                          │  配乐面板：曲目 · 音量 · 更换                            │
│                          │  成片：各画幅的 MP4 / SRT 下载 · 历史版本               │
└──────────────────────────┴─────────────────────────────────────────────────────────┘
```
设置抽屉里有：音色选择（可以试听）、语速、字幕样式、AI 标识、预算、读音词典。

### 5.10 P1 新增依赖

`remotion`、`@remotion/player`、`@remotion/bundler`、`@remotion/renderer`、`@remotion/fonts`（版本锁成一致），以及 `ws`。字体文件放在 `remotion/public/fonts/`。

---

## 6. 目录结构

```
app/
  page.tsx                          项目列表
  projects/[id]/page.tsx            创作页（从原 app/page.tsx 迁来）
  projects/[id]/video/page.tsx      制作页
  api/projects/…  api/media/…  api/jobs/…  api/lexicon  api/voices  api/library/music
lib/
  core/        types · lines · timeline · subtitles · shots · mix · srt · hash     纯函数，浏览器和 Remotion 都能用
  server/      db · migrations/ · media · jobs · events                              只在服务端运行
  providers/   llm.ts（现有文件迁入）· tts/dashscope.ts · align/ · pricing
  pipeline/    stages/{annotate,tts,storyboard,music,render}.ts · plan.ts
  （现有的 duration / prompts / templates / api / client 保留在原位置）
remotion/      Root · Video · shots/ · layers/ · fonts · public/fonts
worker/        index.ts · loop.ts · static-server.ts
config/        pricing.json
data/          app.db · media/ · library/{music,sfx} · bundles/ · templates.json（不进 git）
docs/          本文档
```

---

## 7. 实施顺序（每一步都可以单独合并、单独验证）

| # | 内容 | 验证方式 | 预估工作量 |
|---|---|---|---|
| **P0-1** | `lib/core` 类型和哈希工具；数据库、迁移、媒体存储；`/api/media`（支持 Range、上传） | 单元测试 + 手动拖动播放大文件 | 1.5 天 |
| **P0-2** | 项目 CRUD 和 revision 校验；创作页迁到 `/projects/[id]`；列表页；导入 localStorage 草稿 | 清空浏览器数据后稿件还在；两个标签页同时编辑时出现 409 提示 | 2 天 |
| **P0-3** | jobs 表、Worker、租约、重试、取消、并发限流、Worker 在线提示；用一个测试步骤 `echo` 跑通 | 集成测试：执行中杀掉 Worker 再重启，任务能完成 | 2 天 |
| **P0-4** | SSE 推送、`useProjectEvents`、`<JobStrip>` | 关页再开，进度继续实时更新 | 1 天 |
| **P1-1** | 断句和读音标注、LCS 保留句子 ID、读音词典；制作页的句子列表 | 单元测试：原文一个字都没被改；改一句后其余句子 ID 不变 | 2 天 |
| **P1-2** | CosyVoice 适配、`tts` 步骤、缓存、单句重录、音色选择、语速实测 | 真实调用一段文字；改一句后账本只多一条记录 | 2.5 天 |
| **P1-3** | `buildTimeline`、字幕、SRT、Remotion 组件（配音 + 字幕 + 占位卡）、Player 预览 | 单元测试 + 目测声音和字幕同步 | 3 天 |
| **P1-4** | `render` 步骤：打包、渲染、响度归一、元数据、AI 角标、下载 | 用 ebur128 验证响度；`ffprobe` 能看到元数据 | 2 天 |
| **P1-5** | 分镜步骤、`normalizeShots` 规则、分镜板、上传图片、锁定 | 单元测试覆盖各条规则；锁定的镜头不变 | 3 天 |
| **P1-6** | 曲库导入、选曲、自动压低、转场音效 | 单元测试校验音量曲线；试听 | 2 天 |
| **P1-7** | 9:16 版式、安全区、横竖两版一起渲染 | 两个画幅各出一条成片 | 1.5 天 |
| **P1-8** | 对账式编排、一键成片、费用预估、预算、样片渲染 | 5 分钟的稿子从一键到出片，全程无需人工干预 | 2 天 |

合计约 **P0 6.5 天，P1 18 天**（按一个人全职开发粗估，不含等待服务商开通和准备曲库的时间）。

**测试策略**：`lib/core` 下的纯函数都要有 vitest 单元测试（时间轴、断行、分镜规则、音量曲线、SRT、句子 diff、对账）；数据库和任务系统用临时目录做集成测试；TTS 用模拟的 WebSocket 服务测试；另外写一个 `npm run smoke` 脚本，渲染一条 10 秒短片做冒烟测试。

---

## 8. 合规（P1 默认开启）

- **显式标识**：画面角落显示半透明的「AI生成」字样（横屏放右上角，竖屏放左上角，避开平台按钮）。设置里可以换位置，**默认不能关闭**，如果要关闭需要二次确认。发布素材生成的简介末尾，自动加上「本视频含 AI 生成内容」。
- **隐式标识**：FFmpeg 把 AIGC 信息写进文件元数据（内容标签、生成服务提供者、内容编号）。具体字段名以《人工智能生成合成内容标识办法》配套的国家标准为准，实现时核对。
- **授权记录**：曲库每一首必须填授权来源；上传的图片记录上传人；声音只用平台预置音色（P1 不做声音克隆）。
- **审核被拒**：P1 只做一件事，把失败原因原样显示并允许修改后重试；P2 再加入自动改写提示词和换画面来源的退路。

---

## 9. 风险与待核实事项

| 事项 | 影响 | 应对 |
|---|---|---|
| CosyVoice 的消息格式、哪些音色支持时间戳和 SSML、单价 | P1-2 | 接入第一天就用真实账号验证；单价写在 `config/pricing.json`，由人工核实后填写 |
| 逐句合成时，句间语气不连贯 | 听感 | P1-2 结束时试听评估，必要时改成整段合成 |
| `node:sqlite` 仍是实验特性 | 低 | 访问已收口在一个文件里，可以换成 better-sqlite3 |
| Remotion 授权（团队超过 3 人） | 费用 | 人数变化前核实官网条款 |
| 渲染速度 | 等待时间 | 先用 draft 样片渲染；实际速度在 P1-4 实测，必要时调整并发或换机器 |
| 内网机器无法下载 Chrome 和字体 | 部署 | 提前下载，写进部署文档 |
| 版权曲库需要你准备 | P1-6 | 可以先放几首无版权问题的曲子跑通流程 |

---

## 10. 给 P2 留的扩展位

- `Shot.kind` 已经包含 `image`、`video`、`stock`、`chart`；`placeholder` 版式直接替换成生图结果。
- `lib/providers/` 按同样的接口加上 `image/`、`video/`（例如万相）；画面来源策略通过 `planPipeline` 按 `kind` 和 `importance` 分派。
- `Line.keywords` → 花字和「叮」音效；`Shot.description` 和 `prompt` → 生图提示词；`settings.visualStyleId` → 视觉设定集。
- 缓存键和素材账本的机制不变，候选图挑选就是同一个缓存键下存放多个结果。
