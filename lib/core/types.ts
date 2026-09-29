import { z } from "zod";
import { briefSchema, metadataSchema, sectionSchema, segmentSchema } from "../types";

/**
 * 项目文档：用户可编辑的全部内容。机器产物（配音、缓存）不在这里，
 * 时间轴由 buildTimeline(文档, 产物) 派生，见 lib/core/timeline.ts。
 */

export const aspects = ["16:9", "9:16"] as const;
export type Aspect = (typeof aspects)[number];
export const aspectSize: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
};

export const moods = ["悬疑", "紧张", "轻松", "温暖", "激昂", "史诗", "科技", "忧伤", "中性"] as const;
export type Mood = (typeof moods)[number];
const moodSchema = z.enum(moods);

export const voiceTagChoices = [
  { value: "auto", label: "自动（按句子情绪）" },
  { value: "none", label: "不加标签" },
  { value: "serious", label: "严肃" },
  { value: "sad", label: "悲伤" },
  { value: "excited", label: "兴奋" },
  { value: "amazed", label: "惊叹" },
  { value: "curious", label: "好奇" },
  { value: "empathetic", label: "共情" },
  { value: "sarcastic", label: "讽刺" },
  { value: "whispers", label: "耳语" },
  { value: "very slowly", label: "非常缓慢" },
  { value: "very fast", label: "非常快速" },
  { value: "ssml:measured", label: "SSML · 舒展停顿" },
  { value: "ssml:compact", label: "SSML · 紧凑停顿" },
] as const;
export type VoiceTag = (typeof voiceTagChoices)[number]["value"];
const voiceTagSchema = z.enum(voiceTagChoices.map((choice) => choice.value) as [VoiceTag, ...VoiceTag[]]);

/** 一段朗读片段：say 为替换读法（如 “2025” → “二零二五”），缺省按原文朗读 */
export const spanSchema = z.object({ text: z.string(), say: z.string().optional() });
export type Span = z.infer<typeof spanSchema>;

export const lineSchema = z.object({
  id: z.string(),
  segmentIndex: z.number().int().min(0),
  /** 原文：字幕显示用，永远不改 */
  text: z.string(),
  /** 读音标注；拼起来必须等于 text */
  spans: z.array(spanSchema).default([]),
  /** 句后停顿（毫秒）；缺省按段内 / 段间默认值 */
  pauseAfterMs: z.number().min(0).max(5000).optional(),
  keywords: z.array(z.string()).default([]),
  mood: moodSchema.optional(),
  /** 逐句表达；SSML 模式只控制句内停顿，不叠加 Instruct 或情绪标签。 */
  voiceTag: voiceTagSchema.optional(),
  locked: z.boolean().default(false),
});
export type Line = z.infer<typeof lineSchema>;

export const shotKinds = ["title", "quote", "placeholder", "upload", "image", "video", "stock", "chart"] as const;
export type ShotKind = (typeof shotKinds)[number];
export const shotKindLabels: Record<ShotKind, string> = {
  title: "章节标题",
  quote: "金句卡",
  placeholder: "占位画面",
  upload: "上传图片",
  image: "AI 生图",
  video: "AI 视频",
  stock: "素材库",
  chart: "图表",
};
/** P1 可用的镜头类型 */
export const p1ShotKinds = ["title", "quote", "placeholder", "upload"] as const satisfies readonly ShotKind[];

export const motions = ["zoom-in", "zoom-out", "pan-left", "pan-right", "none"] as const;
export type Motion = (typeof motions)[number];

/** 景别：由远到近 */
export const shotSizes = ["extreme-wide", "wide", "medium", "close", "extreme-close"] as const;
export type ShotSize = (typeof shotSizes)[number];
export const shotSizeLabels: Record<ShotSize, string> = { "extreme-wide": "大远景", wide: "全景", medium: "中景", close: "近景", "extreme-close": "特写" };

/** 表达方式：generate = 生成画面；motion = Remotion 代码画面；composite = 画面 + 动画层；real = 需要真实素材 */
export const shotModes = ["generate", "motion", "composite", "real"] as const;
export type ShotMode = (typeof shotModes)[number];

