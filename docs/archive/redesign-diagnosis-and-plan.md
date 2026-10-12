# 重构与体验升级：现状诊断 + 方案

> 日期：2026-10-03
> 范围：全站（信息架构、用户流程、界面布局、视觉与动效、代码结构）
> 底线：核心功能行为不退化；数据与接口保持兼容；构建和测试保持绿色。

---

## 一、现状诊断

### 1.1 产品定位

DO·Vedio 不是「AI 视频生成器」，而是**一条端到端的口播视频生产线**：

```
标题/概要 + 解说风格
      ↓  文案阶段（/projects/[id]）
  选题角度 → 大纲 → 逐章流式成稿 → 去 AI 味 → 时长校准 → 发布素材
      ↓  制作阶段（/projects/[id]/video）
  断句标注 → 配音(TTS) → 角色识别 → 分镜 → 配乐 → 渲染 → 下载
```

两侧各有一套「支撑库」：写稿侧依赖**解说风格模板 / 梗库**，制作侧依赖**画面风格库 / 曲库 / 制作预设 / 模型中心**。

真正的差异化能力（不是通用 LLM 包装）：
1. **按时长控字数**——200/250/300 字每分钟，时间轴由实际字数推算，不采信模型自估
2. **去 AI 味**——11 条实测规则，预防/检测/改写三层，白名单式最小改动 + 验收
3. **网感/梗库**——联网抓取、逐个核实、按圈层与章节分配、过气降级
4. **可审计曲库**——授权状态、SHA-256 去重、许可证证据、选曲评分
5. **成本前置**——金币计费、报价、预算、批量确认
6. **制作预设 + 版本历史 + 乐观锁**——工程化程度的护城河

### 1.2 健康度基线（改动前）

| 项 | 状态 |
|---|---|
| `npm run typecheck` | ✅ 0 错误 |
| `npm test` | ✅ 74 文件 / 575 用例全绿 |
| `npm run dev` | ✅ web + worker 正常运行，日志无异常 |
| 工作区 | ⚠️ 有 55 文件、+5454/-915 行未提交改动 |

**结论：地基是好的。**这是一次「整理与提升」，不是「推倒重来」。任何声称要重写的方案都是错的。

### 1.3 核心功能清单（必须保留）

按用户可感知的能力盘点：

| 域 | 能力 |
|---|---|
| 项目 | 列表/搜索/排序、新建、复制、删除入回收站、30 天保留、旧草稿导入 |
| 文案 | 角度构思(换一批)、大纲增删调时长、逐章流式写稿、分段改写(9 种动作)、时长校准、去 AI 味(单段/全文/自动)、发布素材(标题/简介/标签) |
| 梗库 | 联网刷新(1/3/6 月窗口)、逐个核实、圈层分类、热度生命周期、屏蔽、粘贴导入、手动添加、按章节分配 |
| 配音 | 逐句/段落两种粒度、音色切换(报价/应用/撤回)、单句重录、批次停止、takes 撤销、读音词典 |
| 分镜 | 角色识别与定妆、镜头生成、候选对比、批量生成与停止、锁定、拆分/合并、搜索筛选 |
| 画面 | 画面风格(Aix 库 + 自定义)、字幕(字体/排版/动效/双语)、配乐(情绪/能量/授权筛选)、动效模板 |
| 输出 | 16:9 / 9:16 双画幅、样片/成片两档质量、成片过期检测、内联预览、下载、SRT |
| 工程 | 模型中心(内置 + 自定义服务商)、制作预设、版本历史、存储管理、访问令牌、changelog |

### 1.4 主要问题

按「影响用户的程度」排序，每条附证据。

#### P0 — 结构性问题，直接影响可用性

**1. 信息架构是「7 个平级链接」，没有层级**

`components/nav.tsx:6-14` 把 7 项平铺在同一行：

```
项目 · 解说风格 · 梗库 · 画面风格 · 模型中心 · 存储 · 项目更新
```

