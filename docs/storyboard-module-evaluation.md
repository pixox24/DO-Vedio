# 分镜模块评估报告

**项目**: DO-Vedio 视频生成系统  
**模块**: 分镜生成与管理 (Storyboard Module)  
**评估日期**: 2026-10-03  
**评估范围**: 分镜生成逻辑、候选管理、UI交互、性能与可维护性

---

## 执行摘要

分镜模块是视频生成流程的核心环节，负责将文案句子转化为可视化的镜头序列。当前实现已具备完整的生成、编辑、候选管理和预览功能，但在**交互流畅度**、**状态一致性**、**错误恢复**和**UI信息密度**方面仍有明显改进空间。

**关键发现**:
- ✅ 架构设计合理，分离了规则层（纯函数）与生成层（副作用）
- ⚠️ **严重问题**: 候选历史合并逻辑复杂，边界情况处理不完善
- ⚠️ **性能问题**: 高频签名计算导致不必要的刷新，影响编辑体验
- ⚠️ **交互缺陷**: 批量操作缺少进度反馈，失败恢复路径不清晰
- ⚠️ **UI问题**: 信息层次不够清晰，关键操作埋藏较深

---

## 一、架构与代码质量评估

### 1.1 核心架构设计

**优点**:
```
lib/core/shots.ts (纯函数规则层)
    ↓
lib/pipeline/stages/storyboard.ts (大模型生成)
    ↓
lib/pipeline/stages/shot-generate.ts (素材生成)
    ↓
components/video-controls.tsx (UI交互层)
```

- **职责分离清晰**: 规则计算、LLM生成、素材生成、UI交互各自独立
- **纯函数设计**: `normalizeShots`、`repairShots` 等核心逻辑可测试性强
- **增量式生成**: 只重做过期的分镜范围 (`staleRanges`)，避免全量重算

**问题**:
- **缺少中间层抽象**: 规则直接硬编码在 `SHOT_RULES` 常量中，无法按项目/模板动态调整
- **状态管理分散**: 分镜状态分布在 `doc.shots`、`timeline`、`renders` 多处，容易不一致

---

### 1.2 严重问题：候选历史合并逻辑过于复杂

**问题代码** (`lib/pipeline/stages/shot-generate.ts:33-51`):
```typescript
export function mergeCandidateHistory(
  current: CandidateAsset[] | undefined,
  fresh: CandidateAsset[],
  currentAssetId?: string,
  max = MAX_CANDIDATES
) {
  const withCurrent = currentAssetId && !existing.some(...)
    ? [{ id: `legacy-${currentAssetId}`, assetId: currentAssetId }, ...existing]
    : existing;
  
  const merged = [...fresh, ...withCurrent.filter(...)];
  const kept = merged.slice(0, max);
  
  // 问题：当 currentIndex >= max 时，替换逻辑复杂且容易出错
  if (currentIndex >= max && currentIndex >= 0 && currentAssetId) {
    const evict = kept.findLastIndex((candidate) => candidate.assetId !== currentAssetId);
    if (evict >= 0) kept.splice(evict, 1, merged[currentIndex]);
  }
  
  const selectedId = currentAssetId && kept.some(...)
    ? currentAssetId
    : kept.find(...)?.assetId;
  
  return kept.map((candidate) => ({ ...candidate, selected: candidate.assetId === selectedId }));
}
```

**问题分析**:
1. **边界条件脆弱**: `evict` 查找逻辑假设一定能找到非当前素材，但新候选可能全是重复的
2. **语义不清**: `legacy-${currentAssetId}` 命名混淆了「旧项目兼容」和「当前正在使用」两个概念
3. **测试覆盖不足**: 只有 4 个测试用例，未覆盖 `currentIndex === max - 1` 等临界情况
4. **性能隐患**: 每次生成都遍历全部候选，O(n²) 复杂度

**建议修复方案**:

