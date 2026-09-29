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