问题：
- **高频**（项目）和**低频**（存储、项目更新）同等权重
- **写作侧**（解说风格、梗库）和**制作侧**（画面风格）混在一起，无分组
- 命名冲突：`解说风格`(/templates) 与 `画面风格`(/styles) 都是「风格」，用户无法从名字区分「文案怎么写」和「画面怎么画」
- 设置项（模型中心、存储）伪装成一级导航，且不在 `/settings` 下聚合

**2. 制作页是一个 609 行的「一切中心」**

`components/video-studio.tsx` 一个组件里塞了：开工确认门禁、运行控制条、状态栏、任务步骤条、预览器、时间轴、7 个标签面板的调度、成片列表。配合 `components/video-controls.tsx` 的 **1398 行**（4 个互不相关的面板共用一个文件），制作页的认知负荷和改动风险都过高。

**3. 文案页与制作页之间是「硬切换」，不是流程**

两页由 `components/project-bar.tsx` 的 `01 文案 / 02 制作` 分段控件连接。切换会 `router.push` 整页跳转，**丢弃全部已获取数据**（约 15 个独立 fetch 生命周期没有共享缓存）。用户改一句文案再回制作页，要重新付一次全部加载成本。

**4. 零散的状态反馈体系**

同一个「出错了」有 3 种不同写法（`workbench.tsx`、`video-studio.tsx`、`video-controls.tsx` 各一套 amber 边框 + 透明底），同一个「确认」有 **4 套互不兼容的弹窗实现**（`feedback.tsx` z-[100] / `preset-dialog.tsx` z-[95] / `project-list.tsx` z-40 / `version-history.tsx` z-[80]），各自实现 Esc、点击遮罩、`role="dialog"`。

其中 `project-list.tsx:198` 的 z-40 与 `app/layout.tsx:17` 的 sticky header 同为 z-40 —— **新建项目弹窗会被页头盖住**，这是一个现存的真实 bug。

#### P1 — 一致性与体验问题

**5. 设计系统只有「约定」，没有「组件」**

`components/ui.tsx` 有 9 个原语（Field/AutoTextarea/Spinner/Select/Switch/SegmentedControl/RangeField/AudioButton/Icon），但**没有 Button / Dialog / Card / Tabs / Badge / Tooltip / Input**。

- 按钮：111 处 `className="btn btn-ghost btn-sm"` 手写字符串。因为没有 `<Button>`，每个 loading 按钮都手抄 `<Spinner className="size-3.5" />`
- 弹窗：4 套实现（见上）
- 输入：3 种写法（`ui.tsx` 的 `Field` / `cast-panel.tsx:290` 自己的 `FieldInput` / 裸 `<label>`）
- 下拉：全站该用自定义 `Select`，但 `video-studio.tsx:477,594,595` 还在用原生 `<select>`（会被操作系统样式接管）

**6. 视觉令牌不完整，硬编码散落**

- 圆角 **7 级**（`rounded-full/xl/lg/2xl/md/sm/[2rem]`）无规则
- 边框白色透明度 **12 种**（`/10`×54、`/[0.07]`×22、`/[0.06]`×17 …），且 `/10` 与 `/[0.07]` 视觉几乎相同却混用
- 语义色完全绕过令牌：`amber-*`×100+、`red-*`×80+ 等原始 Tailwind 色阶散落各处，**没有** `--color-warn` / `--color-danger`
- 微字号硬编码：`text-[11px]`×84、`text-[10px]`×51、`text-[9px]`×5
- 硬编码十六进制 11 处：`bg-[#111]/95`(弹窗)、`bg-[#151515]`(toast)、`bg-[#152000]`(成功 toast)、`bg-[#17242c]`(视频衬底)
- **字体声明了却没加载**：`--font-sans` 写了 Inter，但全项目零 `next/font` 引用 —— 除非本机装了 Inter，否则实际渲染的是 PingFang SC
- `--color-line-subtle` 零消费者（死令牌）

