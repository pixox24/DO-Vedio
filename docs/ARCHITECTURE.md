# 架构地图

接手项目先读这一页，**不要通读代码**。这里只写「去哪找」，不写「是什么」。

- 功能演进历史 → `lib/changelog.ts`（页面 `/changelog`）
- 安装、环境变量、模型 Key → `README.md`
- 本文件与 `README.md` 冲突时以本文件为准：README 只覆盖早期的「文案工坊」，制作与复创部分它没写。

---

## 一、这是什么

输入标题/参考视频 → 生成带分段时间轴的口播稿 → 配音、分镜、字幕、配乐 → Remotion 渲染成片。

- Next.js 16 + React 19 + Remotion 4 + Tailwind 4；数据库是 `node:sqlite`（无 ORM）
- 单仓库、**双进程**，没有独立后端服务
- 503 个源码文件，约 2.9 MB

## 二、进程模型（最重要的一张图）

```
浏览器 ──► web (next dev / next start)        写 DB、派发任务、SSE/轮询回报
              │
              ▼
           data/app.db  (SQLite, WAL, 两进程共用)
              ▲
              │
           worker (npm run worker → worker/index.ts)
              └─ worker/loop.ts 轮询 jobs 表 → lib/pipeline/stages/*
```

- **web 从不直接跑重活**：只写 `jobs` 表，由 worker 领取（`lib/server/jobs.ts`，60s 租约，崩溃自动回队）。
- web 与 worker 必须同时跑才有完整功能。启动：双击「启动.bat」或 `npm run dev:all` / `npm run up`。
- **改完要重启谁**：`worker/`、`lib/pipeline/`、`lib/server/` → 重启 worker；**`lib/core/` 被两个进程共用，web 和 worker 都要重启**。

## 三、目录职责

| 目录 | 放什么 | 特征 |
|---|---|---|
| `app/` | Next.js 路由。15 个 `page.tsx` + **81 个 `api/*/route.ts`** | 页面组件都很薄，逻辑在 `components/` 和 `lib/` |
| `components/` | 全部 UI。顶层 33 个 + `studio/`（制作页各面板）+ `viral/` | `workbench.tsx` 创作台、`video-studio.tsx` 制作页是两个大壳 |
| `lib/core/` | **纯领域层，无 I/O**。文档类型、时间轴、分镜、角色、字幕、运镜、缓存键 | 73 个文件 + `subtitle/` 17 个，改动风险最高 |
| `lib/pipeline/` | 任务编排。`stage.ts` 契约、`plan.ts` 自动推进、`runtime.ts` 自检、`stages/` 14 个步骤 | worker 的心脏 |
| `lib/server/` | 持久化与外部资源。db、迁移、队列、媒体、缓存、ffmpeg、GC、梗库、版本 | 唯一碰数据库的地方 |
| `lib/providers/` | 模型服务商接入（`catalog` 模型清单 / `registry` / `custom` 加密存储 / 用量），子目录 `media/` `tts/` | ⚠️ 服务商**散落硬编码**，加一家远不止改这里，见第四节 |
| `lib/viral/` | 爆款复创领域逻辑（状态机、生成、审校、失效判定） | 配合 `lib/server/viral/` 存储、`lib/pipeline/viral/` 任务 |
| `lib/humanize/` | 去 AI 味：规则库、检测器、改写验收 | 规则与提示词共用一份 |
| `lib/aix/` | 外部 AIX 风格库适配（调色板、动效、模板映射） | 素材在 `vendor/aix-style-library/` |
| `lib/templates/` | 内置风格模板 + 自定义模板存储 | 另有 `lib/visual-styles/store.ts` |
| `remotion/` | 视频合成。`root.tsx` 注册 composition，`layers/` `shots/` `animation/` | 单独一套 React，不跑在浏览器 |
| `worker/` | `index.ts` 启动自检与定时维护，`loop.ts` 轮询 | 只有两个文件 |
| `scripts/` | 启动脚本与**探针**（`tts-probe`、`animation-probe/eval`、`texture-probe`） | 探针是调试神器，别当成产品代码 |
| `proxy.ts` | 鉴权中间件（Next 16 叫 proxy，不叫 middleware）+ `lib/auth.ts` | 令牌走 HttpOnly Cookie |
| `tests/` | vitest。但**大部分单元测试与源码同目录**（`*.test.ts` 紧贴实现） | `npm test` |

