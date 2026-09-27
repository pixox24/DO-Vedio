# 视觉导演系统改造计划：风格卡 · 角色定妆 · 分镜 v2

> 目标：让每一句旁白都有**贴切、风格统一、人物前后一致**的画面。
> 做法：先读懂文本，再定风格和选角，再分镜，再生成，最后质检回流，形成闭环。
> 本文是对 [video-pipeline-p0-p1.md](./video-pipeline-p0-p1.md) §5.5 分镜和 §10 P2 扩展位的细化与重排。

---

## 0. 闭环总览

```
                    ┌──────────────────────── 反馈回流 ────────────────────────┐
                    ▼                                                          │
 文案 ─→ ① 视觉风格卡（用户选定 / 推荐）                                         │
   │         │ 画风·色彩·光影·氛围·质感·负面词·Remotion 主题                       │
   │         ▼                                                                 │
   ├──→ ② 选角分析（LLM，全片 1 次）                                             │
   │         │ 是否需要角色？有哪些？长什么样？哪些场景会反复出现？                    │
   │         ▼                                                                 │
   │    ③ 定妆（生图）  角色：候选立绘 → 用户选定 → 三视图 / 表情组               │
   │         │          场景：定场图                                   【确认点 B】│
   │         ▼                                                                 │
   ├──→ ④ 剧本拆解（LLM，按章节）  每个节拍的作用 / 意图 / 锚词 / 出场角色          │
   │         ▼                                                                 │
   │    ⑤ 分镜设计（LLM，按章节）  表达方式 + 背景规格 + 动画层 + 角色调度         │
   │         ▼                                                                 │
   │    ⑥ 规则与校验（纯函数）     节奏 / 景别 / 防编造 / 一致性约束               │
   │         ▼                                                                 │
   │    ⑦ 提示词编译（纯函数）     内容 ⊕ 镜头 ⊕ 角色锚 ⊕ 风格 ⊕ 情绪 ⊕ 负面        │
   │         ▼                                                                 │
   │    ⑧ 镜头生成（生图 / 生视频，带参考图）                                     │
   │         ▼                                                                 │
   │    ⑨ 质检（视觉 LLM）  贴合度 / 角色一致 / 文字泄漏 / 畸形 → 打分 ─────────────┘
   │         ▼                                     低分：自动重生（有预算上限）或标记
   └──→ ⑩ 渲染：背景层 + Remotion 动画层 + 字幕 + 音频
```

**确认点**（人工把关，自动模式下按默认值或最高分通过）：
- A. 风格确认：开始生图前必须有风格（默认用解说风格推荐的风格卡）
- B. 角色定妆确认：选定每个主要角色的立绘，**之后所有镜头都以它为准**
- C. 候选挑选：每个镜头出多张候选时挑一张（可选）

---

## 1. 设计原则

1. **内容与风格严格分离**。大模型只写"拍什么"（主体、动作、环境、景别），**不许写风格词**；风格由提示词编译器统一注入。换风格不改内容，改内容不动风格。
2. **身份与调度分离**。角色长什么样只写在角色卡里；分镜里只写角色在做什么（动作、表情、站位、朝向），不重复描述外貌。
3. **能用结构就不用自由文本**。枚举和结构化字段让规则可以校验，也让缓存键稳定。
4. **每一步可解释、可锁定、可局部重做**。选角有证据（出现在哪几句）；任何卡片锁定后，上游重跑也不会覆盖它。
5. **失效传播最小化**。改一句话只重做受影响的节拍和镜头；换风格只重新生图，不重跑分镜；改角色只重生出现这个角色的镜头。
6. **按模型能力降级**。支持参考图的模型用参考图，不支持的退到固定 seed + 身份锚文本 + 回避正脸的构图，而不是直接失败。

---

## 2. 视觉风格卡

### 2.1 和"解说风格模板"的关系

| | 解说风格模板（现有） | 视觉风格卡（新增） |
|---|---|---|
| 作用对象 | 文案：语气、结构、选题 | 画面：画风、色彩、光影、氛围 |
| 存储 | `lib/templates/` · `data/templates.json` | `lib/visual-styles/` · `data/visual-styles.json` |
| 项目字段 | `brief.templateId` | `doc.visualStyle`（快照） |
| 关系 | 解说风格模板可以带一个 `recommendedVisualStyleIds`，新建项目时作为默认推荐 |

### 2.2 数据结构

风格按"维度"拆开，而不是一整段文字。这样编译器可以按槽位注入，情绪调制也能只改其中几个维度。