**7. 动效停留在「hover 反馈」层面**

全套 CSS，无动画库（合理）。但：
- `animate-rise` 是事实上的页面过渡，用在 19 处
- **弹窗无入场动画**（4 套弹窗全部瞬间出现）
- **toast 无滑入**（`feedback.tsx:81` 直接出现）
- `prefers-reduced-motion` 只关掉 3 个生成动画，**没关** `animate-rise` / `animate-pulse` / `animate-spin` / `.btn` 的 `active:scale`

#### P2 — 技术债与冗余

**8. 死代码与重复实现**

> 注：`core/animation.ts` 与 `core/choreography.ts` 曾被误判为孤儿——它们用的是相对导入（`timeline.ts:12-13`），`grep "core/animation"` 匹配不到。二者实际是活代码。

| 对象 | 情况 |
|---|---|
| `app/api/projects/[id]/generation-runs/route.ts` | 12 行，**零调用方**（内部 `lib/providers/runs.ts` 仍在用） |
| `PATCH /api/projects/[id]` | 无调用方，其 `mergePatch` 助手仅为此存在 |
| `lib/selection.ts` | 163 字节，仅单测引用，产品代码零调用 |
| `lib/core/animation-metrics.ts` | 仅被 `scripts/animation-eval.ts` 引用，产品代码零调用 |
| `lib/core/subtitle/renderer.ts` | 仅其自身测试引用，`drawSubtitles` 无产品调用方 |
| `remotion/demo/card-showcase.tsx` | 未注册进 root，演示用 |
| `scripts/diagnose-storyboard-issue.md` / `test-cache-fix.md` | 笔记散落在 scripts/ |
| `migrations.ts` 里 `tts_takes` | 重复建表两次（migration 13 与 ~350 行），靠 `IF NOT EXISTS` 掩盖 |

**8b. 真正需要合并的重叠实现**

| 对象 | 情况 |
|---|---|
| `core/animation.ts`(75) vs `core/choreography.ts`(46) | **两套都活着且互相覆盖**：都在实现「每 30 秒滚动窗口要有一次安静的节拍」，`animation.ts:60-73` 与 `choreography.ts:37-45` 近乎逐行相同。`timeline.ts:206-207` 顺序调用二者，后者胜出，前者的这部分计算被丢弃。且 `normalizeAnimation` 收下 `MotionProfile` 参数后显式忽略（`void _profile`），是早期设计的残留 |
| `core/subtitles.ts` vs `core/subtitle/` | 分工是清晰的（前者管「什么时候出现」，后者管「长什么样」），但在 `buildTimeline` 里手工维持**两套并行表示**（`Timeline.cues` 与 `Timeline.subtitleBlocks`） |
| `meme-picker.tsx` vs `meme-import.tsx` | 两个梗选择/导入面，都写同一个库 |
| `templates/page.tsx` vs `styles/page.tsx` | 「列表 + 弹窗编辑器」骨架重复约 90 行 |

**9. 客户端无共享缓存**

`useTemplates` 被 3 处独立挂载、`useImageModels` 被 3 处独立挂载，各自 `useEffect` + `fetch`，无去重、无缓存策略统一（`force-cache` / `no-store` / 无 混用）。全站约 15 条独立 fetch 生命周期。

**10. 两套撤销机制并存**：文档级（`useProject` 的 `past[]` 栈，Ctrl+Z）与 TTS take 级（`/lines/takes/undo`），语义与入口都不统一。

### 1.5 功能取舍清单