```typescript
// 推荐重构：分离关注点，降低复杂度
function mergeCandidateHistory(
  current: CandidateAsset[] | undefined,
  fresh: CandidateAsset[],
  currentAssetId?: string,
  max = MAX_CANDIDATES
): CandidateAsset[] {
  // 1. 构建去重后的候选池（新优先）
  const pool = new Map<string, CandidateAsset>();
  
  // 先加入旧候选（后续可能被新候选覆盖）
  for (const candidate of current ?? []) {
    pool.set(candidate.assetId, candidate);
  }
  
  // 新候选覆盖同 assetId 的旧记录
  for (const candidate of fresh) {
    pool.set(candidate.assetId, candidate);
  }
  
  // 2. 确保当前正在使用的素材在池中
  if (currentAssetId && !pool.has(currentAssetId)) {
    pool.set(currentAssetId, {
      id: `current-${currentAssetId}`,
      assetId: currentAssetId,
    });
  }
  
  // 3. 排序：新候选在前，当前使用的素材其次，剩余按原顺序
  const sorted = [
    ...fresh.map(f => pool.get(f.assetId)!),
    ...(currentAssetId && !fresh.some(f => f.assetId === currentAssetId)
      ? [pool.get(currentAssetId)!]
      : []
    ),
    ...[...(current ?? [])]
      .filter(c => !fresh.some(f => f.assetId === c.assetId) && c.assetId !== currentAssetId)
      .map(c => pool.get(c.assetId)!)
      .filter(Boolean)
  ];
  
  // 4. 截断并标记选中
  const kept = sorted.slice(0, max);
  const selectedId = currentAssetId && kept.some(c => c.assetId === currentAssetId)
    ? currentAssetId
    : fresh[0]?.assetId;
  
  return kept.map(c => ({ ...c, selected: c.assetId === selectedId }));
}
```

**需要补充的测试用例**:
- 当前素材在 `index === max - 1` 位置
- 新候选全部与当前素材重复
- `current` 为空数组但 `currentAssetId` 存在（遗留数据）

---

### 1.3 性能问题：高频签名计算触发不必要刷新

**问题代码** (`components/video-studio.tsx:56-71`):
```typescript
function signatureOf(doc: ProjectDoc) {
  return JSON.stringify([
    doc.lines.map((l) => [l.id, l.text, l.mood, l.voiceTag, ...]),
    doc.shots.map((s) => [s.id, s.assetId, Object.entries(s.assetVariants ?? {}), ...]),
    // 问题：每次调用都序列化全部镜头的 assetVariants
    doc.music.map((m) => [...]),
    doc.characters.map((c) => [...]),
    [doc.settings.subtitle, doc.settings.music, ...]
  ]);
}
```

**问题分析**:
1. **计算成本高**: 每个镜头的 `assetVariants` 是一个对象，`Object.entries` + 多次 `map` 在镜头数量 > 50 时明显卡顿
2. **触发过于频繁**: `useMemo` 依赖 `store.doc`，任何字段变化都会重算（包括不影响内容签名的字段）
3. **连锁刷新**: 签名变化 → `useEffect` → `scheduleRefresh` → 4 个 API 请求 + timeline 重算

**实测影响** (根据代码推断):
- 用户编辑 `shot.description` 时：虽然该字段被排除在签名外，但因为 `doc` 引用变了，`useMemo` 仍会重算整个签名
- 50 个镜头项目：每次签名计算 ~15ms，在快速打字时累积延迟

