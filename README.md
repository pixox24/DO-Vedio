# DO·Vedio — AI 视频文案工坊

输入视频标题、内容概要和目标时长，选择一种解说风格，由大模型自动生成**带分段时间轴**的 B站/西瓜视频口播文案。

## 功能

- **按时长控字数**：舒缓 / 适中 / 紧凑三档语速（200 / 250 / 300 字每分钟）。时间轴按实际字数计算，不采用模型自己估的时长
- **概要可留空**：AI 按所选风格的「选题偏好」构思 3 个切入角度（含开场钩子、要点、内容性质），选中后自动写入概要；支持「换一批」。概要为空时点「一键成稿」，会自动采用第一个角度
- **防编造**：每个角度标注「真实科普 / 观点评论 / 虚构故事」，写稿时按性质约束；全局要求不编造具体数据、人名和出处
- **两步生成**：先生成大纲，可增删章节、调整每章时长；再逐章流式写稿，章与章之间自动衔接
- **8 种内置风格**：严肃权威、幽默风趣、犀利吐槽、悬疑叙事、知识科普、温情治愈、热血激昂、纪录片旁白
- **自定义风格**：可以手动创建（含选题偏好）；也可以粘贴自己以前的文案，让 AI 提炼出风格模板和选题习惯
- **分段改写**：扩写、缩写、更口语化、换风格、自定义要求、校准到目标字数，每段都能撤销一次
- **时长校准**：总时长偏差超过 ±15% 时给出提示，一键把偏差大的段落改写到目标长度
- **发布素材**：生成 3 个备选标题、带章节时间戳的简介和 10 个标签
- 稿件自动保存在浏览器中，刷新页面不会丢失；支持复制全文和导出 Markdown

## 快速开始

需要 Node.js 22 或更高版本。

```bash
npm install
cp .env.local.example .env.local   # 至少填一个 API Key
npm run dev                        # http://localhost:3000
```

内网部署：

```bash
npm run build
npm start -- -H 0.0.0.0 -p 3000
```

## 模型配置

在 `.env.local` 中配置 Key。**只有配置了 Key 的模型才会出现在页面上**。

| 服务商 | Key | 默认模型 | 覆盖模型名 |
|---|---|---|---|
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat | `DEEPSEEK_MODEL` |
| 通义千问 | `DASHSCOPE_API_KEY` | qwen-plus | `QWEN_MODEL` |
| Kimi | `MOONSHOT_API_KEY` | kimi-latest | `KIMI_MODEL` |
| 豆包 | `ARK_API_KEY` | doubao-seed-1-6-250615 | `DOUBAO_MODEL` |
| OpenAI | `OPENAI_API_KEY` | gpt-5 | `OPENAI_MODEL` |
| Claude | `ANTHROPIC_API_KEY` | claude-opus-5 | `ANTHROPIC_MODEL` |

每个服务商的接口地址都可以用 `<ID>_BASE_URL` 覆盖（例如 `DEEPSEEK_BASE_URL`），用于接入代理或私有部署。Claude 默认开启服务端 `fallbacks: "default"`：请求被安全分类器拦截时，会自动改用推荐的后备模型重试。

## 目录

```
app/
  page.tsx                 创作页
  templates/page.tsx       风格模板管理
  api/                     angles · outline · section · rewrite · metadata · templates · models
components/                表单、大纲编辑、文案视图、发布素材
lib/
  llm.ts                   多模型接入（Vercel AI SDK）
  prompts.ts               各环节提示词
  duration.ts              字数/时长换算与时间轴（附单元测试）
  templates/               内置模板与自定义模板存储（data/templates.json）
```

## 测试

```bash
npm test
```