`lib/` 根目录几个散件也常用：`prompts.ts`（各环节提示词）、`llm.ts`（多模型接入）、`types.ts`、`duration.ts`、`client.ts`（前端 hooks）、`changelog.ts`。

## 四、改哪里 → 去哪儿找

| 要改什么 | 入口 |
|---|---|
| 文案环节提示词 | `lib/prompts.ts` |
| 加/改模型服务商 | `lib/providers/catalog.ts`（每个模型一条：`kind` / `adapter` / `authEnv` / `baseUrlEnv` / `modelEnv` / `featureFlagEnv`）+ `lib/providers/registry.ts`（`authConfigured` 鉴权分派）+ `components/provider-settings.tsx` |
| 配音 TTS（改现有服务商） | `lib/pipeline/stages/tts.ts` · `tts-block.ts` · `components/studio/voice-panel.tsx` |
| **配音 TTS（新增一家服务商）** | **见下方专节——远不止 `lib/providers/tts/`** |
| 字幕**样式预设** | `lib/core/subtitle/presets.ts`（`SUBTITLE_PRESETS` 6 条 + `subtitlePresetUpdates()` 的 switch，**两处都要加**）；枚举与 schema 在 `lib/core/subtitle/types.ts` |
| 字幕**断行 / 时间戳 / SRT** | `lib/core/subtitles.ts` + `lib/core/subtitle/{formatter,merge,renderer}.ts` |
| 字幕 UI | `components/subtitle-panel.tsx`（数据驱动，加预设不用改它） |
| 时间轴计算 | `lib/core/timeline.ts` —— **唯一派生点**，`buildTimeline(文档, 产物)` |
| 分镜 / 镜头 | `lib/core/shots.ts` + `stages/storyboard.ts` + `components/studio/storyboard-panel.tsx` |
| 一句话的**运镜**候选 | `lib/core/motion-library.ts` 的 `motionChoices(text)`；UI 在 `components/motion-preset-picker.tsx` |
| **入场 / 转场动效** | `lib/core/animation.ts` + `remotion/animation/` |
| 角色 | `lib/core/cast.ts` + `stages/cast.ts` + `components/cast-panel.tsx` |
| 渲染成片 | `lib/pipeline/render.ts` + `stages/render.ts`；composition 注册在 `remotion/root.tsx`（主 id `"Video"`，props 由 `lib/core/video-composition.ts` 组装） |
| 配乐 / 音效 | `lib/server/music.ts` + `lib/core/sfx.ts` + `components/studio/music-panel.tsx` |
| **计费与单价** | `config/pricing.json`（真正的单价表，按 `provider/model` 键）；`lib/pipeline/pricing.ts` 只是通用查表，无 provider 分支 |
| 去 AI 味 | `lib/humanize/` |
| 热梗库 | `lib/memes.ts`（规则）+ `lib/server/memes.ts`（存储）+ `lib/server/meme-fetch.ts`（联网） |
| 爆款复创 | `lib/viral/`（领域）+ `lib/server/viral/`（存储）+ `lib/pipeline/viral/`（任务）+ `components/viral/` |
| 数据库表结构 | `lib/server/migrations.ts`（形状 `{ id, name, sql, apply? }`，当前最大 `id` 是 **22**，新增用 23） |
| 任务队列 / 重试 | `lib/server/jobs.ts` + `worker/loop.ts` + `lib/pipeline/plan.ts` |
| 存储占用与清理 | `lib/server/gc.ts` + `app/settings/storage/` |
| 版本历史与回滚 | `lib/server/versions.ts` + `components/version-history.tsx` |
| 项目更新页 | `lib/changelog.ts`（页面只渲染数据） |

### 新增一家 TTS 服务商：散落各处的 provider 硬编码

上面那行「配音 TTS」会骗人。只往 `lib/providers/tts/` 加一个文件，运行时会直接抛「不支持的配音服务商」。

**下面这份清单来自两次盲测核对，不是来自一次真实的新增。它一定还不完整**——开始之前先自己跑一遍全仓复核，别信清单：

```bash
grep -rn '"dashscope"\|"google-gemini"\|dashscope\|google-gemini' lib app components scripts config
```