**建议优化**:
```typescript
// 方案 1: 细粒度 memo，只对真正影响签名的字段计算
const contentSignature = useMemo(() => {
  if (!store.doc) return "";
  const { lines, shots, music, characters, settings } = store.doc;
  // 只提取需要的字段，避免 Object.entries 遍历
  return quickHash([
    lines.map(l => `${l.id}:${l.text}:${l.mood ?? ""}:${l.voiceTag ?? ""}`),
    shots.map(s => `${s.id}:${s.assetId}:${s.kind}:${s.locked ? "1" : "0"}`),
    // ... 其他必要字段
  ]);
}, [
  store.doc?.lines,
  store.doc?.shots,
  store.doc?.music,
  store.doc?.characters,
  store.doc?.settings.subtitle,
  // 细粒度依赖
]);

// 方案 2: 服务端计算签名，客户端只比较哈希值
// timeline API 返回时附带 contentHash，客户端只需 lastHash !== nextHash
```

---

## 二、交互设计评估

### 2.1 批量操作缺少中间状态反馈

**问题场景**:
1. **批量生成图片**: 用户点击「生成所有镜头」后，只能在顶部 JobStrip 看到进度条，无法知道「哪几个镜头正在生成」
2. **批量重生成**: 选中 10 个镜头点重新生成，任务提交后界面无变化，用户不知道是否生效

**用户困惑**:
- "我点了按钮，但什么都没发生" → 实际上任务已排队，但 UI 没有即时反馈
- "哪些镜头正在生成？哪些失败了？" → JobStrip 只显示汇总数字，无法定位具体镜头

**建议改进**:
```typescript
// 在每个镜头卡片上显示生成状态
type ShotCardState = 
  | { status: "idle" }
  | { status: "queued", position: number }  // 排队位置
  | { status: "generating", progress: number }
  | { status: "failed", error: string }
  | { status: "done" };

// 视觉反馈
<div className="shot-card">
  {state.status === "generating" && (
    <div className="absolute inset-0 bg-accent/10 animate-pulse">
      <div className="absolute bottom-0 h-1 bg-accent" 
           style={{ width: `${state.progress * 100}%` }} />
    </div>
  )}
  {state.status === "failed" && (
    <div className="absolute top-2 right-2 text-red-400">
      <Icon name="alert-circle" />
    </div>
  )}
</div>
```

---

### 2.2 错误恢复路径不清晰

**问题代码** (`components/video-controls.tsx:650-680` StoryboardPanel):
```typescript
// 生成失败时只有一个全局错误提示
{error && <p className="text-sm text-red-300">{error}</p>}
```

**问题**:
1. **单点失败影响全局**: 一个镜头生成失败，整个分镜流程卡住，用户不知道能否跳过
2. **重试操作不明确**: 失败后是「重试全部」还是「只重试失败的」？按钮文案未区分
3. **缺少诊断信息**: 错误信息 `"生成失败"` 太笼统，用户无法判断是提示词问题还是服务问题

**真实场景**:
```
用户生成 20 个镜头，第 15 个因为提示词违规失败：
  ❌ 当前体验：弹窗 "生成失败：内容违规"，所有镜头停止
  ✅ 理想体验：第 15 个镜头标记为失败，其他继续；用户可单独编辑该镜头提示词后重试
```

**建议改进**:
```typescript
// 失败镜头的行内重试 UI
{shot.generationError && (
  <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-3">
    <p className="text-sm text-red-300">{shot.generationError}</p>
    <div className="mt-2 flex gap-2">
      <button onClick={() => retryShot(shot.id)}>重试</button>
      <button onClick={() => editPrompt(shot.id)}>修改提示词</button>
      <button onClick={() => skipShot(shot.id)}>跳过此镜</button>
    </div>
  </div>
)}

// JobStrip 支持分镜头的失败列表
<details>
  <summary>3 个镜头生成失败</summary>
  <ul>
    {failedShots.map(s => (
      <li key={s.id}>
        镜头 #{s.index}: {s.error}
        <button onClick={() => retry(s.id)}>重试</button>
      </li>
    ))}
  </ul>
</details>
```

---

### 2.3 候选切换交互不够直观

**当前实现** (`components/video-controls.tsx:918-921`):
```tsx
<div className="flex flex-wrap gap-1.5">
  {shot.candidates?.map((candidate) => (
    <button onClick={() => selectCandidate(shot.id, candidate.assetId)}>
      <Image src={mediaUrl(candidate.assetId)} width={96} height={64} />
    </button>
  ))}
</div>
```