```ts
visualStyleSchema = {
  id, name, description, builtin?, version,

  // —— 画风（决定"用什么媒介画"）——
  medium: "photo" | "cinematic" | "illustration" | "anime" | "3d" | "ink" | "watercolor"
        | "flat-vector" | "paper-cut" | "pixel" | "oil" | "comic",
  rendering: string,          // 渲染细节，如 "soft cel shading, clean line art"
  texture: string,            // 质感，如 "subtle film grain" / "paper texture"

  // —— 色彩 ——
  palette: { primary: string[]; accent: string; neutral: string[] },   // hex，同时驱动 Remotion
  colorGrade: string,         // 调色描述，如 "teal and orange, low saturation"
  saturation: "low" | "mid" | "high",
  contrast: "low" | "mid" | "high",

  // —— 光影 ——
  lighting: string,           // 基调，如 "soft diffused daylight" / "hard rim light, deep shadows"
  timeOfDayBias?: string,     // 偏好时段，如 "golden hour"

  // —— 氛围与情绪基调 ——
  atmosphere: string,         // 如 "quiet, contemplative, slightly melancholic"
  moodRange: { allow: Mood[]; deny: Mood[] },   // 这个风格能承载的情绪范围
  moodModulation: Partial<Record<Mood, { lighting?: string; colorGrade?: string; atmosphere?: string }>>,

  // —— 镜头语言 ——
  camera: { lens: string; depthOfField: "shallow" | "deep"; preferredShotSizes: ShotSize[] },
  composition: string,        // 如 "generous negative space, rule of thirds"

  // —— 约束 ——
  negative: string[],         // 风格专属负面词（在全局负面词之外追加）
  strength: 0.5 | 0.75 | 1,   // 风格强度：写实类内容可以调低

  // —— 参考与预览 ——
  referenceAssetIds: string[],   // 风格参考图（模型支持 style-reference 时传入）
  previewAssetIds: string[],     // 用固定测试场景生成的样张（见 2.6）

  // —— 代码画面联动 ——
  remotion: { fontFamily?: string; accent: string; palettes: [string, string, string][]; grain?: boolean },
}
```

### 2.3 内置风格卡（首批 10 张）

| 名称 | medium | 适合的解说风格 / 题材 |
|---|---|---|
| 电影写实 | cinematic | 历史、纪实、悬疑 |
| 暗调悬疑 | cinematic | 悬疑、罪案、未解之谜（低饱和、硬光、冷调） |
| 温暖手绘 | illustration | 治愈、情感、生活 |
| 扁平信息图 | flat-vector | 科普、商业、财经 |
| 日系动漫 | anime | 故事演绎、青春 |
| 国风水墨 | ink | 历史、传统文化、古诗词 |
| 3D 黏土 | 3d | 幽默、儿童科普 |
| 赛博霓虹 | cinematic | 科技、未来 |
| 复古胶片 | photo | 怀旧、年代故事 |
| 漫画分镜 | comic | 吐槽、搞笑 |

每张内置卡都带预生成的样张，放在 `public/visual-styles/`，免得首次打开就要花钱。

### 2.4 风格如何融合，但不改变内容

**槽位编译**（见第 7 节）：
```
[内容槽] 主体 + 动作 + 环境 + 道具     ← 分镜产出，禁止出现风格词
[镜头槽] 景别 + 角度 + 镜头 + 构图留白  ← 分镜产出，受 style.camera 偏好约束
[角色槽] 角色身份锚文本               ← 角色卡产出
[风格槽] medium + rendering + texture + colorGrade + lighting + atmosphere
[情绪槽] moodModulation[本镜头情绪]    ← 只覆盖 lighting / colorGrade / atmosphere
[负面槽] 全局负面词 + style.negative
```

**保证"不影响内容"的四条机制**：
1. **风格词过滤**：分镜输出的内容槽经过校验，命中风格词表（"油画""赛博朋克""电影感""胶片""水彩""8K""大师作品"……）就剔除并记录。词表内置，可扩展。
2. **风格只改"怎么画"**：风格槽只包含媒介、光影、色彩、质感、氛围；主体、数量、动作、空间关系都写在内容槽，而且编译时内容槽放在最前面（大多数模型对开头的词权重更高）。
3. **情绪在风格范围内调制，而不是覆盖**：比如"暗调悬疑"风格遇到"温暖"情绪的句子，不改成明亮暖调，而是"在冷色画面里加一处暖色光源"。`moodModulation` 由风格卡作者定义；没有定义的情绪按 `moodRange.deny` 决定：被拒绝的情绪退回风格的默认基调，并在分镜板上提示"该情绪与风格冲突"。
4. **风格强度**：`strength` 控制风格槽的词数和权重。写实科普类题材用 0.5，避免风格把信息画歪。

### 2.5 风格卡的来源

