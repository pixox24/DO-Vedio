/**
 * 项目更新记录（单一数据源）。
 *
 * 页面 /changelog 只负责渲染这里的数据。每次完成一个「重大功能 / 重要体验优化 /
 * 架构调整 / 不兼容变更」后，在 `changelog` 数组的最前面追加一条新记录（按时间倒序）。
 *
 * 约定详见仓库根目录的 AGENTS.md「项目更新记录」一节。
 */

export type ChangeKind = "feature" | "improvement" | "fix" | "infra";

export type ChangeItem = {
  kind: ChangeKind;
  title: string;
  detail?: string;
};

export type ChangeEntry = {
  /** 语义化版本号，例如 0.1.0 */
  version: string;
  /** 发布日期，格式 YYYY-MM-DD */
  date: string;
  /** 该版本的主题 */
  title: string;
  /** 一两句话概括这次更新 */
  summary: string;
  /** 分类条目 */
  items: ChangeItem[];
};

export const changeKindMeta: Record<ChangeKind, { label: string; icon: "bolt" | "wand" | "bug" | "server"; badge: string; dot: string }> = {
  feature: { label: "新功能", icon: "bolt", badge: "border-accent/25 bg-accent/10 text-accent", dot: "bg-accent" },
  improvement: { label: "体验优化", icon: "wand", badge: "border-sky-300/25 bg-sky-300/10 text-sky-200", dot: "bg-sky-300" },
  fix: { label: "问题修复", icon: "bug", badge: "border-red-300/25 bg-red-300/10 text-red-200", dot: "bg-red-300" },
  infra: { label: "架构与部署", icon: "server", badge: "border-violet-300/25 bg-violet-300/10 text-violet-200", dot: "bg-violet-300" },
};

export const changeKindOrder: ChangeKind[] = ["feature", "improvement", "fix", "infra"];