| 决定 | 对象 | 理由 |
|---|---|---|
| **合并** | `core/animation.ts` + `core/choreography.ts` → 一个 `normalizeShots` 管道 | 两条 pass 重复实现「30 秒安静节拍」且后者覆盖前者，合并后才能让规则真正确定；顺带删掉 `normalizeAnimation` 里被忽略的 `_profile` 参数 |
| **删除** | `lib/selection.ts`（+测试） | 产品零调用 |
| **删除** | `lib/core/animation-metrics.ts` + `scripts/animation-eval.ts` | 仅调试脚本引用，无产品价值 |
| **删除** | `core/subtitle/renderer.ts`（+相关测试） | `drawSubtitles` 无产品调用方（烧录走 `remotion/layers/subtitles.tsx`） |
| **删除** | `remotion/demo/card-showcase.tsx` | 未注册进 root 的演示文件 |
| **删除** | `api/projects/[id]/generation-runs/route.ts` | 零调用方，内部模块保留 |
| **删除** | `PATCH /api/projects/[id]` + `mergePatch` | 零调用方 |
| **删除** | `scripts/*.md` 笔记 → 归入 `docs/` | 目录约定混乱 |
| **合并** | `core/subtitles.ts` 与 `core/subtitle/` 的并行表示 | 保持模块分工，但把 `buildTimeline` 里手工同步的两套表示收敛为一个来源 |
| **合并** | 4 套弹窗 → 1 个 `<Dialog>` | 统一 z-index、Esc、遮罩、动画、无障碍 |
| **合并** | 3 种错误条 → 1 个 `<Alert>` | 统一语义色令牌 |
| **拆分** | `video-controls.tsx`(1398) → 4 个文件 | 4 个互不相关的面板共用一个文件 |
| **拆分** | `video-studio.tsx`(609) → 编排 + 子组件 | 降低改动风险 |
| **保留** | 全部 6 大能力域 | 核心功能，不动 |
| **保留** | `/memes`、`/styles`、`/templates` 独立页面 | 高频独立工作流，只是要重新归组 |
| **重做** | `nav.tsx` 7 平级链接 | 改为分组导航 |
| **重做** | 全站视觉令牌 | 补齐 radius / border / semantic color / text 尺度 |
| **新增** | `<Button>` `<Dialog>` `<Alert>` `<Card>` `<Tabs>` | 补上缺失的原语，收敛 111 处手写类名 |

---

## 二、方案

### 2.1 新的用户流程

**核心变化：把「两个页面」变成「一条流水线」。**

```
① 选项目 / 新建
      ↓
② 文案工作台（/projects/[id]）
   左：简报表单（标题·时长·解说风格·模型·网感）
   右：Hero → 角度 → 大纲 → 逐章成稿 → 去 AI 味 → 发布素材
      ↓  「去制作视频」按钮（不再是同级 tab，而是流程推进）
③ 制作工作室（/projects/[id]/video）
   顶部：动作条（生成成片 / 样片 / 停止 / 花费 / 状态）
   左：预览 + 时间轴（固定，不随面板跳动）
   右：内容 / 画面 / 输出 三组面板
   底：成片列表（按画幅 / 质量筛选，内联播放）
```

关键改进：
- 文案页的「去制作视频」用**主按钮**而非 tab，语义是「下一步」
- 制作页返回文案用**次级入口**，语义是「回到上一步」

### 2.2 新的信息架构

```
顶部导航（分组，不再平级）
├─ 项目            /                     ← 首页，最大权重
├─ 创作资源  ▾
│   ├─ 解说风格     /templates           ← 文案侧：怎么写
│   ├─ 梗库        /memes                ← 文案侧
│   └─ 画面风格     /styles               ← 制作侧：怎么画
└─ 设置      ▾
    ├─ 模型中心     /settings/providers
    ├─ 存储        /settings/storage
    └─ 项目更新     /changelog
```

改动要点：
1. **分组**：项目单列；创作资源与设置各自成组
2. **消除命名歧义**：`解说风格` / `画面风格` 保留，但归入「创作资源」组并加副标题说明（文案怎么念 vs 画面怎么画）
3. **低频项收进「设置」**：模型中心、存储、项目更新
4. **`/settings` 路由聚合**：新增 `/settings` 作为设置落地页（模型中心、存储、项目更新入口）

### 2.3 布局方向

