import { charsFor } from "./duration";
import { rewriteActions, speechRateLabels, type Brief, type RewriteAction, type Section, type SpeechRate, type StyleTemplate } from "./types";
import type { Prompt } from "./llm";

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
        brief.avoid && `绝对不要出现以下内容或词语：${brief.avoid}`,
      ]),
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

export function outlinePrompt(brief: Brief, t: StyleTemplate, rate: SpeechRate): Prompt {
  const total = charsFor(brief.minutes, rate);
  const count = brief.minutes <= 3 ? "3-4" : brief.minutes <= 8 ? "4-6" : brief.minutes <= 15 ? "5-7" : "6-9";
  return {
    instructions: baseInstructions(t, brief),
    prompt: `${briefBlock(brief)}

请为这期视频设计章节大纲。
- 总时长 ${brief.minutes} 分钟，语速${speechRateLabels[rate]}（约 ${total} 字），分成 ${count} 个章节
- 第一章必须是“开场钩子”，只占 10-20 秒，用悬念、反常识结论或痛点在前几秒抓住观众
- 最后一章是总结收尾，自然地引导观众点赞、投币、收藏，并抛出一个评论区话题
- 中间章节按所选风格的结构偏好安排，章节标题简短有力
- points 写清本章要讲的 2-4 个要点，用分号隔开
- minutes 为本章分钟数（可以是小数），所有章节加起来等于 ${brief.minutes}`,
  };
}

export function sectionPrompt(
  brief: Brief,
  t: StyleTemplate,
  rate: SpeechRate,
  sections: Section[],
  index: number,
  previousTail: string,
): Prompt {
  const s = sections[index];
  const target = charsFor(s.minutes, rate);
  const outline = sections.map((x, i) => `${i + 1}. ${x.title}（${x.points}）${i === index ? " ← 当前章节" : ""}`).join("\n");
  return {
    instructions: baseInstructions(t, brief),
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
};

export function rewritePrompt(brief: Brief, t: StyleTemplate, input: RewriteInput): Prompt {
  const len = input.text.length;
  const task: Record<RewriteAction, string> = {
    expand: `扩写这一段，补充细节、例子或论据，扩展到约 ${Math.round(len * 1.5)} 字`,
    shrink: `精简这一段，保留核心信息，压缩到约 ${Math.round(len * 0.6)} 字`,
    colloquial: "让这一段更口语化、更适合朗读：拆分长句，换掉书面词，增加自然的语气",
    restyle: input.restyle ? `把这一段改写成下面这种风格，内容和信息量保持不变：\n\n${styleBlock(input.restyle)}` : "换一种表达方式重写这一段",
    custom: `按以下要求修改这一段：${input.instruction ?? ""}`,
    fit: `调整这一段的长度到约 ${input.targetChars} 字（上下浮动不超过 5%），风格和核心信息不变`,
  };
  return {
    instructions: baseInstructions(input.action === "restyle" && input.restyle ? input.restyle : t, brief),
    prompt: `视频标题：${brief.title}

${input.before ? `前文（仅供衔接参考）：\n"""\n${input.before}\n"""\n\n` : ""}需要修改的段落：
"""
${input.text}
"""

${input.after ? `后文（仅供衔接参考）：\n"""\n${input.after}\n"""\n\n` : ""}任务（${rewriteActions[input.action]}）：${task[input.action]}
修改后要和前后文衔接自然。只输出修改后的段落正文，不要任何说明。`,
  };
}

export function metadataPrompt(brief: Brief, script: string): Prompt {
  return {
    instructions: "你是 B站/西瓜视频的运营专家，擅长写高点击率又不标题党的标题和简介。",
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
- structureHints：开场、主体、结尾的惯用结构
- ideation：这位作者习惯怎样选题和切入（偏爱什么样的角度、从哪里下手）
- dos：3-5 条标志性写法（口头禅、句式、修辞习惯）
- donts：2-4 条这位作者明显回避的写法
- sample：用这种风格写一段 100-150 字的全新示范文字，主题不要和样本重复`,
  };
}
