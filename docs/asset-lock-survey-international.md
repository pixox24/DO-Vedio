> 本文是《一致性资产盘点：一场戏里还需要「锁」什么》的证据附件之一（通用/国际视角与失败模式），结论请看主报告。

# AI 视频跨镜头一致性：除「人物角色卡」外还必须锁定的视觉资产全清单（深度调研报告）

**证据标注约定（全文通用）**
- 🟢**业界共识** —— 多个独立来源交叉印证，传统影视与 AI 生产都成立
- 🏢**厂商官方私有做法** —— 某工具的官方文档/官方公告，换个工具就不成立
- 🧪**第三方实践者报告** —— 真实团队/开源项目的一手经验，含自报数据，可信但非普适
- 📣**低可信/营销内容** —— 培训机构、SEO 博客、二手转述，仅作线索
- 🔍**我的推断** —— 无直接来源，由前述事实推出

---

## 0. 结论速览（TL;DR）

1. **「角色卡」只锁身份，不锁状态。** 跨镜头穿帮的大头不是脸变了，而是服装、伤口、持物、开合状态、站在轴线哪一侧、门开没开变了。一致性工程真正要管理的是「**身份 / 变体 / 连续性锁**」三层，而不是一张三视图。🧪（[zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills/blob/main/docs/character-consistency-across-shots.md)）
2. **根本原因是模型无状态**：每次生成独立运行，模型不保留角色记忆；同提示词换 seed 就可能换人。所以一致性必须**外置成显式资产**，不能靠提示词祈祷。🧪（[36氪/DataEye](https://www.36kr.com/p/3759331098358277)、[hxsd](https://www.hxsd.com/content/59418/)）
3. **真正被"锁定"的资产远不止人物**：完整清单是 **14 类视觉/听觉资产 + 1 组"元资产"**（台账、命名、seed 快照、门禁）。其中被行业反复证明"不锁就翻车"的是：**场景几何母版（含反打视角）、首帧图、hero 道具、统一调色/LUT、光位、音色 ID**。
4. **门槛差异极大**：单镜头短视频的 P0 只有「首帧 + 风格参考 + 画幅」三样；一旦进入**多集连续短剧**，P0 会膨胀到「资产库 + 版本状态机 + 命名锚点 + 音色绑定 + 质检门禁」。腾讯云山海对外披露的量级是：**213 个组织、6,921 个项目、52,636 集、296,925 个分镜镜头**，其五层架构里专门有一层是「资产层（要素管理与团队记忆）」。🏢🧪（[腾讯云开发者社区](https://cloud.tencent.com.cn/developer/article/2694951)）
5. **最容易漏锁的三样**：① 场景的**反打视角/几何母版**（"同一房间四个角度"其实是 N 次互不相干的生成）；② **光位与光比**（换个时段就等于换一套 plate）；③ **道具的比例锚与文字策略**（含文字道具 100% 会自己发明文字）。🧪（[gflow-cli consistency.md](https://github.com/ffroliva/gflow-cli/blob/develop/skills/video-production/consistency.md)）

---

## 1. 问题的本质：一致性 = 外置状态管理

### 1.1 模型无状态，所以"记忆"必须由人写下来
AI 视频模型是**无状态**的：每次生成独立运行，不保留角色记忆；即便提示词一字不差，不同随机种子下同一角色可能变成另一个人。📣（[hxsd 转述](https://www.hxsd.com/content/59418/)）
行业侧证：DataEye 研究院实测行业痛点时写道——"一旦涉及复杂动作、场景，可能上一个镜头中的主角，到下一个画面就换了张脸，成片合格率大幅下滑，反而为了统一性需要大量人工进行抽卡试错、大量算力成本被消耗"；并引 Vista 看天下报道称某精品 AI 短剧团队约 10 人，其中 **7–8 人是"抽卡师"**。🧪（[36氪](https://www.36kr.com/p/3759331098358277)）

### 1.2 三层拆法：身份 / 变体 / 连续性锁 🧪
开源短剧工作流仓库 `zenstory-ai/drama-skills` 把这个拆得最清楚（MIT，11 个 Claude Code / Codex 短剧 skill）：
- **身份**：这个人是谁，跨集不变 → 用三视图 / `--cref` / LoRA / i2v 参考槽锁。
- **变体**：身份不变但服装、伤势、时段、天气、开合或持有状态改变 ——「换了件外套」是**变体**，不是新角色。
- **连续性锁**：只锁"不随剧情改变、且观众看得出不一致"的可见事实，用最小名词短语写（如一枚固定耳饰、外套颜色）。
- 其参考图分三态：`IMG-*`（只有提示词）/ `PLAN-*`（计划提供）/ `REF-*`（确实存在且已检查）——**只有 `REF-*` 能进视频提示词的参考槽**。

这正是"为什么只靠三视图会崩"的答案：三视图是身份参考，而跨镜穿帮多数是**状态**变了。🧪（同上）

### 1.3 资产层是工业化的分水岭 🏢
腾讯云山海星辰 Nova AI 的五层 Harness 架构中，资产层被定义为「**要素管理与团队记忆**」：建立全局资产库，通过版本状态（**定妆、可用、待确认、废弃**）管理角色、场景等要素，确保多人协作时引用同一份资产；并把"角色定妆、场景、道具"散落在个人电脑里导致的"无法保持稳定性与一致性"列为核心痛点。🏢（[腾讯云](https://cloud.tencent.com.cn/developer/article/2694951)）

### 1.4 传统影视早就在做同一件事 🟢
- **Show bible / series bible**：用于确保"key details、角色发展与准确的 continuity / timeline"。Wikipedia 引 Frasier 的例子：show bible 被"scrupulously maintained"，凡在片中确立的信息（Frasier 母亲的名字、Niles 最喜欢的教授、Martin 最喜欢的酒吧、甚至 Maris 的一长串食物过敏）都进 bible，再反过来作为编剧保持一致性的资源；**写 bible 在美剧体系里还能计入 WGA 入会所需的 24 个 credit units**。🟢（[Wikipedia: Bible (screenwriting)](https://en.wikipedia.org/wiki/Bible_(screenwriting))；[AWN: The Pitch Bible: Just The Essentials](https://www.awn.com/animationworld/pitch-bible-just-essentials)）
- **Lookbook / 视觉参考**：导演在开机前把影调、色彩、质地、镜头语言固化成一本可传阅的图册。🟢（[StudioBinder: How to Make a Lookbook for Film](https://www.studiobinder.com/blog/film-lookbook-examples/)）
- **Color script / color keys**：动画与视效前期用一整套小色稿把全片情绪—颜色的曲线画出来；`befores & afters` 有一篇专讲《Scoob!》color script 与 color keys 的行业访谈。🟢（[befores & afters](https://beforesandafters.com/2020/05/29/unravelling-the-mystery-of-the-color-script-and-color-keys-in-scoob/)）
- **Show LUT**：现场与后期共用的"看片用"转换，保证从拍摄到 dailies 到成片同一套 look。🟢（[Roger Deakins 官方论坛：About show LUTs and Daily timing](https://www.rogerdeakins.com/forums/topic/about-show-luts-and-daily-timing/)；[Kevin Shaw CSC, Show LUTs](https://icolorist.com/wp-content/uploads/2021/10/CSC_ShowLUTs.pdf)；[ACES Central](https://acescentral.com/)；[Pomfort: Looks, LMTs, and 3D LUT transforms](https://pomfort.com/article/looks-lmt-and-3d-lut-transforms/)）

**结论**：AI 视频工作流里被"锁定"的东西，本质是把传统影视的 bible / lookbook / color script / show LUT / 场记连续性 / 声音指导，**翻译成模型可消费的"参考素材 + 文本事实"**。这是全篇最重要的类比。🟢🔍

---

## 2. 完整资产清单（14 类 + 元资产）

> 每类给出：**锁什么 → 实际长什么样 → 下游喂给谁 → 分级（P0/P1/P2，定义见第 3 节）**。
> 分级默认按"**多镜/多集短剧**"这一最常见的高要求场景标注；单镜头场景的门槛另见 §3.3。

### A. 人物身份类（Character Identity）
- **锁什么**：脸型轮廓、五官比例、发型、体态、身材比例、可辨识记忆点（痣、耳饰、挑染）。📣（[hxsd](https://www.hxsd.com/content/59553/)）
- **长什么样**：最小集 = **1 张正面半身高清母版 + 3/4 侧 + 正侧 + 背面**（"三视图/4-View 资产板"）；进阶 = 表情表、动作参考图。`manju-laoli-skill` 用 "4 View 资产板"，并要求 16 项五官 + 6 项材质编码 + 亲缘推导表（T1→T2→T3 骨相继承 40%~60%）。🧪（[asset-first-pipeline.md](https://raw.githubusercontent.com/lixiaoxiao9888-create/manju-laoli-skill/main/short-drama-director/references/asset-first-pipeline.md)）
- **格式参考（可核验的硬约束）**：可灵 Element 多图元素要求 **至少 1 张正面图 `frontal_image` + 1–3 张其他角度 `refer_images`；.jpg/.jpeg/.png；单文件 ≤10MB；短边 ≥300px；长宽比 1:2.5 ~ 2.5:1**。🏢（[Kling API: Element Management](https://kling.ai/document-api/api/video/3-0-omni/elements.md)）
- **下游**：i2v 首帧（烘焙进画面）、多图参考槽、角色 LoRA、换脸后处理（ReActor/InstantID）、平台"角色实体"（Flow character / Kling Element / **Pika 角色卡**；Sora 的 characters 已随 2026-04-26 停服下线）。
- **分级：P0**（同一角色出现在 ≥2 个镜头即 P0）

### B. 服装 / 妆造 / 发型类（Wardrobe & Look）
- **锁什么**：服装件数、颜色、材质、内搭、袖口/领口状态、发型分缝、妆容强度、伤势/污渍/湿度等**状态变体**。
- **关键事实（很重要）**：**角色实体通常只锁脸，不锁衣服。** gflow 团队在一个真实项目上测得：11 帧里 9 帧人物对、但只有 4 帧服装对；结论是"服装一致性来自在每条提示词里**逐字重复同一个 wardrobe token**（如 the grey hoodie），永远不要指望实体"。🧪（[gflow-cli](https://github.com/ffroliva/gflow-cli/blob/develop/skills/video-production/consistency.md)）
- **另一个硬教训**：**图案/文字服装会 100% 自造文字**。该团队一条六镜场景里，"a band t-shirt" 每一镜都渲染出拼错的 logo，因此定规矩：服装一律 plain、no print。🧪（同上）
- **长什么样**：服装编号表（C01-A 日常 / C01-B 夜景）+ 每个编号一张服装图（正面 + 全身）+ 颜色 hex/材质词；换装用"最小改动"（只动衣服，脸型/五官/发型/姿态全锁）。🧪（[WorkBuddy 工作流](https://cloud.tencent.cn/developer/article/2754190)）
- **下游**：提示词中的固定 wardrobe token、多图参考（可灵 tags 里有专门的 `o_105 Costume` 标签）、换装图生图。
- **分级：P0**（有换装或多集）/ **P1**（单集但同一场次内换装）

### C. 场景 / 环境 / 地点（Location Sheet）
- **锁什么**：房间几何（门、窗、家具左右顺序）、材质、光源位置、机位可用角度、空间关系。
- **必须理解的失败机制**：**"同一房间的多个角度"如果分别用文生图生成，就是 N 次互不相干的生成，没有任何东西把角度 2 绑到角度 1。** gflow 记录："A real production shipped with a window that changed between beats." 修法是**锚点链**：先出一个"只有几何、没有人"的锚定角度 plate，其它角度一律用 i2i 从这张锚点派生（序列化、按顺序建）。🧪（[gflow-cli](https://github.com/ffroliva/gflow-cli/blob/develop/skills/video-production/consistency.md)）
- **长什么样**：
  - 最小可用集 = **一个 wide + 它的 reverse（反打）**——反打是背后那面墙，也是漂移最严重的一角；
  - 每个会入画的区域各要一张 plate（"要拍进陈列柜内部，就得有柜内 plate，光有房间 plate 不够"）；
  - 一个镜头只挂**一张**与机位几何匹配的 plate；
  - **换一种光照状态 = 换一张 plate**（从同一锚点派生）；
  - 中文工作流里对应的形态是"核心场景资产图（母版 + 机位调度版或站位版 + 拼接图）"。🧪（gflow 同上；[manju-laoli](https://raw.githubusercontent.com/lixiaoxiao9888-create/manju-laoli-skill/main/short-drama-director/references/asset-first-pipeline.md)）
- **命名**：必须按项目前缀命名（`<piece>_env_window.png`，绝不叫 `window.png`）——素材库常按精确文件名去重，通用名会静默选错资产。🧪（gflow）
- **下游**：多图参考槽的"环境位"（gflow 的合成顺序是 角色 → 环境 → 道具，且**环境永远不许被裁掉**）；i2i 派生其它角度；场景 LoRA（可选）。
- **分级：P0**

### D. 道具 / 关键物件（Prop Sheet & Hero Prop）
- **锁什么**：形状、材质、反光特性、颜色、比例、文字/logo、**状态**（完好/破损/被点亮）。
- **长什么样**：**每个"承载文字 / 会被计数 / 会成为画面焦点"的道具一张 sheet**；道具要占满画面（上传重编码会毁掉小字）；**每张 sheet 必须带比例锚**（一只手、一条桌沿），没锚的物体回来会变成巨物；**状态键控**——会变状态的道具是两张 sheet 不是一张；再加一张"装配图"固定相对尺度与空间关系。🧪（[gflow-cli](https://github.com/ffroliva/gflow-cli/blob/develop/skills/video-production/consistency.md)）
- **两条反直觉规则**：① **含文字道具优选正打、字形精确的母版，并且能不用就不用**——"改变种类的道具"能不用文字就传达机制，"改变措辞的道具"等于邀请模型发明文字；② **绝不要把必须离开的道具摆成贴着某表面**——一张平贴玻璃的卡片，三次尝试都让引擎在演员手里长出一个复制品，改成离玻璃一臂远就解决了。🧪（同上）
- **中文侧对应**："剧情关键物证 / 多镜出现 / 有防穿模风险的道具必须出图"（材质 / 反光 / 手持基准）。🧪（[manju-laoli](https://raw.githubusercontent.com/lixiaoxiao9888-create/manju-laoli-skill/main/short-drama-director/references/asset-first-pipeline.md)）
- **下游**：多图参考（可灵 tags 有 `o_104 Item`）、i2v 首帧、产品广告的合成批准帧。
- **分级：P0（hero prop）/ P1（一般道具）/ P2（背景陈设）**

### E. 风格 / 美术风格（Style Bible & Style Reference）
- **锁什么**：画风、笔触、材质感、渲染倾向（写实/动漫/3D）、整体气质。
- **工具机制（厂商私有）**：Midjourney V7 的 `--sref` 是**独立于角色**的风格通道，官方称"更懂风格、prompt 差异很大也更容易生效、更少把主体泄漏进画面"，并升级了 moodboard；旧 sref code 需 `--sv 4` 回退。🏢（[Midjourney: Style references for V7](https://updates.midjourney.com/style-references-for-v7/)）
- **长什么样**：**一张锚定风格的图 + 一段固定风格描述词**；`gflow` 的规矩是"每条 prompt 都写一个明确的角色：geometry / dressing / grade"，**没有声明角色的参考会被当成三种都用上**。🧪（gflow）
- **中文实践补充**："如果你想要一种特定的视觉风格，最简单的方法不是描述它，而是说出拥有这种风格的导演的名字。"📣（[hxsd](https://www.hxsd.com/content/59311/)）
- **下游**：`--sref` / style preset / 风格 LoRA / 首帧生成时的 style 约束。
- **分级：P0**

### F. 影调与调色（Color Script / LUT / 色彩情绪脚本）
- **锁什么**：全片色彩曲线、每个场次的情绪色、统一 grade。
- **传统依据**：color script / color keys 是动画与视效前期标准件。🟢（[befores & afters](https://beforesandafters.com/2020/05/29/unravelling-the-mystery-of-the-color-script-and-color-keys-in-scoob/)）
- **AI 侧的现实**：`gflow` 明确要求 **plate 只承载几何，光和 grade 属于镜头文本，不要烤进 plate**；同时用**固定 geometry 段落 + 统一调色**抑制房间漂移。🧪（gflow）
- **中文实践**："色调差异放大不一致感。全片统一后期调色，整体观感更连贯。"📣（[hxsd](https://www.hxsd.com/content/59418/)）
- **已出现的工具形态**：社区已经在做"**由参考标准驱动的色彩视觉一致性引擎**"，把不同来源的图片拉回同一视觉标准（本地运行）。🧪（[ECHO · 回响](https://github.com/x9c4gqtxv4-coder/ECHO) — 仓库地址见文末来源；注：该项目成熟度未评估）
- **下游**：统一 LUT / 后期 grade、参考图 selection、色板（品牌色板）。
- **分级：P0（多场次/多集）/ P1（单场次）**

### G. 灯光方案（Lighting Setup）
- **锁什么**：主光方向与高度、光比、色温、实际光源在画面里的位置（窗、灯、霓虹）。
- **为什么必须锁**：**"不同的光照状态就是不同的 plate"**（gflow）；中文实践同样把"光位"列为场景资产的第一要素——"场景图先定光位再定氛围，光位写死，后续所有镜头都要跟它连戏"；同一间卧室"白天暖光晚上冷光、家具时有时无，观众观感直接乱掉"。🧪（[gflow](https://github.com/ffroliva/gflow-cli/blob/develop/skills/video-production/consistency.md)；[WorkBuddy](https://cloud.tencent.cn/developer/article/2754190)；[hxsd](https://www.hxsd.com/content/59487/)）
- **长什么样**：场次级"光位图/光位描述块"（光源方位 + 色温 K + 光比），以及按时段拆分的 plate 组（日/夜/黄昏）。
- **下游**：plate 派生、镜头文本里的 lighting 段落、Veo/可灵提示词的 lighting 段、Flux/Stable Diffusion 的 relight。
- **分级：P0（多镜同场景）/ P1（单镜）**

### H. 镜头与焦段（Lens / Focal Length / 机位 / 构图模板）
- **锁什么**：镜头词汇表（wide / medium / CU / ECU / OTS）、命名机位、机位高度、焦段、构图与视线、**180° 轴线**。
- **实践形态（可直接抄）**：把电影语法**当数据字段**写进 beat sheet，而不是靠记忆：
  - **命名机位** `A_WIDE`、`B_MED_<name>`、`C_CU_<name>`、`D_TWO`，每个镜头注明机位与"每个演员背后是什么"；"反复出现才让剪辑读起来像同一场戏的剪辑，而不是一堆无关镜头"；
  - **声明 180° 轴线**：谁占画面左，摄影机永不越轴；"一张俯视 blocking 草图，比任何数量的散文都更便宜地定下轴线、视线与反打地理"；
  - **封闭的景别词汇表** + 全片有意的景别曲线，而不是随机游走。🧪（[gflow-cli](https://github.com/ffroliva/gflow-cli/blob/develop/skills/video-production/consistency.md)）
- **AI 工具侧的显式控件**：可灵支持**相机六轴**（Horizontal / Vertical / Pan / Tilt / Roll / Zoom，范围 [-10, 10]），中文侧实践建议单轴先试 ±5~±7、多轴组合 ≤2；即梦支持在提示词里写"镜头高度 1.6 米、匀速前推、速度 0.8 米/秒、**焦段 24 毫米**"。🧪（[video-prompt-reverse 平台适配指南](https://raw.githubusercontent.com/luozhilzh/video-prompt-reverse/main/references/platform-guides.md)）
- **下游**：分镜提示词的 cinematic language 段、相机控制参数、ControlNet depth/pose 预演。
- **分级：P0（多镜）/ P1（单镜但有反打）**

### I. 关键帧 / 首尾帧（Keyframes / First & Last Frame）
- **锁什么**：这一镜的**起点那一格能看见的全部内容**（人物朝向、位置、视线、持物、出入口、屏幕方向、必要状态）。
- **规则（中文开源工作流已成形）**：每镜先写"起点 → 唯一动作 → 终点"；**冻结关键帧只写起点那一瞬间能看见的东西**，终点才出现的动作/姿态/道具状态要删掉；关键帧定稿后**反查**这一格里需要保持身份/造型/地理的人物、地点、道具，逐项写进"视觉依据"。🧪（[zenstory drama-skills](https://github.com/zenstory-ai/drama-skills/blob/main/docs/character-consistency-across-shots.md)）
- **为什么首帧是最高杠杆**：`i2v` **没有身份通道**，请求会按设计拒绝参考实体——"**谁在首帧里，你就得到谁**"。身份只能靠烘焙进那一帧。🧪（[gflow-cli](https://github.com/ffroliva/gflow-cli/blob/develop/skills/video-production/consistency.md)）
- **尾帧**：用于 FLF2V / 首尾帧生成，把端点状态钉死；`Seedance` 侧的第三方指南强调**提示词只描述两帧之间的过渡逻辑**，并明写 `@Image2 is the final visual target, not just mood reference`。🧪（[seedance-2.0 first-last-frame-guide](https://raw.githubusercontent.com/Emily2040/seedance-2.0/main/references/first-last-frame-guide.md)）
- **分级：P0（首帧）/ P1（尾帧）**

### J. 动态 / 运镜模板（Camera Move Templates）
- **锁什么**：一镜一主运动、速度、起止、局部运动区域（哪些动、哪些绝对不动）。
- **工具机制（厂商私有）**：可灵 Motion Brush（涂抹局部控制运动）、可灵相机六轴；海螺在提示词里写 `[推进] [拉远] [左摇] [右摇] [晃动] [固定]` 等标准运镜指令（同组建议 ≤3，顺序用"然后"）；Runway 有 Motion Brush 与 camera presets。🏢🧪（[Kling 平台适配段落](https://raw.githubusercontent.com/luozhilzh/video-prompt-reverse/main/references/platform-guides.md)；[Kling AI Camera Control Guide](https://klingai.com/quickstart/ai-camera-control-guide) — 该页自动抓取返回空，仅确认 URL 存在）
- **中文管线里的对应物**："动作预演 15 宫格"、"镜头模板库"（标注景别、动作、情绪、时长、转场逻辑，下一部剧换剧情不换骨架）。🧪📣（[manju-laoli](https://raw.githubusercontent.com/lixiaoxiao9888-create/manju-laoli-skill/main/short-drama-director/references/asset-first-pipeline.md)；[hxsd](https://www.hxsd.com/content/59487/)）
- **下游**：视频提示词的 motion 段、相机参数、Motion Brush 蒙版、以及"禁止多运动"的负向约束。
- **分级：P1**（多镜时升 P0）

### K. 声音（配音音色 / 音乐主题 / 音效）
- **锁什么**：① 每个角色的**音色（voice ID）**；② 音乐主题/动机；③ 对白、OS、SFX、BGM 四类音频资产；④ 口型/对白与画面的对齐。
- **为什么是真需求（厂商已经把它产品化）**：可灵 3.0 Omni 的角色 Element **支持绑定音色**——"you can also bind a unique voice to the video or multi-image character elements, ensuring the character always maintains the same face and voice across different works"；Element API 里 `element_voice_id` 是正式字段（多图元素绑音色时仅支持人物/人形元素）。🏢（[Kling Element Library User Guide](https://kling.ai/quickstart/klingai-element-library-user-guide)（`kling.ai/quickstart/klingai-element-library-3-user-guide`）；[Kling API](https://kling.ai/document-api/api/video/3-0-omni/elements.md)）
- **音色锁定的技术选择**：ElevenLabs 区分 **IVC（<2 分钟音频，推理时条件化，跨风格一致性较弱）** 与 **PVC（≈30 分钟高质量音频，微调模型权重，跨语音类型与情绪范围一致性明显更好，需 Creator 及以上套餐）**；并明确"Professional Voice Cloning 需要约 30 分钟高质量音频"。🏢（[ElevenLabs: Voice cloning: how it works](https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning.md)）
- **传统依据**：主题/动机与角色绑定（leitmotif 传统）是配乐一致性的标准做法；品牌侧对应"sonic branding / sonic logo"。🟢（[AudioBrain: Sonic Branding / Sonic Logos](https://www.audiobrain.com/sonic-logos)）
- **长什么样**：声音资产表（角色 → voice_id / 参考音频 / 语速情绪）、BGM 库、SFX 清单；`manju-laoli` 把声音列为资产包第四类实体 `AUD`。🧪
- **下游**：TTS 配音、口型驱动、Veo 原生音频提示词、音效替换。
- **分级：P0（有对白 + 跨镜/跨集）/ P1（有 BGM 统一需求）/ P2（音效库）**

### L. 文字 / 字幕 / 图形包装（Title Card / 字幕样式）
- **锁什么**：字幕字体字号与描边、位置与安全区、片头 title card、片尾/引流模板、品牌 logo 与角标、水印策略。
- **行业铁律（两条）**：
  1. **画面里不要文字，字幕后期加。** 中文实践者的"零容忍"清单：看手、看道具数量、**看画面里有没有出现小字——这个必须零容忍，我来加字幕，不让模型替我加**。🧪（[WorkBuddy](https://cloud.tencent.cn/developer/article/2754190)）
  2. **任何承载文字的东西都会自造文字**（服装、招牌、道具）。🧪（[gflow](https://github.com/ffroliva/gflow-cli/blob/develop/skills/video-production/consistency.md)）
- **长什么样**：包装资产包（字幕样式表、封面版式、片尾模板、字体文件），一次性做好永久复用；账号视觉统一也会影响平台推荐权重。📣（[hxsd](https://www.hxsd.com/content/59487/)）
- **分级：P0（品牌/广告/有片头片尾）/ P1（普通短剧，至少锁字幕样式）/ P2（花字模板）**

### M. 元资产（Meta-assets）——最容易漏，也最影响产能
这一类不是"图"，但业界确实在锁，而且往往决定项目能不能规模化：

| 元资产 | 锁什么 | 业界依据 |
|---|---|---|
| **资产图册 / 唯一事实来源（SSOT）** | 所有 `@CHR` / `@SCN` / `@PRP` 编码 + 资产参考图 + 索引标签，取代纯文字台账 | 🧪 [manju-laoli](https://raw.githubusercontent.com/lixiaoxiao9888-create/manju-laoli-skill/main/short-drama-director/references/asset-first-pipeline.md) |
| **版本状态机** | 定妆 / 可用 / 待确认 / 废弃 —— 多人协作引用同一份资产 | 🏢 [腾讯云山海](https://cloud.tencent.com.cn/developer/article/2694951) |
| **seed 与参数快照** | "保存你生成角色用的 seed 值……下一集换了 seed 值，角色直接变成另一个人"；终选图的种子与提示词必须一起存，保证可复现。**⚠️ 定位澄清**：seed 快照的价值在**可复现与可回退**，**不是**一致性方案本身——Midjourney 官方明确 "Seeds can't capture or bookmark a specific style, character, or appearance across different prompts"；锁形象要靠参考图/角色实体 🔍 | 🧪📣 [hxsd](https://www.hxsd.com/content/59487/)；[WorkBuddy](https://cloud.tencent.cn/developer/article/2754190)；🏢 [Midjourney Seeds](https://docs.midjourney.com/hc/en-us/articles/32604356340877-Seeds) |
| **命名与锚点规范** | 项目前缀 + 短锚点（`@CHR-荆恪-正面`）+ 参考图三态（IMG/PLAN/REF） | 🧪 gflow；zenstory |
| **门禁 / 质检清单** | "无图不进分镜""分镜引用的锚点无对应已锁定资产图 → 阻断"；质检发现画幅/脸型/服装与资产图不一致 → 阻断 | 🧪 manju-laoli |
| **负面清单** | 禁文字、禁水印、禁新增人物、禁改身份、禁改 logo | 🧪 seedance 指南；gflow |
| **画幅与平台规格** | 画幅/风格/平台在 P0 一次锁定，全流程沿用 | 🧪 manju-laoli |
| **授权与权限** | Sora 的 character cameo 可设权限：仅自己 / 批准用户 / 互相 / 所有人 / 所有人（排除某组）；语音克隆带 voice-captcha 验证 | 🏢 [ITmedia](https://www.itmedia.co.jp/aiplus/article/2510/31/1251031084/)；[ElevenLabs](https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning.md) |
| **合规/水印** | Google 生成媒体一律嵌入 SynthID 不可见水印 | 🏢 [Google/SynthID via Simon Willison](https://simonwillison.net/2025/Nov/20/nano-banana-pro/) |
| **组织能力（Skill ≠ Prompt）** | 把剪枝、审核、翻译等经验沉淀为系统可调用能力，而非单次提示词 | 🏢 [腾讯云山海](https://cloud.tencent.com.cn/developer/article/2694951) |

**分级：P0（团队 >1 人或跨集）**

---

## 3. 必备 vs 备选：分层依据与门槛差异

### 3.1 分层判据（我归纳的 8 个变量）🔍
一个资产是否升到 P0，取决于下面 8 个问题里有几个答案是"是"：
1. 这个元素是否在 **≥2 个镜头**出现？（重复出现 = 观众有机会比对）
2. 是否出现过**可辨识的面部特写**？（人脸是最敏感的比对区）
3. 是否**跨集/跨项目**复用？
4. 是否**承载剧情**（hero prop / 物证）或被计数、被手持、被特写？
5. 是否**含文字/logo/品牌露出**？
6. 是否有**连续空间动作**（进出门、正反打、越轴、追逐）？
7. 是否**原生音频/有对白**？
8. 是否**多人并行生产**（>1 人就要命名与台账）？

### 3.2 三层分级

**P0 · 必备（不锁必然翻车，返工成本 > 制作成本）**
1. 角色身份母版（正脸 + 3/4 + 全身，最好加背面）
2. 复用场景的**几何母版 + 反打视角 plate**
3. **首帧图**（i2v 无身份通道，身份只能烘焙进首帧）
4. 风格/影调基准（style ref + 统一 grade/LUT）
5. 画幅与平台规格（一次锁定）
6. **连续性锁清单**（服装/伤口/持物/开合状态）
7. 角色**音色 ID**（有对白且跨镜/跨集）
8. 资产台账 + 命名规范（团队 >1 人）

**P1 · 强烈建议（直接决定"能不能看"，但不锁不至于全盘作废）**
- hero prop sheet（含比例锚、状态键、装配图）
- 场景的时段/天气变体 plate
- 灯光方案（光位 + 色温 + 光比）
- 镜头语言表（命名机位、景别词汇、180° 轴线）
- 尾帧 / FLF2V 端点
- color script（多场次情绪曲线）
- 表情表 / 动作参考
- 换装变体表
- 字幕与包装样式
- 负面提示词黑名单

**P2 · 可选（投入产出比取决于规模与长期性）**
- 专属角色 LoRA 训练
- ControlNet 姿态/深度预演、15 宫格动作预演、3D 灰模/俯视调度图
- 音乐主题动机、音效库
- title card 与片头动画包装
- 跨项目复用库、资产检索系统
- 语音克隆的 PVC 级投入（≈30 分钟录音）

### 3.3 单镜头短视频 vs 多集连续短剧：门槛差在哪

| 维度 | 单镜头短视频（1 个生成片段，≤10s，几乎不剪） | 单集多镜（10–40 镜，同场景群） | 多集连续短剧（数十~上百集，团队 3–10 人） | 品牌广告 / 产品片 |
|---|---|---|---|---|
| 角色身份 | 常可省（无重复比对对象）；**但若要发多版本/多平台，至少锁 1 张脸** | **P0**：1 张母版 + 3/4 + 全身 | **P0**：母版 + 变体 + 表情 + voice 绑定 + 可选 LoRA | **P0**（代言人/固定角色） |
| 场景 | 可省（一镜一景，无反向镜头） | **P0**：几何母版 + 反打 | **P0**：全场景 plate 组 + 时段变体 | **P1**（除非多场景系列） |
| 道具 | 可省（除非是产品本身） | **P0**（hero prop） | **P0**（含状态键与装配图） | **P0**（产品几何 + logo **零容忍**） |
| 风格/色板 | **P0**（一张 style ref 就够） | **P0** | **P0** + 品牌色板/字体 | **P0**（品牌规范） |
| 调色/LUT | P2 | P1 | **P0** | **P0** |
| 光位 | 可省（一镜一光） | P1 | **P0** | **P0** |
| 镜头/焦段/轴线 | 可省 | **P0**（轴线） | **P0** | P1 |
| 首帧/尾帧 | **P0（首帧）** | **P0** | **P0** | **P0** |
| 声音 | P2（除非有对白） | P1 | **P0**（音色绑定 + BGM 库） | **P0**（品牌 sonic logo + 配音） |
| 元资产 | 不需要 | 需要轻量台账 | **P0**：SSOT + 状态机 + 门禁 + 命名 | **P0**：+ 审批流 + 版权/授权 |
| 典型新增角色 | — | 抽卡师/分镜师 | 资产管理员、审校 | 品牌方审批 |

**一句话门槛**：**从"单镜"跨到"多镜"，第一个必须新增的不是三视图，而是"场景几何母版 + 反打"和"剪辑级连续性锁"；从"单集"跨到"多集"，第一个必须新增的是"台账与版本状态"，因为此时一致性问题的性质从"技术问题"变成了"流程问题"。**🔍（依据：腾讯云山海把资产层定义为"团队记忆"；WorkBuddy 作者原话"这类问题不是生成质量差，而是资产没管好——它属于流程问题，不是模型问题" 🧪）

---

## 4. 主流工具的一致性机制对照（厂商私有做法，🏢）

> **⏱ 时效声明（重要）**
> 下表参数按 **2026-10** 核验，只代表核验时点的官方口径。AI 视频工具的参考图机制**迭代极快、且会整体重构**：Midjourney 在 V8 用 **Edit Model 取代了 Omni Reference / Character Reference**；Pika 在 2026-09 整体重建并**下线了 Scene Ingredients**；**Sora 已停服**。**厂商自己的不同页面之间也会互相矛盾**（实证见 §4.1）。
> 因此：选型与写 SOP 时**必须以目标模型的当前 API 文档为准**，并把「**模型版本 + 文档版本**」一并锁进项目档案——这本身就是一类"元资产"。下表中凡已变更 / 已停服的条目均已就地标注。

| 工具 | 机制 | 锁什么 | 容量与硬限制 | 来源 |
|---|---|---|---|---|
| **Midjourney（当前，默认 V8.2）** | **Edit Model** —— 官方原文："Generate new images using up to 4 reference images (**replacing Omni Reference and Character Reference**)." | 角色（含多角色）、物件、构图、透视；**不锁风格**（风格归 `--sref`）。官方提示：若多个角色的特征互相串味，"combine your characters into a single reference image" | **最多 4 张参考图**（Web 侧 Attach to prompt 上限四张；Discord 用 `--edit` + 多个图片 URL）；走 GPU time 计费；与 `--tile` 不兼容、结果不可 Remix；兼容 V8.1/V8.2，可与 Image Prompt、Style Reference、Moodboard、Personalization 组合 | 🏢 [Edit Model](https://docs.midjourney.com/hc/en-us/articles/48495453462797-Edit-Model)、[Version](https://docs.midjourney.com/hc/en-us/articles/32199405667853-Version)（正文经 Zendesk 公开 API 核对） |
| **Midjourney（⛔ Legacy：V6 `--cref/--cw`、V7 `--oref/--ow`）** | `--cref` + `--cw`（V6，支持多 URL 混合）；**Omni-Reference `--oref` + `--ow`**（V7，**仅 1 张图**） | `--cw 100`（默认）= 脸 + 发型 + 衣服；`--cw 0` = 仅脸（便于换装换发型）；`--oref` = 把角色/物体/载具/非人生物"放进我的图里" | `--ow` **1–1000**，默认 100（官方建议保持 <400）；与 `--stylize`/`--exp` 争夺影响力；**V8.X 已移除**——Omni-Reference 页顶部即警告 "When using V8.X, use the Edit Model instead" | 🏢 [Omni-Reference](https://docs.midjourney.com/hc/en-us/articles/36285124473997-Omni-Reference)、[Character References](https://updates.midjourney.com/character-refs/)、[Legacy Features](https://docs.midjourney.com/hc/en-us/articles/33329788681101-Legacy-Features) |
| **Midjourney** | `--sref` + `--sw` 风格参考 / Style codes / Moodboards | **纯风格**：官方原文 "It doesn't copy objects or people, just the overall style—like colors, medium, textures, or lighting" | `--sw`（style weight）**0–1000，默认 100**；`--sv` 选模型版本（V7 默认 `--sv 6`，旧 sref code 需 `--sv 4`）；**与 Moodboards 不兼容**；官方明确"**你不能基于上传的图片创建 style code**" | 🏢 [Style Reference](https://docs.midjourney.com/hc/en-us/articles/32180011136653-Style-Reference)、[Style references for V7](https://updates.midjourney.com/style-references-for-v7/) |
| **Midjourney** | `--stylize`（`--s`） | 艺术化强度 —— **与一致性零和**：官方称 `--stylize`、`--exp` 与参考权重"all compete for influence" | 0–1000，默认 100；预设 Low 50 / Med 100 / High 250 / Very High 750 | 🏢 [Stylize](https://docs.midjourney.com/hc/en-us/articles/32196176868109-Stylize) |
| **Google Veo 3.1** | **Ingredients to video**：最多 **3 张参考图**（角色 / 物体 / 场景） | 角色一致性 + 风格 | 另有 **first & last frame**、**Scene extension**（每段基于上一段最后一秒续接）；8s、720p/1080p/4K、原生音频、9:16 | 🏢 [Google Developers Blog](https://developers.googleblog.com/en/introducing-veo-3-1-and-new-creative-capabilities-in-the-gemini-api/)；[Gemini API 文档](https://ai.google.dev/gemini-api/docs/veo) |
| **Google Flow** | 项目级 **CHARACTER 实体** vs `--ref` 图片 | 实体锁"这个人"（多角度 turnaround + 声音 + 性格），`--ref` 锁"像这张图"（location plate / prop sheet） | 🧪 该实践文档称 Flow **只有 CHARACTER 一种可复用实体**（没有环境/道具/风格实体）；**`i2v` 请求按设计拒绝实体**；每次生成**最多一个带脸参考**（两个实体会 400）；模型参考上限 omni-flash 7 / veo-lite·fast 3 / **veo-quality 0**、nano2·nano-pro 10 / imagen4 3（**live-verified，非官方承诺**） | 🧪 [gflow-cli consistency.md](https://github.com/ffroliva/gflow-cli/blob/develop/skills/video-production/consistency.md) |
| **OpenAI Sora 2**（⛔ **已停服**） | **characters**（即通常所称 Cameo）+ **跨多镜头指令 + world state 持久化** | **一次短视频 + 录音同时锁"形象 + 声音"**，且**不限人类**：官方原文 "This capability is **very general, and works for any human, animal or object**."；肖像权可端到端控制（可随时撤销授权或移除含该角色的视频） | 官方对跨镜头一致性的原话：**"able to follow intricate instructions spanning multiple shots while accurately persisting world state"**（暗示分镜控制是在**单次生成内**完成，与"逐镜拼接 + 参考图"是两条不同路线 🔍）；Sora 2 Pro 为 ChatGPT Pro 专属；**Web/App 已于 2026-04-26 停服、API 于 2026-09-24 停服，数据将被永久删除**；Storyboard/Remix/Re-cut/Blend/Style presets 的官方帮助页**已随停服下线**（旧链接 `help.openai.com/en/articles/12435986-...` 现为 404，**不得再引用**） | 🏢 [OpenAI 官方发布页 Sora 2](https://openai.com/index/sora-2/)（一手，含上面全部原文）；[官方停服说明](https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation)；早期二手侧证 📣 [ITmedia](https://www.itmedia.co.jp/aiplus/article/2510/31/1251031084/) |
| **可灵 Kling（3.0 / 3.0 Omni）** | **Element Library（多图元素 / 视频元素）** | 角色、道具（**Item**）、**服装（Costume）**、场景（**Scene**）、特效（Effect）、动物——官方称"AI will remember your characters, items, and scenes" | 元素创建：**1 张 frontal_image + 1–3 张其他角度**，≤10MB，短边 ≥300px，比例 1:2.5~2.5:1；**3.0 Omni 起角色元素可绑音色**（"same face **and voice** across different works"）；**i2v 首尾帧生成最多绑 3 个元素**；视频生成最多 **7 个参考角色**、图像生成最多 **10 个**；可从单张主参考图 AI 扩视角；**"首帧 + 元素绑定"与"多角色共指（3+）"是 3.0 相对 2.6 新增的能力** | 🏢 [Element Library User Guide](https://kling.ai/quickstart/klingai-element-library-3-user-guide)；[Element API](https://kling.ai/document-api/api/video/3-0-omni/elements.md)；[VIDEO 3.0 能力对比表](https://kling.ai/quickstart/klingai-video-3-model-user-guide) |
| **可灵 Kling 4.0**（当前，2026-10 发布） | **Omni Reference**（多类型参考组合）+ **Multiple Keyframes** | 角色（脸/发型/**服装**）、产品、环境——官方原文："preserve the defining details of characters, products, and environments **as shots change**"；"Even as lighting, framing, and shot size change, her facial features, hairstyle, clothing, and overall appearance remain recognizable." | **最多 15 个组合参考资产**：图 ≤**10** / 视频 ≤**5**（合计 ≤**30 秒**）/ 主体 ≤**7**（含 ≤3 个视频主体）；**关键帧 ≤10**；时长 **3–30 秒**（3.0 时代对比：无视频时 7、有视频时 4 个参考；1 段视频 15 秒） | 🏢 [Kling 4.0 vs 3.0 官方对照表](https://kling.ai/blog/kling-4-vs-3)、[Kling 4.0 发布博文](https://kling.ai/blog/kling-4-ai-video-model)、[多关键帧指南](https://kling.ai/blog/kling-4-multiple-keyframes-guide) |
| **MiniMax 海螺** | **Subject-Reference to Video（S2V-01）** | `subject_reference` 数组，`type: character` + 参考图 | API 层正式字段 | 🏢 [MiniMax API Docs](https://platform.minimax.io/docs/api-reference/video-generation-s2v) |
| **Runway** | **Gen-4 References —— 注意：这是 Image（图像）工具，不是视频参考槽** | 角色身份、物件、风格、构图（含 sketch reference 草图/标注控构图与视线）；官方称"**单张参考图**"即可在不同光照、地点与处理下保持角色一致 | **最多 3 张参考图**（"You can select up to three active References for a single generation"）；分辨率上限 720×720（1:1）/ 1280×720（16:9）；用 `@name` 在 prompt 中指名；可 tag 保存跨会话复用、可 Share with Workspace；输入建议：自然均匀打光、中性表情、多人参考时把原图人脸用黑框盖住 | 🏢 [Creating with Gen-4 Image References](https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References)（帮助中心直连 403，正文经阅读代理核对）；[官方研究页](https://runwayml.com/research/introducing-runway-gen-4) |
| **Runway Act-Two** | 表演迁移（driving 视频 + character 图/视频） | **锁的是"表演"，不是外观**：把动作、表情、手势、音频迁移到角色上；character 用**图片**时自动补环境运动且可用 gesture control，用**视频**时保留原主体/环境/相机运动、**无** gesture control | 时长上限 **30 秒**、**24fps**、**5 credits/秒（最低 3 秒）**；需 **Standard 档及以上**；**Facial Expressiveness 默认 3**——官方原文"Lower values result in less expressiveness but **may improve character consistency** in certain cases"（一致性是可分配预算的又一例证）；输入要求单人、脸部全程可见、最远到腰部、无剪辑中断 | 🏢 [Performance Capture with Act-Two](https://help.runwayml.com/hc/en-us/articles/42311337895827-Performance-Capture-with-Act-Two) |
| **Pika（2026-09 重构后）** | **Character Studio**（角色卡）+ **Video Studio**（多镜头资产槽） | **Character Studio 官方原文："Lock face, hair and wardrobe from a single reference."**（脸 + 头发 + **服装**，单张参考图）→ 产出**角色卡**："a full-body shot, a 3/4 portrait, and three expressions"，可存库并跨项目、跨 Pika app 复用；允许真人参考（"upload a clear photo (yourself, an actor, a model)... Only use likenesses you have the right to use."） | **Video Studio：最多 50 个可 `@mention` 的角色/产品/场景/风格槽，支持 30 秒多镜头**（当前西方产品里槽位数最多）；**Pikaframes：2–5 个有序关键帧**，单段转场 1–5s（仅 2 帧时可 10s），**5 帧时只能 720p**；**⛔ 旧的 Scene Ingredients 已下线**（页面 404、API 目录中已无此项）；**⚠️ 流传的"Pikaframes 最长 25 秒"官方从未写过**（按官方数字推算 5 帧 × 4 段 × 5s ≈ 20 秒上限，🔍算术推断）；Free/Starter 无商用许可，Creator 及以上含商用 | 🏢 [Character Studio](https://create.pika.art/apps/character-studio)、[Video Studio](https://create.pika.art/apps/video-studio)、[Pikaframes](https://create.pika.art/apps/pikaframes)、[新版公告](https://pika.art/blog/welcome-to-the-new-pika)、[定价](https://pika.art/pricing) |
| **Nano Banana Pro（Gemini 3 Pro Image）** | 多图组合参考 | **最多 14 张参考图**：其中**最多 6 张物体（高保真还原）**、**最多 5 张人物（维持角色一致性）**；另有 1K/2K/4K 输出、多轮编辑、可读文字渲染 | 官方 API 文档原文由 Simon Willison 摘引；4K 图 $0.24/张 | 🏢 [Google API 文档（经 Simon Willison 引述）](https://simonwillison.net/2025/Nov/20/nano-banana-pro/)；[Google 开发者博客](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-3-pro-image-developers/)（正文未完整抓取） |
| **Vidu** | Reference-to-Video（多主体参考） | 官方产品页主打"Reference to Video — Keep Characters Consistent" | 具体上限未在本轮核验（🟠） | 🏢 [Vidu 官方页](https://www.vidu.com/ai-reference-to-video) ⚠️内容未核验 |
| **即梦 / Seedance** | 多模态混合输入 + 首尾帧 | 第三方平台指南称 **Seedance 2.0 最多参考 12 个文件**；即梦支持首帧 + 尾帧输入 | 🟠 数值来自第三方，**未见官方文档核验** | 🧪 [平台适配指南](https://raw.githubusercontent.com/luozhilzh/video-prompt-reverse/main/references/platform-guides.md) |
| **通义万相 Wan** | 参考生视频（`character1` 等指代）+ 多镜头公式 | 参考主角**最多 3 个** | 多镜头写法：`总体描述 + 镜头序号 + 时间戳 + 分镜内容` | 🧪 同上 |
| **开源栈（ComfyUI 等）** | IP-Adapter（含 FaceID）/ ControlNet + LoRA + InstantID/PuLID + ReActor | 面部、体型风格、姿态三路分开锁（IP-Adapter 多模态提示官方推荐 `scale=0.5`，纯图像提示 `scale=1.0`）；ControlNet 锁姿态/深度/边缘/**不锁身份、不锁相机**（官方 14 个模型里没有相机位姿模型）；换脸做后期兜底 | 社区经验（📣 **口径不齐，务必按"无权威定论"处理**）：角色 LoRA 数据量常见说法为 **20–50 张**（培训机构博客）、更可信的社区值为 **10–20 张**（HF 博客）或 **30–60 张**（Civitai），**kohya 官方四份文档未给任何数据集规模建议**；`--network_dim` 官方称常用 4–128（SDXL 常试 32/64），`--network_alpha` 建议约为 dim 的一半，LoRA 学习率常用 1e-4~1e-3；IP-Adapter FaceID / InstantID 因 InsightFace 许可**仅限研究、不可商用** | 📣 [hxsd](https://www.hxsd.com/content/59418/)（培训机构博客，数值仅为线索）；🏢 [IP-Adapter](https://github.com/tencent-ailab/IP-Adapter)、[ControlNet 1.1 清单](https://github.com/lllyasviel/ControlNet-v1-1-nightly)、[kohya sd-scripts train_network](https://github.com/kohya-ss/sd-scripts/blob/main/docs/train_network.md)、[InstantID](https://github.com/instantX-research/InstantID)、[PuLID](https://github.com/ToTheBeginning/PuLID) |

> ⚠️ 这一节的参数变动极快。第三方平台指南自己也写明："下列原生控件参数为 2026 年中公开文档核实值……正式投产前请以各平台当前官方文档为准。"🧪

### 4.1 实证：厂商自己的页面会互相矛盾（这本身是一项资产锁定风险）

跨镜头一致性方案最常见的隐性事故，不是模型不行，而是**你照着一条早已失效的官方描述搭了 SOP**。本次调研抓到 4 个可复核的实例：

| # | 矛盾 | 一处说 | 另一处说 | 应以哪个为准 |
|---|---|---|---|---|
| 1 | **Luma**（同厂商、同产品） | 营销页 `lumalabs.ai/ray3` 仍写 "Create consistent characters across shots with a single reference image." | **官方 Ray3.14 说明书的 "Notes & current limitations" 原文："References (Character) aren't supported in Ray3.14."**（同时 HDR/EXR in Modify Video 也不支持） | Ray3.14 说明书（型号页更新更快）→ **Luma 的角色参考应写成"Ray3-Modify 时代的特性 + 在 Ray3.14 上不可用"** 🏢 [Ray3.14 说明](https://lumalabs.ai/news/ray3_14) |
| 2 | **Adobe Firefly 帮助页 vs 原厂** | Firefly 帮助与博文仍在写 "Kling **2.5 Turbo**"，把它当作在售的伙伴模型 | Kling 自家官网首页已是 "**All-New Kling 4.0**"，4.0 于 **2026-10** 正式发布、2026-09-28 起早期访问 | 原厂（聚合平台的文档滞后约一年）🏢 [Kling 官网](https://kling.ai/)、[Kling 4.0 博文](https://kling.ai/blog/kling-4-ai-video-model) |
| 3 | **Midjourney 公告 vs 文档** | 2025-05 的 Omni-Reference 公告写 `--ow` "goes from **0 to 100 to 1000**" | 官方文档页写 "any value between **1 and 1,000**" | 文档（**1–1000**）；公告里的 0 疑为笔误，不建议引用 🏢 [公告](https://updates.midjourney.com/omni-reference-oref/)、[文档](https://docs.midjourney.com/hc/en-us/articles/36285124473997-Omni-Reference) |
| 4 | **OpenAI Sora：搜索结果 vs 现实** | 搜索引擎与大量第三方文章仍把 `help.openai.com/en/articles/12435986-generating-content-with-characters` 当作 Sora "characters/cameo" 的官方说明 | 该 URL 现已 **404**；产品本身也已停服（Web/App 2026-04-26、API 2026-09-24） | **官方发布页 + 停服页**；404 链接一律不得引用 🏢 [Sora 2 发布页](https://openai.com/index/sora-2/)、[停服说明](https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation) |

**由此得出的操作纪律**（🔍 建议写进项目规范）：
1. 资产档案里每条参考素材都记录 **「工具 + 模型版本 + 文档 URL + 核验日期」**，与 seed/参数快照同级；
2. **营销页只用来"发现功能"，参数以 API/帮助文档页为准**；两者冲突时按"更新更频繁的那一页"取信，并回写核验日期；
3. SOP 里避免写"某工具支持 X"这种**不带版本**的断言——本次调研中 Luma、Midjourney、Pika 三家都在一年内发生过机制级变更。

---

## 5. 落地形态：每类资产在工作流里长什么样

| 资产 | 最小张数 / 数量 | 视角与内容 | 格式 / 分辨率（可核验基准） | 命名 | 谁生成 | 下游去向 |
|---|---|---|---|---|---|---|
| 角色身份母版 | 1（+3 视图） | 正面半身高清、3/4 侧、正侧、背面；纯色/分段背景，不带帽子眼镜道具（除非永久特征） | jpg/png；短边 ≥300px（可灵门槛）；建议 ≥1K 长边 | `CHR_<名>_front.png` | 美术/角色设计师，或图生图从已过检图派生 | i2v 首帧、平台参考槽（Midjourney Edit Model / 可灵 Element / Flow entity / Pika 角色卡）、LoRA 数据集 |
| 表情表 | 6–12 | 中性/喜怒哀惧惊 + 该角色特有表情 | 同上 | `CHR_<名>_emo_<情绪>.png` | 图像模型批量 | 关键帧生成、表演参考 |
| 服装变体 | 每场景/每时段 1 | 全身正面（+背面） | 同上 | `C01-A_daily.png` | 图生图最小改动（只动衣服） | 提示词 wardrobe token（逐字重复） |
| 场景几何母版 | 1 | wide，**只有几何，没有人**，家具/门窗按左右顺序可点名 | 16:9，≥1280×720 | `<piece>_env_<room>_wide.png` | 文生图 | 派生其他角度的锚点 |
| 场景反打视角 | 1+ | reverse angle（门内看外/外看内） | 同上 | `<piece>_env_<room>_reverse.png` | **i2i 从锚点派生（禁止再文生图）** | 双人镜头的背景 plate |
| 场景细节 plate | 按需 | 柜内、窗外、桌面等会入画的区域 | 同上 | `<piece>_env_<room>_case.png` | i2i | 特写镜头的环境参考 |
| 时段/天气变体 | 每状态 1 | 日/夜/黄昏、雨/雪 | 同上 | `<piece>_env_<room>_night.png` | i2i 从同锚点 | 对应镜头的环境参考 |
| hero 道具 sheet | 每件 1（+状态 1 +装配 1） | 占满画面、带比例锚（手/桌沿）、正打含字形 | ≥1K，避免重编码损字 | `PRP_<名>_<状态>.png` | 文生图/图生图 | 多图参考（可灵 `o_104 Item`）、产品合成批准帧 |
| 风格参考 | 1–3 | 一张最像成片的帧 + 一段风格词 | 任意高分辨率 | `STYLE_<剧名>_ref01.png` | 美术/导演选定 | `--sref`、style preset、首帧生成 |
| color script | 每场次 1 格 | 该场次情绪色小稿，按时间轴排列 | 小图即可 | `COLOR_<场次>.png` | 美术 | 调色与灯光指导 |
| 光位图 | 每场次/时段 1 | 光源方位、色温 K、光比 | 文本 + 草图 | `LIGHT_<场次>_<时段>.md` | 摄影指导 | plate 派生、镜头 lighting 段 |
| 镜头语言表 | 1 张表 | 命名机位、景别、轴线声明、视线 | 表格/beat sheet | `SHOTS_<集>.md` | 导演/分镜 | 分镜提示词、质检 |
| 首帧 | 每镜 1 | 起点那一格能看见的一切 | 与视频分辨率一致（1080p/4K） | `EP01_SH012_first.png` | 图像模型（挂参考） | i2v 输入（**身份唯一通道**） |
| 尾帧 | 需要时 1 | 终点目标状态 | 同上 | `EP01_SH012_last.png` | 同上 | FLF2V |
| 运镜模板 | 每个模板 1 条 | 一镜一主运动 + 速度 + 局部区域 | 文本 + 参考视频 | `MOVE_pushin_slow` | 导演 | 视频提示词 motion 段、Motion Brush |
| 音色 | 每角色 1 | 参考音频或 voice_id | PVC ≈30min 素材；IVC <2min | `VOICE_<角色>.id` | 配音/克隆 | TTS、可灵 element 音色绑定 |
| 音频资产表 | 1 张表 | OS/对白/SFX/BGM 四类 | — | `AUDIO_<集>.md` | 声音设计 | 剪辑、混音 |
| 包装资产 | 1 套 | 字幕样式、封面版式、片尾模板、字体 | — | `PKG_<账号>.md` | 包装设计 | 剪辑合成 |
| 资产图册（SSOT） | 1 本 | 编码 + 资产图 + 索引标签 | Markdown/表格 | `《剧名》_资产图册.md` | 资产管理员 | 全流程引用 |

---

## 6. 反例与失败模式：哪一种锁定资产能防住它

| # | 失败模式 | 典型症状 | 来源 | 防线（锁哪类资产） |
|---|---|---|---|---|
| 1 | **身份漂移 / 换脸** | 上一镜主角下一镜换人；跨集变脸 | 🧪 [36氪/DataEye](https://www.36kr.com/p/3759331098358277)；🎓 VBench "Subject Consistency" 维度（DINO 特征跨帧相似度）[VBench](https://ar5iv.labs.arxiv.org/html/2311.17982) | 角色身份母版 + 多角度参考（当前可用的：Midjourney **Edit Model ≤4 图** / 可灵 **Element** 或 **Kling 4.0 Omni Reference** / Flow **character entity** / Pika **Character Studio 角色卡** / Veo 3 图）+ 固定 seed。**⚠️ 固定 seed 只能算辅助手段**——Midjourney 官方原文：**"Seeds can't capture or bookmark a specific style, character, or appearance across different prompts... For consistency in your images, we recommend style references, omni references, and personalization."**（[Seeds](https://docs.midjourney.com/hc/en-us/articles/32604356340877-Seeds)）；极端情况用 LoRA 或换脸后处理 |
| 2 | **服装/配饰变色变款** | 灰卫衣变黑卫衣；耳环换了 | 🧪 gflow（11 帧里仅 4 帧服装正确） | **服装变体表 + 每条提示词逐字重复的 wardrobe token**（不要指望角色实体） |
| 3 | **场景几何漂移（窗户位置变了）** | 同一房间反打时窗/门/家具位置变化 | 🧪 gflow（"a real production shipped with a window that changed between beats"，且曾有项目把反打漂移当作"不可避免"接受） | **场景几何母版 + 反打 plate + 固定 geometry 段落（按左右顺序点名家具门窗）**；plate 一律 i2i 从锚点派生 |
| 4 | **越轴 / 视线反向** | 正反打时两人都看同一侧，空间感崩 | 🧪 gflow（声明 180° 轴线 + 命名机位解决） | 镜头语言表（俯视 blocking 草图 + 轴线声明 + 命名机位） |
| 5 | **光线方向/色温跳变** | 前一镜从左打光，下一镜从右；白天/夜晚色温混 | 🧪 WorkBuddy（"光位写死"）；gflow（"不同光照状态 = 不同 plate"） | **光位图 + 按时段拆分的 plate 组** |
| 6 | **焦段跳变导致人脸变形** | 特写突然变成广角脸、五官拉伸 | 📣 hxsd（正脸参考驱动时"侧面/远景匹配度约 55%"）；🔍 焦段/机位未锁定时的透视跳变 | 镜头语言表（焦段 + 机位高度 + 景别曲线）+ 每镜重挂身份参考（而不是只靠首帧） |
| 7 | **道具消失/复制/凭空多一个** | 手里多出一个杯子；卡片变成两张 | 🧪 gflow（三次尝试都长出复制品，改成离玻璃一臂远解决）；WorkBuddy（"看道具数量"列入候选验收） | hero prop sheet + **状态键控 sheet** + "用藏起道具而不是让道具消失"的调度规则 |
| 8 | **道具比例失控** | 参考图里的小物件回来变成巨物 | 🧪 gflow（"unanchored objects come back giant"） | **比例锚**（手、桌沿）+ 装配图 |
| 9 | **文字/logo 乱码与闪烁** | 招牌、T恤、包装上的字每镜都不同 | 🧪 gflow（"Whatever carries text invents text"）；WorkBuddy（画面文字零容忍） | 含文字道具的**正打字形母版 + 尽量不在画面里放文字 + 后期加字幕/贴 logo** |
| 10 | **背景/群演 pop-in、多手指** | 背景人物忽有忽无；多指 | 🧪 WorkBuddy（候选图验收清单）；🎓 VBench "Multiple Objects" 维度 | 场景 plate（覆盖所有会入画的区域）+ 候选多出图 + 人眼终选 |
| 11 | **运动崩坏/融化/闪烁** | 大动作时形体融化、纹理沸腾 | 🎓 VBench "Motion Smoothness"、"Temporal Flickering"；📣 hxsd（每镜 2–4 秒、动作幅度宁小勿大） | 运镜/动作模板（一镜一主运动）+ 短镜头 + 分镜切碎 |
| 12 | **音色漂移** | 同一角色不同镜头/不同集音色不同 | 🏢 Kling 已把"face + voice 一致性"做成产品卖点；ElevenLabs 说明 IVC 跨语音风格一致性弱 | **音色 ID 绑定 / PVC 克隆**（≈30 分钟素材） |
| 13 | **调色不统一放大不一致感** | 每镜色调略不同，整体像拼贴 | 📣 hxsd（"色调差异放大不一致感"） | 统一 LUT / 后期 grade + color script |
| 14 | **改稿溯源丢失** | 换错图、回退不了、参数记不住 | 🧪 WorkBuddy（终选图必须存 seed + 提示词；候选留档编号） | **seed 快照 + 候选归档 + 版本状态机** |
| 15 | **跨账号/跨环境资产失效** | 换账号后角色实体解析不了 | 🧪 gflow（实体是项目与账号作用域的，"moving a production between accounts means rebuilding the cast under identical names"） | 资产名册 + 可重建的命名规范（把实体当"可重建"而非"唯一真相"） |

---

## 7. 不确定性与争议（请谨慎引用）

1. **部分页面的正文未能直接抓取**：Midjourney 官方 docs、Runway 帮助中心、OpenAI 帮助中心/发布页对直连返回 403 或只返回 JS 空壳；Google Flow 支持页、Volcano Engine 文档同样是 JS 空壳。本次对其中多数改用两条**可复现**的取数路径取到正文：**Midjourney 的 Zendesk 公开 API**（`https://docs.midjourney.com/api/v2/help_center/en-us/articles/<id>.json`）与 **`r.jina.ai` 阅读代理**；URL 均为官方地址、正文已逐字核对，但正式引用前建议自行复核一次。🔍
2. **仍属第三方口径、未见官方原文的项**：即梦/Seedance 的"**12 个参考文件**"（官方 `volcengine.com/docs` 一路返回空正文，未取到原文）；Pika 的 **Pikaframes "25 秒"**（官方从未写过，已按官方数字标注为推算）。**已升级为官方口径的**：Runway Gen-4 References 的"**最多 3 张**"（官方帮助页原文）；Adobe Custom Models 的三种类型与训练数据最佳实践（官方帮助页原文）；Pika Character Studio / Video Studio 的锁定项与槽位数（2026-09 新版官方页原文）。🟠→🏢
3. **Sora 的特性页已随停服下线**：Storyboard / Remix / Re-cut / Blend / Style presets 的官方定义本次**无法取得**（旧帮助页 404），报告中一律**只以官方发布页原文为据**，并把其余部分标注为已退役工具链，不用第三方报道顶替。🏢🔍
4. **"76% 的 AI 短剧创作者把一致性列为第一大痛点"**：出自培训机构博客，**未给抽样方法**，不要当作统计数据引用。📣
5. **学术侧评测**：VBench 把"视频生成质量"拆成 16 个维度（Subject/Background Consistency、Temporal Flickering、Motion Smoothness、Dynamic Degree、Aesthetic/Imaging Quality、Object Class、Multiple Objects、Human Action、Color、Spatial Relationship、Scene、Appearance/Temporal Style、Overall Consistency），并做了人类偏好标注验证——这是"失败模式清单"最中立的骨架。🎓（[VBench](https://ar5iv.labs.arxiv.org/html/2311.17982)；续作 [VBench-2.0](https://ar5iv.labs.arxiv.org/html/2503.21755v2)；个性化图像生成的人类对齐基准 [DreamBench++ (ICLR 2025)](https://proceedings.iclr.cc/paper_files/paper/2025/hash/71ad539a57b1fd49b19e5c80070cb8b9-Abstract-Conference.html)）
6. **一个反方观点值得记录**：行业正在用"全流程工业化工具"把中间环节（拆剧本→定角色→生成→剪辑）自动化，DataEye 认为"未来行业连抽卡师可能都不需要了"。这意味着**部分元资产（如逐镜提示词模板）可能被产品吸收**，但**资产本身（脸、场景、道具、音色）仍然必须被定义一次**——只是由谁定义、以什么界面定义会变。🔍（[36氪](https://www.36kr.com/p/3759331098358277)）

---

## 8. 最小可行资产包（MVP）与执行顺序

### 8.1 单镜头短视频（半天到一天）
```
P0：① 1 张风格参考图 + 风格词
    ② 1 张首帧图（若有真人脸 → 这张脸就是你的"角色卡"）
    ③ 画幅/平台规格
    ④ 一镜一主运动的运镜描述
P1：负面清单（禁文字、禁水印、禁多余人物）
```
**可以完全省掉**：三视图、场景母版、道具表、color script、台账。**唯一别省的是**：如果你打算把同一个角色/产品复用第二次，**第一次就把它存成资产**。

### 8.2 多镜单集（2–5 天）
```
P0：角色母版 → 场景几何母版 + 反打 → hero prop sheet → 每镜首帧 → 连续性锁清单 → 统一调色
P1：光位图 → 命名机位/轴线 → 表情表 → 尾帧（需要时）→ 字幕样式
```
顺序铁律（多个来源一致）：**资产先于分镜，无图不进分镜**；分批出图、逐批确认（角色 → 场景 → 道具）。🧪

### 8.3 多集连续短剧（周更/月产）
```
P0：全量资产库 + 命名与短锚点 + 版本状态（定妆/可用/待确认/废弃）
    + 音色绑定 + 质检门禁 + seed 与参数快照 + 跨集一致性审校
P1：角色 LoRA（长期 IP）/ color script / 音乐动机 / 包装资产
P2：ControlNet 预演、3D 灰模、跨项目复用库
```

### 8.4 三条最容易执行的纪律（性价比最高）🔍
1. **母版只读**：每个角色/场景只认一张"母版"，其它图一律从它派生（i2i），不再文生图。🧪（WorkBuddy："母版图之后只读"）
2. **锚点回写**：设计文档与成品不一致时**以成品为准**，把成品里的细节回写进档案。🧪（WorkBuddy）
3. **一条提示词只改一个变量**，并保留每次的 seed 与提示词——否则你无法判断是什么起了作用，也无法回退。🧪（WorkBuddy；hxsd）

---

## 9. 主要来源清单

**传统影视前期（🟢）**
- Bible (screenwriting) — https://en.wikipedia.org/wiki/Bible_(screenwriting)
- AWN《The Pitch Bible: Just The Essentials》— https://www.awn.com/animationworld/pitch-bible-just-essentials
- befores & afters：color script / color keys in 'Scoob!' — https://beforesandafters.com/2020/05/29/unravelling-the-mystery-of-the-color-script-and-color-keys-in-scoob/
- StudioBinder：Film Lookbook — https://www.studiobinder.com/blog/film-lookbook-examples/
- Roger Deakins 论坛：show LUTs — https://www.rogerdeakins.com/forums/topic/about-show-luts-and-daily-timing/
- Kevin Shaw CSC《Show LUTs》— https://icolorist.com/wp-content/uploads/2021/10/CSC_ShowLUTs.pdf
- ACES Central — https://acescentral.com/
- Pomfort：Looks, LMTs, 3D LUT — https://pomfort.com/article/looks-lmt-and-3d-lut-transforms/

**工具官方（🏢）—— 按 2026-10 核验后的当前口径**
- Midjourney **Edit Model**（当前主力，取代 Omni/Character Reference，≤4 图）— https://docs.midjourney.com/hc/en-us/articles/48495453462797-Edit-Model
- Midjourney Version（V8.2 为默认）— https://docs.midjourney.com/hc/en-us/articles/32199405667853-Version
- Midjourney Style Reference（`--sref/--sw`）— https://docs.midjourney.com/hc/en-us/articles/32180011136653-Style-Reference
- Midjourney Stylize（`--s` 0–1000）— https://docs.midjourney.com/hc/en-us/articles/32196176868109-Stylize
- Midjourney Seeds（官方明说 seed 不能锁风格/角色/外观）— https://docs.midjourney.com/hc/en-us/articles/32604356340877-Seeds
- Midjourney Legacy Features（`--cref/--cw`、`--oref/--ow`、Style Tuner 已列此）— https://docs.midjourney.com/hc/en-us/articles/33329788681101-Legacy-Features
- Midjourney Character References（V6 时代公告）— https://updates.midjourney.com/character-refs/
- Midjourney Omni-Reference `--oref`（V7 时代公告）— https://updates.midjourney.com/omni-reference-oref/
- Midjourney Style references for V7 — https://updates.midjourney.com/style-references-for-v7/
- Google：Veo 3.1 in Gemini API（Ingredients to video / first-last frame / scene extension）— https://developers.googleblog.com/en/introducing-veo-3-1-and-new-creative-capabilities-in-the-gemini-api/
- Gemini API：Veo 文档（≤3 参考图；用参考图/1080p/4k 时必须 8 秒）— https://ai.google.dev/gemini-api/docs/veo
- Gemini API：图像生成文档（Nano Banana 系列分类型限额）— https://ai.google.dev/gemini-api/docs/image-generation
- Google Flow 帮助：Ingredients / Characters / Frames / `@Voice` — https://support.google.com/flow/answer/16353334
- Kling Element Library User Guide（3.0）— https://kling.ai/quickstart/klingai-element-library-3-user-guide
- Kling Element API（元素 schema 与硬限制）— https://kling.ai/document-api/api/video/3-0-omni/elements.md
- Kling VIDEO 3.0 能力对比表（首帧+元素绑定、多角色共指为 3.0 新增）— https://kling.ai/quickstart/klingai-video-3-model-user-guide
- **Kling 4.0 vs 3.0 官方对照表（15 组合资产 / 10 关键帧 / 3–30s）** — https://kling.ai/blog/kling-4-vs-3
- Kling 4.0 发布博文（Omni Reference 的跨镜头表述）— https://kling.ai/blog/kling-4-ai-video-model
- Kling 多关键帧指南 — https://kling.ai/blog/kling-4-multiple-keyframes-guide
- MiniMax Subject-Reference to Video（S2V-01）— https://platform.minimax.io/docs/api-reference/video-generation-s2v
- Runway：Creating with Gen-4 **Image** References（≤3 张）— https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References
- Runway：Performance Capture with Act-Two（锁表演，≤30s/24fps/5 credits 每秒）— https://help.runwayml.com/hc/en-us/articles/42311337895827-Performance-Capture-with-Act-Two
- Runway 官方研究页（Gen-4 / Gen-4.5）— https://runwayml.com/research/introducing-runway-gen-4 ｜ https://runwayml.com/research/introducing-runway-gen-4.5
- **Pika Character Studio**（单图锁脸+头发+服装，产出角色卡）— https://create.pika.art/apps/character-studio
- **Pika Video Studio**（50 个可 `@` 槽 + 30 秒多镜头）— https://create.pika.art/apps/video-studio
- Pika Pikaframes（2–5 有序关键帧）— https://create.pika.art/apps/pikaframes
- Pika 新版公告（不再按档位封禁功能）— https://pika.art/blog/welcome-to-the-new-pika
- Pika 定价（Free/Starter 无商用许可）— https://pika.art/pricing
- Luma Ray3.14 说明（**References (Character) 不支持**）— https://lumalabs.ai/news/ray3_14
- Luma Ray3 Modify（Character Reference 的时代归属）— https://lumalabs.ai/news/ray3-modify
- Luma Ray3.2（16 关键帧 / 20s@1080p）— https://lumalabs.ai/news/introducing-ray-3-2
- Luma 定价 / 官方 LLM 信息页 — https://lumalabs.ai/pricing ｜ https://lumalabs.ai/llm-info
- **OpenAI Sora 2 官方发布页（characters 机制、多镜头 + world state 原话）** — https://openai.com/index/sora-2/
- **OpenAI 官方停服说明（Web/App 2026-04-26、API 2026-09-24）** — https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation
- Sora cameo（早期二手侧证，ITmedia）— https://www.itmedia.co.jp/aiplus/article/2510/31/1251031084/
- The Verge：Sora reusable characters + stitching — https://www.theverge.com/news/809877/openai-sora-app-character-cameo-updates
- ElevenLabs Voice Cloning（IVC vs PVC，PVC ≈30 分钟素材）— https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning.md
- Nano Banana Pro（官方 API 文档经 Simon Willison 引述，含 14 图上限）— https://simonwillison.net/2025/Nov/20/nano-banana-pro/
- Adobe Firefly Custom Models（Character / Illustration / Photographic 三类）— https://helpx.adobe.com/firefly/web/custom-models/get-started-with-custom-models/custom-models-overview.html

**中文产业与工作流实践（🏢🧪📣）**
- 腾讯云山海 AI 短剧 Harness 体系（资产层、版本状态、生产量级）— https://cloud.tencent.com.cn/developer/article/2694951
- 36氪/DataEye：AI 短剧一致性与抽卡师 — https://www.36kr.com/p/3759331098358277
- WorkBuddy：母版图 → 换装 → 一致（角色资产工作流）— https://cloud.tencent.cn/developer/article/2754190
- zenstory drama-skills：跨镜/跨集角色一致性（身份/变体/连续性锁）— https://github.com/zenstory-ai/drama-skills/blob/main/docs/character-consistency-across-shots.md
- manju-laoli-skill：Asset-First 六阶段管线 — https://raw.githubusercontent.com/lixiaoxiao9888-create/manju-laoli-skill/main/short-drama-director/references/asset-first-pipeline.md
- gflow-cli consistency（Flow 一致性方法与实测）— https://github.com/ffroliva/gflow-cli/blob/develop/skills/video-production/consistency.md
- seedance-2.0 first/last frame guide — https://raw.githubusercontent.com/Emily2040/seedance-2.0/main/references/first-last-frame-guide.md
- 平台适配指南（可灵/海螺/即梦/万相/Sora/Runway/Veo/Pika 参数）— https://raw.githubusercontent.com/luozhilzh/video-prompt-reverse/main/references/platform-guides.md
- 火星时代（培训机构博客，仅作线索）— https://www.hxsd.com/content/59418/ ｜ https://www.hxsd.com/content/59487/ ｜ https://www.hxsd.com/content/59553/

**学术（🎓）**
- VBench — https://ar5iv.labs.arxiv.org/html/2311.17982
- VBench-2.0 — https://ar5iv.labs.arxiv.org/html/2503.21755v2
- DreamBench++ (ICLR 2025) — https://proceedings.iclr.cc/paper_files/paper/2025/hash/71ad539a57b1fd49b19e5c80070cb8b9-Abstract-Conference.html

---

### 附：如果只能记一句话
**「角色卡锁身份；场景母版锁空间；光位与 LUT 锁影调；首帧锁这一镜的一切；台账锁团队记忆。」** —— 其中第 2、3、5 项是最常被漏掉、也最贵的三项。