| 来源 | 实现 |
|---|---|
| 内置 | `lib/visual-styles/builtin.ts` |
| 手工创建 / 复制修改 | 风格卡编辑页，按维度分组填写，每组都有下拉预设和自由文本 |
| **从参考图反推** | 上传 1–5 张参考图 → 视觉 LLM 输出风格卡的各个维度（和现有的文案风格反推 `extractPrompt` 对称）；参考图同时存进 `referenceAssetIds` |
| 按解说风格推荐 | 新建项目时，根据 `templateId` + 内容性质（fact/opinion/story）推荐 3 张 |

### 2.6 风格预览（样张）

用**固定的 3 个测试场景**生成样张，让不同风格可以横向对比：
1. 人物中景：一位中年人坐在窗边看书
2. 城市全景：清晨的城市街道
3. 静物特写：桌上的一杯咖啡和一本笔记本

缓存键 = 风格卡哈希 + 生图模型。修改风格卡时，预览区显示"样张已过期，重新生成（约 ¥x）"。

### 2.7 项目中的风格

- `doc.visualStyle` 存的是**快照**，而不是 id 引用。风格库里的卡被修改后，项目不会悄悄跟着变，只在项目里提示"风格卡有新版本，是否更新"。
- **项目级微调**：`doc.visualStyleOverrides`（只允许改几个维度），满足"这个项目想再暗一点"的需求，不必复制一张新卡。
- **换风格的影响**：所有生成的画面过期，分镜不过期。切换前弹出影响范围和预估花费；旧素材保留在候选里，可以切回去。
- Remotion 的 `theme`（[remotion/theme.ts](../remotion/theme.ts)）改为从 `style.remotion` 读取，**生成画面和代码画面的色调统一**。

---

## 3. 选角：识别文章需不需要角色

### 3.1 新阶段 `cast`（全片 1 次 LLM 调用）

**输入**：全文（带句子 ID）、brief、内容性质、人称视角（`perspective`）、解说风格、视觉风格卡的 `medium`（影响非人类角色的呈现方式）。

**第一步：判定叙事模式**（决定选角策略）：

| 叙事模式 | 判定依据 | 角色策略 |
|---|---|---|
| `story` 虚构故事 | 内容性质为 story；有情节、有具名或指代明确的人物 | 完整选角：主角、配角都建卡 |
| `real-people` 真实人物 | 历史人物、公众人物、真实事件当事人 | **不生成可辨认的肖像**。建"真实人物卡"，呈现策略从背影、剪影、远景、手部特写、象征物中选；鼓励上传有版权的真实素材 |
| `archetype` 典型人物 | 科普或观点里的"一个普通上班族""你""很多年轻人" | 建 1–2 张"典型人物卡"，让全片的"普通人"是同一个人，增强代入感 |
| `narrator` 第一人称 UP 主 | `perspective = first`，"我"反复出现并有画面需求 | 可选"UP 主形象卡"（虚拟形象）；默认关闭，由用户开启 |
| `none` 无角色 | 纯知识、数据、物件、自然 | 不建人物卡；只识别反复出现的**场景**和**物件** |

一篇文章可以同时有多种模式（例如科普片里穿插一段虚构小故事），按章节标注。

**第二步：实体抽取与指代消解**：
- 抽取所有人物指称：人名、称谓（老王、店主、那个女孩）、代词（他、她、他们）、角色描述（一个穿红衣服的人）。
- **指代消解**：把"他""这个男人""老王"归并到同一个实体，每个实体给出**出场证据**：`mentions: { lineId, text }[]`。
- 非人类角色也算：动物、拟人的物件、机器人、外星人。
- 群体（工人们、观众）单独标为 `group`。

**第三步：是否建卡**（规则 + LLM 判断，规则优先）：

```
建卡 ⇐ 出场镜头数 ≥ 2  或  跨章节出现  或  是叙事的主角
不建卡 ⇐ 只出现一次的路人 → 直接写在该镜头的内容槽里
群体 → 默认不建卡；有明显统一外观（同一支军队、同一群学生）时建"群像卡"
真实公众人物 → 建"真实人物卡"，呈现策略为不露脸
```

**输出**：

```ts
castAnalysis = {
  modes: { segmentIndex: number; mode: NarrativeMode }[],
  entities: {
    key: string,                       // 稳定键：名字或规范化称谓，用来和已有角色卡对账
    name: string,
    kind: "person" | "animal" | "creature" | "object" | "group",
    role: "protagonist" | "supporting" | "archetype" | "narrator" | "real" | "extra",
    real: boolean,
    mentions: { lineId: string; text: string }[],
    needsCard: boolean,
    reason: string,                    // 为什么建卡 / 不建卡，给用户看
  }[],
  scenes: { key, name, mentions, needsCard, reason }[],   // 反复出现的地点
}
```