| 位置 | 要做什么 | 漏了会怎样 |
|---|---|---|
| `lib/core/types.ts:463` | `provider: z.enum(["dashscope", "google-gemini"])` | **zod 直接拒绝** |
| `lib/providers/tts/types.ts` | 服务商接口定义 | — |
| `lib/providers/tts/<新>.ts` | 实现，照 `gemini.ts` / `dashscope.ts` | — |
| `lib/providers/tts/factory.ts` | 分发（`ttsProviderOf`） | 抛「不支持的配音服务商」 |
| `lib/providers/catalog.ts` | 补每个模型一条（`kind: "tts"`、`adapter`、`authEnv`、`featureFlagEnv`…） | 模型不出现在选择器 |
| `lib/providers/registry.ts` | `authConfigured` 的鉴权分派特判 | 误判「未配置」 |
| **`app/api/voices/route.ts`** | 前端音色/模型下拉的数据源，**手写死两个服务商**（`import dashscopeTts + geminiTts`，`providers: [...]`） | **UI 里根本没有新服务商，前面全改完也接不进去** |
| `lib/core/blocks.ts` | `BLOCK_LIMITS`、`PARAGRAPH_JOINERS`、`paragraphSupported` 按 provider 分支 | 整段模式**静默不支持** |
| `lib/core/keys.ts` | 缓存键含 provider；`STAGE_VERSION.tts` 有 provider 特判（`:105`） | 缓存串味/不失效 |
| **`lib/pipeline/stages/tts-block.ts:54`** | `refCps` 的 `provider === "dashscope" ? rate : 1` 三元 | 语速倍率**静默失效** |
| `lib/pipeline/pricing.ts` + **`config/pricing.json`** | 前者通用，往后者加 `"<provider>/<model>": { perTenThousandChars, verified }` | 按默认价计费（`verified: false`） |
| `lib/server/custom-voices.ts` | 音色本硬编码 `"dashscope"`（3 处） | 非 DashScope 直接报错 |
| `components/studio/voice-panel.tsx:212` | `canAddVoice` 写死 `provider === "dashscope"`；另有 Gemini 专用字段/文案 | 不能添加自定义音色 |
| `app/api/providers/test/route.ts:12` | `providerId: z.literal("google-gemini")`，整段是 Gemini 专用 | 新服务商没有「测试连接」 |
| `components/provider-settings.tsx` | 「测试连接」按钮只对 `google-gemini` 渲染 | 设置页无测试入口 |
| `scripts/tts-probe.ts` / `tts-paragraph-probe.ts` | `family` 联合类型 + `MODELS` 数组也硬编码 | ⚠️ **见下方警告** |

⚠️ **不要用 `npm run tts:probe` 来验证新服务商**：探针自己的模型表是硬编码的，新服务商进去会得到「无此模型」的**假阴性**，反而让你以为改动没生效。

`blocks.ts`、`tts-block.ts`、`voice-panel.tsx` 属于「改了 provider 就得动、不动会静默出错」的一类，最容易漏。

### 新增一个后端接口

- **先确认有没有现成能力**。比如「导出 PDF」这件事，全仓零 PDF 依赖（`package.json` 里没有 pdf/puppeteer/playwright，源码零命中）——那是一个需要先做技术选型的任务，不是照抄一个 route 就完事。别把「找到入口」当成「找到了实现」。
- 位置：`app/api/<资源>/route.ts`；项目作用域走 `app/api/projects/[id]/…`。最简单的参照是 `app/api/projects/[id]/renders/route.ts`。
- **鉴权不用自己写**：`proxy.ts` 统一拦截全部 `/api`，失败返回 `{ error, code: "AUTH_REQUIRED" }` / 401。
  ⚠️ 例外：没配 `DO_VEDIO_ACCESS_TOKEN` 时 `accessControlEnabled()` 为 false，proxy 直接放行——**本地开发等于无鉴权**，生产才真正拦截。
- **重活不要写在 route 里**：写 `jobs` 表交给 worker；route 只做校验 + 入队 + 读结果。若这就是个新步骤，第六节的「新增一个步骤」同样适用。
- 读数据走 `lib/server/db.ts` 的 `all/get`，别 new 连接。

## 五、三条主线