export const changelog: ChangeEntry[] = [
  {
    version: "0.27.0",
    date: "2026-10-01",
    title: "存储管理：回收站、素材回收与缓存清理",
    summary: "删除的项目不再只是从前端消失，而是进入可恢复的回收站；新增存储管理页，展示数据目录占用，并支持回收无引用素材、清理打包缓存与临时文件，控制 data 目录膨胀。",
    items: [
      { kind: "feature", title: "存储管理页", detail: "「存储」设置页展示素材库、渲染打包缓存、临时文件、TTS 探测样本和数据库的占用与文件数，并提供一键清理入口。" },
      { kind: "feature", title: "项目回收站", detail: "删除项目进入回收站保留 30 天，可随时恢复或彻底删除；彻底删除时级联清理任务、版本快照、成片记录等关联数据，财务记录保留。" },
      { kind: "feature", title: "删除即停止任务", detail: "删除项目时自动取消未结束的任务，避免为一个已删除的项目继续付费生成素材。" },
      { kind: "improvement", title: "无引用素材回收", detail: "按可达性回收磁盘素材：仍被项目、版本快照、成片、曲库或进行中任务引用的文件不会删除；24 小时宽限期保护刚生成还没写回文档的素材，命中被回收素材的缓存会同步失效。" },
      { kind: "improvement", title: "缓存与临时文件自动清理", detail: "打包缓存只保留最近两份并保护正在使用的目录；临时文件保留 24 小时、TTS 探测样本保留 7 天；过期回收站项目由 Worker 定期维护自动彻底删除。" },
      { kind: "infra", title: "定期维护与测试", detail: "Worker 启动后与每 6 小时执行一次存储维护；新增迁移无关的清理测试，覆盖孤儿回收、引用保留、回收站级联删除、缓存失效与缓存目录保留策略。" },
    ],
  },
  {
    version: "0.26.1",
    date: "2026-10-01",
    title: "高级动效设置即时生效",
    summary: "分镜板修改动画家族、强度、旧运镜或转场后会自动保存并刷新预览；已有样片和成片会明确标记为过期，重新生成后才会更新视频文件。",
    items: [
      { kind: "improvement", title: "高级设置自动刷新预览", detail: "动画相关镜头字段纳入前端时间轴签名，修改后自动重算时间轴并保留当前播放位置。" },
      { kind: "fix", title: "动画改动正确标记成片过期", detail: "成片状态同时校验 contentHash 与 animationHash，调整动效或转场后不再误显示为当前版本。" },
      { kind: "improvement", title: "明确重新渲染入口", detail: "高级面板说明预览刷新与实际渲染的区别；点击生成样片或生成成片，才会提交新的渲染任务。" },
    ],
  },
  {
    version: "0.26.0",
    date: "2026-10-01",
    title: "可审计曲库与授权选曲",
    summary: "背景音乐从「有文件就能用」升级为可审计、可批量导入、可恢复、可去重的生产级曲库：没有可保存授权证据的曲目一律待核实，只有已核实且明确允许商用的曲目才会进入自动选曲。",
    items: [
      { kind: "feature", title: "曲库授权数据模型", detail: "每首曲目记录作者、许可证链接、官方来源页、下载地址、署名文本、商业使用许可、授权状态、审核日期、原始与规范化 SHA-256、时长、BPM、能量、是否器乐、标签和禁用原因；旧 library.json 原样兼容。" },
      { kind: "feature", title: "批量导入与取证", detail: "新增 npm run library:fetch：只从白名单 HTTPS 官方来源下载，遵守 robots 与限速，限制重试、单文件和总量，先落 staging，校验状态码、Content-Type、扩展名和文件头，再用 ffprobe/ffmpeg 检查损坏、纯音频、时长、采样率、声道、静音比例和峰值削波。" },
      { kind: "feature", title: "去重与断点续传", detail: "原始文件与规范化文件都按 SHA-256 去重，相同文件不会重复入库；导入状态写入 staging，中断后 --resume 可跳过已导入曲目继续。" },
      { kind: "feature", title: "导入报告与 NOTICE", detail: "每次导入生成 JSON + Markdown 报告，列出 accepted / rejected / quarantine / duplicate / missing license / invalid audio、来源、sha256 和原因，并自动生成需要署名曲目的 NOTICE.md 与许可证证据文件。" },
      { kind: "feature", title: "曲库面板筛选", detail: "配乐面板可按情绪、能量、授权状态和标题/作者/来源筛选，直接试听并看到时长与授权标记；手动选曲下拉只列已核实可用曲目。" },
      { kind: "feature", title: "首批可审计曲库", detail: "导入 101 首生产曲目（Jamendo 38 / Freesound 40 / Wikimedia Commons 23），全部为 CC0 或 CC BY、已核实授权并保存许可证证据；9 个情绪各至少 17 首，单一来源不超过 40%。" },
      { kind: "improvement", title: "选曲评分升级", detail: "在情绪匹配基础上增加能量、目标 BPM、曲目长度与片段长度、可循环、器乐优先、冷却次数和单一曲目全片占比上限；无精确情绪时按可解释的退让顺序选择，并写入选曲原因。" },
      { kind: "fix", title: "未核实授权不再参与选曲", detail: "授权状态不是 verified 或被禁用的曲目不会进入自动选曲；没有任何合格曲目时明确报错并提示导入入口，不再静默使用版权不明的音乐。" },
      { kind: "infra", title: "迁移与回归测试", detail: "新增数据库迁移补齐曲库授权字段；测试覆盖缺失许可证 strict 失败、无法访问来源隔离、非音频拒绝、SHA-256 去重、pending/rejected 不选曲、锁定片段保留、相邻不重复、长短片段循环、9 个情绪退让和旧清单兼容。" },
    ],
  },
  {
    version: "0.25.0",
    date: "2026-10-01",
    title: "制作预设：一次配置，每个项目复用",
    summary: "制作页的全部设置与画面风格可以存成「制作预设」；新建项目自动套用默认预设，已有项目可分组套用并一键撤销。",
    items: [
      { kind: "feature", title: "制作预设", detail: "把配音、字幕、输出画幅、素材策略、配乐音效、AI 标识和画面风格存成命名快照；支持从当前项目一键另存、重命名、复制、删除和设为默认。" },
      { kind: "feature", title: "新建项目自动套用", detail: "新建项目默认使用「默认预设」，文案写完进入制作页时字幕、音色、画幅和风格已经是配好的状态；也可以在创建时明确不使用预设。" },
      { kind: "feature", title: "分组应用", detail: "应用预设时可按输出、配音、字幕、配乐、画面风格、发布流程六组勾选，只套用需要的部分；预算默认不覆盖，防止换预设意外改变花钱上限。" },
      { kind: "feature", title: "变更预览与降级提示", detail: "应用前显示将发生的逐项变化；音色、字体或文本模型在当前环境不可用时保留项目原值并明确提示，不静默失败。" },
      { kind: "improvement", title: "应用可撤销", detail: "应用预设后提示里的「撤销」可以完全还原；已应用预设的项目保存的是值快照，之后修改或删除预设都不影响历史项目。" },
      { kind: "infra", title: "预设独立存储", detail: "预设存放在服务端 SQLite，跨浏览器一致、可备份；默认预设删除后自动回退出厂默认，新建项目不报错。" },
    ],
  },
  {
    version: "0.24.0",
    date: "2026-10-01",
    title: "字幕可靠性与翻译安全合并",
    summary: "字幕排版不再丢字或二次折行，SRT 不再重叠，逐字高亮跟随真实配音；双语翻译按句识别方向、可显示进度与停止，完成时只合并译文、不覆盖期间编辑。",
    items: [
      { kind: "fix", title: "翻译完成不再覆盖编辑", detail: "翻译结果按句 ID 与源文哈希合并回最新文档，只写译文和哈希；请求期间改过的文案、锁定、语气、停顿等字段原样保留，删除的句子不复活。" },
      { kind: "fix", title: "不合格译文被拒绝", detail: "目标语言、长度比例和字幕长度收敛为客户端与服务端共用的质量门，重试预算耗尽也不放行；失败项不覆盖已有有效翻译，并给出简短原因。" },
      { kind: "fix", title: "排版永不丢字", detail: "超过最大行数时不再截断，而是保留全部文字并显式标记；英文长单词、URL 和数字串按 Unicode grapheme 安全断行，emoji 与组合字符不会被拆开。" },
      { kind: "fix", title: "字幕不再被压成半宽二次折行", detail: "预览与成片的外层定位此前把可用宽度限制为画面一半，浏览器会把排好的行重新折行；现在撑满画面宽度再居中，排版结果与测量完全一致。" },
      { kind: "fix", title: "SRT 时间不重叠", detail: "最短显示时长只作为建议，字幕结束时间不得超过下一句的真实开始或成片总时长；导出前全局排序校验，序号稳定、时间合法。" },
      { kind: "improvement", title: "逐字高亮跟随真实配音", detail: "Karaoke 使用 TTS 字级时间戳（含标点的稀疏索引），前慢后快和长停顿都能如实反映；缺少字级时间时回退整句均匀进度，不再越界或 NaN。" },
      { kind: "improvement", title: "翻译方向按句识别", detail: "默认逐句判断源语言，混合语言稿不会再用第一句的方向翻译全篇；可手动统一中文或英文源文，数字符号等低置信度句子明确跳过并说明原因。" },
      { kind: "improvement", title: "翻译进度与停止", detail: "批量翻译显示已完成/待处理句数，可随时停止；已完成的批次保留，未完成的句子可再次补齐。" },
      { kind: "improvement", title: "译文状态更诚实", detail: "只有译文语言正确且哈希匹配才算已确认；无哈希的旧译文显示为待更新并提供补译入口，覆盖率不再虚高。" },
      { kind: "improvement", title: "字体按需加载与失败回退", detail: "展开字体选择器不再一次性下载全部内置字体，滚动到卡片才加载；加载失败会停止转圈、说明回退系统字体并提供重试。" },
      { kind: "improvement", title: "预设名实一致", detail: "修正赛博霓虹与复古打字机的描述，与实际渲染效果一致；手动调整样式后预设卡片显示「自定义组合」，点击可重置。" },
      { kind: "improvement", title: "字号与无障碍", detail: "字号控件标明以 950px 宽画面为基准并同步取值范围；字体选择器关联真实容器 ID，最大行数使用单选语义并支持方向键。" },
    ],
  },
  {
    version: "0.23.0",
    date: "2026-10-01",
    title: "可自定义字幕模块",
    summary: "从 AI-Video 完整移植字幕模块：6 套样式预设、字体选择、字号位置、背景描边、入场动效和双语副行，预览与成片共用同一套排版。",
    items: [
      { kind: "feature", title: "字幕设置面板", detail: "制作页新增「字幕」面板：抖音爆款黄白、电影双语大片、荧光暗黑胶囊、赛博霓虹、复古打字机和经典黑底白字六套预设，支持字号、垂直位置、背景胶囊、描边和阴影开关。" },
      { kind: "feature", title: "字幕字体选择", detail: "口播和翻译副行可以分别选择字体，内置系统黑体、乐米石鼓旧宋、武汉英雄体、摇醒青年黑、卓特自由体和四套西文字体；字体按需加载，载入失败自动回退系统字体。" },
      { kind: "feature", title: "双语字幕", detail: "开启后主行口播、副行翻译；面板显示翻译覆盖率，缺翻译或文案改过时可一键补齐，翻译按句哈希对账，过期的副行宁可不画也不错位。" },
      { kind: "feature", title: "入场动效", detail: "支持弹性弹出、平滑淡入、逐字高亮和不动四种效果，关键词强调色可单独开关。" },
      { kind: "improvement", title: "智能多行排版", detail: "过长句子在标点处自然折行并自动缩小字号，双语块变高后自动避开画面上下安全区，不伸出画面。" },
      { kind: "infra", title: "字幕模块独立", detail: "配置、预设、字体、排版引擎和 Canvas 渲染集中在 lib/core/subtitle，Remotion 预览与成片渲染共用同一份测量结果，Canvas 渲染器保留给导出场景。" },
    ],
  },
  {
    version: "0.22.0",
    date: "2026-10-01",
    title: "全片编排与风格专属动画",
    summary: "动画家族现在覆盖时间线、拼贴、HUD 和水墨表达，并由全片编排层按情绪和章节分配节奏。",
    items: [
      { kind: "feature", title: "四类风格专属 family", detail: "新增 timeline、collage、hud 和 ink 渲染器，时间推进、套印错位、界面扫描和墨线生长可直接在镜头中使用。" },
      { kind: "feature", title: "全片编排层", detail: "章节边界、旁白情绪、镜头重要度和风格张力共同决定强度与转场，连续镜头不再各自做局部决定。" },
      { kind: "improvement", title: "剩余转场增强", detail: "dissolve 使用逐帧纹理溶解效果，并继续保持重叠转场不缩短音频和字幕时间轴。" },
      { kind: "fix", title: "HUD 强度预算", detail: "连续 HUD 镜头自动降为克制强度，避免发光和闪烁堆叠成视觉噪声。" },
      { kind: "infra", title: "动画质量指标", detail: "新增重复文字、数字溯源、family 熵、连续重复、运动占比、安全区和强度方差报告。" },
    ],
  },
  {
    version: "0.21.0",
    date: "2026-10-01",
    title: "六类动画家族",
    summary: "信息卡现在按内容形态使用可复用的动画渲染器，横屏和竖屏共用同一份时间轴并自动避让字幕。",
    items: [
      { kind: "feature", title: "六个动画家族", detail: "新增 editorial、kinetic、stat、compare、process 和 callout 渲染器，标题、数字、对比、流程和重点信息各有对应的动态表达。" },
      { kind: "feature", title: "两层视差镜头", detail: "复合镜头把背景素材和信息层分开运动，静态图片也能获得轻量的景深感。" },
      { kind: "improvement", title: "字幕安全区统一派生", detail: "所有动画家族和复合镜头都读取时间轴派生的安全区，多行字幕会自动让出更多底部空间。" },
      { kind: "fix", title: "未实现 family 明确禁用", detail: "时间线、拼贴、HUD 和水墨等后续家族在界面中标记为开发中，不再让用户误以为已经有独立渲染。" },
    ],
  },
  {
    version: "0.20.0",
    date: "2026-10-01",
    title: "动画配方与重叠转场",
    summary: "代码画面现在使用可校验的动画 family、锚点和强度预算；转场通过重叠镜头实现，不会缩短旁白和字幕的时间轴。",
    items: [
      { kind: "feature", title: "封闭动画配方", detail: "镜头支持 family、结构化参数和字级锚点，旧 motion 会自动兼容并避免双轨规则冲突。" },
      { kind: "feature", title: "重叠式转场", detail: "支持淡入、擦除、甩镜、推入和溶解，镜头区间只重叠不缩短，保持音频、字幕和总时长不变。" },
      { kind: "improvement", title: "字幕安全区自动派生", detail: "动画层按实际字幕行数计算底部避让比例，横屏和竖屏不再依赖写死的镜头字段。" },
      { kind: "fix", title: "镜头类型不再静默降级", detail: "素材库、图表、真实素材和复合模式都有明确渲染分支，缺资源时显示可诊断状态。" },
      { kind: "infra", title: "内容与动画哈希拆分", detail: "渲染记录同时保存 contentHash 与 animationHash，调整转场或动效时不再强制整片内容缓存失效。" },
    ],
  },
  {
    version: "0.19.0",
    date: "2026-09-30",
    title: "代码画面与视觉风格对齐",
    summary: "信息卡、标题卡等 Remotion 代码画面不再共用一套写死的配色和动效，改为从所选视觉风格推导；新项目按解说风格推荐贴切的画面风格。",
    items: [
      { kind: "feature", title: "配色由风格推导", detail: "从 Aix 风格的配色描述解析出真实色值，改用「深—中—浅」三色渐变和强调色；160 张风格卡得到 42 组不同的强调色，此前它们只共享 5 组。" },
      { kind: "feature", title: "动效成为风格的一部分", detail: "风格卡新增动效基调（缓动、幅度、入场方向、圆角、纹理），由画风、光影、构图文本推导。水墨慢而沉、扁平几何快而硬、霓虹带扫描线，换风格连节奏一起换。" },
      { kind: "feature", title: "按解说风格推荐画面风格", detail: "新项目不再一律拿到目录里排序最前的那张卡；悬疑推荐暗调霓虹、温暖推荐黏土定格，映射表由人工校准并可在风格编辑页调整。" },
      { kind: "improvement", title: "缓动词汇表", detail: "运镜和卡片入场从线性插值改为带缓动的曲线，像素与丝网印刷风格使用跳帧量化，预览和渲染逐帧一致。" },
      { kind: "improvement", title: "信息卡开始运镜", detail: "此前只有图片和标题卡会动，占全片两到三成的信息卡是静止的；现在背景层推进、内容层保持不动，避免和字幕抢注意力。" },
      { kind: "improvement", title: "正文颜色随底色翻转", detail: "米白、纸白这类浅色风格此前用白字，糊成一片；现在按底色明暗自动切换深色字。" },
      { kind: "fix", title: "Aix 快照补全缺失字段", detail: "氛围、镜头、适合题材此前在 Aix 路径上恒为空，情绪调制因此从不生效；现已从对应风格轴填充。" },
    ],
  },
  {
    version: "0.18.0",
    date: "2026-09-30",
    title: "输出规格与生图画幅解耦",
    summary: "输出版本、当前预览和生图素材画幅现在使用同一套版本化规格；横屏与竖屏可以分别生成并保存，也可以按策略共享素材。",
    items: [
      { kind: "feature", title: "横竖输出规格", detail: "支持横屏 1920×1080 与竖屏 1080×1920 的 30fps 预设，新项目默认只生成横屏，双版由用户明确选择。" },
      { kind: "feature", title: "画幅专用素材变体", detail: "每个镜头可以按输出画幅保存独立图片或视频，预览和渲染会优先读取对应变体。" },
      { kind: "improvement", title: "智能双版素材策略", detail: "高风险镜头按画幅分别生成，普通镜头可共享素材；全部分别生成和全部共享也可在制作设置中即时切换。" },
      { kind: "improvement", title: "Provider 真实传递比例与尺寸", detail: "Replicate 与 OpenAI-compatible 图片接口收到目标比例或等比例尺寸，生成记录保留实际 frame；不支持时不会静默丢弃约束。" },
      { kind: "fix", title: "旧项目兼容", detail: "旧项目的横屏、竖屏和双画幅设置继续可读，只有旧 assetId 的镜头继续播放并明确标记为共享素材。" },
      { kind: "infra", title: "画幅隔离缓存键与渲染键", detail: "生图、时间轴和渲染键均包含 output spec，切换预览不会创建任务或错误复用另一画幅缓存。" },
    ],
  },
  {
    version: "0.17.0",
    date: "2026-09-30",
    title: "Aix 160 种系统风格库接入",
    summary: "画面风格现在完全来自版本化 Aix 风格库，用户可以在本地即时搜索并应用任意风格；已有项目继续读取历史快照，自定义风格单独保存在“我的风格”。",
    items: [
      { kind: "feature", title: "Aix 风格选择器", detail: "接入 160 种 active 风格，支持编号、名称、别名和标签搜索，缩略图本地懒加载，浏览和选择不会调用模型或生成任务。" },
      { kind: "improvement", title: "版本化风格快照", detail: "应用风格时保存 Aix 编号、库版本、风格版本、contentHash 和完整结构化来源，后续库升级不会改变已有项目。" },
      { kind: "improvement", title: "系统风格与我的风格分开", detail: "Aix 系统目录只读，自定义风格继续支持编辑、另存和删除，项目微调仍然只影响当前快照。" },
      { kind: "infra", title: "构建期目录校验", detail: "新增 aix:sync 与 aix:check，校验 160 条目录、摘要、路径、JSON schema 和 WebP 缩略图，避免运行时依赖桌面路径。" },
      { kind: "fix", title: "移除旧内置风格", detail: "新项目不再回退到旧 10 张风格；旧项目中缺少来源元数据的完整历史快照仍可读取。" },
    ],
  },
  {
    version: "0.16.0",
    date: "2026-09-30",
    title: "成本确认与可撤销操作统一",
    summary: "所有会调用付费服务的入口现在先显示数量和费用，再按规模决定是否打断确认；重录、候选图和音色恢复的失败路径也有明确的回退语义。",
    items: [
      { kind: "improvement", title: "成本前置与重试统一", detail: "配音、生图和任务重试按钮直接展示数量与可估费用，便宜操作不再弹窗，批量操作按统一阈值确认。" },
      { kind: "feature", title: "重录完成后可撤销", detail: "旧配音只在强制覆盖时归档，任务成功后才提供撤销；批量撤销按一次操作原子恢复，自动补齐不会产生多余归档。" },
      { kind: "improvement", title: "候选图保留历史", detail: "重新生成图片会合并新旧候选并保留当前选中的素材，用户可以随时切回上一版。" },
      { kind: "fix", title: "音色恢复不再因缺音频失败", detail: "撤回音色应用会立即恢复项目设置，缺失的旧音频自动按批次补录，完成后清理临时状态。" },
      { kind: "infra", title: "迁移与归档清理可重放", detail: "配音归档和任务开始时间迁移会检查现有 schema，清理任务时同步清除过期撤销记录。" },
    ],
  },
  {
    version: "0.15.0",
    date: "2026-09-30",
    title: "制作状态与配音批次收口",
    summary: "配音重录、镜头生成和渲染现在都有可追踪的批次或服务端状态；句子面板会提前告诉你哪些配音缺失，渲染中也能看到可信的剩余时间提示。",
    items: [
      { kind: "feature", title: "配音批次可停止", detail: "批量重录显示已完成数量和停止入口，停止只取消本次提交，已生成的音频继续保留；重录覆盖的旧音频可在提示中撤销。" },
      { kind: "improvement", title: "渲染 ETA", detail: "渲染步骤按任务真正开始时间和当前进度估算剩余时间，刚开始显示准备中，估算过长时改显示已进行时长。" },
      { kind: "improvement", title: "缺失配音提示", detail: "句子面板顶部汇总没有音频的句子数量和预估费用，并提供补齐缺失入口，已有配音在补齐前继续可用。" },
      { kind: "fix", title: "服务端裁决镜头状态", detail: "镜头卡按当前描述对应的服务端任务显示状态，旧一代任务不会再覆盖新描述的生成结果；换音色和重录进度也统一由页面上层维护。" },
      { kind: "infra", title: "任务开始时间记录", detail: "新增 jobs.started_at 并在领取、重试时维护，为渲染 ETA 提供不会被心跳刷新干扰的时间基准。" },
    ],
  },
  {
    version: "0.14.0",
    date: "2026-09-30",
    title: "全量生图可停止并继续",
    summary: "全量生成图片现在可以按批次停止，保留已完成结果，之后继续补齐未完成镜头。",
    items: [
      { kind: "feature", title: "停止本次生成", detail: "停止只取消当前全量生图批次，单独生成的镜头不受影响；刷新页面后仍可识别批次状态。" },
      { kind: "improvement", title: "继续补图", detail: "已完成图片和候选图保留，继续生成时重新扫描缺图与过期镜头，不重复提交已完成镜头。" },
    ],
  },
  {
    version: "0.13.0",
    date: "2026-09-29",
    title: "段落配音工作流完善",
    summary: "句子面板现在按实际段落任务组织内容，支持整段试听、拆小子块试听和单独录制句子；重录与换音色提示会同时显示句数和任务数。",
    items: [
      { kind: "feature", title: "段落块分组与试听", detail: "同一段落的句子集中展示，组头提供整段试听；自动拆小时可分别试听每个子块，并显示精确、估算或降级状态。" },
      { kind: "feature", title: "单独录制此句", detail: "段落模式下可以让单句暂时脱离段落合成，确认后自动补齐受影响的段落任务。" },
      { kind: "improvement", title: "组头重录与状态", detail: "重录本段、任务进度和失败原因统一放在段落组头，句内继续保留单句试听、锁定、定位和词典操作。" },
      { kind: "fix", title: "句数与任务数显示修正", detail: "批量重录和换音色报价分别展示句子数量与段落任务数量，避免把任务数误报为句数。" },
    ],
  },
  {
    version: "0.12.0",
    date: "2026-09-29",
    title: "段落配音支持 Gemini 与自动降级",
    summary: "段落级配音开放 Google Gemini；切分前先校验语速，切不准时自动拆小重录、最后才退回逐句，漏读或截断的音频不会进入成片。",
    items: [
      { kind: "feature", title: "Gemini 段落配音（实验）", detail: "Gemini 没有字级时间戳，改为把音频里的停顿按顺序对齐到句末和句内逗号上再切分；「他说，……继续。」这类逗号处的长停顿不会再被误当成句界。" },
      { kind: "improvement", title: "三级降级", detail: "整段切分或语速校验不通过时，先对半拆开分别重录（最多两层），仍不通过才逐句合成；所有结果最后一次性写入，中途失败不留半截。" },
      { kind: "improvement", title: "漏读、重读与切错检测", detail: "整段语速偏离音色实测语速过多判为漏读、重读或截断，某句语速偏离整段过多判为句界切错，阈值来自真实探针数据。" },
      { kind: "improvement", title: "分块更均衡", detail: "超长自然段按最少块数、字数均衡、优先句号处拆分，不再把段落最后一句单独留下。句子面板会标出「已拆小合成」「已逐句合成」。" },
    ],
  },
  {
    version: "0.11.0",
    date: "2026-09-29",
    title: "段落级配音（实验）",
    summary: "配音可以按自然段整段合成，再自动切回单句，句间音色、语气和停顿更连贯；字幕、镜头锚点和单句试听照常可用。",
    items: [
      { kind: "feature", title: "合成粒度：逐句 / 段落", detail: "制作设置里新增「合成粒度」。段落模式把同一自然段的几句一次合成，再按时间戳切成单句，切换时沿用「后台生成、就绪后统一切换、可撤回」的换音色流程。当前开放阿里云百炼（CosyVoice / Qwen）。" },
      { kind: "improvement", title: "保留自然停顿与换气", detail: "段落内句间停顿用原音频里的实测值（约 0.5–0.8 秒，逐句模式固定 0.25 秒），相邻句的音频首尾相接，播放效果与整段原音频一致；同样的文案成片会略长。" },
      { kind: "improvement", title: "重录按段提示", detail: "段落模式下句子显示所在段落位置，「重录本段」会先说明将整段重新生成及计费句数；切分不可靠时自动退回逐句合成，字幕不会错位。" },
      { kind: "fix", title: "Gemini 在国内网络下可用", detail: "新增 GOOGLE_GEMINI_PROXY_URL，只让 Gemini 请求走本机代理，DashScope 等国内服务继续直连；地区受限和代理未启动时给出明确提示。" },
      { kind: "infra", title: "配音任务统一构造", detail: "自动编排、全部重录、单句重录和换音色共用同一套任务构造与报价；新增逐句 vs 段落的 A/B 探针脚本 npm run tts:paragraph-probe。" },
    ],
  },
  {
    version: "0.10.0",
    date: "2026-09-29",
    title: "并发制作可靠性升级",
    summary: "补齐从访问控制到后台任务执行的关键保护，避免未授权访问、旧任务回写、保存覆盖和过期分镜影响项目或产生重复费用。",
    items: [
      { kind: "feature", title: "共享访问保护", detail: "页面和 API 支持共享令牌登录，生产服务默认仅本机监听，降低项目数据和付费接口被意外暴露的风险。" },
      { kind: "improvement", title: "保存与取消更可靠", detail: "保存冲突会合并请求期间的最新编辑，长任务支持取消并在写回前复核状态，减少并发编辑造成的覆盖。" },
      { kind: "fix", title: "任务代次隔离", detail: "取消、重试或租约恢复后，旧 Worker 不能再完成新代次任务、重复记账或覆盖新结果；TTS 任务也按项目隔离。" },
      { kind: "fix", title: "分镜和成片一致性", detail: "分镜生成会校验文案快照，视频镜头使用真实视频素材，保存冲突时不会提交新的生图或渲染任务。" },
      { kind: "infra", title: "流水线状态校验", detail: "媒体批处理、角色定妆、镜头生成和渲染在关键阶段检查当前任务代次，并通过项目级查询避免跨项目读写。" },
    ],
  },
  {
    version: "0.9.2",
    date: "2026-09-29",
    title: "内网访问保护",
    summary: "为页面、API 和媒体接口增加共享访问令牌，并将生产服务默认收紧为本机监听，降低误部署造成的数据和费用风险。",
    items: [
      { kind: "feature", title: "共享令牌登录", detail: "配置 DO_VEDIO_ACCESS_TOKEN 后，未登录页面会跳转到登录页，API 未授权统一返回 401；令牌只保存在 HttpOnly Cookie 中。" },
      { kind: "infra", title: "生产监听地址收紧", detail: "生产启动默认监听 127.0.0.1，只有显式设置 DO_VEDIO_HOST 才会开放到局域网；生产漏配令牌时服务直接返回 503。" },
    ],
  },
  {
    version: "0.9.1",
    date: "2026-09-29",
    title: "Gemini TTS 连接诊断",
    summary: "模型中心现在可以直接验证 Gemini 3.8 Flash 与 Flash-Lite 的真实 TTS 连接，配置问题不再只显示为模糊的待配置状态。",
    items: [
      { kind: "feature", title: "一键测试连接", detail: "每个 Gemini TTS 模型都可发起短文本生成测试，展示延迟、音频格式和可执行的失败原因，不写入项目素材、缓存或账本。" },
      { kind: "fix", title: "配置状态准确识别", detail: "模型中心兼容 GOOGLE_GEMINI_API_KEY 与 GEMINI_API_KEY，并在功能开关开启后正确显示可用状态。" },
    ],
  },
  {
    version: "0.9.0",
    date: "2026-09-29",
    title: "配音设置先试听再应用",
    summary: "切换音色或调整参数时先保留为草稿，确认后按需生成；旧配音持续可用，待新配音全部就绪后统一切换。",
    items: [
      { kind: "improvement", title: "配音草稿与一次确认", detail: "调整服务商、模型、音色、语速、音量和表达指令时不再逐项弹出重录提示；可先试听，再查看受影响句数、缓存复用、请求量和费用后应用。" },
      { kind: "feature", title: "后台准备并统一切换", detail: "新配音生成期间保留原音频，失败后只补缺句；支持取消待应用设置，并在旧缓存完整时撤回已应用的设置。" },
    ],
  },
  {
    version: "0.8.1",
    date: "2026-09-29",
    title: "Gemini 配音完整性与配额重试修复",
    summary: "修复 Gemini 把表达指令读进旁白的问题，并按上游 429 给出的等待时间重试；受影响的旧音频缓存不再复用。",
    items: [
      { kind: "fix", title: "只朗读正文", detail: "Gemini 请求只发送朗读文本，暂停表达指令控件并保留已填内容；旧 Gemini 缓存失效，避免把包含指令的音频用于成片。" },
      { kind: "fix", title: "遵守配额等待时间", detail: "解析 Google 429 正文及响应头中的重试时间，API 和 Worker 队列都等待足够时间后再试，减少手动补录。" },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-09-28",
    title: "Gemini TTS Phase 3 灰度验证",
    summary: "使用真实中文样本验证 Gemini 3.8 Flash 与 Flash-Lite 的模型 ID、音频协议、表达指令和配额行为；当前数据未达到默认生产门槛，Google provider 继续受 feature flag 控制。",
    items: [
      { kind: "feature", title: "真实模型探针", detail: "确认可用模型为 gemini-3.8-flash-tts 与 gemini-3.8-flash-lite-tts，并保存基线、长稿、尾句和表达样本报告。" },
      { kind: "improvement", title: "协议兼容", detail: "按实际 SpeechConfig schema 移除无效的 stylePrompt 字段，将表达指令编译到用户 prompt，避免上游 400。" },
      { kind: "fix", title: "Key 兼容读取", detail: "服务端、探针和音色配置接口同时支持 GOOGLE_GEMINI_API_KEY 与 GEMINI_API_KEY，避免已配置的通用 Key 被误报为缺失。" },
      { kind: "fix", title: "网络错误可诊断", detail: "保留 Gemini fetch 失败的 DNS、连接超时和连接中断错误码，试听失败时能区分网络故障与鉴权、模型或请求参数错误。" },
      { kind: "infra", title: "灰度门槛记录", detail: "记录 HTTP 状态、重试、429、usage、WAV 参数和 p95 延迟；配额不足、价格未核实和人工评分缺失时保持 Google 默认关闭。" },
    ],
  },
  {
    version: "0.7.0",
    date: "2026-09-28",
    title: "Gemini TTS 生产流水线接入",
    summary: "Google Gemini TTS 现在可以从制作设置进入试听、批量重录和后台配音任务，同时保留能力、对齐质量和未核实计费单位的明确记录。",
    items: [
      { kind: "feature", title: "生产链路接入", detail: "Gemini provider 接入 TTS worker、试听和批量重录；DashScope 原有配音链路继续可用。" },
      { kind: "improvement", title: "缓存与运行记录", detail: "缓存指纹覆盖表达指令和音频输出参数，GenerationRun、voice_stats、资产 metadata 和账本记录实际 usage 与音频信息。" },
      { kind: "improvement", title: "能力驱动设置", detail: "设置页按模型能力展示表达控制，句子面板标明精确对齐或估算对齐，避免把不支持的逐句情绪控制展示给用户。" },
      { kind: "infra", title: "计费口径可追溯", detail: "字符、token、秒数和未知 usage 使用不同账本单位；Gemini 尚未核实的价格保持 unknown，不当作免费字符计费。" },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-09-28",
    title: "Gemini TTS 协议探针与服务端适配器",
    summary: "新增 Google Gemini Flash / Flash-Lite TTS 的服务端适配器和可重复协议探针，先验证音频、正文完整性与连续段落表现，再进入生产流水线。",
    items: [
      { kind: "feature", title: "Gemini TTS 适配器", detail: "新增正文与 stylePrompt 分离的 Gemini HTTP 请求、Flash / Flash-Lite 模型目录、服务端 API Key 读取和 WAV 统一输出。" },
      { kind: "feature", title: "协议探针", detail: "探针支持基线、表达指令、长稿尾句和六段连续短句样本，保存 JSON、Markdown 和可试听音频目录；未配置 Key 时明确跳过。" },
      { kind: "improvement", title: "音频与错误校验", detail: "识别已有 WAV、裸 PCM 和无效容器，避免重复包装 WAV 头，并对鉴权、配额、限流、超时、安全拒绝和损坏音频分类。" },
      { kind: "infra", title: "受控启用", detail: "增加 Gemini 环境变量、未核实价格标记和 feature flag，默认关闭，不影响现有 DashScope 配音链路。" },
    ],
  },
  {
    version: "0.5.0",
    date: "2026-09-28",
    title: "统一下拉菜单：更清晰、更稳定",
    summary: "所有页面的下拉选择器统一为深色玻璃菜单，选项、选中态和禁用态清晰可见，菜单不会再被面板或滚动区域裁切。",
    items: [
      { kind: "improvement", title: "统一交互与视觉", detail: "下拉触发器、选项列表、选中勾选和禁用状态采用同一套样式，页面之间不再出现默认系统下拉框的割裂感。" },
      { kind: "improvement", title: "菜单显示更可靠", detail: "菜单通过浮层定位并自动选择上下展开方向，长选项列表在视口内滚动，避免被卡片、面板和滚动容器遮住。" },
      { kind: "feature", title: "键盘操作", detail: "支持 Enter、空格、上下方向键和 Escape 操作下拉菜单，保留清晰的选中反馈和禁用选项。" },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-09-28",
    title: "一键启动与重启：启动.bat",
    summary: "双击根目录的「启动.bat」即可启动或重启网页与后台 Worker，不用再区分首次启动和重启；停止、状态查看与生产模式都收在同一个入口。",
    items: [
      { kind: "feature", title: "双击即启", detail: "启动.bat 一个入口同时拉起网页和 Worker，后台运行、日志写 logs/；检测到旧实例会先自动收掉再启动，所以双击第二次就是重启。" },
      { kind: "feature", title: "停止与状态", detail: "启动.bat stop 停掉网页和 Worker；启动.bat status 查看是否在运行、PID 与日志位置，网页没响应时也能看出进程还在不在。" },
      { kind: "feature", title: "生产模式与前台模式", detail: "启动.bat --prod 用构建产物以 next start + worker 后台运行（内网可访问 0.0.0.0:3000）；--fg 前台运行，日志直接打在终端，Ctrl+C 一起停。" },
      { kind: "infra", title: "环境自适配", detail: "启动时自动跳过 PATH 里过旧的 Node（Worker 的 node:sqlite 需要 22.13+），并绕开 npm 在 Node 子进程里找不到自身的问题，旧环境也能双击就跑。" },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-09-28",
    title: "文案更像人写：去 AI 味与热梗",
    summary: "接入基于语料实测的去 AI 味规则；新增梗库与网感档位，让轻松类文案自然用上真实的流行梗。",
    items: [
      { kind: "feature", title: "去 AI 味", detail: "移植 lieflat-less-ai-tone 的 11 条规则：生成时预防、每段标出「AI 味 N」，并可自动或一键做白名单式最小改写，改动不合格时保留原文。" },
      { kind: "feature", title: "热梗与网感", detail: "新增梗库和网感档位（默认跟随风格，严肃类关闭）；生成前先挑梗，出大纲时把梗分到章节，写稿只用选中的梗并控制用量。" },
      { kind: "feature", title: "用梗定位", detail: "文案页顶部列出本期每个梗用了几次、在哪几段，点击直接在正文里选中；AI 味片段也可点击定位。" },
      { kind: "feature", title: "粘贴导入", detail: "粘贴热梗文章、评论或弹幕，AI 抽取后先预览再入库；原文里找不到的词直接丢弃，可联网核实热度。" },
      { kind: "improvement", title: "逐个核实防编造", detail: "联网抓到的新梗入库前单独搜一次，查不到的丢弃、来源不足的标为待核实；现有的梗可一键复核。" },
      { kind: "improvement", title: "梗库管理", detail: "按圈层和时间窗口刷新，刷新时排除已收录；支持「不再收录」、新梗标记，以及按流行时间、可信度筛选和搜索。" },
      { kind: "improvement", title: "硬凹网感检测", detail: "新增一条去 AI 味规则，标出过气梗、超量用梗和解释梗的句子；分段改写新增「加点梗」「去掉梗」。" },
      { kind: "fix", title: "生成更稳", detail: "修复大纲出现 0 分钟章节导致整体失败，以及模型返回个别字段越界导致整批梗作废的问题。" },
      { kind: "infra", title: "联网搜索与迁移", detail: "通义千问开启联网搜索能力；开发模式热更新后自动补跑新增的数据库迁移。" },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-28",
    title: "视觉导演：分镜、画面风格与角色定妆",
    summary: "分镜先理解旁白再决定画面；新增画面风格卡与角色定妆，让画面贴合旁白、风格统一、人物前后一致。",
    items: [
      { kind: "feature", title: "画面风格卡", detail: "新增「画面风格」库（10 张内置卡），可在项目中选择、微调和生成样张；风格统一注入生图提示词，不改变画面内容，信息卡配色同步跟随。" },
      { kind: "feature", title: "角色识别与定妆", detail: "自动识别需要固定形象的角色并推导外貌（标注来源）；先生成立绘选定标准形象，再出三视图、表情和造型，镜头生图自动带上角色描述和参考图。" },
      { kind: "improvement", title: "分镜更懂旁白", detail: "分镜先写意图再选表达方式：具象内容生成画面，数据、要点、对比用信息卡；卡片不再复述字幕，数字必须出自原文。" },
      { kind: "improvement", title: "生图更稳更快", detail: "多张图并行生成、完成一张显示一张；失败只补缺的不重复收费；画面描述或风格改动后提示图片已过期。" },
      { kind: "fix", title: "长耗时生图不再被中断", detail: "修复生图超过 5 分钟时连接被本地断开、已付费图片不显示的问题。" },
      { kind: "infra", title: "提示词编译器", detail: "内容、人物、镜头、风格、情绪按槽位统一拼装；自定义 OpenAI 兼容生图支持参考图（/images/edits）。" },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-24",
    title: "项目起点：从文案到成片的一站式工坊",
    summary:
      "DO·Vedio 是一个 AI 视频创作工坊：输入标题、内容概要和目标时长，选择解说风格，就能生成带分段时间轴的口播文案，并一路延伸到断句、配音、角色、分镜、配乐和成片渲染。",
    items: [
      {
        kind: "feature",
        title: "文案创作",
        detail: "标题 + 概要 + 目标时长，生成带分段时间轴的口播稿；按 200 / 250 / 300 字每分钟三档语速即时长控字数，时间轴按实际字数计算。",
      },
      {
        kind: "feature",
        title: "选题角度与防编造",
        detail: "概要可留空，AI 按所选风格构思 3 个切入角度（含开场钩子与要点）；每个角度标注真实科普 / 观点评论 / 虚构故事，写稿时按性质约束，不编造具体数据、人名和出处。",
      },
      {
        kind: "feature",
        title: "两步成稿",
        detail: "先生成大纲，可增删章节、调整每章时长；再逐章流式写稿，章与章之间自动衔接。",
      },
      {
        kind: "feature",
        title: "解说风格库",
        detail: "内置 8 种风格（严肃权威、幽默风趣、犀利吐槽、悬疑叙事、知识科普、温情治愈、热血激昂、纪录片旁白）；支持手动创建，或粘贴旧文案由 AI 提炼专属风格与选题偏好。",
      },
      {
        kind: "feature",
        title: "画面风格库",
        detail: "定义画面「怎么画」：画风、色彩、光影、氛围与质感；生图时统一注入，换风格不改变画面内容。",
      },
      {
        kind: "feature",
        title: "全流程视频制作",
        detail: "断句标注 → 配音 → 角色识别 → 分镜 → 配乐 → 渲染，逐步推进；支持逐行试听、角色设定与分镜表、曲库与转场音效。",
      },
      {
        kind: "feature",
        title: "成片渲染与预览",
        detail: "基于 Remotion 渲染，支持 16:9 等画幅与草稿 / 成片两档质量；提供在线预览、字幕与成片下载，并保留版本历史。",
      },
      {
        kind: "feature",
        title: "多模型中心",
        detail: "接入 DeepSeek、通义千问、Kimi、豆包、OpenAI、Claude；也可添加 OpenAI Compatible / Anthropic Messages 第三方服务商，自动拉取模型并选择启用。",
      },
      {
        kind: "feature",
        title: "发布素材",
        detail: "一键生成 3 个备选标题、带章节时间戳的简介和 10 个标签，直接用于发布。",
      },
      {
        kind: "improvement",
        title: "写作体验",
        detail: "分段改写（扩写 / 缩写 / 更口语化 / 换风格 / 校准字数）并支持撤销；总时长偏差超过 ±15% 时提示并一键校准；稿件自动保存，支持复制全文与导出 Markdown。",
      },
      {
        kind: "infra",
        title: "本地优先的架构",
        detail: "Next.js 16 + React 19 + Remotion，后台任务由独立 Worker 执行，项目与素材存储在本地 SQLite；自定义服务商的 API Key 使用 PROVIDER_ENCRYPTION_KEY 加密保存。",
      },
    ],
  },
];