### 3.2 选角的增量与对账
- 文案改动后重新分析选角；用 `key` 和已有的卡对账：**已有且锁定的卡永远不动**；新出现的角色新增；消失的角色标记"未出场"，但不删除。
- 缓存键 = 全文哈希 + 模型 + 分析版本号。

---

## 4. 角色长什么样

### 4.1 外貌推导（`cast` 阶段的第二个输出，同一次调用或紧接着的第二次调用）

**推导来源分三级，每个字段都标注来源**：

| 来源 | 例子 | 规则 |
|---|---|---|
| `explicit` 原文明确写了 | "她今年二十三岁，留着短发" | **不可违背**；用户修改时提示与原文冲突 |
| `inferred` 从上下文合理推断 | 明朝背景 → 服饰；外卖员 → 工作服和头盔；性格内向 → 姿态收敛 | 可以改 |
| `default` 没有信息，按风格与题材补全 | 发色、脸型 | 可以改；尽量做出区分度 |

**角色卡 v2**（扩展现有的 `characterCardSchema`，向下兼容）：

```ts
characterCardSchema = {
  id, key, name, locked,
  kind, role, real,

  identity: {
    ageRange: string,              // "20-25" / "60+"
    gender?: string,               // 原文明确或推断，没有就留空，不强行指定
    ethnicityOrRegion?: string,    // 仅当故事背景需要时
    era?: string,                  // 时代
    occupation?: string,
  },
  face: { shape?, eyes?, hair: string, facialHair?, marks?: string },   // hair 必填
  body: { build?: string, height?: string },
  looks: {                          // 造型：同一个角色在不同时期 / 场合的装扮
    id: string, name: string,       // "默认" / "少年时" / "婚礼上"
    wardrobe: string, props?: string,
    fromLineId?: string,            // 从哪一句开始换这身造型
  }[],
  signature: string[],             // 2–3 个识别锚点：红围巾、圆框眼镜、左脸的疤
  personality: string,             // 只用来指导姿态和表情基调，不写进生图提示词
  expressionRange: string[],       // 常见表情

  fieldSources: Record<string, "explicit" | "inferred" | "default" | "user">,
  evidence: { lineId: string; text: string }[],

  anchorText: string,              // 身份锚：编译出的 30–50 词英文描述（见 4.3）
  sheet: {                         // 定妆产物
    portraitCandidates: string[],  // 候选立绘 assetId
    portraitAssetId?: string,      // 选定的立绘
    turnaroundAssetIds: string[],  // 三视图：正 / 侧 / 背
    expressionAssetIds: string[],  // 表情组
    lookAssetIds: Record<string, string>,   // 每套造型的定妆
    seed?: number,
    styleHash: string,             // 定妆时使用的风格；风格变了 → 定妆过期
  },
  referenceAssetIds: string[],     // 用户上传的参考（优先级最高）
}
```

**推导时的约束**（写进 prompt 并做校验）：
- **区分度**：同一部片的角色之间，发型、配色、体型至少有两项明显不同，避免观众分不清谁是谁。
- **不贴刻板印象**：职业、地域不绑定固定的长相；没有依据时不指定肤色、体型。
- **不像真人**：虚构角色不能描述成"像某某明星"。
- **原文一致性检查**：原文前后矛盾时（"她二十岁"，后面又写"年过五旬"），识别为**时间跨度** → 自动拆成两套造型；无法解释的矛盾列入问题清单。

### 4.2 定妆：先生成角色图，确定长什么样

新阶段 `character-sheet`（生图），流程：

```
① 立绘候选：每个角色 4 张
   构图固定：正面半身、中性表情、纯色浅灰背景、柔和棚光，套用项目风格卡
   各张使用不同 seed，保持外貌描述不变
        ↓  用户挑选（或自动模式下按质检分选最高的）       【确认点 B】
② 以选定立绘为参考图，继续生成：
   · 三视图（正 / 侧 / 背，全身）
   · 表情组（喜 / 怒 / 哀 / 惊，4 张头像）
   · 每套额外造型的定妆照
        ↓
③ 写回角色卡：sheet.*，并把立绘 + 三视图加入参考图集
```

**用户操作**：
- 对某张候选"再来 4 张"或"在这张基础上改"（修改文字字段后，以当前立绘为参考重新生成）
- 上传自己的参考图（真人演员授权照、已有 IP 形象），直接跳过生成
- 锁定角色：之后不会因为重新选角或换风格而改动（换风格时提示"已锁定的定妆沿用旧风格，是否解锁重做"）

**真实人物卡**不做定妆，只配置呈现策略（剪影 / 背影 / 象征物 / 上传素材）。

### 4.3 身份锚文本（anchorText）

一致性的核心。由**代码**从角色卡的字段编译，而不是让大模型每个镜头各写一遍：