1. **创作线（文案）**：`app/page.tsx` → `components/home-composer.tsx` → `/projects/[id]` → `components/workbench.tsx` → 角度 → 大纲 → 逐章写稿 → 去 AI 味 → 发布素材。纯前端 + `/api/{angles,outline,section,rewrite,metadata}`。
2. **制作线（视频）**：`/projects/[id]/video` → `components/video-studio.tsx` → 派发 jobs → worker 跑 stages → 预览 → 导出。
   ⚠️ **别把 `steps` 和 `allStages` 当镜像**：`lib/pipeline/stages/index.ts` 的 `allStages` 是**注册表**（14 项全量，决定调度）；`components/video-studio.tsx` 的 `steps` 只是**进度条显示项**（6 项子集，顺序与 `allStages` 不同，双语时还由 `produceSteps()` 在 render 前动态插入 `subtitle-translate`）。
3. **复创线（爆款）**：`/viral` → `components/viral/viral-workspace.tsx` → 任务跑在 `lib/pipeline/viral/` → 审校通过后**移交**到制作线（`lib/server/viral/handoff.ts`）。

## 六、约定与坑

**约定**

- **文档与产物分离**：`ProjectDoc`（`lib/core/types.ts`）只装用户可编辑的内容；音频/图片/缓存存在 `assets` 表和 `data/media/`，文档里只留 hash 引用。改结构时别把产物塞进文档。
- **新增一个步骤**：写 `lib/pipeline/stages/xxx.ts` → 注册进 `stages/index.ts` 的 `allStages` → 前端加进 `video-studio.tsx` 的 `steps`。三处都要改，但后两处**不是镜像关系**（见第五节）。
- **缓存键**：`lib/core/keys.ts`。改提示词或参数会改变缓存命中，通常是对的（旧产物不该被复用）。
- **迁移只增不改**：往 `migrations.ts` 末尾追加，id 递增（当前最大 22）。修改历史条目会让老库直接跳过——已执行记录在 `schema_migrations` 表。
- **重试语义**：抛 `PermanentError`（`lib/pipeline/stage.ts`）表示不重试；其它错误只有 408/429/5xx 才重试。
- **只读接口**：`lib/server/db.ts` 的 `all/get/run/tx` 是唯一的数据库入口，不要绕过它 new 连接。

**坑**

- **不要读这些目录**（生成物 / 第三方素材，读了只会污染判断）：
  - `data/` —— 含 25 MB Remotion bundle 缓存和 `app.db`，已 gitignore
  - `.next/` `node_modules/` `logs/` `tmp/`
  - `vendor/aix-style-library/`（163 个 json + 160 个 webp）、`public/aix/`（同源镜像）—— 外部风格库，走 `lib/aix/` 适配
  - `motions/` —— 三个外部导入的旧版动效模板包（HTML/JSON/字体），只被 `lib/core/legacy-templates.ts` 以 `sourcePath` 引用。了解它们看那个文件，别去读包本身
- **`motions` 是个同名陷阱**：`lib/core/types.ts` 导出的 `motions` 是**运镜**枚举（`zoom-in` / `pan-left` / …），与 `motions/` 目录无关。全项目里「运镜」= `motion-library.ts` / `types.ts` 的 `motions`，「动效/动画」= `animation.ts` / `remotion/animation/`，别混着搜。
- **中文注释用 read 工具看**：本机的 PowerShell `Get-Content` 会把 UTF-8 中文读成乱码，还会给出错误的行数。
- **`docs/` 里只有本文件是上手读物**，其余按目录名分生命周期：
  - `docs/archive/` —— 22 篇已实现或已废弃的历史计划（`*-plan` / `*-evaluation` / `*-checklist` / `*-analysis` / `*-review`）。**不要通读**，需要设计缘由时按文件名精确定位（归档 ≠ 删除，仍可 grep）。
  - `docs/viral-*.md` + `docs/agent-config/` —— 爆款复创的规格、决策、质量协议与**未完成验收台账**（`viral-recreation-status.md` 的「未完成与限制」一节记着哪些项待评）。只有改 viral 功能时才读。
  - 归档文档之间的相对链接已随目录移动失效，属已知的装饰性破损；仍被代码引用的那一处（`components/studio/shared.tsx`）已指向 `docs/archive/`。

## 七、验证

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest run
npm run lint          # eslint
```

完成重大功能后按 `AGENTS.md` 的要求在 `lib/changelog.ts` 顶部补一条记录。
