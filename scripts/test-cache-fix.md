# 缓存键修复测试验证

## 已完成的修改

### ✅ 修改的文件
1. `lib/core/keys.ts` - 缓存键生成函数
   - `annotateKey()` - 添加 `projectId` 参数
   - `storyboardKey()` - 添加 `projectId` 参数
   - `castKey()` - 添加 `projectId` 参数
   - `musicKey()` - 添加 `projectId` 参数

2. `lib/pipeline/stages/annotate.ts` - 断句标注调用点
   - 第 74 行：传入 `input.projectId`

3. `lib/pipeline/stages/storyboard.ts` - 分镜生成调用点
   - 第 204 行：传入 `input.projectId`

4. `lib/pipeline/stages/cast.ts` - 角色表生成调用点
   - 第 37 行：传入 `input.projectId`

5. `lib/pipeline/plan.ts` - 编排层调用点
   - 第 54 行：传入 `projectId`
   - 第 82 行：传入 `projectId`

### ✅ 验证结果
- TypeScript 类型检查：通过 ✅
- 单元测试（12/12）：通过 ✅

---

## 手动测试步骤

### 测试 1: 相同内容的不同项目不会共享缓存

**目标**：验证新项目不会复用旧项目的缓存结果

**步骤**：
1. 创建项目 A
2. 输入测试文案："大家好，欢迎来到本期视频，今天给大家分享一个有趣的话题。"
3. 点击"断句标注" → 等待完成
4. 检查浏览器控制台/网络请求，确认有 LLM 调用
5. 创建新项目 B
6. 输入**相同**的测试文案："大家好，欢迎来到本期视频，今天给大家分享一个有趣的话题。"
7. 点击"断句标注" → 等待完成
8. 检查浏览器控制台/网络请求

**预期结果**：
- ✅ 项目 B 应该**重新调用 LLM**（有新的网络请求）
- ✅ 项目 B 的标注结果应该与项目 A **独立存储**
- ✅ 不应该出现"旧项目"提示

**如何检查**：
```bash
# 查看数据库中的缓存键
sqlite3 data/db.sqlite3 "SELECT key, stage, created_at FROM cache ORDER BY created_at DESC LIMIT 5;"

# 应该看到两个不同的缓存键（因为包含了不同的 projectId）
```

---

### 测试 2: 同一项目重复运行仍使用缓存

**目标**：验证缓存机制仍然正常工作

**步骤**：
1. 使用测试 1 中的项目 A
2. 不修改文案，再次点击"断句标注"
3. 检查网络请求

**预期结果**：
- ✅ 应该**直接使用缓存**（没有新的 LLM 调用）
- ✅ 瞬间完成（<100ms）

---

### 测试 3: 修改内容后缓存失效

**目标**：验证内容变化后缓存正确失效

**步骤**：
1. 使用测试 1 中的项目 A
2. 修改文案为："大家好，欢迎来到本期视频，今天给大家分享另一个有趣的话题。"
3. 点击"断句标注"

**预期结果**：
- ✅ 应该**重新调用 LLM**（因为内容哈希变了）
- ✅ 生成新的缓存条目

---

### 测试 4: 分镜生成跨项目隔离

**目标**：验证分镜生成也不会跨项目共享缓存

**步骤**：
1. 使用测试 1 中的项目 A
2. 完成断句标注和配音
3. 点击"生成分镜" → 等待完成
4. 创建新项目 C，使用**相同文案**
5. 完成断句标注和配音
6. 点击"生成分镜"

**预期结果**：
- ✅ 项目 C 应该**重新生成分镜**（不复用项目 A 的结果）
- ✅ 不应该出现"旧项目分镜"提示

---

### 测试 5: 配音模块跨项目隔离

**注意**：配音模块的缓存键 **不包含 projectId**，这是有意设计

**原因**：
- 配音缓存基于 `朗读文本 + 音色参数`
- 相同的朗读文本 + 相同的音色 = 相同的音频
- 跨项目复用配音结果可以**节省成本**
- 这是**正确的行为**，不需要修改