```
{ageRange} {gender} {occupation}, {hair}, {face.eyes}, {signature...},
wearing {当前造型 wardrobe}, {props}
例：a woman in her early 20s, short black bob haircut, round wire glasses,
    red knitted scarf, wearing a beige trench coat, carrying a canvas tote bag
```

- 只包含**可见的、稳定的**特征；性格、背景故事不写进去。
- 识别锚点（signature）一定写进去：即使模型不支持参考图，靠"红围巾 + 圆眼镜"观众也能认出是同一个人。
- 所有镜头里同一个角色的锚文本**逐字相同**（同一套造型下），这是纯文本模型保持一致性的关键。

### 4.4 按模型能力分级保证一致性

| 等级 | 模型能力（`catalog` 的 capabilities） | 做法 |
|---|---|---|
| A | `character-consistency` / 多张参考图 | 立绘 + 三视图作为参考图 + 锚文本 |
| B | `reference-image`（单张） | 立绘作为参考图 + 锚文本 |
| C | 只有 `seed` | 锚文本 + 角色专属固定 seed |
| D | 纯文本 | 锚文本 + 调度降级：重要度 1 的镜头用背影、远景、剪影、局部特写，**减少正脸暴露**，降低不一致被看出来的概率 |

**需要补的现状缺口**：自定义 OpenAI 兼容生图目前只调 `/images/generations`，参考图被丢弃。需要支持 `/images/edits`（多张 `image[]`），让 gpt-image 类模型达到 B/A 级；并在模型设置里声明能力。

### 4.5 场景卡（反复出现的地点）
和角色流程对称但更轻：选角分析识别反复出现的地点 → 场景卡（空间布局、时代、材质、标志物、时段） → 生成 1 张**定场图**（全景、无人物）→ 作为该场景镜头的参考图和身份锚。

---

## 5. 剧本拆解与分镜 v2（接入风格和角色）

### 5.1 剧本拆解（新阶段 `beats`，按章节并发）

**输入补全**（修正当前 payload 过于单薄的问题）：brief 概要、内容性质、解说风格、本章要点、每句情绪、关键词、选角结果（有哪些角色和场景及其 key）、前一章最后 2 个节拍。

**每个节拍的输出**：
```ts
beat = {
  lineIds: string[],
  role: "hook"|"claim"|"evidence"|"data"|"example"|"story"|"compare"|"list"|"process"
       |"definition"|"question"|"turn"|"emotion"|"quote"|"cta"|"transition",
  intent: string,                  // 观众在这里应该"看到"什么，才能更懂或更有感觉
  relation: "literal"|"supplement"|"metaphor"|"contrast",   // 画面和旁白的关系
  anchors: { text: string; lineId: string; char: number }[],   // 视觉锚词及位置
  abstraction: "concrete"|"abstract",
  intensity: 1|2|3,
  cast: string[],                  // 在画面中出场的角色 key（被提到 ≠ 出场）
  sceneKey?: string,
  facts?: { numbers?: {value: string; unit?: string; label: string}[]; items?: string[]; sides?: [string, string]; year?: string; place?: string },
}
```

注意 `cast` 的判定："他想起了母亲"——母亲被提到了，但画面可以只拍他（回忆镜头时才出现母亲）。这由 LLM 按意图判断，prompt 里给出示例。

### 5.2 分镜设计（按章节并发，输入 = 节拍 + 风格卡摘要 + 角色 / 场景卡摘要）

**表达方式决策矩阵**写进 prompt（见上一版评估：具体场景 / 故事 / 隐喻 → 生成；数据 / 列表 / 流程 / 定义 → Remotion；对比 / 事物 + 数据 / 地点 / 年代 / 悬念 → 叠加；真实人物、品牌 → 真实素材）。

**镜头 v2**：
```ts
Shot = {
  // 保留：id, at, locked, sourceHash, candidates, assetId, focus, seed ...
  beatId, intent,
  mode: "generate" | "motion" | "composite" | "real",
  background?: {
    source: "image" | "video" | "stock" | "upload" | "gradient",
    content: { subject: string; action?: string; setting: string; props?: string },   // 禁止风格词
    camera: { shotSize: ShotSize; angle: Angle; movementHint?: string },
    cast: { characterId: string; lookId?: string; action: string; expression?: string;
            position?: "left"|"center"|"right"; facing?: "camera"|"left"|"right"|"away" }[],  // ≤ 3 人
    sceneId?: string,
    mood: Mood,
    safeArea: "none" | "left" | "right" | "top" | "bottom",   // 给动画层留位置
    reuseFrom?: string,   // 复用某个镜头的图，换裁切
  },
  overlays: Overlay[],     // stat / list / compare / callout / kinetic / quote / map / year / flow
  motion: { kind: Motion; reason: string },
  transition?: "cut" | "fade" | "whip" | "match",
}
```

