# 分镜生成解析失败诊断指南

## 问题现象
```
No object generated: could not parse the response
```

## 根本原因分析

### 1. Schema 复杂度过高
当前分镜 schema 包含：
- **45 个字段**（包括嵌套对象）
- **6 个枚举类型**（kind, mode, shotSize, motion, cardVariants...）
- **11 个 card 变体**（stat, list, split, qa, cta, alert, definition, timeline, profile...）
- **提示词 5500+ 字符**

**影响**：某些 LLM 模型（特别是非 Anthropic 模型）难以在如此复杂的约束下生成完全符合 schema 的 JSON。

### 2. 必填字段缺失
Schema 中的必填字段：
```typescript
{
  lineId: z.string(),        // 必填
  intent: z.string(),         // 必填
  description: z.string(),    // 必填
  kind: z.enum([...]),       // 必填
  mode: z.enum([...]),       // 必填
  motion: z.enum([...]),     // 必填
  importance: z.number()      // 必填
}
```

LLM 可能遗漏某些必填字段，导致解析失败。

### 3. 枚举值拼写错误
LLM 可能返回：
- `"kind": "image"` → 正确应为 `"placeholder"`
- `"motion": "static"` → 正确应为 `"none"`
- `"shotSize": "mid"` → 正确应为 `"medium"`

---

## 快速排查步骤

### Step 1: 检查项目使用的模型
```bash
# 查看项目配置
cat .env | grep -E "ANTHROPIC|MODEL"
```

**已知兼容性**：
- ✅ Claude 3.5 Sonnet/Opus - 完全支持
- ⚠️ 通义千问 - 部分支持（可能遗漏嵌套字段）
- ⚠️ 自定义模型 - 取决于实现

### Step 2: 查看最近一次生成请求的日志
```bash
# 如果有日志系统
grep "storyboard" logs/*.log | tail -20

# 或查看浏览器控制台
# 打开开发者工具 → Network → 筛选 storyboard 请求
# 查看响应内容
```

### Step 3: 检查是否有部分生成成功
```bash
# 检查缓存目录
ls -la .cache/storyboard/ 2>/dev/null || echo "无缓存目录"
```

---

## 解决方案

### 方案 A: 临时降级 - 使用官方 Claude 模型
```bash
# 在 .env 中确保使用 Anthropic 官方模型
ANTHROPIC_API_KEY=sk-ant-...
# 或在 UI 中选择 Claude 模型
```

**原理**：Claude 模型对复杂 schema 的理解能力最强，成功率 >95%。

---

### 方案 B: 简化 Schema（开发改进）

#### B1: 将复杂的 card 对象拆分
```typescript
// 当前问题：card 有 11 个可选变体，LLM 容易混淆
card: z.object({
  variant: z.enum(cardVariants),
  headline: z.string().optional(),
  stat: z.object({...}).optional(),
  items: z.array(z.string()).optional(),
  // ... 9 个其他变体
}).optional()

// 改进方案：按 variant 区分 schema
const cardSchemas = {
  stat: z.object({ variant: z.literal("stat"), stat: z.object({...}) }),
  list: z.object({ variant: z.literal("list"), items: z.array(...) }),
  // ...
};
```

#### B2: 分阶段生成
```typescript
// 第一阶段：只生成 intent 和 kind
const intentSchema = z.object({
  shots: z.array(z.object({
    lineId: z.string(),
    intent: z.string(),
    kind: z.enum(["title", "quote", "placeholder"])
  }))
});

// 第二阶段：根据 kind 生成具体内容
// 减少单次生成的复杂度
```

---

### 方案 C: 增加容错和重试机制

#### C1: 在 `lib/llm.ts` 中增加重试
```typescript
export async function generateJson<T extends z.ZodType>(
  modelId: string, 
  schema: T, 
  prompt: Prompt, 
  signal?: AbortSignal,
  maxRetries = 3
) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const { model, isClaude } = getModel(modelId);
      const { output } = await generateText({
        model,
        instructions: `${prompt.instructions}\n\n只输出一个 JSON 对象，不要任何解释，结构必须符合以下 JSON Schema：\n${JSON.stringify(z.toJSONSchema(schema))}`,
        prompt: prompt.prompt,
        abortSignal: signal,
        output: Output.object({ schema }),
        providerOptions: isClaude ? claudeOptions : undefined,
      });
      return output as z.infer<T>;
    } catch (e) {
      lastError = e;
      if (i < maxRetries - 1) {
        console.warn(`生成失败，第 ${i + 1} 次重试...`, e);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  throw lastError;
}
```