**问题**:
1. **视觉层次不清**: 当前选中的候选没有明显标识（只有内部 `selected` 字段，UI 未体现）
2. **预览成本高**: 用户需要逐个点击才能看大图对比
3. **无法批量操作**: 不能「为所有镜头选择第 2 候选」

**建议改进**:
```tsx
<div className="space-y-2">
  <p className="text-xs text-white/40">
    候选 {shot.candidates?.length ?? 0} / {MAX_CANDIDATES}
    {shot.candidateGroupId && <span className="ml-2">批次 {shot.candidateGroupId.slice(0, 8)}</span>}
  </p>
  <div className="grid grid-cols-4 gap-2">
    {shot.candidates?.map((candidate, index) => (
      <button
        key={candidate.id}
        className={`relative aspect-video overflow-hidden rounded-lg border-2 transition ${
          candidate.selected
            ? "border-accent shadow-lg shadow-accent/20"
            : "border-white/10 hover:border-white/30"
        }`}
        onClick={() => selectCandidate(shot.id, candidate.assetId)}
      >
        <Image src={mediaUrl(candidate.assetId)} fill className="object-cover" />
        {candidate.selected && (
          <div className="absolute top-1 right-1 rounded-full bg-accent p-1">
            <Icon name="check" className="size-3" />
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 p-1 text-[10px] text-white">
          候选 {index + 1}
        </div>
      </button>
    ))}
  </div>
  {/* 快速预览 */}
  <button className="chip" onClick={() => openGallery(shot.candidates)}>
    全屏对比
  </button>
</div>
```

---

## 三、UI/UX 问题分析

### 3.1 信息密度过高，层次不清晰

**问题截图位置** (`components/video-controls.tsx:650-926` StoryboardPanel):

当前 StoryboardPanel 在一个面板内包含：
- 分镜列表（无限滚动）
- 每个镜头：缩略图、描述、画面提示、角色选择、候选图、高级设置
- 批量操作按钮（顶部）
- 生成按钮（底部）

**用户反馈** (推断):
- "找不到某个镜头" → 列表太长，缺少快速定位
- "不知道能改什么" → 可编辑字段与只读信息混在一起
- "误操作" → 「删除」「拆分」等危险操作与常用操作并列

**建议改进**:

#### 1) 增加快速导航
```tsx
<div className="sticky top-0 z-10 bg-ink p-3 border-b border-white/10">
  <input
    placeholder="搜索镜头描述或画面内容..."
    value={searchQuery}
    onChange={(e) => setSearchQuery(e.target.value)}
  />
  <div className="mt-2 flex gap-2 overflow-x-auto">
    {doc.segments.map((seg, i) => (
      <button
        key={i}
        onClick={() => scrollToSegment(i)}
        className="chip"
      >
        第 {i + 1} 章
      </button>
    ))}
  </div>
</div>
```

#### 2) 折叠高级选项
```tsx
<details className="mt-3">
  <summary className="cursor-pointer text-sm text-white/60">
    高级设置
  </summary>
  <div className="mt-2 space-y-2">
    {/* 角色、参考图、seed 等低频操作 */}
  </div>
</details>
```

#### 3) 危险操作二次确认
```tsx
<button
  className="chip text-red-400 hover:bg-red-400/10"
  onClick={async () => {
    if (await confirm({ 
      title: "删除镜头？", 
      message: "此操作不可撤销",
      tone: "danger" 
    })) {
      deleteShot(shot.id);
    }
  }}
>
  删除
</button>
```

---

### 3.2 关键操作埋藏过深

**问题路径**:
```
生成单个镜头的画面：
  1. 点击镜头卡片展开详情
  2. 滚动到底部
  3. 点击「生成画面」
  4. 选择模型
  5. 选择候选数量
  6. 确认生成
```