旧字段迁移：`description` 由 `content` 编译出一句中文（分镜板展示用）；`kind` 由 `mode + background.source` 推导，保持和现有渲染兼容。

### 5.3 规则层（扩展 `normalizeShots`）
- 剪辑点优先对准锚词开始说出的时刻
- 相邻镜头景别至少差一级；拆出来的镜头改景别，并用 `reuseFrom` 复用图片
- 运镜由作用和强度决定，不再随机轮换
- 强度分配预算：强度 3 → 生视频或 4 张候选；强度 2 → 2 张；强度 1 → 1 张，或优先 Remotion / 复用
- 校验：
  - 动画层里的数字必须出现在旁白里
  - 内容槽不能含风格词
  - 生成画面不能要求出现文字
  - 真实人物必须是 `real` 或使用不露脸的调度
  - 单个生成镜头最多 3 个建卡角色
  - 同一种表达方式在一章内不能连续超过 3 次
  - 动画层文字不能和字幕完全重复

---

## 6. 提示词编译器 `lib/core/prompt-compiler.ts`（纯函数，有单元测试）

```ts
compileShotPrompt(shot, { style, overrides, characters, scenes, aspect, model }) → {
  prompt: string,           // 英文
  negative: string,
  references: { assetId: string; role: "character" | "scene" | "style"; weight?: number }[],
  seed?: number,
  size: { width, height },
  debug: { slots: Record<string, string> },   // 分镜板里"查看提示词"展示各槽位
}
```

**顺序**：内容 → 角色锚 → 镜头 → 场景锚 → 风格 → 情绪调制 → 质量词。

**参考图优先级**（受模型的最大参考图数量限制）：用户上传的角色参考 > 角色立绘 > 三视图中和朝向匹配的那张 > 场景定场图 > 风格参考图。

**画幅**：
- 默认按主画幅生成，另一画幅用 `focus` 裁切；编译器根据 `safeArea` 和角色站位自动算出 `focus`。
- 强度 ≥ 2 且两种画幅都要导出时，**分别按画幅生成**（构图不同），缓存键包含画幅。

**方言适配**：不同模型对提示词长度、权重语法、负面词的支持不同，由 `model.promptDialect` 决定（例如不支持负面词的模型，把关键负面项改写成正面描述）。

**示例**（风格卡：温暖手绘；角色：林夏，默认造型；情绪：忧伤）：
```
[内容] a young woman sitting alone at a bus stop in the rain, holding a folded letter
[角色] a woman in her early 20s, short black bob haircut, round wire glasses, red knitted scarf, wearing a beige trench coat
[镜头] medium shot, eye level, subject on the right third, empty space on the left
[风格] hand-drawn illustration, soft gouache texture, warm muted palette
[情绪] cool blue ambient light with a single warm street lamp, quiet melancholic atmosphere
[负面] text, watermark, logo, extra fingers, deformed hands, multiple people
```

**缓存键**（修正现有的 `shotGenerationKey`）：加入 `compiled.prompt`、参考图列表、画幅、风格哈希。只要编译结果不变就命中缓存——不影响画面的字段改动（如 `motion`）不会触发重新生图。

---

## 7. 质检回流（新阶段 `shot-review`，视觉 LLM）

每张生成的候选图都评分：

| 维度 | 检查内容 | 不合格时 |
|---|---|---|
| 贴合度 | 画面是否表达了 `intent`；主体是否正确 | 重新生成，把问题写进内容槽作为修正提示 |
| 角色一致 | 和角色立绘对比：发型、识别锚点、服装 | 重新生成，加大参考图权重 |
| 人数与站位 | 人数是否等于出场角色数 | 重新生成 |
| 文字泄漏 | 画面里是否出现了文字或水印 | 重新生成 |
| 畸形 | 手、脸、肢体 | 重新生成 |
| 风格一致 | 和风格样张对比 | 标记 |

- 候选按总分排序，自动模式下默认选最高分。
- 自动重生**有上限**：每个镜头最多 2 次，并计入项目预算；超出后在分镜板上标红，交给人工处理。
- 质检结果写入生成记录（`generation-runs`），积累后可以反过来发现哪种风格或模型在哪类镜头上容易失败，调整默认策略。

---

## 8. 流水线编排与失效传播

新增阶段接入 `planPipeline` 的对账式编排：

```
annotate ─┐
tts ──────┤
          ├─→ cast ─→ character-sheet ─┐
          │         └→ scene-sheet ────┤
          └─→ beats ───────────────────┴─→ storyboard ─→ (compile) ─→ shot-generate ─→ shot-review ─→ render
visualStyle（用户选定）───────────────────────────────────────────────┘
```

