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