/** 信息卡版式（Remotion 画面）：数据由大模型从旁白中抽取，渲染层不再猜 */
export const cardVariants = ["headline", "stat", "list", "split", "quote"] as const;
export type CardVariant = (typeof cardVariants)[number];
export const cardSchema = z.object({
  variant: z.enum(cardVariants),
  /** 主标题：术语、关键词或一句短结论 */
  headline: z.string().optional(),
  stat: z.object({ value: z.string(), unit: z.string().optional(), label: z.string().default("") }).optional(),
  items: z.array(z.string()).optional(),
  sides: z.tuple([z.string(), z.string()]).optional(),
});
export type Card = z.infer<typeof cardSchema>;

export const shotSchema = z.object({
  id: z.string(),
  /** 锚点：从某句第 char 个字开始；时间由字级时间戳换算 */
  at: z.object({ lineId: z.string(), char: z.number().int().min(0).default(0) }),
  kind: z.enum(shotKinds),
  /** 导演意图：观众此刻应该看到或感受到什么 */
  intent: z.string().optional(),
  mode: z.enum(shotModes).optional(),
  shotSize: z.enum(shotSizes).optional(),
  card: cardSchema.optional(),
  description: z.string().default(""),
  prompt: z.string().optional(),
  onScreenText: z.string().optional(),
  motion: z.enum(motions).default("zoom-in"),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  assetId: z.string().optional(),
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  /** 一致性输入：参考素材、角色卡、场景卡和首尾帧。 */
  referenceAssetIds: z.array(z.string()).default([]),
  characterIds: z.array(z.string()).default([]),
  sceneId: z.string().optional(),
  seed: z.number().int().nonnegative().optional(),
  firstFrameAssetId: z.string().optional(),
  lastFrameAssetId: z.string().optional(),
  controlAssetId: z.string().optional(),
  /** 同一批候选共享 candidateGroupId；assetId 是当前选中的候选。 */
  candidateGroupId: z.string().optional(),
  candidates: z.array(z.object({ id: z.string(), assetId: z.string(), selected: z.boolean().default(false) })).default([]),
  /** 生成当前素材时的提示词指纹；与现在编译出的不同，说明描述或风格改过、素材已过期 */
  assetPromptHash: z.string().optional(),
  /** 覆盖范围内句子文本的哈希；与当前不一致说明镜头过期 */
  sourceHash: z.string().default(""),
  locked: z.boolean().default(false),
});
export type Shot = z.infer<typeof shotSchema>;

/**
 * 视觉风格卡：决定「怎么画」（画风、色彩、光影、氛围、质感、镜头语言），不决定「画什么」。
 * 分镜只写内容，风格由提示词编译器（lib/core/prompt-compiler.ts）统一注入。
 * 与文案的「解说风格模板」（lib/templates）是两回事。
 */
export const styleMediums = ["photo", "cinematic", "illustration", "anime", "3d", "ink", "watercolor", "flat-vector", "paper-cut", "pixel", "oil", "comic"] as const;
export type StyleMedium = (typeof styleMediums)[number];
export const styleMediumLabels: Record<StyleMedium, string> = {
  photo: "写实摄影",
  cinematic: "电影画面",
  illustration: "插画",
  anime: "日系动漫",
  "3d": "3D 渲染",
  ink: "水墨",
  watercolor: "水彩",
  "flat-vector": "扁平矢量",
  "paper-cut": "剪纸拼贴",
  pixel: "像素",
  oil: "油画",
  comic: "漫画",
};
export const styleLevels = ["low", "mid", "high"] as const;
export const styleStrengths = ["light", "normal", "strong"] as const;
export type StyleStrength = (typeof styleStrengths)[number];
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色需为 #RRGGBB");
const moodTweakSchema = z.object({ lighting: z.string().optional(), colorGrade: z.string().optional(), atmosphere: z.string().optional() });