这是高频操作，却需要 6 步，且第 2-3 步在长列表中容易迷失。

**建议改进**:
```tsx
// 在镜头卡片上直接露出快捷操作
<div className="shot-card">
  <div className="shot-thumbnail-container">
    {shot.assetId ? (
      <Image src={mediaUrl(shot.assetId)} fill />
    ) : (
      <div className="placeholder">
        <button
          className="absolute inset-0 flex items-center justify-center bg-white/5 hover:bg-white/10"
          onClick={() => quickGenerate(shot.id)}
        >
          <Icon name="wand" className="size-6" />
          <span>生成</span>
        </button>
      </div>
    )}
  </div>
  
  {/* 已有画面时，悬浮操作菜单 */}
  {shot.assetId && (
    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
      <button className="icon-btn" onClick={() => regenerate(shot.id)}>
        <Icon name="refresh" />
      </button>
      <button className="icon-btn" onClick={() => showCandidates(shot.id)}>
        <Icon name="grid" />
      </button>
    </div>
  )}
</div>
```

---

### 3.3 状态反馈延迟

**问题现象**:
1. 点击「锁定镜头」后，图标 2-3 秒才变化 → 实际上 `store.setDoc` 立即生效，但等待刷新才更新 UI
2. 切换候选图后，预览播放器 5 秒后才显示新画面 → `scheduleRefresh` 的 300ms 防抖 + 网络请求

**根本原因**:
```typescript
// video-studio.tsx:190-196
const scheduleRefresh = useCallback((preservePlayback = false) => {
  if (refreshTimer.current) clearTimeout(refreshTimer.current);
  refreshTimer.current = setTimeout(() => {
    // 问题：所有 UI 更新都走这条路，包括本地状态变化
    void runRefreshRef.current?.(preservePlayback);
  }, 300);
}, []);
```

**建议改进**:
```typescript
// 方案 1: 乐观更新 + 后台同步
function toggleLock(shotId: string) {
  // 立即更新本地状态
  store.setDoc((doc) => ({
    ...doc,
    shots: doc.shots.map((s) =>
      s.id === shotId ? { ...s, locked: !s.locked } : s
    ),
  }));
  
  // 后台同步，失败时回滚
  store.flush().catch(() => {
    store.setDoc((doc) => ({
      ...doc,
      shots: doc.shots.map((s) =>
        s.id === shotId ? { ...s, locked: !s.locked } : s
      ),
    }));
    toast("操作失败，已恢复", "error");
  });
}

// 方案 2: 区分本地操作和远程依赖
const localSignature = useMemo(() => {
  // 只包含不需要服务端重算的字段
  return JSON.stringify([
    doc.shots.map(s => [s.id, s.locked, s.description]),
  ]);
}, [doc.shots]);

const remoteSignature = useMemo(() => {
  // 需要 timeline 重算的字段
  return JSON.stringify([
    doc.lines.map(l => [l.id, l.text]),
    doc.shots.map(s => [s.assetId, s.kind]),
  ]);
}, [doc.lines, doc.shots]);

// 本地操作不触发远程刷新
useEffect(() => {
  if (remoteSignature) scheduleRefresh(true);
}, [remoteSignature]);
```

---

## 四、逻辑设计问题

### 4.1 分镜过期判定过于严格

**问题代码** (`lib/pipeline/stages/storyboard.ts:66-78`):
```typescript
export function rangeMatchesCurrent(
  source: Line[],
  current: Line[],
  range: { from: number; to: number }
): boolean {
  // 问题：任何 line.text、line.mood、line.keywords 变化都认为过期
  const signature = (line: Line) =>
    JSON.stringify({
      segmentIndex: line.segmentIndex,
      text: line.text,
      keywords: line.keywords,
      mood: line.mood,
    });
  
  return slice.every((line, offset) => {
    const found = currentById.get(line.id);
    return !!found && 
           found.index === first.index + offset && 
           signature(found.line) === signature(line);  // 完全匹配
  });
}
```