**示例**：
- 项目 A："欢迎收看" + 音色 X → 音频 a.mp3
- 项目 B："欢迎收看" + 音色 X → 复用音频 a.mp3 ✅

如果要修改这个行为（让配音也按项目隔离），需要修改：
```typescript
// lib/core/keys.ts
export function ttsKey(spoken: string, v: VoiceSettings, textType?: "PlainText" | "SSML", projectId?: string) {
  return `tts:${quickHash({
    v: STAGE_VERSION.tts + (v.provider === "google-gemini" ? 1 : 0),
    projectId, // 可选：添加项目隔离
    s: spoken,
    ...(textType === "SSML" ? { textType } : {}),
    ...voiceFields(v, textType),
  })}`;
}
```

---

## 数据库验证

### 查看缓存键结构

```bash
# 查看最近的缓存条目
sqlite3 data/db.sqlite3 << EOF
SELECT 
  substr(key, 1, 40) as key_prefix,
  stage,
  length(result) as result_size,
  datetime(created_at/1000, 'unixepoch', 'localtime') as created
FROM cache 
ORDER BY created_at DESC 
LIMIT 10;
EOF
```

### 清除旧缓存（可选）

如果需要清除修复前的旧缓存：

```bash
# 备份数据库
cp data/db.sqlite3 data/db.sqlite3.backup

# 清除所有缓存（慎重！）
sqlite3 data/db.sqlite3 "DELETE FROM cache;"

# 或者只清除特定阶段的缓存
sqlite3 data/db.sqlite3 "DELETE FROM cache WHERE stage = 'annotate';"
sqlite3 data/db.sqlite3 "DELETE FROM cache WHERE stage = 'storyboard';"
```

---

## 性能影响分析

### 修改前
- 缓存键：`quickHash({ v, content, modelId })`
- 相同内容跨项目共享缓存 ✅（节省成本）
- 新项目看到旧项目数据 ❌（混淆用户）

### 修改后
- 缓存键：`quickHash({ v, projectId, content, modelId })`
- 每个项目独立缓存 ✅（符合预期）
- 相同内容的多个项目会重复调用 LLM ⚠️（成本略增）

### 成本估算

**场景**：创建 10 个教程示例项目，每个项目使用相同的示例文案（100 句）

| 阶段 | 修改前成本 | 修改后成本 | 增加 |
|------|-----------|-----------|------|
| 断句标注 | 1 次调用 | 10 次调用 | +900% |
| 分镜生成 | 1 次调用 | 10 次调用 | +900% |
| 角色表 | 1 次调用 | 10 次调用 | +900% |

**但是**：
- 这是**预期行为**，因为每个项目应该有独立的结果
- 真实使用中，用户很少创建完全相同内容的多个项目
- 对于测试/教程场景，可以使用"复制项目"功能（复制结果，不重新生成）

---

## 回归风险

### 低风险
- ✅ 类型安全：TypeScript 编译通过
- ✅ 单元测试：所有测试通过
- ✅ 向后兼容：旧缓存自然失效（因为键格式变了）

### 需要关注
- ⚠️ 性能：首次生成时间可能略长（因为不能复用其他项目的缓存）
- ⚠️ 成本：重复内容的多个项目会重复计费

### 缓解措施
1. **复制项目功能**：推荐用户使用"复制项目"而非重新创建
2. **缓存监控**：可添加缓存命中率监控
3. **文档说明**：在用户手册中说明缓存策略

---

## 总结

### ✅ 已解决的问题
1. 新项目不再显示"旧项目"提示
2. 断句标注、分镜生成、角色表生成按项目隔离
3. 每个项目的数据完全独立

### ⚠️ 有意保留的行为
- 配音缓存仍然跨项目共享（基于朗读文本和音色）
- 这是为了节省成本的有意设计

### 📊 测试覆盖
- 类型检查：通过
- 单元测试：12/12 通过
- 手动测试：需要执行上述 5 个测试用例

---

需要立即进行手动测试吗？还是先部署到测试环境？