**文案页**（保持已验证的 440px + 自适应双栏，但收敛状态）：
- 左栏简报表单固定
- 右栏单一「当前阶段」渲染（Hero / 角度 / 大纲 / 文稿），避免多块并存
- 把 3 种错误条统一为 1 个 `<Alert>`

**制作页**（桌面三层）：
```
┌────────────────────────────────────────────────┐
│ 动作条：项目名 · 保存 · 状态 · 生成/停止 · 花费   │  固定
├──────────────────────┬─────────────────────────┤
│ 预览轨（固定宽度）      │ 编辑轨（tabs 固定头部）    │
│  播放器                │  内容 / 画面 / 输出        │
│  时间轴                │  当前面板内容             │
│  问题摘要              │                          │
├──────────────────────┴─────────────────────────┤
│ 成片列表                                        │
└────────────────────────────────────────────────┘
```
- 左右两轨宽度**固定**，切换面板不改变比例（现有问题：预览会跳动）
- 移动端两态：预览态 / 编辑态

### 2.4 视觉方向

保留现有的强项（酸性柠檬绿 `#cdff3a` + 炭黑 + 噪点质感 + 玻璃态面板，这套已经很统一），**补齐令牌**：

```css
@theme {
  /* 现有保留 */
  --color-accent: #cdff3a;
  --color-ink: #050505;

  /* 新增：语义色 */
  --color-warn: …;   --color-warn-surface: …;   --color-warn-border: …;
  --color-danger: …; --color-danger-surface: …; --color-danger-border: …;
  --color-success: …;

  /* 新增：圆角尺度 */
  --radius-control: 0.75rem;  /* rounded-xl  → 输入/菜单项 */
  --radius-surface: 1rem;     /* rounded-2xl → 面板块/弹窗 */
  --radius-panel: 1.5rem;     /* rounded-3xl → 顶层面板 .panel */
  /* 全圆角 pill 继续用 rounded-full */

  /* 新增：边框尺度 */
  --border-hairline: rgb(255 255 255 / 0.07);
  --border-soft:     rgb(255 255 255 / 0.1);
  --border-strong:   rgb(255 255 255 / 0.2);

  /* 新增：微字号 */
  --text-2xs: 0.6875rem; /* 11px */
  --text-3xs: 0.625rem;  /* 10px */
}
```

同时：
- **加载字体**（`next/font` 引入 Inter + JetBrains Mono），当前只是个字符串
- 删掉零消费者的 `--color-line-subtle`
- 11 处硬编码 hex 收敛到令牌

### 2.5 动效方向

原则：**动效解释状态变化，不做装饰**。

| 场景 | 动效 | 时长 |
|---|---|---|
| 弹窗入场/出场 | 遮罩淡入 + 面板 scale(0.98→1) + fade | 160–200ms |
| Toast | 从右滑入 + 淡入，4.2s 后淡出 | 180ms |
| 面板切换 | 内容 fade + 微位移（复用 `rise`） | 200ms |
| 保存状态 | 文字过渡，不弹 toast 打断 | 180ms |
| 任务开始/完成 | 进度条过渡 + 勾选淡入，**不无限闪烁** | 160–220ms |
| 预览更新 | 半透明状态层 + 完成后淡出，保留播放位置 | 160ms |

补充：`prefers-reduced-motion` 下关闭**全部**位移/缩放/脉冲，只保留颜色与文本状态。

### 2.6 执行阶段