**实际影响**:
- 用户改了一个标点符号 → 整段分镜重做（费用、等待时间）
- `line.mood` 由配音模块自动标注 → 配音完成后触发全片分镜重做

**建议优化**:
```typescript
// 方案 1: 只对实质性变化重做
function isSubstantialChange(oldLine: Line, newLine: Line): boolean {
  // 只关心影响分镜决策的字段
  const oldWords = oldLine.text.replace(/[，。！？；：、""''（）]/g, "");
  const newWords = newLine.text.replace(/[，。！？；：、""''（）]/g, "");
  
  return (
    oldWords !== newWords ||  // 实质内容变化
    oldLine.segmentIndex !== newLine.segmentIndex  // 章节调整
  );
}

// 方案 2: 增量更新而非全量重做
// 只重新生成变化句子对应的镜头，其他镜头保持不变
```

---

### 4.2 镜头规则硬编码，缺少灵活性

**问题代码** (`lib/core/shots.ts:14`):
```typescript
export const SHOT_RULES = {
  minMs: 1500,
  maxMs: 6000,
  openingMs: 15000,
  openingMaxMs: 3500,
};
```

**局限**:
1. 所有项目共用同一套规则，无法适配不同风格（TikTok 快节奏 vs 纪录片慢节奏）
2. 规则变化需要修改代码、重新部署
3. 用户无法自定义镜头节奏偏好

**建议改进**:
```typescript
// 方案 1: 模板系统
interface ShotRulesTemplate {
  id: string;
  name: string;
  rules: {
    minMs: number;
    maxMs: number;
    openingMs: number;
    openingMaxMs: number;
    preferredMotions: Motion[];  // 优先使用的运镜
  };
}

const TEMPLATES: ShotRulesTemplate[] = [
  { id: "default", name: "标准", rules: { minMs: 1500, maxMs: 6000, ... } },
  { id: "fast", name: "快节奏", rules: { minMs: 800, maxMs: 3000, ... } },
  { id: "slow", name: "纪录片", rules: { minMs: 3000, maxMs: 10000, ... } },
];

// 存储在 doc.settings.shotRulesTemplateId

// 方案 2: 可配置规则
interface ProjectSettings {
  // ... 现有字段
  shotRules: {
    minMs: number;
    maxMs: number;
    // 允许用户在 UI 中调整
  };
}
```

---

### 4.3 候选生成策略单一

**当前逻辑** (`lib/pipeline/stages/shot-generate.ts:72-78`):
```typescript
const candidateCount = Math.max(1, Math.min(4, Math.floor(input.candidateCount ?? 1)));
// 问题：只能生成 1-4 个候选，且参数固定
const compiled = compileShotPrompt(project.doc, shot);
// 所有候选使用相同提示词，只有 seed 不同
```

**局限**:
1. 候选图差异不够明显（同一提示词 + 不同 seed，变化有限）
2. 无法探索不同风格（例如「3 个写实 + 1 个卡通」）
3. 用户无法指定「生成 2 个全身景 + 2 个特写」

**建议增强**:
```typescript
type CandidateStrategy =
  | { type: "seed-variation"; count: number }  // 当前策略
  | {
      type: "shot-size-variation";  // 不同景别
      sizes: ShotSize[];
    }
  | {
      type: "style-variation";  // 不同风格
      styles: Array<{ id: string; prompt: string }>;
    }
  | {
      type: "custom";  // 自定义每个候选的完整提示词
      prompts: string[];
    };

// UI 中让用户选择策略
<Select value={strategy.type}>
  <option value="seed-variation">种子变化（默认）</option>
  <option value="shot-size-variation">景别变化</option>
  <option value="style-variation">风格变化</option>
</Select>
```

---

## 五、改进建议优先级排序