| 变化 | 过期范围 | 不受影响 |
|---|---|---|
| 改一句文案 | 该句所在节拍 → 对应镜头 → 这些镜头的生图；选角分析重新对账（锁定的卡不变） | 其他镜头、定妆 |
| 换风格 / 调风格 | 所有定妆（未锁定）、所有生图、Remotion 主题 | 选角、节拍、分镜 |
| 改角色外貌 | 该角色的定妆 → 出现该角色的镜头生图 | 其他角色、分镜 |
| 重新选定立绘 | 出现该角色的镜头生图 | 分镜 |
| 改镜头内容 / 景别 | 该镜头的生图 | 其他镜头 |
| 只改运镜 / 动画层 | 只重新渲染 | 生图 |

每次失效之前都给出**影响范围和预估花费**，用户确认后才执行（沿用现有的 `confirmBudget`）。

---

## 9. 界面

1. **风格卡库** `/styles`：卡片网格（3 张样张 + 名称），支持新建、复制、从参考图反推、编辑（按维度分组，右侧实时显示编译出的风格槽文本）。
2. **项目「视觉设定」面板**（在分镜板上方，按顺序排三个页签，对应闭环的前三步）：
   - 风格：当前风格卡、项目级微调、换风格（带影响范围和预估花费）
   - 角色：角色卡列表（立绘、名字、出场次数、字段来源标记）；定妆工作台（候选 → 选定 → 三视图 / 表情组 / 造型）；真实人物卡的呈现策略
   - 场景：场景卡与定场图
3. **分镜板增强**：镜头卡显示节拍作用标签、表达方式、出场角色头像；"查看提示词"展开各槽位；质检分数与问题；强度标记。
4. **进度引导**：步骤条改为 `标注 ▸ 配音 ▸ 风格 ▸ 选角定妆 ▸ 分镜 ▸ 生图 ▸ 质检 ▸ 渲染`，卡在确认点时明确提示"需要你选定角色"。

---

## 10. 分期计划

| 里程碑 | 内容 | 验收标准 | 预计 |
|---|---|---|---|
| **M0 快速修正** | 分镜 payload 补全上下文（概要、风格、内容性质、情绪、要点）；prompt 先写意图再写画面；版式交给 LLM 选并给结构化数据，删掉正则猜测；占位卡不复述字幕；修正局部重做的上下文；拆镜头换景别 | 5 篇评测稿人工评分，贴合度明显提升；"与"字误判为 0 | 2 天 |
| **M1 风格卡 + 编译器** | 风格卡数据结构、内置 10 张（含样张）、库页面与编辑；项目快照与微调；提示词编译器（槽位、风格词过滤、情绪调制、负面词）；缓存键加入风格；Remotion 主题联动 | 同一分镜换 3 种风格，内容主体不变（质检贴合度一致）；风格词过滤有单元测试 | 5 天 |
| **M2 选角 + 角色卡 + 定妆** | `cast` 阶段（叙事模式、指代消解、建卡判定、外貌推导与字段来源）；角色卡 v2 迁移；定妆工作台（候选 → 选定 → 三视图 / 表情 / 造型）；身份锚编译；真实人物策略；自定义生图支持 `/images/edits` 参考图；能力分级 | 故事评测稿识别出的主要角色与人工标注一致；无角色的科普稿不建人物卡；定妆后 10 个镜头中同一角色人工判定一致 ≥ 8 个 | 6 天 |
| **M3 剧本拆解 + 分镜 v2** | `beats` 阶段；镜头 v2 数据结构与迁移；决策矩阵 prompt 与 few-shot；按章节并发；角色调度与场景引用；规则层扩展 | 数据句全部走 Remotion 且数字与原文一致；抽象句全部给出隐喻；角色出场判定正确 | 5 天 |
| **M4 分层渲染** | `ImageShot` 支持叠加动画层；新增 stat / list / compare / callout / kinetic / year / map 版式，锚在字上出现；`safeArea` 自动 focus；按画幅分别生成 | 横竖屏动画层都不遮挡主体；声画同步误差 < 100ms | 5 天 |
| **M5 质检闭环 + 自动模式** | `shot-review` 阶段、评分与自动重生（带上限）、候选排序；场景卡与定场图；自动模式的默认策略；失效影响范围预估 | 文字泄漏率 < 3%；自动模式一键成片无需人工介入即可通过质检 | 4 天 |

M1 必须在 M2 之前：定妆要套用风格。M2 必须在 M3 之前：分镜需要引用角色 id。M0 可以立即并行开始。

---

## 11. 评测集

固定 5 篇稿子，每个里程碑都跑一遍并保留结果做对比：
1. 虚构故事（2 个主角 + 1 个配角，含时间跨度）
2. 硬核科普（大量数据和流程）
3. 观点评论（大量抽象句）
4. 历史真实人物
5. 第一人称 UP 主吐槽