export const visualStyleInputSchema = z.object({
  name: z.string().trim().min(1, "请填写风格名称"),
  description: z.string().default(""),
  /** 画风：用什么媒介画 */
  medium: z.enum(styleMediums),
  rendering: z.string().default(""),
  texture: z.string().default(""),
  /** 色彩：schemes 每组为 [深, 中, 浅]，同时驱动 Remotion 画面；accent 为强调色 */
  palette: z.object({ schemes: z.array(z.tuple([hex, hex, hex])).min(1), accent: hex }),
  colorGrade: z.string().default(""),
  saturation: z.enum(styleLevels).default("mid"),
  contrast: z.enum(styleLevels).default("mid"),
  /** 光影与氛围：风格的基调 */
  lighting: z.string().default(""),
  atmosphere: z.string().default(""),
  /** 情绪调制：某种情绪下在风格范围内微调光影和氛围（不写的情绪用通用提示） */
  moodTweaks: z.partialRecord(z.enum(moods), moodTweakSchema).default({}),
  /** 这个风格承载不了的情绪：遇到时保持风格基调，并提示冲突 */
  deniedMoods: z.array(z.enum(moods)).default([]),
  /** 镜头语言 */
  lens: z.string().default(""),
  depthOfField: z.enum(["shallow", "deep"]).default("shallow"),
  composition: z.string().default(""),
  negative: z.array(z.string()).default([]),
  /** 风格强度：写实科普类内容建议 light，避免风格把信息画歪 */
  strength: z.enum(styleStrengths).default("normal"),
  /** 适合的解说风格模板 id，用于新项目推荐 */
  suits: z.array(z.string()).default([]),
});
export type VisualStyleInput = z.infer<typeof visualStyleInputSchema>;
export const visualStyleSchema = visualStyleInputSchema.extend({ id: z.string(), builtin: z.boolean().optional() });
export type VisualStyle = z.infer<typeof visualStyleSchema>;

/**
 * 角色卡：身份只写在这里（长什么样），分镜里只写角色在做什么。
 * 每个字段记录来源：explicit = 原文明确写了（不可违背）；inferred = 从上下文推断；default = 按题材补全；user = 用户改过（重新选角不覆盖）。
 */
export const characterKinds = ["person", "animal", "creature", "object", "group"] as const;
export const characterRoles = ["protagonist", "supporting", "archetype", "narrator", "real", "extra"] as const;
export const characterRoleLabels: Record<(typeof characterRoles)[number], string> = { protagonist: "主角", supporting: "配角", archetype: "典型人物", narrator: "UP 主形象", real: "真实人物", extra: "路人" };
/** 真实人物的呈现方式：不生成可辨认的正脸 */
export const presentations = ["full", "back", "silhouette", "hands", "symbol"] as const;
export type Presentation = (typeof presentations)[number];
export const presentationLabels: Record<Presentation, string> = { full: "正常出镜", back: "背影", silhouette: "剪影", hands: "手部特写", symbol: "象征物" };
export const fieldSources = ["explicit", "inferred", "default", "user"] as const;
export type FieldSource = (typeof fieldSources)[number];
/** 可追踪来源的外貌字段 */
export const characterFields = ["ageRange", "gender", "region", "era", "occupation", "hair", "eyes", "faceShape", "facialHair", "marks", "build", "height", "signature", "personality"] as const;
export type CharacterField = (typeof characterFields)[number];

export const lookSchema = z.object({
  id: z.string(),
  name: z.string().default("默认"),
  wardrobe: z.string().default(""),
  props: z.string().default(""),
  /** 从哪一句开始换成这身造型；缺省表示从头开始 */
  fromLineId: z.string().optional(),
});
export type Look = z.infer<typeof lookSchema>;

export const characterSheetSchema = z.object({
  /** 立绘候选（可以多批） */
  candidates: z.array(z.string()).default([]),
  /** 选定的立绘：之后所有镜头以它为准 */
  portraitAssetId: z.string().optional(),
  turnaroundAssetIds: z.array(z.string()).default([]),
  expressionAssetIds: z.array(z.string()).default([]),
  lookAssetIds: z.record(z.string(), z.string()).default({}),
  /** 生成立绘时的风格与外貌指纹；与当前不同说明定妆过期 */
  sourceHash: z.string().optional(),
});
export type CharacterSheet = z.infer<typeof characterSheetSchema>;

