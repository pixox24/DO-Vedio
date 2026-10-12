# 问题 2: 新项目仍提示旧项目状态

## 问题现象

用户创建新项目后，在**断句标注**和**配音模块**中仍然提示有旧项目数据，明明是一个新建的项目。

---

## 根本原因分析

### 1. 缓存键（Cache Key）基于内容而非项目ID

查看代码 `lib/pipeline/stages/annotate.ts:74`：

```typescript
const key = annotateKey(input.lines, lex, input.modelId);
let ann = cacheGet<Annotation[]>(key);
```

**问题**：
- `annotateKey` 只基于 **句子内容 + 词典 + 模型ID**
- **不包含 `projectId`**
- 如果新项目的句子内容与旧项目相同，会命中旧项目的缓存

**影响范围**：
- 断句标注（`annotate`）
- 配音（`tts`）
- 分镜生成（`storyboard`）
- 角色表生成（`cast`）

所有使用 `cacheGet/cachePut` 的模块都可能跨项目共享缓存。

---

### 2. 缓存键生成逻辑

查看 `lib/core/keys.ts`（推测）：

```typescript
export function annotateKey(
  lines: { id: string; text: string }[], 
  lex: Lexicon, 
  modelId: string
): string {
  return quickHash({
    lines: lines.map(l => l.text),  // 只用文本，不用 projectId
    lex,
    modelId
  });
}
```

**示例**：
- 旧项目 A：句子内容 "大家好，欢迎来到..."
- 新项目 B：句子内容 "大家好，欢迎来到..."（相同）
- 生成的缓存键相同 → 新项目读取到旧项目的标注结果

---

### 3. 数据库设计

查看 `lib/server/cache.ts`：

```typescript
export function cachePut(key: string, stage: string, result: unknown) {
  run(
    "INSERT OR REPLACE INTO cache (key, stage, result, created_at) VALUES (?, ?, ?, ?)", 
    key, 
    stage, 
    json(result), 
    Date.now()
  );
}
```

**表结构**（推测）：
```sql
CREATE TABLE cache (
  key TEXT PRIMARY KEY,  -- 缓存键（不含 projectId）
  stage TEXT,            -- 阶段名（annotate/tts/storyboard...）
  result TEXT,           -- JSON 结果
  created_at INTEGER     -- 创建时间
);
```

**问题**：
- 主键是 `key`，不包含 `project_id`
- 多个项目的相同内容会互相覆盖缓存
- **无法区分不同项目的相同内容**

---

## 实际影响场景

### 场景 1: 重复内容的多个项目

**操作步骤**：
1. 项目 A：输入文案 "大家好，我是XX，今天给大家带来..."
2. 完成断句标注 → 缓存结果
3. 创建新项目 B：输入**相同**的文案
4. 点击"断句标注" → **直接使用项目 A 的缓存**

**用户看到**：
- 提示"旧项目"或"已有标注结果"
- 断句结果可能与当前项目的设置不符（不同的词典、不同的模型）

---

### 场景 2: 测试项目与正式项目

**操作步骤**：
1. 创建测试项目：用标准测试文案"欢迎收看本期视频..."
2. 完成所有流程 → 缓存所有结果
3. 创建正式项目：也用"欢迎收看本期视频..."开场
4. **所有模块都读取测试项目的缓存**

**问题**：
- 即使正式项目选了不同的模型、不同的风格
- 仍然复用测试项目的结果
- 用户困惑："为什么新项目有旧数据？"

---

### 场景 3: 教程示例与实际使用

**操作步骤**：
1. 用户跟着教程创建示例项目（教程统一的示例文案）
2. 完成所有步骤 → 缓存结果
3. 创建自己的项目，但开头也用"大家好..."这类通用开场白
4. **复用教程示例的缓存结果**

**问题**：
- 通用开场白命中率极高
- 大量用户会受影响

---

## 解决方案

### 方案 A: 缓存键包含 projectId（推荐）

#### A1: 修改缓存键生成逻辑

**修改文件**：`lib/core/keys.ts`