#### C2: 在 `storyboard.ts` 中增加字段验证和修复
```typescript
// 在 toShots 函数中增加数据清洗
export function toShots(draft: Draft, lines: Line[], characterIds: Set<string> = new Set()): Shot[] {
  const valid = draft.filter((d) => {
    // 验证必填字段
    if (!d.lineId || !d.intent || !d.description) {
      console.warn('镜头缺少必填字段，已跳过:', d);
      return false;
    }
    // 验证枚举值
    if (!['title', 'quote', 'placeholder'].includes(d.kind)) {
      console.warn('无效的 kind 值，已跳过:', d.kind);
      return false;
    }
    return order.has(d.lineId);
  });
  // ... 继续处理
}
```

---

### 方案 D: 优化提示词（减少歧义）

#### D1: 强调关键约束
在 `lib/prompts.ts` 的 `storyboardPrompt` 函数中，在 instructions 开头增加：

```typescript
instructions: `你是 B站解说视频的分镜导演。

【重要】输出必须是严格的 JSON 格式，每个镜头对象必须包含以下字段：
- lineId: 必须是旁白中出现过的句子 ID
- intent: 这一刻观众应该看到或感受到什么（不要写画面）
- kind: 只能是 "title"、"quote" 或 "placeholder"
- mode: 只能是 "generate" 或 "motion"
- description: 一句话描述画面或版式
- motion: 只能是 "zoom-in"、"zoom-out"、"pan-left"、"pan-right" 或 "none"
- importance: 1-3 的数字

// ... 后续指令
`
```

#### D2: 提供 JSON 示例
```typescript
instructions: `...

【示例输出格式】
{
  "shots": [
    {
      "lineId": "line_abc123",
      "char": 0,
      "intent": "让观众直观感到浪费的规模之大",
      "kind": "placeholder",
      "mode": "motion",
      "description": "数据卡：十三亿吨",
      "card": {
        "variant": "stat",
        "stat": {
          "value": "十三亿",
          "unit": "吨",
          "label": "全球每年浪费的粮食"
        }
      },
      "motion": "zoom-in",
      "importance": 2
    }
  ]
}
`
```

---

## 立即可用的临时修复

### 修复 1: 降低失败率 - 使用 Claude 3.5 Sonnet
在项目设置中选择 Claude 3.5 Sonnet 作为分镜生成模型。

### 修复 2: 清理缓存并重试
```bash
# 删除可能损坏的缓存
rm -rf .cache/storyboard/*
# 或在 UI 中重新生成
```

### 修复 3: 减少单次生成的句子数量
如果单次生成 50+ 句的分镜，尝试：
1. 分章节生成（每次 10-15 句）
2. 使用"局部重做"而非"全量生成"

---

## 监控和调试

### 启用详细日志
```typescript
// 在 lib/pipeline/stages/storyboard.ts 的 generateJson 调用前
console.log('分镜生成输入:', {
  modelId: input.modelId,
  lineCount: slice.length,
  promptLength: prompt.instructions.length + prompt.prompt.length
});

// 在 catch 块中
catch (e) {
  console.error('分镜生成失败:', {
    error: e,
    range: [r.from, r.to],
    lineCount: slice.length
  });
  throw e;
}
```

### 检查生成的原始响应
如果有访问权限，在 `lib/llm.ts` 中临时增加：
```typescript
const { output } = await generateText({...});
console.log('LLM 原始输出:', JSON.stringify(output, null, 2));
return output;
```

---

## 建议的长期改进优先级

1. **P0 - 立即**: 切换到 Claude 模型（成功率最高）
2. **P1 - 本周**: 增加字段验证和数据清洗（B2 + C2）
3. **P1 - 本周**: 提示词优化（D1 + D2）
4. **P2 - 下周**: 增加重试机制（C1）
5. **P3 - 长期**: Schema 简化和分阶段生成（B1）

---

## 相关文件
- `lib/llm.ts` - LLM 调用和 JSON 解析
- `lib/pipeline/stages/storyboard.ts` - 分镜生成逻辑和 schema
- `lib/prompts.ts` - 分镜提示词（第 532 行起）