export const characterCardSchema = z.object({
  id: z.string(),
  /** 选角对账键：规范化的名字或称谓 */
  key: z.string().default(""),
  name: z.string().default(""),
  kind: z.enum(characterKinds).default("person"),
  role: z.enum(characterRoles).default("supporting"),
  real: z.boolean().default(false),
  presentation: z.enum(presentations).default("full"),
  ageRange: z.string().default(""),
  gender: z.string().default(""),
  region: z.string().default(""),
  era: z.string().default(""),
  occupation: z.string().default(""),
  hair: z.string().default(""),
  eyes: z.string().default(""),
  faceShape: z.string().default(""),
  facialHair: z.string().default(""),
  marks: z.string().default(""),
  build: z.string().default(""),
  height: z.string().default(""),
  /** 2–3 个识别锚点：红围巾、圆框眼镜……一致性的关键 */
  signature: z.array(z.string()).default([]),
  /** 只用于指导姿态和表情基调，不写进生图提示词 */
  personality: z.string().default(""),
  /** 其他外貌补充（旧版角色卡的外貌描述也在这里） */
  appearance: z.string().default(""),
  /** 旧版角色卡的服装；有造型时以造型为准 */
  wardrobe: z.string().default(""),
  looks: z.array(lookSchema).default([]),
  fieldSources: z.partialRecord(z.enum(characterFields), z.enum(fieldSources)).default({}),
  /** 用户改掉了原文写明的字段：画面可能与文案矛盾，界面上持续提示 */
  overriddenExplicit: z.array(z.enum(characterFields)).default([]),
  /** 出场证据：选角分析找到的句子 */
  evidence: z.array(z.object({ lineId: z.string(), text: z.string() })).default([]),
  /** 最近一次选角分析里没有再出现 */
  absent: z.boolean().default(false),
  sheet: characterSheetSchema.default(characterSheetSchema.parse({})),
  /** 用户上传的参考图（优先级最高） */
  referenceAssetIds: z.array(z.string()).default([]),
  locked: z.boolean().default(false),
});
export type CharacterCard = z.infer<typeof characterCardSchema>;

export const narrativeModes = ["story", "real-people", "archetype", "narrator", "none"] as const;
export type NarrativeMode = (typeof narrativeModes)[number];
export const narrativeModeLabels: Record<NarrativeMode, string> = { story: "虚构故事", "real-people": "真实人物", archetype: "典型人物", narrator: "第一人称 UP 主", none: "无角色" };

/** 选角分析结果（机器产出，写回文档供界面展示和对账） */
export const castAnalysisSchema = z.object({
  /** 分析时的文案指纹；与当前不同说明需要重新分析 */
  sourceHash: z.string(),
  modes: z.array(z.object({ segmentIndex: z.number().int().min(0), mode: z.enum(narrativeModes) })).default([]),
  /** 识别到但没有建卡的人物及原因 */
  skipped: z.array(z.object({ name: z.string(), reason: z.string() })).default([]),
  issues: z.array(z.string()).default([]),
});
export type CastAnalysis = z.infer<typeof castAnalysisSchema>;

export const sceneCardSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  description: z.string().default(""),
  style: z.string().default(""),
  referenceAssetIds: z.array(z.string()).default([]),
  locked: z.boolean().default(false),
});
export type SceneCard = z.infer<typeof sceneCardSchema>;

export const musicCueSchema = z.object({
  trackId: z.string(),
  fromLineId: z.string(),
  toLineId: z.string(),
  mood: moodSchema.optional(),
  /** 从曲目的第几毫秒开始播放 */
  offsetMs: z.number().min(0).default(0),
  locked: z.boolean().default(false),
});
export type MusicCue = z.infer<typeof musicCueSchema>;

export const voiceSettingsSchema = z.object({
  provider: z.enum(["dashscope", "google-gemini"]).default("dashscope"),
  model: z.string().default("cosyvoice-v3-flash"),
  voiceId: z.string().default("longanyang"),
  /** 语速倍率 0.5–2 */
  rate: z.number().min(0.5).max(2).default(1),
  pitch: z.number().min(0.5).max(2).default(1),
  volume: z.number().int().min(0).max(100).default(50),
  /** 可选的自然语言表达控制；Qwen-Audio 模型会原样透传。 */
  instruction: z.string().trim().max(500).default(""),
  /** Google Gemini 的服务商参数；正文与表达指令保持分离。 */
  google: z.object({
    stylePrompt: z.string().trim().max(1000).default(""),
    locale: z.string().trim().max(32).optional(),
    outputEncoding: z.enum(["LINEAR16", "WAV"]).default("LINEAR16"),
    sampleRateHertz: z.number().int().positive().optional(),
    alignment: z.enum(["provider", "estimated"]).default("estimated"),
  }).optional(),
});
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const duckingSchema = z.object({
  /** 有人声时音乐的增益（dB） */
  underVoiceDb: z.number().default(-12),
  /** 人声长停顿时的增益（dB） */
  gapDb: z.number().default(-6),
  attackMs: z.number().default(200),
  releaseMs: z.number().default(500),
  /** 停顿超过多久才抬高音乐 */
  minGapMs: z.number().default(1200),
});
export type Ducking = z.infer<typeof duckingSchema>;