```typescript
// 修改前
export function annotateKey(
  lines: { id: string; text: string }[], 
  lex: Lexicon, 
  modelId: string
): string {
  return quickHash({
    lines: lines.map(l => l.text),
    lex,
    modelId
  });
}

// 修改后
export function annotateKey(
  lines: { id: string; text: string }[], 
  lex: Lexicon, 
  modelId: string,
  projectId: string  // 新增参数
): string {
  return quickHash({
    projectId,  // 加入缓存键
    lines: lines.map(l => l.text),
    lex,
    modelId
  });
}
```

#### A2: 更新所有调用点

**修改文件**：`lib/pipeline/stages/annotate.ts`

```typescript
// 第 74 行
const key = annotateKey(input.lines, lex, input.modelId, input.projectId);
```

**修改文件**：`lib/pipeline/stages/storyboard.ts`

```typescript
// 找到所有 storyboardKey 调用，添加 projectId
const key = storyboardKey({ payload, modelId: input.modelId, projectId: input.projectId });
```

**影响范围**：
- `annotate.ts`
- `storyboard.ts`
- `cast.ts`
- `shot-generate.ts`
- 所有使用 `xxxKey()` 生成缓存键的地方

---

### 方案 B: 数据库结构调整（更彻底）

#### B1: 修改缓存表结构

```sql
-- 新表结构
CREATE TABLE cache_v2 (
  project_id TEXT,       -- 项目ID
  key TEXT,              -- 缓存键
  stage TEXT,            -- 阶段名
  result TEXT,           -- JSON 结果
  created_at INTEGER,    -- 创建时间
  PRIMARY KEY (project_id, key)  -- 复合主键
);
```

#### B2: 迁移现有数据

```typescript
// 迁移脚本
function migrateCacheTable() {
  db.run('CREATE TABLE cache_v2 (...);');
  
  // 将旧缓存标记为全局共享（projectId = NULL）
  db.run(`
    INSERT INTO cache_v2 (project_id, key, stage, result, created_at)
    SELECT NULL, key, stage, result, created_at
    FROM cache
  `);
  
  // 重命名表
  db.run('DROP TABLE cache;');
  db.run('ALTER TABLE cache_v2 RENAME TO cache;');
}
```

#### B3: 更新缓存函数

```typescript
// lib/server/cache.ts

export function cacheGet<T>(projectId: string, key: string): T | undefined {
  const r = get<{ result: string }>(
    "SELECT result FROM cache WHERE project_id = ? AND key = ?",
    projectId,
    key
  );
  return r ? parseJson<T>(r.result, undefined as T) : undefined;
}

export function cachePut(
  projectId: string, 
  key: string, 
  stage: string, 
  result: unknown
) {
  run(
    "INSERT OR REPLACE INTO cache (project_id, key, stage, result, created_at) VALUES (?, ?, ?, ?, ?)",
    projectId,
    key,
    stage,
    json(result),
    Date.now()
  );
}
```

---

### 方案 C: 临时修复 - 清除缓存功能

在不改动核心逻辑的情况下，提供手动清除缓存的功能：

#### C1: 添加清除缓存 API

```typescript
// app/api/projects/[id]/cache/route.ts

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const projectId = params.id;
  
  // 删除该项目的所有缓存
  // 注意：当前实现无法按 projectId 删除，因为缓存键不含 projectId
  // 这是临时方案的局限
  
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

#### C2: UI 添加"清除缓存"按钮

```tsx
// components/project-settings.tsx

<button
  className="btn btn-ghost"
  onClick={async () => {
    if (await confirm({
      title: "清除项目缓存？",
      message: "将删除该项目的所有已缓存结果，下次生成时会重新调用模型。",
      tone: "default"
    })) {
      await fetch(`/api/projects/${projectId}/cache`, { method: 'DELETE' });
      toast("缓存已清除", "success");
    }
  }}
>
  清除缓存