指标：画面与旁白贴合度（LLM 评委 + 人工抽查）、角色一致性、风格一致性、文字泄漏率、数字编造率、单片生图花费。

---

## 12. 风险与边界

| 风险 | 对策 |
|---|---|
| 真实人物肖像伪造 | `real` 角色一律不露脸；质检检查"是否像某位名人" |
| 刻板印象 | prompt 约束 + 没有依据时不指定肤色和体型 + 字段来源可见，用户能改 |
| 模型能力差异大 | 能力分级降级（4.4），模型设置里显式声明能力 |
| 花费失控 | 定妆、换风格、自动重生都先给预估再执行；强度分配预算；复用图片 |
| 风格与内容冲突（如水墨画风画数据中心） | 允许，但质检贴合度低时提示降低风格强度 |
| 长篇一致性衰减 | 按章节并发 + 全片级的风格卡和角色卡作为共同上下文 |
| 数据迁移 | 新字段都有默认值；旧的 `description` / `kind` 保留，由新结构推导，渲染兼容 |

---

## 实施记录

### M0（已完成）
分镜上下文补全、先意图后画面的 prompt 与决策表、信息卡数据由大模型抽取并校验（`lib/core/cards.ts`）、占位卡不复述字幕、局部重做传相邻镜头、拆镜头换景别。

### M1（已完成）
- 风格卡：`visualStyleSchema`（`lib/core/types.ts`）、10 张内置卡（`lib/visual-styles/builtin.ts`）、风格库存储与接口（`/api/visual-styles`）、风格库页面 `/styles`、项目「画面风格」面板。
- 提示词编译器：`lib/core/prompt-compiler.ts`（槽位、画风词过滤、情绪调制、风格强度、负面词）；生图缓存键和素材过期判断都基于编译结果的指纹 `assetPromptHash`。
- Remotion 主题由风格卡派生（`lib/core/theme.ts`，经 `ThemeContext` 注入）。
- 风格样张：`style-preview` 阶段，3 个固定测试场景，按「编译后的提示词 + 模型」缓存。

与原计划的差异：
1. **项目微调不单独存 overrides**：项目里保存的本来就是快照，直接编辑快照即为微调；与风格库同 id 的卡对比即可判断「已微调」，并支持「恢复为风格库版本」和「另存为新风格」。
2. **提示词暂用中文**：内置风格卡字段为中文，面向中文生图模型；英文方言适配留到后续（§6「方言适配」）。
3. **负面词内联**：目前两个适配器都不支持独立的负面词，统一以「画面中不要出现：…」追加在提示词末尾；编译结果仍单独保留 `negative`。
4. **内置样张不预置**：样张需要调用生图模型，改为在风格库和项目面板里按需生成（一次生成后缓存）。
5. **风格参考图、从参考图反推风格卡**：未在 M1 实现，放到 M2（需要自定义生图支持 `/images/edits` 与视觉模型）。

### M2（已完成）
- 选角：`cast` 阶段（`lib/pipeline/stages/cast.ts`）全片一次大模型调用，和配音并行，分镜等它完成；规则层（`lib/core/cast.ts`）决定建卡、与已有角色卡对账（锁定的卡、用户改过的字段、定妆图都保留）、区分度与一致性检查。
- 角色卡 v2：身份 / 外貌字段逐项标注来源（原文 / 推断 / 补全 / 已改），记录被用户覆盖的原文字段；造型可指定从哪一句开始；真实人物只拍背影 / 剪影 / 手部 / 象征物。
- 身份锚：由代码从角色卡编译，按镜头位置选造型，作为提示词的「人物」槽；改外貌会让用到该角色的镜头过期。
- 定妆：`character-sheet` 阶段，立绘候选 → 选定 → 三视图 / 表情组 / 造型定妆，全部套用画面风格；参考图优先级：用户上传 > 立绘 > 三视图，多角色交错。
- 分镜接入角色表，大模型只标出「在画面里」的角色，描述中用名字指代。
- 自定义 OpenAI 兼容生图支持 `/images/edits` 多参考图；不支持时退回文生图，并把原因写进生成记录。

实测（DeepSeek，童话改编稿）：第一版 prompt 把随剧情变化的职业和造型专属道具（外卖头盔）写成了身份锚，并出现左右耳矛盾；已在 prompt 中区分「不变的特征」与「随造型变的东西」，规则层增加对应检查，第二次实测无此问题。

未做 / 调整：
1. 场景卡与定场图仍在 M5。
2. 能力分级 D 级（纯文本模型时回避正脸的调度）未做：编译结果需要与模型无关才能作为缓存指纹，放到 M3 的分镜调度里处理。
3. 选角结果变化后不会自动重做已有分镜；已有项目需要在「镜头」里手动勾选角色，或重新分镜。