export const settingsSchema = z.object({
  aspects: z.array(z.enum(aspects)).min(1).default(["16:9", "9:16"]),
  voice: voiceSettingsSchema.default(voiceSettingsSchema.parse({})),
  subtitle: z
    .object({ enabled: z.boolean().default(true), burnIn: z.boolean().default(true), highlight: z.boolean().default(true) })
    .default({ enabled: true, burnIn: true, highlight: true }),
  music: z
    .object({ enabled: z.boolean().default(true), gainDb: z.number().min(-40).max(6).default(0), ducking: duckingSchema.default(duckingSchema.parse({})) })
    .default({ enabled: true, gainDb: 0, ducking: duckingSchema.parse({}) }),
  sfx: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  aiLabel: z
    .object({ enabled: z.boolean().default(true), position: z.enum(["auto", "top-left", "top-right"]).default("auto") })
    .default({ enabled: true, position: "auto" }),
  budgetYuan: z.number().min(0).nullable().default(null),
  pauseAfterPreview: z.boolean().default(false),
  modelId: z.string().default(""),
});
export type Settings = z.infer<typeof settingsSchema>;

/** 草稿阶段的 brief：标题允许为空 */
export const draftBriefSchema = briefSchema.extend({ title: z.string() });

export const projectDocSchema = z.object({
  brief: draftBriefSchema,
  modelId: z.string().default(""),
  sections: z.array(sectionSchema).default([]),
  segments: z.array(segmentSchema).default([]),
  metadata: metadataSchema.nullable().default(null),
  lines: z.array(lineSchema).default([]),
  shots: z.array(shotSchema).default([]),
  /** 项目的画面风格：风格库中某张卡的快照，可在项目里微调；为空时生图前自动采用推荐风格 */
  visualStyle: visualStyleSchema.nullable().default(null),
  characters: z.array(characterCardSchema).default([]),
  castAnalysis: castAnalysisSchema.nullable().default(null),
  scenes: z.array(sceneCardSchema).default([]),
  music: z.array(musicCueSchema).default([]),
  settings: settingsSchema.default(settingsSchema.parse({})),
});
export type ProjectDoc = z.infer<typeof projectDocSchema>;
export type ProjectDocInput = z.input<typeof projectDocSchema>;

export type Project = {
  id: string;
  title: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  doc: ProjectDoc;
};
export type ProjectPipelineStatus = "empty" | "script" | "annotating" | "voicing" | "storyboard" | "music" | "rendering" | "ready" | "failed";
export type ProjectSummary = Omit<Project, "doc"> & {
  minutes: number;
  segments: number;
  pipelineStatus: ProjectPipelineStatus;
  coverHash: string | null;
  lastRenderDurationMs: number | null;
  lastRenderCreatedAt: number | null;
};

export const emptyDoc = (): ProjectDoc =>
  projectDocSchema.parse({
    brief: {
      title: "",
      summary: "",
      minutes: 5,
      templateId: "humor",
      audience: "",
      perspective: "first",
      mustInclude: "",
      avoid: "",
      rate: "auto",
    },
  });

export type AssetKind = "audio" | "image" | "video" | "subtitle" | "other";
export type Asset = {
  hash: string;
  kind: AssetKind;
  mime: string;
  ext: string;
  bytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  meta: Record<string, unknown>;
  createdAt: number;
};

export const jobStatuses = ["queued", "running", "succeeded", "failed", "canceled"] as const;
export type JobStatus = (typeof jobStatuses)[number];
export type Job = {
  id: string;
  projectId: string | null;
  stage: string;
  key: string;
  /** 人类可读的目标，如「第 3 句」「16:9」 */
  target: string;
  status: JobStatus;
  progress: number;
  message: string;
  attempts: number;
  maxAttempts: number;
  priority: number;
  runAfter: number;
  costEstimate: number;
  costActual: number;
  error: string | null;
  input: unknown;
  result: unknown;
  createdAt: number;
  updatedAt: number;
};

/** 媒体访问地址 */
export const mediaUrl = (hash: string) => `/api/media/${hash}`;
