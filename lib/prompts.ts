import { charsFor, countChars } from "./duration";
import { rewriteActions, speechRateLabels, type Brief, type RewriteAction, type Section, type SpeechRate, type StyleTemplate } from "./types";
import type { Prompt } from "./llm";
import { detectAiTone, groupHits } from "./humanize/detect";
import { notAiTone, rules } from "./humanize/rules";
import { assignMemes, countMemeUses, MAX_USES_PER_MEME, memeBudget, memeCircles, memeHeats, memeKinds, memesForSection, resolveSlang, slangLevels, type Meme, type MemeRef } from "./memes";
import type { ToneContext } from "./humanize/detect";

const list = (items: string[]) => items.filter(Boolean).map((x) => `- ${x}`).join("\n");

function styleBlock(t: StyleTemplate) {
  return [
    `【解说风格：${t.name}】${t.description}`,
    t.tone && `语气：${t.tone}`,
    t.structureHints && `结构偏好：${t.structureHints}`,
    t.ideation && `选题偏好：${t.ideation}`,
    t.dos.length > 0 && `推荐写法：\n${list(t.dos)}`,
    t.donts.length > 0 && `禁止写法：\n${list(t.donts)}`,
    t.sample && `风格示范（只模仿语气和节奏，不要照搬内容）：\n"""\n${t.sample}\n"""`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 写作时就避开的 AI 痕迹（预防）。依据 lieflat-less-ai-tone 的对照语料：
 * 这些写法 AI 用得是人类的 2-9 倍；同时列出实测不是 AI 痕迹的写法，防止矫枉过正。
 */
function humanToneBlock() {
  return [
    "【像人写的：避开 AI 高频写法】以下写法在 AI 文本里的出现频率是人类的数倍，观众一听就觉得是机器写的：",
    list(rules.map((r) => r.avoid)),
    `以下是人类写作的正常特征，不要为了“不像 AI”刻意回避：${notAiTone.join("；")}。`,
    "风格模板的推荐写法和风格示范与上面的约束冲突时，以风格模板为准。",
  ].join("\n");
}

function baseInstructions(t: StyleTemplate, brief: Brief) {
  return [
    "你是一名资深的 B站/西瓜视频解说文案作者，擅长写中长视频口播稿。文案用于真人或 AI 配音朗读，必须口语化、适合朗读、节奏自然。",
    styleBlock(t),
    "通用要求：\n" +
      list([
        brief.perspective === "first" ? "使用第一人称 UP 主口吻（“我”“咱们”），和观众直接对话" : "使用第三人称旁白视角，客观叙述",
        brief.audience && `目标受众：${brief.audience}，用词深浅以他们能听懂为准`,
        "只写要念出来的话：不要写画面描述、镜头说明、括号备注、表情符号或 Markdown 格式",
        "多用短句，一句话不要超过 40 个字，方便配音换气",
        "只使用内容概要中给出的信息或广为人知的常识；不要编造具体的统计数字、人名、机构和引用出处，拿不准时用概括性的说法",
        "如果内容概要标注了内容性质，严格遵守对应要求",
        "内容概要里给了具体数字、时间、对象时直接说出来，不要换成“大幅”“显著”这类概括说法",
        brief.avoid && `绝对不要出现以下内容或词语：${brief.avoid}`,
      ]),
    humanToneBlock(),
  ].join("\n\n");
}

function briefBlock(brief: Brief) {
  return [
    `视频标题：${brief.title}`,
    brief.summary && `内容概要：\n${brief.summary}`,
    brief.mustInclude && `必须覆盖的要点：\n${brief.mustInclude}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function anglesPrompt(brief: Brief, t: StyleTemplate, exclude: string[]): Prompt {
  const scope =
    brief.minutes <= 4
      ? "时长很短，每个角度只聚焦一个点并讲透，不要铺得太开"
      : brief.minutes <= 10
        ? "时长适中，每个角度可以有 2-3 层递进"
        : "时长较长，每个角度可以多层展开、有起承转合";
  return {
    instructions: baseInstructions(t, brief),
    prompt: `视频标题：${brief.title}
${brief.summary ? `\n用户给出的创作方向（在这个范围内构思）：\n${brief.summary}\n` : ""}
这期视频时长 ${brief.minutes} 分钟。请按照上面「${t.name}」风格的选题偏好，构思 3 个截然不同的选题角度。
- ${scope}
- 3 个角度之间要有明显差异，不要只是换个说法
- angle：一句话说清切入角度
- hook：开场第一句台词，要符合该风格的语气，能在前几秒抓住观众
- points：3-5 个核心要点，每条一句话
- kind：内容性质，按角度实际要讲的内容判断，不要看风格。fact = 讲真实存在的知识、现象和事实；opinion = 以观点和评论为主；story = 虚构的人物、情节或情景演绎（凡是编出来的故事、离奇或超自然情节，一律标 story）
- note：只有当题材本身和「${t.name}」风格明显冲突时才填写（例如灾难、悼念、重大伤亡事件配幽默或吐槽风格），写出提醒和克制的处理建议；普通题材一律填空字符串，不要写泛泛的注意事项
${exclude.length > 0 ? `- 不要和以下已经提出过的角度重复或相近：\n${list(exclude)}` : ""}`,
  };
}

/** 大纲阶段最多分配几个梗：按全片字数和档位，至少 1 个 */
export function outlineMemeLimit(brief: Brief, t: StyleTemplate, rate: SpeechRate) {
  const level = resolveSlang(brief.slang, t);
  return level === "off" ? 0 : Math.max(1, memeBudget(charsFor(brief.minutes, rate), level));
}

/** 大纲返回后清洗用梗分配（只留选中的梗、不重复、不超量） */
export function normalizeOutlineMemes<T extends { memes?: string[] }>(sections: T[], brief: Brief, t: StyleTemplate, rate: SpeechRate) {
  const limit = outlineMemeLimit(brief, t, rate);
  return assignMemes(sections, limit > 0 ? brief.memes : null, limit);
}

export function outlinePrompt(brief: Brief, t: StyleTemplate, rate: SpeechRate): Prompt {
  const total = charsFor(brief.minutes, rate);
  const memeLimit = outlineMemeLimit(brief, t, rate);
  const memes = memeLimit > 0 ? (brief.memes ?? []) : [];
  const count = brief.minutes <= 3 ? "3-4" : brief.minutes <= 8 ? "4-6" : brief.minutes <= 15 ? "5-7" : "6-9";
  return {
    instructions: baseInstructions(t, brief),
    prompt: `${briefBlock(brief)}

请为这期视频设计章节大纲。
- 总时长 ${brief.minutes} 分钟，语速${speechRateLabels[rate]}（约 ${total} 字），分成 ${count} 个章节
- 第一章必须是“开场钩子”，只占 10-20 秒，用悬念、反常识结论或痛点在前几秒抓住观众；反常识结论要正面说出来，不要写成“你以为……其实……”“不是……而是……”
- 最后一章是总结收尾，自然地引导观众点赞、投币、收藏，并抛出一个评论区话题
- 中间章节按所选风格的结构偏好安排，章节标题简短有力，直接说这一章讲什么，不要加“一、二、三”“第一章”之类的编号
- points 写清本章要讲的 2-4 个要点，用分号隔开
- minutes 为本章分钟数（可以是小数），所有章节加起来等于 ${brief.minutes}${
      memes.length
        ? `
- memes：把下面这些用户选好的梗分配到最搭的章节，每章 0-2 个，填梗名原文。同一个梗只分给一章；全片最多分配 ${memeLimit} 个，搭不上的梗就不分；讲事实、数据或情绪沉重的章节不分；尽量分散，不要全挤在开场
${memes.map((m) => `  · ${m.term}：${m.meaning}${m.where ? `（适合：${m.where}）` : ""}`).join("\n")}`
        : ""
    }`,
  };
}

const formsLabel = (m: MemeRef) => (m.variants.length ? `（也写作 ${m.variants.join("、")}）` : "");

/** 梗列表。实测模型会照抄例句的笑点（“当前剩余 3%”），有用法说明时就不给例句 */
function memeList(memes: MemeRef[], usage: Record<string, number>) {
  return memes
    .map((m) => `- ${m.term}${formsLabel(m)}：${m.meaning}。${m.usage ? `用法：${m.usage}` : `例：${m.example}`}${m.where ? `。这期适合：${m.where}` : ""}${usage[m.term] ? "（前文已经用过，尽量换别的）" : ""}`)
    .join("\n");
}

function memeRules(budgetLine: string) {
  return list([
    budgetLine,
    "结合这里自己的内容说，不要照搬网上现成的段子和例句",
    "只能用上面列出的梗。列表外的网络流行语和梗一律不用（模型记忆里的梗大多已经过时），也不要自造梗",
    "用对含义和语气，放在观点、吐槽、转折、共鸣、互动这类位置；陈述事实、数据、引用和严肃内容时不用",
    "直接用，不要解释梗（不写“这里的……指的是……”“也就是网上说的……”），也不要加引号强调",
    "找不到自然的位置就不用，宁缺毋滥",
  ]);
}

/** 还能用的梗：全片用够次数的去掉 */
const availableMemes = (memes: MemeRef[], usage: Record<string, number>) => memes.filter((m) => (usage[m.term] ?? 0) < MAX_USES_PER_MEME);

/**
 * 写稿时可用的流行梗。只给用户挑过、大纲分给本章的梗，并限定用量和位置：
 * 硬塞、过密、用完再解释一遍，本身就是 AI 硬凹网感。
 */
function memeBlock(brief: Brief, t: StyleTemplate, chars: number, usage: Record<string, number>, assigned?: string[]) {
  const level = resolveSlang(brief.slang, t);
  const picked = brief.memes ?? [];
  if (level === "off" || picked.length === 0) return "";
  const noMemes = "这一章不要用梗，也不要用别的网络流行语。";
  const mine = memesForSection(picked, assigned);
  if (mine.length === 0) return `【流行梗】大纲没有给本章分配梗，${noMemes}`;
  const available = availableMemes(mine, usage);
  if (available.length === 0) return `【流行梗】分给本章的梗都已经用够次数了，${noMemes}`;
  const budget = Math.min(memeBudget(chars, level), available.length);
  return [
    `【本章可用的流行梗】（网感：${slangLevels[level].label}）下面是用户挑过、近期正在流行的表达，用对了能让文案更接地气：`,
    memeList(available, usage),
    "用梗规则：",
    memeRules(
      budget >= 1 ? `本章加起来最多用 ${budget} 处梗（这是上限，不是指标），同一个梗本章只用一次` : "本章篇幅短，可以不用；只有特别贴切的位置才用，最多 1 处",
    ),
  ].join("\n");
}

export function sectionPrompt(
  brief: Brief,
  t: StyleTemplate,
  rate: SpeechRate,
  sections: Section[],
  index: number,
  previousTail: string,
  /** 前面各章已用过的梗及次数 */
  memeUsage: Record<string, number> = {},
): Prompt {
  const s = sections[index];
  const target = charsFor(s.minutes, rate);
  const outline = sections.map((x, i) => `${i + 1}. ${x.title}（${x.points}）${i === index ? " ← 当前章节" : ""}`).join("\n");
  return {
    instructions: [baseInstructions(t, brief), memeBlock(brief, t, target, memeUsage, s.memes)].filter(Boolean).join("\n\n"),
    prompt: `${briefBlock(brief)}

全片大纲：
${outline}

${previousTail ? `上一章结尾（请自然衔接，不要重复）：\n"""\n${previousTail}\n"""\n\n` : ""}现在只写第 ${index + 1} 章「${s.title}」的口播文案。
- 要点：${s.points}
- 字数约 ${target} 字（上下浮动不超过 10%），这是硬性要求
- ${index === 0 ? "这是开场，第一句话就要抓人，不要做自我介绍式的铺垫" : index === sections.length - 1 ? "这是结尾，收束全片观点，并自然引导点赞投币和评论互动" : "不要写开场白和总结语，直接进入本章内容"}
- 直接输出正文，不要输出章节标题或任何说明`,
  };
}

export type RewriteInput = {
  action: RewriteAction;
  text: string;
  before: string;
  after: string;
  targetChars?: number;
  instruction?: string;
  restyle?: StyleTemplate;
  /** 全片已用过的梗及次数（加点梗时避开用够次数的） */
  memeUsage?: Record<string, number>;
  /** 梗库里已过气的梗（去 AI 味检测用） */
  staleMemes?: string[];
};

export function rewritePrompt(brief: Brief, t: StyleTemplate, input: RewriteInput): Prompt {
  if (input.action === "humanize") return humanizePrompt(brief, t, input);
  const len = input.text.length;
  const level = resolveSlang(brief.slang, t);
  const addable = availableMemes(brief.memes ?? [], input.memeUsage ?? {});
  const addCount = Math.max(1, Math.min(memeBudget(countChars(input.text), level === "off" ? "light" : level), addable.length, 3));
  const task: Record<Exclude<RewriteAction, "humanize">, string> = {
    expand: `扩写这一段，补充细节、例子或论据，扩展到约 ${Math.round(len * 1.5)} 字`,
    shrink: `精简这一段，保留核心信息，压缩到约 ${Math.round(len * 0.6)} 字`,
    colloquial: "让这一段更口语化、更适合朗读：拆分长句，换掉书面词，增加自然的语气",
    restyle: input.restyle ? `把这一段改写成下面这种风格，内容和信息量保持不变：\n\n${styleBlock(input.restyle)}` : "换一种表达方式重写这一段",
    custom: `按以下要求修改这一段：${input.instruction ?? ""}`,
    fit: `调整这一段的长度到约 ${input.targetChars} 字（上下浮动不超过 5%），风格和核心信息不变`,
    addMemes: addable.length
      ? `在这一段里自然地用上下面的梗，最多 ${addCount} 处。只在合适的位置加梗或替换个别说法，其他内容、信息和字数基本不变：\n${memeList(addable, input.memeUsage ?? {})}\n\n用梗规则：\n${memeRules(`最多 ${addCount} 处，同一个梗只用一次`)}`
      : "这一段保持原样输出（本期没有可用的梗）",
    dropMemes: "把这一段里的网络梗和网络流行语换成正常、朴素的说法，其他内容一字不动",
  };
  const used = [...countMemeUses(input.text, brief.memes ?? []).keys()];
  const memeNote = !used.length || input.action === "addMemes" || input.action === "dropMemes"
    ? ""
    : input.action === "restyle" && input.restyle?.slang === "off"
      ? `\n目标风格不用网络梗，改写时去掉这些梗，换成正常说法：${used.join("、")}。`
      : `\n原段落里的这些梗是用户特意选用的，改写时保留：${used.join("、")}。不要再加别的网络流行语。`;
  return {
    instructions: baseInstructions(input.action === "restyle" && input.restyle ? input.restyle : t, brief),
    prompt: `视频标题：${brief.title}

${input.before ? `前文（仅供衔接参考）：\n"""\n${input.before}\n"""\n\n` : ""}需要修改的段落：
"""
${input.text}
"""

${input.after ? `后文（仅供衔接参考）：\n"""\n${input.after}\n"""\n\n` : ""}任务（${rewriteActions[input.action]}）：${task[input.action]}
修改后要和前后文衔接自然。${memeNote}只输出修改后的段落正文，不要任何说明。`,
  };
}

function rulebook() {
  return rules
    .map((r) =>
      [
        `### ${r.no}. ${r.name}`,
        `触发标记：${r.trigger}`,
        `改法：${r.fix}`,
        r.keep && `不改：${r.keep}`,
        ...r.examples.map(([bad, good]) => `例 ✗ ${bad}\n例 ✓ ${good}`),
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

/**
 * 去 AI 味：移植 lieflat-less-ai-tone 的白名单式改写。
 * 只改命中规则的地方、改动最小、信息守恒；未改动的句子逐字保留，
 * 这样视频制作里这些句子的配音缓存和镜头锚点都不会失效。
 */
export function humanizePrompt(brief: Brief, t: StyleTemplate, input: Pick<RewriteInput, "text" | "before" | "after" | "staleMemes">): Prompt {
  const ctx: ToneContext = { memes: brief.memes ?? [], stale: input.staleMemes, slang: resolveSlang(brief.slang, t) };
  const hits = groupHits(detectAiTone(input.text, ctx));
  const used = [...countMemeUses(input.text, brief.memes ?? []).keys()];
  return {
    instructions: `你是口播稿的终审编辑，负责去掉文案里的 AI 写作痕迹。这份稿子会交给配音朗读，观众是听，不是看。

【硬性边界，最高优先级】
- 白名单式改写：只能处理下面“改写规则”里明确列出的问题，不能凭一般写作经验修改其他内容。没有命中任何规则的句子必须逐字保留，包括标点
- 命中规则的句子，也只改解决该问题所必需的部分。不顺便润色，不替换没有问题的词，不调整语气、详略和信息密度。拿不准是否命中时，保持原文
- 段落数量和顺序、换行位置必须原样保留，不概括、不扩写、不删观点、不重组论证
- 信息守恒：不许新增姓名、机构、数字、日期、引语、出处、因果、心理活动和任何原文没写的细节；也不许删掉原文的观点、结论、限定词和让步（“可能”“通常”“据说”）。改写后的每个实词都要能在原文里找到出处
- 不负责“把抽象写具体”：原文抽象就让它抽象，绝不编数据
- 引号里的引语、对话不改

【不作为改写理由】这些特征看着像 AI 味，实测站不住，不能据此改文字：${notAiTone.join("；")}。也不要为了“像人写的”补“就／很／了”这类虚词、换代词、调句长或拆段落。

【风格参考】下面是这期视频的解说风格。风格参考和改写规则冲突时，以风格参考为准，那是这种风格本来的写法，不是 AI 痕迹：
${styleBlock(t)}
叙述视角：${brief.perspective === "first" ? "第一人称 UP 主" : "第三人称旁白"}${used.length ? `\n本期选用的流行梗（风格的一部分，不是 AI 痕迹，必须原样保留）：${used.join("、")}` : ""}

【改写规则】（按优先级排序；同一句命中多条时先按靠前的改，改完不再叠加。“例”都摘自别的文章，只示范改法，例句里的任何内容都不能写进这份稿子）
${rulebook()}

【输出前自查】每一处改动都要能对应上面某一条规则，对应不上的改动撤销；未命中的句子逐字保留；段落数与原文相同；没有新增或删除任何事实，没有写进任何例句内容；限定词和让步没被抹掉。补回指时只加“这”“这一点”这类词，不要另写一句新话。`,
    prompt: `视频标题：${brief.title}

${input.before ? `前文（仅供理解上下文，不要输出）：\n"""\n${input.before}\n"""\n\n` : ""}需要处理的段落：
"""
${input.text}
"""

${input.after ? `后文（仅供理解上下文，不要输出）：\n"""\n${input.after}\n"""\n\n` : ""}${
      hits.length
        ? `检测器按触发标记定位到的疑似位置：\n${hits.map((g) => `- ${g.rule.no}. ${g.rule.name}：${g.hits.map((h) => `「${h.text}」`).join("、")}`).join("\n")}\n\n逐条处理：命中触发标记的就按该规则的改法改掉，只有属于该规则“不改”列出的情形才保留原样；把一个触发词换成同一规则里的另一个（如“这意味着”换成“这说明”）不算改掉。检测器认不出的同类问题也按规则处理。\n\n`
        : "检测器没有定位到明显的触发标记，请逐条规则检查；没有命中就原样输出。\n\n"
    }只输出处理后的段落全文，不要任何说明。`,
  };
}

export function metadataPrompt(brief: Brief, script: string): Prompt {
  return {
    instructions: `你是 B站/西瓜视频的运营专家，擅长写高点击率又不标题党的标题和简介。\n\n${humanToneBlock()}`,
    prompt: `视频原标题：${brief.title}

视频文案：
"""
${script}
"""

请生成：
- titles：3 个备选标题，每个 20-30 字，风格各不相同（如悬念型、数字型、观点型），可以用【】或｜分隔，但不要夸大或欺骗
- description：视频简介，80-150 字，概括看点并引导互动（不要写章节时间戳，系统会自动追加）
- tags：10 个标签，每个 2-8 字，兼顾大类和长尾关键词`,
  };
}

export function extractPrompt(samples: string): Prompt {
  return {
    instructions: "你是一名文案风格分析师，能精准提炼一位作者的写作风格，并总结成可复用的风格模板。",
    prompt: `以下是同一位作者写的视频文案样本：

${samples}

请分析这些样本的共同风格，生成一个风格模板：
- name：4-6 字的风格名称
- description：一句话描述适用场景
- tone：语气和人设
- speechRate：根据句子长短和节奏判断语速，slow / medium / fast 三选一
- slang：样本里网络流行梗、网络用语的密度。off 基本不用；light 偶尔点缀；medium 比较常用；heavy 密集
- structureHints：开场、主体、结尾的惯用结构
- ideation：这位作者习惯怎样选题和切入（偏爱什么样的角度、从哪里下手）
- dos：3-5 条标志性写法（口头禅、句式、修辞习惯）。如果作者本来就常用破折号、冒号、“不是……而是……”、句首“然而”这类容易被当成 AI 痕迹的写法，写进来，后续去 AI 味时会以此为准
- donts：2-4 条这位作者明显回避的写法
- sample：用这种风格写一段 100-150 字的全新示范文字，主题不要和样本重复。标点习惯和句式要贴着样本，样本里没有的破折号、提示性冒号、翻案句式不要加`,
  };
}

// ---------- 热梗 ----------

/** 第一步：强制联网搜索近期热梗，输出调研笔记（纯文本） */
/**
 * 第一步：联网搜“热梗盘点”一类的文章，只摘录文章里点名的梗。
 * 实测直接让模型“列出最近流行的梗”，它会生成大量看起来像梗、其实没人用的词（逐个核实时大多查不到）；
 * 改成摘录媒体、梗百科、平台热词榜里点名的梗，每条都要能指出出处。
 */
export function memeSearchPrompt(today: string, opts: { topic?: string; circle?: string; exclude?: string[]; months?: number } = {}): Prompt {
  const { topic, circle, exclude = [], months = 1 } = opts;
  const span = months <= 1 ? "最近 30 天" : months >= 6 ? "最近半年" : `最近 ${months} 个月`;
  const focus = [topic && `和「${topic}」这类话题相关`, circle && `「${circle}」圈层`].filter(Boolean).join("、");
  return {
    instructions: "你是中文互联网流行文化研究员，只做摘录，不做创作。必须联网搜索，只摘录搜到的文章里明确点名的梗，绝不自己编造或概括出新词。",
    prompt: `今天是 ${today}。请联网搜索${span}发布的网络热梗、流行语盘点类内容${focus ? `（${focus}）` : ""}，例如：媒体的“本月热梗 / 流行语盘点”、梗百科和小鸡词典的热门词条、B站 / 微博 / 抖音 / 小红书的热词榜和热搜话题、“最近很火的 XX 是什么梗”这类解释文章。
${exclude.length ? `\n下面这些已经收录过了，不要再列：${exclude.join("、")}\n` : ""}
从这些内容里摘录被点名的梗，最多 20 个，每个写清：
- 梗本身和常见写法（必须是文章里出现的原词）
- 出处：哪篇文章或哪个榜单提到了它
- 含义
- 典型用法，和一个搜到的原句
- 主要流行的平台
- 大约从什么时候开始流行（写到年月）
- 现在的热度：刚起来 / 正火 / 在退潮
- 是否涉及冒犯某个群体、低俗、饭圈、真实人物争议或政治

要求：
- 只收网民在日常聊天、评论、弹幕里拿来用的网络用语和梗；政策术语、新闻事件名、品牌、产品和人名都不算
- 每个梗都要能指出具体出处；指不出出处的不要列
- 不要把几个词拼成新词，也不要根据现象自己起名字
- 找不到这么多就少列，宁可只列 3 个真的
- 早已过气的老梗（如 yyds、绝绝子、栓Q）不要列，除非最近确实又火了`,
  };
}

/**
 * 粘贴导入：从用户贴进来的文章、评论、弹幕里抽取梗。
 * 整理规则和“搜梗”一致，但要加一条：原文没解释含义时，含义如实标注为推测，不许硬编。
 * 例句必须是原文里出现过的句子。
 */
export function memeImportPrompt(text: string, today: string): Prompt {
  return {
    instructions: `你负责从用户粘贴的中文材料里整理出网络热梗和流行表达。只整理材料里真实出现过的词，绝不补充、绝不编造，也不要根据现象自己起名字。

材料可能是一篇「热梗盘点」、别人的评论、弹幕，或者随手记的笔记。整理规则：
- term 写材料里最常见的写法，variants 写材料里出现的其他写法
- kind：word 词汇；pattern 可以套用的句式（如“X 的尽头是 Y”）；catchphrase 口头禅；pun 谐音梗
- meaning：含义。材料里解释了这个梗就照它写；材料只是用了它、没解释，就按上下文推测，并把 explained 填 false
- usage：它在句子里怎么用、搭什么语气、适合放在什么位置；材料没说就按含义推测
- example：必须是材料里原样出现过的句子，优先挑能看出用法的那句；材料里找不到合适的句子就留空，不要自己造句
- platform：材料里提到就写；没提到就按内容判断指的是哪个平台，判断不了填空
- since：材料里提到就写成“年-月”（如 2026-08）；没提到填空字符串
- heat：从这些里选一个——${Object.values(memeHeats).join(" / ")}
- risk：safe 安全；caution 可能冒犯群体、低俗、饭圈、涉及真实人物争议；banned 涉政（包括政策、规划、时政术语）、歧视、色情
- say：只有字母缩写、数字谐音这类配音会读错的写法才填中文读法，普通汉字梗填空
- circle：从这些里选一个——${memeCircles.join("、")}；都不合适填空
- publishedAt：材料里能看出的发布时间，写成“年-月”；看不出填空

只收网民在日常聊天、评论、弹幕里拿来用的网络用语和梗；普通词汇、政策术语、新闻事件名、品牌、产品和人名都不要整理进来。材料里如果没有像梗的表达，memes 给空数组。`,
    prompt: `今天是 ${today}。用户粘贴的材料：
"""
${text}
"""`,
  };
}

/** 手动添加：查一个具体的梗（有搜索能力时联网查） */
export function memeLookupPrompt(term: string, today: string, online: boolean): Prompt {
  return {
    instructions: online
      ? "你是中文互联网流行文化研究员。必须联网搜索，只根据搜索到的内容回答。"
      : "你是中文互联网流行文化研究员。只写你有把握的内容，不确定的地方写“不确定”。",
    prompt: `今天是 ${today}。请${online ? "联网查一下" : "说明"}网络用语「${term}」：
- 常见写法
- 含义
- 典型用法，和一个自然的例句
- 主要流行的平台，大约从什么时候开始流行（写到年月）
- 现在的热度：刚起来 / 正火 / 在退潮 / 已经过气
- 是否涉及冒犯某个群体、低俗、饭圈、真实人物争议或政治
如果它不是网络用语，或者查不到，直接说明。`,
  };
}

/**
 * 核实一个梗：单独联网搜这个词本身，按固定格式回答（程序解析）。
 * 用来挡住“看起来像梗、其实是模型编的”条目，同时复核它现在的热度和流行起始时间。
 */
export function memeVerifyPrompt(term: string, meaning: string, today: string): Prompt {
  return {
    instructions: "你是事实核查员。必须联网搜索，只根据搜索结果判断，不要凭印象；搜不到就如实说搜不到。",
    prompt: `今天是 ${today}。请联网搜索网络用语「${term}」（据称的含义：${meaning}），判断它是不是真的在网上被很多人使用。

严格按下面的格式回答，每项一行，不要写别的：
结论：真实 / 存疑 / 查不到
独立来源：搜到的、原文里出现了「${term}」的不同网站或帖子的数量（数字）
流行起始：年-月（如 2026-08），不知道写“不详”
当前热度：刚起来 / 正火 / 在退潮 / 已经过气
原文：一句搜到的、包含「${term}」原词的原句，搜不到写“无”

判断标准：只有多个互不相关的来源都在用这个词，才算“真实”；只有一两处、或者搜到的只是意思相近的其他说法，算“存疑”；完全搜不到这个词算“查不到”。`,
  };
}

/** 第二步：把调研笔记整理成结构化条目 */
export function memeStructurePrompt(notes: string, today: string): Prompt {
  return {
    instructions: "你负责把一份热梗调研笔记整理成结构化数据。只整理笔记里有的内容，不补充、不编造。",
    prompt: `今天是 ${today}。调研笔记：
"""
${notes}
"""

整理规则：
- term 写最常见的写法，variants 写其他写法
- kind：word 词汇；pattern 可以套用的句式（如“X 的尽头是 Y”）；catchphrase 口头禅；pun 谐音梗
- usage 写给文案作者看：它在句子里怎么用、搭什么语气、适合放在什么位置
- since 写成“年-月”，如 2026-08；只知道年份就写 2026；platform 照笔记写。笔记里没有就填空字符串
- heat：rising 刚起来；peak 正火；fading 在退潮；dead 已经过气
- risk：safe 安全；caution 可能冒犯群体、低俗、饭圈、涉及真实人物争议；banned 涉政（包括政策、规划、时政术语）、歧视、色情
- 笔记里如果混进了政策术语、新闻事件名、品牌或人名，不要整理进来
- say：只有字母缩写、数字谐音这类配音会读错的写法才填中文读法（如 yyds 填“永远的神”），普通汉字梗填空字符串
- circle：主要流行的圈层，从「${memeCircles.join("、")}」里选一个，都不合适填空字符串`,
  };
}

/** 选梗：从候选里挑和这期题材、风格搭得上的 */
export function memePickPrompt(brief: Brief, t: StyleTemplate, candidates: Meme[]): Prompt {
  const level = resolveSlang(brief.slang, t);
  return {
    instructions: "你是 B站 UP 主的文案策划，负责为这期视频从梗库里挑选合适的流行梗。挑得准比挑得多重要：用错一个梗，比不用梗更掉价。",
    prompt: `视频标题：${brief.title}
${brief.summary ? `内容概要：\n${brief.summary}\n` : ""}解说风格：${t.name}（${t.description}；语气：${t.tone}）
网感档位：${slangLevels[level].label}

候选梗（[序号] 梗（类型）：含义｜语气｜例句）：
${candidates.map((m, i) => `[${i}] ${m.term}（${memeKinds[m.kind]}）：${m.meaning}｜${m.tone || "—"}｜${m.example}`).join("\n")}

挑出 5-12 个和这期题材、风格语气搭得上的梗；合适的不够就少挑，不要凑数。
- 不选：和题材基调冲突的；要大量背景解释观众才听得懂的；可能冒犯这期涉及的人群的
- index 填候选序号；where 用一句话说明这期里可以用在什么位置、什么语境（例如“吐槽房租涨价那段”“结尾引导评论”）`,
  };
}

// ---------- 视频制作 ----------

export function annotatePrompt(lines: { id: string; text: string }[], context: { title: string; segmentTitle: string; lexicon: { word: string; say: string }[] }): Prompt {
  return {
    instructions: `你是中文配音导演，负责在 AI 配音前给口播稿做朗读标注。TTS 会逐字朗读，所以你要标出它容易读错的地方。
原则：
- 绝对不能改动原文。spans 里每个片段的 text 拼起来必须和原句一字不差（包括标点和空格）
- 只在确实需要时给片段加 say（替换读法）：多音字（如“行长”的“长”→写成同音字“掌”）、容易读错的数字（年份“2025年”→“二零二五年”，型号编号逐位读）、英文缩写（按中文习惯的读法，如“AI”保持不变，“SQL”→“S Q L”）、特殊符号（“~”“/”等）
- say 只能用汉字、英文字母、数字和常用标点，不要用拼音声调、SSML 或括号注释
- 不需要标注的句子，spans 给空数组
- pauseAfterMs：句后停顿毫秒数。一般句子不填；需要强调、制造悬念或话题转折时填 500-1200
- keywords：每句 0-2 个值得在字幕上高亮的关键词，必须是原句里出现的连续文字
- mood：这句话的情绪，从给定选项中选`,
    prompt: `视频：${context.title}
章节：${context.segmentTitle}
${context.lexicon.length ? `\n已有读音词典（遇到这些词直接照用）：\n${context.lexicon.map((l) => `- ${l.word} → ${l.say}`).join("\n")}\n` : ""}
需要标注的句子：
${lines.map((l) => `[${l.id}] ${l.text}`).join("\n")}

为每一句输出一条标注，id 与上面一致。`,
  };
}

export type StoryboardPayload = {
  title: string;
  brief: { summary: string; audience: string; perspective: "first" | "third" };
  /** 解说风格（文案风格，不是画风） */
  style?: { name: string; description: string; tone: string };
  segments: { index: number; title: string; points?: string }[];
  lines: { id: string; segmentIndex: number; text: string; ms: number; keywords: string[]; mood?: string }[];
  /** 建卡角色：分镜只写他们在做什么，外貌由系统从角色卡补上 */
  cast?: { id: string; name: string; role: string; brief: string; presentation?: string }[];
  /** 增量模式：只为这个范围出镜头，前后是固定的镜头 */
  partial?: { before?: { text: string; shot?: string }; after?: { text: string; shot?: string } };
};

export function storyboardPrompt(input: StoryboardPayload): Prompt {
  let cur = -1;
  const body: string[] = [];
  for (const l of input.lines) {
    if (l.segmentIndex !== cur) {
      cur = l.segmentIndex;
      const seg = input.segments.find((s) => s.index === cur);
      body.push(`\n## 第 ${cur + 1} 章：${seg?.title ?? ""}${seg?.points ? `\n本章要点：${seg.points}` : ""}`);
    }
    body.push(`[${l.id}] (${(l.ms / 1000).toFixed(1)}s${l.mood ? ` · ${l.mood}` : ""}) ${l.text}`);
  }
  const edge = (label: string, e?: { text: string; shot?: string }) => (e ? `${label}的旁白：「${e.text}」${e.shot ? `，镜头：${e.shot}` : ""}。` : "");
  return {
    instructions: `你是 B站解说视频的分镜导演。你的工作不是给每句话配一张图，而是先读懂旁白在这里要做什么，再决定用什么方式让观众看懂、看进去。

镜头连续覆盖整条时间轴：每个镜头从某一句（或句中某个字）开始，持续到下一个镜头开始。

【先理解，再设计】每个镜头按这个顺序想，输出也按这个顺序：
1. intent：这一刻观众应该看到或感受到什么。写目的，不写画面。例如「让观众直观感到浪费的规模之大」「制造悬念，让人想知道门后有什么」
2. 表达方式：按下面的决策表选 kind 和 mode
3. 再写具体内容（description / card / onScreenText）

【决策表】
生成画面（kind=placeholder，mode=generate，之后按 description 生成配图）：
- 具体的人、物、场景、事件、动作、故事情节 → 直接拍出来
- 抽象的观点、情绪、概念 → 用视觉隐喻：找一个具体、能画出来、和这句话意思紧扣的意象（如「焦虑」→「一只攥紧的手，沙子从指缝流下」）。不要拍「一个人在思考」「城市夜景」这类放在哪句都行的通用画面
信息卡（kind=placeholder，mode=motion，由代码排版做动画，不生图）：
- 旁白给出关键数字、比例、倍数 → card.variant=stat。stat.value 必须是旁白里出现的数字原文（可以是「十三亿」「35」），不许换算、不许编造；unit 写单位；label 写这个数字是什么（≤ 12 字）
- 并列的要点、原因、步骤（2-4 项）→ list。items 每项 ≤ 10 字，headline 可写总括（如「三个原因」）
- 两者对比（前后、A 与 B、过去与现在）→ split。sides 写对比的双方，每边 ≤ 8 字
- 术语、定义、核心结论、互动引导 → headline。headline ≤ 12 字，是提炼出的关键词或短结论，不是整句照抄
章节与金句：
- title：章节标题卡。每章第一句用它（开场第一章除外），onScreenText 写 4-10 字的章节标题
- quote：金句卡。只给全片最有冲击力的 2-5 句话，onScreenText 写要上屏的金句（可精简，不超过 24 字）

【导演原则】
- 画面要补充字幕说不清的东西，不要复述字幕。字幕已经在念这句话，信息卡上只放提炼后的关键词、数据、要点
- 内容性质决定拍法：真实科普和观点评论不要虚构具体的人物和事件细节，用示意性的画面；虚构故事按情节拍，保持人物和场景前后一致
- 建卡角色（见下方角色表）出现在画面里时，把角色 id 填进 characters，description 里直接用角色名指代（如「林夏坐在公交站」），不要再写外貌和服装——系统会自动加上。只是被提到、不在画面里的角色不要填（「他想起了母亲」通常只拍他）。一个镜头最多 3 个角色
- 没有建卡的人物或场景再次出现时，description 里用相同的外观描述词，保证前后一致
- 真实公众人物不拍正脸，用背影、剪影、手部特写或象征物（角色表里标了呈现方式的照做）
- 生成画面和信息卡要穿插，同一种表达方式不要连续超过 3 个镜头；信息卡一般占 20%-35%，数据密集的内容可以更多
- 句子的情绪（括号里的 mood）决定画面的光线和氛围：悬疑、紧张偏暗、硬光；温暖、轻松偏柔和、明亮

【description】只在 mode=generate 时认真写，一句话：主体 + 动作 + 环境 + 关键道具或细节，具体到画师能直接画出来
- 景别写在 shotSize 里，不要写进 description
- 不要写画风词（油画、水彩、电影感、赛博朋克、4K、高清等），画风由系统统一决定
- 画面里不要出现文字、字幕、logo
- mode=motion 时 description 写一句版式说明即可（如「数据卡：十三亿吨」）

【shotSize】（mode=generate 必填）extreme-wide 交代大环境和规模；wide 场景全貌；medium 人物动作和人物关系；close 表情、手部和物件；extreme-close 强调一个关键细节。相邻的生成画面景别要有变化。

【motion】运镜要有理由：zoom-in 强调、紧张、聚焦；zoom-out 揭示全貌、交代环境、收束；pan-left / pan-right 浏览、并列、时间流逝。相邻镜头不要相同。

【importance】1 普通，2 重要，3 开场钩子、高潮、转折（最多占 15%）

【节奏】每个镜头 2-6 秒；开场前 15 秒节奏更快；一句话超过 6 秒时可以在句中逗号后切镜头（用 char 指定从第几个字开始，否则 char 为 0）；很短的句子和相邻句共用一个镜头。

【示例】
旁白：全世界每年浪费的粮食，高达十三亿吨。
→ intent：让观众直观感到浪费的规模之大；kind=placeholder，mode=motion，card={variant:stat, stat:{value:"十三亿", unit:"吨", label:"全球每年浪费的粮食"}}，motion=zoom-in
旁白：焦虑，本质上是对失控的恐惧。
→ intent：把抽象的焦虑变成能感受到的失控感；kind=placeholder，mode=generate，shotSize=close，description：一只手用力攥紧一把沙子，沙粒不断从指缝间流下，昏暗的桌面上只有一束侧光
旁白：他推开门，屋里一个人都没有。
→ intent：制造空无一人的不安；kind=placeholder，mode=generate，shotSize=wide，description：一扇老旧木门半开着，门后是空荡荡的客厅，家具盖着白布，地上积着薄灰，motion=zoom-in
旁白：原因有三个：成本太高、效率太低、习惯难改。
→ intent：让观众一眼记住三个原因；kind=placeholder，mode=motion，card={variant:list, headline:"三个原因", items:["成本太高","效率太低","习惯难改"]}`,
    prompt: `视频：${input.title}
${input.style ? `解说风格：${input.style.name}（${input.style.description}${input.style.tone ? `；语气：${input.style.tone}` : ""}）\n` : ""}${input.brief.audience ? `目标受众：${input.brief.audience}\n` : ""}叙述视角：${input.brief.perspective === "first" ? "第一人称 UP 主" : "第三人称旁白"}
${input.brief.summary ? `\n内容概要：\n${input.brief.summary}\n` : ""}${input.cast?.length ? `\n角色表（id · 名字 · 身份 · 外貌摘要）：\n${input.cast.map((c) => `- ${c.id} · ${c.name} · ${c.role} · ${c.brief}${c.presentation ? `（${c.presentation}）` : ""}`).join("\n")}\n` : ""}${input.partial ? `\n注意：这是局部重做。${edge("这段之前", input.partial.before)}${edge("这段之后", input.partial.after)}只为下面这些句子设计镜头，第一个镜头必须从第一句开始，并与前后镜头自然衔接（景别、表达方式不要和相邻镜头雷同）。\n` : ""}
旁白（[句子ID] (时长 · 情绪) 原文）：
${body.join("\n")}

输出镜头列表，lineId 必须是上面出现过的句子 ID，按时间顺序排列。`,
  };
}

export type CastPayload = {
  title: string;
  brief: { summary: string; perspective: "first" | "third" };
  style?: { name: string; description: string };
  segments: { index: number; title: string }[];
  lines: { id: string; segmentIndex: number; text: string }[];
};

export function castPrompt(input: CastPayload): Prompt {
  let cur = -1;
  const body: string[] = [];
  for (const l of input.lines) {
    if (l.segmentIndex !== cur) {
      cur = l.segmentIndex;
      body.push(`\n## 第 ${cur + 1} 章（segmentIndex=${cur}）：${input.segments.find((s) => s.index === cur)?.title ?? ""}`);
    }
    body.push(`[${l.id}] ${l.text}`);
  }
  return {
    instructions: `你是影视选角导演兼角色设计师。读完整篇口播稿，判断这期视频的画面里需要哪些角色，并为需要建卡的角色设计外貌，保证他们在几十个镜头里看起来是同一个人。

【第一步：叙事模式】为每一章判断画面里的人物属于哪种情况：
- story：虚构故事，有具体的人物和情节
- real-people：讲真实的历史人物、公众人物或真实事件的当事人
- archetype：科普或观点里的典型人物（「一个普通上班族」「你」「很多年轻人」），用一个固定形象让观众代入
- narrator：第一人称 UP 主在讲自己的经历，画面需要出现「我」
- none：纯知识、数据、物件或自然，画面不需要固定人物
内容概要里标注了内容性质时以它为准：虚构故事按 story；真实科普、观点评论不要虚构具体人物，最多用 archetype。

【第二步：找出所有人物，做指代归并】
- 人名、称谓（老王、店主、那个女孩）、代词（他、她、他们）、描述（穿红衣服的人）指的是同一个人时，归并成一个实体
- mentions 列出这个人物被提到或出场的全部句子 ID
- 动物、拟人的物件、机器人或怪物也算角色，kind 分别为 animal / object / creature；群体（工人们、观众）kind=group
- 比喻和修辞里的物件（「手机像一座牢笼」）、普通道具、抽象概念都不是角色，不要列出
- key：唯一标识，用名字或最稳定的称谓

【第三步：是否建卡】
- needsCard=true：反复出现（≥ 2 句）、跨章节出现，或是主角
- 只出现一次的路人（role=extra）和群体一般不建卡；reason 用一句话写明理由
- 真实公众人物（real=true，role=real）也要列出，但画面不会拍正脸，presentation 从 back（背影）/ silhouette（剪影）/ hands（手部特写）/ symbol（象征物）中选最合适的
- narrator（UP 主形象）只有文中的「我」确实需要出现在画面里时才建卡

【第四步：设计外貌】只对 needsCard=true 的角色认真写
- 原文明确写到的特征必须照写，并把字段名列进 explicitFields；根据时代、职业、地域、性格合理推断的列进 inferredFields；其余按题材补全
- 可填字段：ageRange（自然的说法，如「二十出头」「五十多岁」）、gender、region（仅当背景需要时）、era（时代）、occupation、hair、eyes、faceShape、facialHair、marks（疤痕、痣等）、build、height
- 区分「不变的」和「随造型变的」：身份锚会出现在这个角色的每一个镜头里，所以
  · occupation 只写贯穿全片不变的身份；剧情里换了职业（外卖员→心理咨询师），职业写进对应造型的 name 和 wardrobe，occupation 留空
  · signature：2-3 个识别锚点，必须在所有造型里都成立——身体特征（「左耳缺一角」「雀斑」）或始终佩戴的配饰（「圆框眼镜」「红色毛线围巾」）。某套造型专属的服装、工具、道具（头盔、工作证、配送箱）只能写进那套造型，不能当识别锚点
  · 同一特征在各字段里的描述必须一致（左右、颜色、数量不能前后矛盾），已写进 marks 的特征不要在 signature 里换个说法重复
- looks：造型（服装 + 道具）。服装随剧情变化时（少年→中年、平时→婚礼、换工作）写多套，第二套起用 fromLineId 标明从哪一句开始
- personality：一句话性格，只用来指导姿态和表情
- 同一部片的角色之间，发型、配色、体型至少有两项明显不同，让观众分得清
- 没有依据时不指定肤色和体型，不套用职业和地域的刻板印象；确实没有信息、也不需要补全的字段直接留空，不要写「不指定」「未知」
- 虚构角色不能描述成「像某位明星」
- 只写看得见的外观，不写画风（画风由系统统一决定）

【示例】
原文：「林夏今年二十三岁，留着齐耳短发……她又一次站在那家书店门口……五年后，林夏已经是一家出版社的编辑。」
→ key=林夏，role=protagonist，needsCard=true，ageRange=二十出头，gender=女性，hair=齐耳黑色短发，explicitFields=[ageRange, gender, hair]，occupation 留空（前后换了身份），signature=[红色毛线围巾, 左眼角一颗泪痣]，looks=[{name:大学生, wardrobe:米色风衣、牛仔裤, props:帆布托特包}, {name:出版社编辑, wardrobe:深灰色西装外套、白衬衫, props:一叠书稿, fromLineId:<五年后那句的 ID>}]`,
    prompt: `视频：${input.title}
叙述视角：${input.brief.perspective === "first" ? "第一人称 UP 主" : "第三人称旁白"}
${input.style ? `解说风格：${input.style.name}（${input.style.description}）\n` : ""}${input.brief.summary ? `\n内容概要：\n${input.brief.summary}\n` : ""}
全文（[句子ID] 原文）：
${body.join("\n")}

输出每一章的叙事模式，以及全部人物（包括不建卡的，写明理由）。没有人物时 characters 给空数组。`,
  };
}