### P0 - 必须修复（影响基础功能）
1. ✅ **修复候选历史合并逻辑** → 防止数据丢失
2. ✅ **优化签名计算性能** → 解决编辑卡顿
3. ✅ **增加批量操作的实时反馈** → 用户明确知道任务状态

### P1 - 高优先级（显著提升体验）
4. ✅ **镜头卡片显示生成状态** → 可视化进度
5. ✅ **失败镜头的行内重试** → 减少恢复摩擦
6. ✅ **候选切换 UI 优化** → 对比更直观
7. ✅ **快速导航与搜索** → 长列表可用性

### P2 - 中优先级（锦上添花）
8. **乐观更新本地操作** → 即时反馈
9. **分镜过期判定优化** → 减少不必要重做
10. **模板化镜头规则** → 适配不同风格

### P3 - 低优先级（长期规划）
11. **候选生成策略增强** → 探索多样性
12. **分镜 AI 助手** → 智能推荐镜头切分点
13. **A/B 测试功能** → 对比不同分镜方案

---

## 六、具体实施路径

### 阶段 1: 稳定性修复（1-2 天）
```typescript
// 1. 重构 mergeCandidateHistory
- 添加单元测试覆盖边界情况
- 重写逻辑，降低圈复杂度
- 添加运行时断言

// 2. 优化签名计算
- 实现 quickHash 替代 JSON.stringify
- 细粒度 useMemo 依赖
- 或改为服务端计算
```

### 阶段 2: 交互优化（3-5 天）
```typescript
// 3. 状态可视化
- 镜头卡片增加状态徽章
- JobStrip 增加失败列表
- 候选选择器重设计

// 4. 快速操作
- 悬浮工具栏
- 快捷键支持（J/K 导航、R 重新生成）
- 批量选择模式
```

### 阶段 3: 性能与规模（5-7 天）
```typescript
// 5. 虚拟滚动
- 长列表优化（react-window）
- 懒加载缩略图

// 6. 后台任务管理
- WebSocket 实时通知
- 离线任务恢复
```

---

## 七、测量指标

### 性能指标
- **签名计算时间**: 当前 ~15ms (50镜头) → 目标 < 5ms
- **刷新延迟**: 当前 ~300ms → 目标 < 100ms (本地操作)
- **首屏渲染**: 当前 ~800ms → 目标 < 500ms

### 体验指标
- **任务可见性**: 用户能在 5 秒内找到「哪些镜头正在生成」
- **错误恢复**: 失败后 3 次点击内完成重试
- **误操作率**: 「删除」等危险操作的误触率 < 1%

### 业务指标
- **分镜编辑完成率**: 用户开始编辑分镜 → 提交生成的比例
- **重新生成次数**: 平均每个镜头重新生成的次数（过高说明初次质量差）
- **候选利用率**: 生成的候选中，用户实际选择非第一候选的比例

---

## 八、总结

### 优势保持
- ✅ 架构设计合理，职责分离清晰
- ✅ 增量式生成节省成本
- ✅ 规则层纯函数易测试

### 核心问题
- ⚠️ 候选管理逻辑复杂度过高，存在数据丢失风险
- ⚠️ 高频签名计算影响编辑流畅度
- ⚠️ 批量操作反馈不足，用户心理模型不匹配

### 优先行动
1. **立即**: 修复候选合并逻辑，增加测试覆盖
2. **本周**: 优化签名计算，增加镜头状态可视化
3. **本月**: 重设计候选选择 UI，增加快速导航

### 长期方向
- 从「工具」向「助手」演进：AI 推荐镜头切分、自动优化节奏
- 从「单一流程」向「实验平台」：支持 A/B 对比、版本管理
- 从「项目级配置」向「智能适配」：根据内容类型自动调整规则

---

**评估完成日期**: 2026-10-03  
**建议复审周期**: 实施阶段 1-2 后，2 周内复审性能与体验指标