| 阶段 | 内容 | 风险 | 状态 | 验收 |
|---|---|---|---|---|
| **一** | **设计系统地基**：补齐 `ui.tsx` 原语（Button/Dialog/Drawer/Alert/Card）、统一令牌、加载字体、修 z-index bug | 低 | ✅ 已完成 | typecheck + 575 测试 + 全页面走查 |
| **二** | **导航与信息架构**：分组导航、`/settings` 聚合与落地页 | 低 | ✅ 已完成 | 全站导航可达 |
| **三** | **制作页拆分**：`video-controls.tsx` 1398 → 4 个面板文件；`video-studio.tsx` 编排收敛 | 中 | ✅ 已完成 | 制作全流程走查 |
| **四** | **流程连贯性**：文案↔制作主按钮化；客户端共享缓存（消除 15 条独立 fetch） | 中 | ⬜ 待开始 | 切页不丢数据 |
| **五** | **动效与状态统一**：剩余 3 套弹窗迁移、错误条统一、reduced-motion 补齐 | 低 | ⬜ 待开始 | 走查 + 无障碍 |
| **六** | **清理**：删死代码与死路由、合并 `animation.ts`/`choreography.ts`、三处 Field 统一 | 低 | ⬜ 待开始 | 测试仍全绿 |

每阶段结束运行 `npm run typecheck` + `npm test` + 关键流程走查，再进入下一阶段。

#### 第 1–2 阶段完成记录（2026-10-03）

产物清单（便于回滚时对照）：

| 文件 | 改动 |
|---|---|
| `app/globals.css` | 新增语义色/圆角/边框/微字号/层级令牌；`.alert*` `.overlay*` `.nav-pill` `.nav-menu` 组件类；弹窗/toast/抽屉入场动画；reduced-motion 全覆盖 |
| `components/ui.tsx` | 新增 `Button` `Dialog` `Drawer` `Alert` `Card` |
| `app/layout.tsx` | `next/font` 自托管 Inter + JetBrains Mono |
| `components/nav.tsx` | 7 项平铺 → 三层分组（`<details>` 实现） |
| `app/settings/page.tsx` | 新增设置落地页 |
| `components/feedback.tsx` | 确认弹窗改用 `Dialog` |
| `components/project-list.tsx` | 新建项目弹窗改用 `Dialog`（顺带修掉被页头遮挡的 z-index bug） |
| `lib/changelog.ts` | 追加 0.39.0 |

**本阶段未删除任何功能**，只做新增与合并（4 套弹窗 → 1、3 种错误条 → 1 套语义类）。

#### 第 3 阶段完成记录（2026-10-05）

`components/video-controls.tsx`（1398 行，4 个互不相关的面板挤在一个文件）拆为 `components/studio/`：

| 文件 | 行数 | 内容 |
|---|---|---|
| `studio/shared.tsx` | 47 | `ProjectStore` / `LineInfo` / `ImageJobInput` 类型 + `costLabelText` / `jobBatchId` |
| `studio/sentence-panel.tsx` | 563 | 逐句配音、重录、段落模式、筛选与批量操作 |
| `studio/storyboard-panel.tsx` | 525 | 镜头网格、候选切换、批量生图与失败恢复（含 `ShotCard`、`shotExpression`、`PromptSlots`） |
| `studio/music-panel.tsx` | 113 | 曲库筛选（情绪/能量/授权）、试听与配乐片段 |
| `studio/settings-panel.tsx` | 191 | 音色、批量换音色、画幅、预算与制作预设 |

**验证方式**：拆分后逐一比对了 23 个顶层声明的函数体，与拆分前**逐字节一致**（唯一差异是 `ShotThumbnail` 的导入路径 `./` → `../` 和衬底色改用 `bg-stage` 令牌）。原文件已删除，唯一引用方 `video-studio.tsx` 改为直接导入四个面板。

`video-studio.tsx` 本阶段**未拆分**（仍 612 行）——编排逻辑与三个 refresh 守卫耦合紧密，拆开风险大于收益，留待需要时再动。

---

## 三、遗留问题（待确认）

1. **未提交改动**：工作区有 55 文件 +5454/-915 行未提交。重构前应先落盘（建议先 commit 或 stash），否则无法干净回滚。
2. `lib/core/subtitles.ts` 与 `lib/core/subtitle/` 合并需要逐函数比对，字幕是渲染关键路径，需单独一阶段。
3. 制作页「开工确认」门禁（`setupConfirmed`）与设置指纹的交互复杂，拆分时需保持 `production.ts` 的语义不变。