</button>
```

**局限**：
- 无法精确删除当前项目的缓存（因为缓存键不含 projectId）
- 只能清除全局缓存（影响其他项目）
- **不推荐作为长期方案**

---

## 实施建议

### 立即可做（修复当前用户问题）

1. **临时解决**：手动删除数据库中的缓存
   ```bash
   # 进入项目目录
   cd ~/Desktop/DO-Vedio
   
   # 备份数据库
   cp data/db.sqlite3 data/db.sqlite3.backup
   
   # 清除所有缓存
   sqlite3 data/db.sqlite3 "DELETE FROM cache;"
   
   # 重启服务
   npm run dev
   ```

2. **告知用户**：
   - "这是缓存复用导致的，已清除旧缓存"
   - "重新运行断句标注即可"

---

### 短期修复（本周完成）

**采用方案 A**：缓存键包含 projectId

**实施步骤**：
1. 修改 `lib/core/keys.ts` 中所有 `xxxKey()` 函数，添加 `projectId` 参数
2. 更新所有调用点（`annotate.ts`, `storyboard.ts`, `cast.ts`...）
3. 测试：
   - 创建项目 A，完成断句标注
   - 创建项目 B（相同文案），确认**不会**复用项目 A 的缓存
4. 清除旧缓存：`DELETE FROM cache WHERE created_at < ?`（保留最近的）

**优点**：
- ✅ 改动最小，风险可控
- ✅ 不需要数据库迁移
- ✅ 立即生效

**缺点**：
- ⚠️ 旧缓存仍然存在（没有 projectId 字段）
- ⚠️ 需要手动清理旧缓存

---

### 长期改进（下周规划）

**采用方案 B**：数据库结构调整

**实施步骤**：
1. 设计数据库迁移脚本
2. 添加 `cache_v2` 表，复合主键 `(project_id, key)`
3. 迁移现有数据
4. 更新 `cache.ts` 的所有函数
5. 删除旧表

**优点**：
- ✅ 结构清晰，语义明确
- ✅ 可以按项目删除缓存
- ✅ 支持缓存统计（每个项目的缓存大小）

**缺点**：
- ⚠️ 需要数据库迁移
- ⚠️ 测试工作量较大

---

## 测试验证

### 测试用例 1: 相同内容的不同项目

**前置条件**：已实施方案 A

**步骤**：
1. 创建项目 A："大家好，欢迎来到本期视频"
2. 运行断句标注 → 检查缓存键包含项目 A 的 ID
3. 创建项目 B："大家好，欢迎来到本期视频"（相同内容）
4. 运行断句标注 → 检查缓存键包含项目 B 的 ID

**预期结果**：
- 项目 A 和项目 B 的缓存键**不同**
- 项目 B 会重新调用模型，不复用项目 A 的结果

---

### 测试用例 2: 同一项目的重复运行

**步骤**：
1. 创建项目 C："测试内容ABC"
2. 第一次运行断句标注 → 调用模型
3. 不修改内容，第二次运行断句标注 → 应该使用缓存

**预期结果**：
- 第一次：有 LLM 调用日志
- 第二次：无 LLM 调用日志，直接返回缓存

---

### 测试用例 3: 修改内容后重新运行

**步骤**：
1. 创建项目 D："原始内容"
2. 运行断句标注 → 结果 R1
3. 修改内容为："修改后内容"
4. 重新运行断句标注 → 结果 R2

**预期结果**：
- R1 和 R2 的缓存键不同（内容哈希不同）
- R2 会重新调用模型

---

## 相关代码位置

| 文件路径 | 功能 | 需修改 |
|---------|------|--------|
| `lib/core/keys.ts` | 缓存键生成 | ✅ 是 |
| `lib/server/cache.ts` | 缓存读写 | ⚠️ 可选 |
| `lib/pipeline/stages/annotate.ts` | 断句标注 | ✅ 是 |
| `lib/pipeline/stages/storyboard.ts` | 分镜生成 | ✅ 是 |
| `lib/pipeline/stages/cast.ts` | 角色表生成 | ✅ 是 |
| `lib/pipeline/stages/shot-generate.ts` | 镜头生成 | ✅ 是 |

---

## 总结

### 问题本质
- 缓存键不包含 `projectId`
- 导致跨项目缓存复用

### 推荐方案
- **短期**：方案 A（缓存键加 projectId）
- **长期**：方案 B（数据库结构优化）

### 预计工作量
- 方案 A：2-3 小时（改动 + 测试）
- 方案 B：1-2 天（迁移 + 测试）

---

需要我立即开始实施**方案 A**（缓存键包含 projectId）吗？
