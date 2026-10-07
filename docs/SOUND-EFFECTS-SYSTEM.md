# 卡片音效系统实施文档

## 📋 项目概述

为视频生成系统中的 11 种卡片类型添加自动音效系统，让非图片生成内容在展示时自动配上合适的音效，提升整体视听体验。

### 设计理念
- **高级、克制、有质感**：音效与视觉动画完美契合
- **智能触发**：根据动画关键帧自动触发，无需手动配置
- **可配置性**：用户可以开关/调整音效
- **扩展性**：预留 API 接口，支持未来 AI 生成音效

---

## 🎯 实施方案：混合方案 + 三层架构

### 架构概览

```
┌─────────────────────────────────────────────────────┐
│                   视频渲染层                          │
├─────────────────────────────────────────────────────┤
│  层1：背景氛围音效（全局贯穿）                        │
│  层2：卡片入场音效（每个卡片）                        │
│  层3：内容强调音效（关键信息）                        │
├─────────────────────────────────────────────────────┤
│              音效管理系统 (SFX Manager)               │
│  - 音效库 (SFX Library)                              │
│  - 触发器 (Trigger System)                          │
│  - 配置管理 (Config Management)                      │
└─────────────────────────────────────────────────────┘
```

---

## 📁 文件结构

```
lib/audio/
├── sfx-library.ts          # 音效素材库配置
├── sfx-manager.ts          # 音效管理核心逻辑
├── sfx-triggers.ts         # 音效触发时机定义
└── types.ts                # 音效系统类型定义

public/sfx/                 # 音效文件存储
├── ambient/                # 背景氛围音效
├── card-entry/             # 卡片入场音效
└── emphasis/               # 内容强调音效
    ├── stat/               # 数据卡音效
    ├── list/               # 列表卡音效
    ├── qa/                 # 问答卡音效
    ├── cta/                # 号召卡音效
    ├── alert/              # 提示卡音效
    ├── definition/         # 定义卡音效
    ├── timeline/           # 时间线卡音效
    ├── profile/            # 人物卡音效
    ├── quote/              # 金句卡音效
    ├── headline/           # 标题卡音效
    └── split/              # 对比卡音效

remotion/animation/
└── ui2v-with-sfx.tsx      # 带音效的卡片模板（可选，或直接在 ui2v.tsx 中集成）

components/
└── video-controls.tsx      # 添加音效控制 UI
```

---

## 🔧 第一步：定义类型系统

### 文件：`lib/audio/types.ts`

```typescript
import type { CardVariant } from "@/lib/core/types";

/**
 * 音效类型
 */
export type SFXType = 
  | "ambient"      // 背景氛围
  | "card-entry"   // 卡片入场
  | "emphasis";    // 内容强调

/**
 * 音效配置
 */
export interface SFXConfig {
  /** 音效文件路径 */
  src: string;
  /** 音量 (0-1) */
  volume: number;
  /** 起始帧 */
  startFrame: number;
  /** 结束帧（可选，不设置则播放完整音效） */
  endFrame?: number;
  /** 淡入时长（帧数） */
  fadeIn?: number;
  /** 淡出时长（帧数） */
  fadeOut?: number;
}

/**
 * 卡片音效组
 */
export interface CardSFXGroup {
  /** 卡片入场音效 */
  entry: SFXConfig;
  /** 关键帧音效列表 */
  keyframes?: SFXConfig[];
}

/**
 * 音效触发器
 */
export interface SFXTrigger {
  /** 触发帧 */
  frame: number;
  /** 音效文件名 */
  sound: string;
  /** 音量 */
  volume: number;
  /** 条件（可选，用于动态判断） */
  condition?: (frame: number) => boolean;
}

/**
 * 音效库配置
 */
export type SFXLibrary = Record<CardVariant, {
  /** 默认音效组 */
  default: CardSFXGroup;
  /** 可选音效组（2-3个变体） */
  alternatives?: CardSFXGroup[];
}>;

/**
 * 全局音效配置
 */
export interface GlobalSFXConfig {
  /** 是否启用音效 */
  enabled: boolean;
  /** 全局音量 (0-1) */
  masterVolume: number;
  /** 背景音效音量 (0-1) */
  ambientVolume: number;
  /** 卡片音效音量 (0-1) */
  cardVolume: number;
  /** 强调音效音量 (0-1) */
  emphasisVolume: number;
}
```

---

## 🎵 第二步：创建音效库配置

### 文件：`lib/audio/sfx-library.ts`

```typescript
import type { SFXLibrary } from "./types";

/**
 * 音效素材库
 * 
 * 每种卡片类型预设 1-3 个音效选项
 * 音效文件需要准备在 public/sfx/ 目录下
 */
export const SFX_LIBRARY: SFXLibrary = {
  // ============ 数据卡 ============
  stat: {
    default: {
      entry: {
        src: "/sfx/emphasis/stat/whoosh-up.mp3",
        volume: 0.4,
        startFrame: 0,
        fadeIn: 3,
      },
      keyframes: [
        {
          src: "/sfx/emphasis/stat/number-reveal.mp3",
          volume: 0.5,
          startFrame: 10,
        },
        {
          src: "/sfx/emphasis/stat/label-appear.mp3",
          volume: 0.3,
          startFrame: 25,
        },
      ],
    },
    alternatives: [
      {
        entry: {
          src: "/sfx/emphasis/stat/focus-reveal.mp3",
          volume: 0.35,
          startFrame: 0,
        },
      },
    ],
  },

  // ============ 列表卡 ============
  list: {
    default: {
      entry: {
        src: "/sfx/emphasis/list/title-reveal.mp3",
        volume: 0.3,
        startFrame: 0,
      },
      keyframes: [
        // 每个列表项的音效会动态生成（见触发器部分）
        {
          src: "/sfx/emphasis/list/item-pop.mp3",
          volume: 0.25,
          startFrame: 15, // 第一项
        },
      ],
    },
  },

  // ============ 问答卡 ============
  qa: {
    default: {
      entry: {
        src: "/sfx/emphasis/qa/question-reveal.mp3",
        volume: 0.35,
        startFrame: 0,
      },
      keyframes: [
        {
          src: "/sfx/emphasis/qa/answer-reveal.mp3",
          volume: 0.4,
          startFrame: 25,
        },
      ],
    },
  },

  // ============ 号召卡 ============
  cta: {
    default: {
      entry: {
        src: "/sfx/emphasis/cta/pulse-intro.mp3",
        volume: 0.45,
        startFrame: 0,
      },
      keyframes: [
        {
          src: "/sfx/emphasis/cta/emphasis-beat.mp3",
          volume: 0.35,
          startFrame: 20,
        },
      ],
    },
  },

  // ============ 提示卡 ============
  alert: {
    default: {
      entry: {
        src: "/sfx/emphasis/alert/notification.mp3",
        volume: 0.4,
        startFrame: 0,
      },
    },
    alternatives: [
      // 根据 alert 类型的不同音效
      {
        entry: {
          src: "/sfx/emphasis/alert/info.mp3",
          volume: 0.35,
          startFrame: 0,
        },
      },
      {
        entry: {
          src: "/sfx/emphasis/alert/warning.mp3",
          volume: 0.5,
          startFrame: 0,
        },
      },
      {
        entry: {
          src: "/sfx/emphasis/alert/success.mp3",
          volume: 0.4,
          startFrame: 0,
        },
      },
      {
        entry: {
          src: "/sfx/emphasis/alert/danger.mp3",
          volume: 0.55,
          startFrame: 0,
        },
      },
    ],
  },

  // ============ 定义卡 ============
  definition: {
    default: {
      entry: {
        src: "/sfx/emphasis/definition/term-reveal.mp3",
        volume: 0.35,
        startFrame: 0,
      },
      keyframes: [
        {
          src: "/sfx/emphasis/definition/meaning-expand.mp3",
          volume: 0.3,
          startFrame: 18,
        },
      ],
    },
  },

  // ============ 时间线卡 ============
  timeline: {
    default: {
      entry: {
        src: "/sfx/emphasis/timeline/flow-start.mp3",
        volume: 0.3,
        startFrame: 0,
      },
      keyframes: [
        // 每个节点的音效会动态生成
        {
          src: "/sfx/emphasis/timeline/node-appear.mp3",
          volume: 0.25,
          startFrame: 10,
        },
      ],
    },
  },

  // ============ 人物卡 ============
  profile: {
    default: {
      entry: {
        src: "/sfx/emphasis/profile/card-reveal.mp3",
        volume: 0.35,
        startFrame: 0,
      },
      keyframes: [
        {
          src: "/sfx/emphasis/profile/content-fade-in.mp3",
          volume: 0.25,
          startFrame: 12,
        },
      ],
    },
  },

  // ============ 金句卡 ============
  quote: {
    default: {
      entry: {
        src: "/sfx/emphasis/quote/quote-open.mp3",
        volume: 0.4,
        startFrame: 0,
      },
      keyframes: [
        {
          src: "/sfx/emphasis/quote/text-reveal.mp3",
          volume: 0.3,
          startFrame: 15,
        },
      ],
    },
  },

  // ============ 标题卡 ============
  headline: {
    default: {
      entry: {
        src: "/sfx/emphasis/headline/spotlight-on.mp3",
        volume: 0.45,
        startFrame: 0,
      },
      keyframes: [
        {
          src: "/sfx/emphasis/headline/particle-gather.mp3",
          volume: 0.3,
          startFrame: 20,
        },
      ],
    },
  },

  // ============ 对比卡 ============
  split: {
    default: {
      entry: {
        src: "/sfx/emphasis/split/flip-start.mp3",
        volume: 0.4,
        startFrame: 0,
      },
      keyframes: [
        {
          src: "/sfx/emphasis/split/panel-flip-left.mp3",
          volume: 0.35,
          startFrame: 10,
        },
        {
          src: "/sfx/emphasis/split/panel-flip-right.mp3",
          volume: 0.35,
          startFrame: 18,
        },
      ],
    },
  },
};

/**
 * 背景氛围音效配置
 */
export const AMBIENT_SFX = {
  subtle: {
    src: "/sfx/ambient/base-subtle.mp3",
    volume: 0.1,
    loop: true,
  },
  modern: {
    src: "/sfx/ambient/base-modern.mp3",
    volume: 0.12,
    loop: true,
  },
} as const;
```

---

## 🎮 第三步：实现音效管理器

### 文件：`lib/audio/sfx-manager.ts`

```typescript
import type { CardVariant, Shot } from "@/lib/core/types";
import type { SFXConfig, CardSFXGroup, GlobalSFXConfig } from "./types";
import { SFX_LIBRARY } from "./sfx-library";

/**
 * 音效管理器
 */
export class SFXManager {
  private config: GlobalSFXConfig;

  constructor(config?: Partial<GlobalSFXConfig>) {
    this.config = {
      enabled: true,
      masterVolume: 0.7,
      ambientVolume: 0.1,
      cardVolume: 0.35,
      emphasisVolume: 0.4,
      ...config,
    };
  }

  /**
   * 获取卡片音效组
   */
  getCardSFX(variant: CardVariant, alternativeIndex?: number): CardSFXGroup {
    const cardSFX = SFX_LIBRARY[variant];
    
    if (alternativeIndex !== undefined && cardSFX.alternatives) {
      return cardSFX.alternatives[alternativeIndex] || cardSFX.default;
    }
    
    return cardSFX.default;
  }

  /**
   * 根据 alert 类型选择合适的音效
   */
  getAlertSFX(alertType: "info" | "warning" | "success" | "danger"): CardSFXGroup {
    const typeIndex = {
      info: 0,
      warning: 1,
      success: 2,
      danger: 3,
    };
    
    return this.getCardSFX("alert", typeIndex[alertType]);
  }

  /**
   * 生成列表项音效（动态）
   */
  generateListItemSFX(itemCount: number, baseStartFrame: number): SFXConfig[] {
    const itemSFX: SFXConfig[] = [];
    const itemDelay = 6; // 每项间隔 6 帧
    
    for (let i = 0; i < itemCount; i++) {
      itemSFX.push({
        src: "/sfx/emphasis/list/item-pop.mp3",
        volume: 0.25 * this.getVolumeMultiplier("emphasis"),
        startFrame: baseStartFrame + i * itemDelay,
      });
    }
    
    return itemSFX;
  }

  /**
   * 生成时间线节点音效（动态）
   */
  generateTimelineNodeSFX(nodeCount: number, baseStartFrame: number): SFXConfig[] {
    const nodeSFX: SFXConfig[] = [];
    const nodeDelay = 8; // 每个节点间隔 8 帧
    
    for (let i = 0; i < nodeCount; i++) {
      nodeSFX.push({
        src: "/sfx/emphasis/timeline/node-appear.mp3",
        volume: 0.25 * this.getVolumeMultiplier("emphasis"),
        startFrame: baseStartFrame + i * nodeDelay,
      });
    }
    
    return nodeSFX;
  }

  /**
   * 应用音量调整
   */
  applyVolume(sfx: SFXConfig, type: "ambient" | "card" | "emphasis"): SFXConfig {
    const multiplier = this.getVolumeMultiplier(type);
    
    return {
      ...sfx,
      volume: sfx.volume * multiplier,
    };
  }

  /**
   * 获取音量乘数
   */
  private getVolumeMultiplier(type: "ambient" | "card" | "emphasis"): number {
    if (!this.config.enabled) return 0;
    
    const volumeMap = {
      ambient: this.config.ambientVolume,
      card: this.config.cardVolume,
      emphasis: this.config.emphasisVolume,
    };
    
    return this.config.masterVolume * volumeMap[type];
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<GlobalSFXConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): GlobalSFXConfig {
    return { ...this.config };
  }
}

/**
 * 默认音效管理器实例
 */
export const defaultSFXManager = new SFXManager();
```

---

## 🎬 第四步：集成到 Remotion 动画模板

### 方法 A：在现有模板中添加音效（推荐）

修改 `remotion/animation/ui2v.tsx` 中的每个模板，添加音效层：

```typescript
import { Audio, Sequence } from "remotion";
import { defaultSFXManager } from "@/lib/audio/sfx-manager";

// 示例：为 StatTemplate 添加音效
export function StatTemplate({ shot, durationInFrames }: AnimationRendererProps) {
  const frame = useCurrentFrame();
  const { width, portrait, u } = useLayout();
  const theme = useTheme();
  const fps = useVideoConfig().fps;
  
  const stat = shot.card.stat;
  if (!stat) return null;
  
  // 获取音效配置
  const sfxGroup = defaultSFXManager.getCardSFX("stat");
  const entrySFX = defaultSFXManager.applyVolume(sfxGroup.entry, "card");
  const keyframeSFX = sfxGroup.keyframes?.map(sfx => 
    defaultSFXManager.applyVolume(sfx, "emphasis")
  ) || [];
  
  // ... 现有视觉渲染代码 ...
  
  return (
    <>
      {/* 视觉层 */}
      <TemplateFrame background="radial-gradient(circle at 50% 40%, #0d1117 0%, #010409 100%)">
        {/* ... 现有内容 ... */}
      </TemplateFrame>
      
      {/* 音效层 */}
      {defaultSFXManager.getConfig().enabled && (
        <>
          {/* 入场音效 */}
          <Sequence from={entrySFX.startFrame}>
            <Audio
              src={entrySFX.src}
              volume={entrySFX.volume}
              startFrom={0}
              endAt={entrySFX.endFrame ? (entrySFX.endFrame - entrySFX.startFrame) * fps : undefined}
            />
          </Sequence>
          
          {/* 关键帧音效 */}
          {keyframeSFX.map((sfx, index) => (
            <Sequence key={index} from={sfx.startFrame}>
              <Audio
                src={sfx.src}
                volume={sfx.volume}
                startFrom={0}
              />
            </Sequence>
          ))}
        </>
      )}
    </>
  );
}
```

### 方法 B：创建音效包装组件

创建一个通用的音效包装组件：

```typescript
// remotion/animation/with-sfx.tsx
import { Audio, Sequence } from "remotion";
import type { ReactNode } from "react";
import type { Shot } from "@/lib/core/types";
import { defaultSFXManager } from "@/lib/audio/sfx-manager";

interface WithSFXProps {
  shot: Shot;
  children: ReactNode;
  durationInFrames: number;
}

export function WithSFX({ shot, children, durationInFrames }: WithSFXProps) {
  const variant = shot.card?.variant;
  if (!variant) return <>{children}</>;
  
  const sfxEnabled = defaultSFXManager.getConfig().enabled;
  if (!sfxEnabled) return <>{children}</>;
  
  // 获取音效配置
  let sfxGroup = defaultSFXManager.getCardSFX(variant);
  
  // 特殊处理：alert 卡片根据类型选择音效
  if (variant === "alert" && shot.card.alert) {
    sfxGroup = defaultSFXManager.getAlertSFX(shot.card.alert.type);
  }
  
  // 特殊处理：列表卡片动态生成音效
  let keyframeSFX = sfxGroup.keyframes || [];
  if (variant === "list" && shot.card.items) {
    const listItemSFX = defaultSFXManager.generateListItemSFX(
      shot.card.items.length,
      15 // baseStartFrame
    );
    keyframeSFX = [...keyframeSFX, ...listItemSFX];
  }
  
  // 特殊处理：时间线卡片动态生成音效
  if (variant === "timeline" && shot.card.timeline) {
    const timelineNodeSFX = defaultSFXManager.generateTimelineNodeSFX(
      shot.card.timeline.length,
      10 // baseStartFrame
    );
    keyframeSFX = [...keyframeSFX, ...timelineNodeSFX];
  }
  
  const entrySFX = defaultSFXManager.applyVolume(sfxGroup.entry, "card");
  const appliedKeyframeSFX = keyframeSFX.map(sfx => 
    defaultSFXManager.applyVolume(sfx, "emphasis")
  );
  
  return (
    <>
      {children}
      
      {/* 音效层 */}
      <>
        {/* 入场音效 */}
        <Sequence from={entrySFX.startFrame}>
          <Audio
            src={entrySFX.src}
            volume={entrySFX.volume}
          />
        </Sequence>
        
        {/* 关键帧音效 */}
        {appliedKeyframeSFX.map((sfx, index) => (
          <Sequence key={index} from={sfx.startFrame}>
            <Audio
              src={sfx.src}
              volume={sfx.volume}
            />
          </Sequence>
        ))}
      </>
    </>
  );
}

// 使用示例
export function StatTemplateWithSFX(props: AnimationRendererProps) {
  return (
    <WithSFX shot={props.shot} durationInFrames={props.durationInFrames}>
      <StatTemplate {...props} />
    </WithSFX>
  );
}
```

---

## 🎛️ 第五步：添加用户控制界面

### 修改 `components/video-controls.tsx`

添加音效控制面板：

```typescript
import { defaultSFXManager } from "@/lib/audio/sfx-manager";
import { useState } from "react";

export function SFXControls() {
  const [config, setConfig] = useState(defaultSFXManager.getConfig());
  
  const updateConfig = (updates: Partial<GlobalSFXConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    defaultSFXManager.updateConfig(newConfig);
  };
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">音效总开关</span>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => updateConfig({ enabled })}
        />
      </div>
      
      {config.enabled && (
        <>
          <div className="space-y-2">
            <label className="text-sm">主音量</label>
            <Slider
              value={[config.masterVolume * 100]}
              onValueChange={([value]) => updateConfig({ masterVolume: value / 100 })}
              max={100}
              step={1}
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm">背景音量</label>
            <Slider
              value={[config.ambientVolume * 100]}
              onValueChange={([value]) => updateConfig({ ambientVolume: value / 100 })}
              max={100}
              step={1}
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm">卡片音效</label>
            <Slider
              value={[config.cardVolume * 100]}
              onValueChange={([value]) => updateConfig({ cardVolume: value / 100 })}
              max={100}
              step={1}
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm">强调音效</label>
            <Slider
              value={[config.emphasisVolume * 100]}
              onValueChange={([value]) => updateConfig({ emphasisVolume: value / 100 })}
              max={100}
              step={1}
            />
          </div>
        </>
      )}
    </div>
  );
}
```

---

## 🎼 第六步：准备音效素材

### 音效素材需求清单

#### 基础版本（MVP）- 每种卡片 1-2 个音效
总共需要：**约 30 个音效文件**

| 类别 | 数量 | 文件格式 | 大小建议 |
|------|------|---------|---------|
| 背景氛围 | 2 | MP3 | 100-200KB |
| 卡片入场 | 11 | MP3 | 20-50KB |
| 关键帧强调 | 15-20 | MP3 | 20-40KB |

#### 完整版本 - 每种卡片 2-3 个音效变体
总共需要：**约 60-80 个音效文件**

### 音效设计规范

1. **文件格式**：MP3, 128kbps
2. **时长**：0.3-2 秒
3. **采样率**：44.1kHz
4. **声道**：立体声
5. **音量标准化**：-18 dB LUFS

### 音效获取方式

#### 方式 1：使用免费音效库（推荐快速开始）
- [Freesound.org](https://freesound.org/)
- [Zapsplat](https://www.zapsplat.com/)
- [BBC Sound Effects](https://sound-effects.bbcrewind.co.uk/)

搜索关键词：
- "UI whoosh"
- "notification"
- "click"
- "pop"
- "reveal"
- "transition"

#### 方式 2：购买专业音效包
- [Epidemic Sound](https://www.epidemicsound.com/)
- [Artlist](https://artlist.io/)
- [AudioJungle](https://audiojungle.net/)

#### 方式 3：AI 生成音效（未来扩展）
- ElevenLabs Sound Effects API
- Stability AI Audio
- 自定义描述生成

---

## 🚀 实施步骤

### 阶段一：基础实现（1-2 天）

**目标**：让系统能播放音效

1. ✅ 创建类型定义 `lib/audio/types.ts`
2. ✅ 创建音效库配置 `lib/audio/sfx-library.ts`（先使用占位符路径）
3. ✅ 实现音效管理器 `lib/audio/sfx-manager.ts`
4. ✅ 在 1-2 个模板中集成音效（测试）
5. ✅ 准备 5-10 个测试音效文件

**验收标准**：
- 至少 2 种卡片能够播放音效
- 音效与动画时序基本同步

---

### 阶段二：完善音效（2-3 天）

**目标**：所有卡片都有音效

1. ✅ 为所有 11 种卡片集成音效
2. ✅ 准备完整的音效素材（30 个文件）
3. ✅ 实现动态音效生成（列表、时间线）
4. ✅ 优化音效时序和音量

**验收标准**：
- 所有 11 种卡片都有入场音效
- 关键动画节点有强调音效
- 音效不会相互冲突或过于嘈杂

---

### 阶段三：用户控制（1 天）

**目标**：用户可以调整音效

1. ✅ 添加音效控制 UI
2. ✅ 实现音效开关
3. ✅ 实现分层音量控制
4. ✅ 配置持久化（localStorage）

**验收标准**：
- 用户可以一键开关音效
- 用户可以独立调整各层音量
- 配置在页面刷新后保持

---

### 阶段四：扩展优化（可选）

**目标**：高级功能

1. ⭕ 音效预览功能（在选择卡片时试听）
2. ⭕ 用户自定义上传音效
3. ⭕ AI 生成音效集成
4. ⭕ 音效均衡器（EQ）
5. ⭕ 音效预设方案（现代/极简/电影感等）

---

## 📊 技术挑战与解决方案

### 挑战 1：音效时序同步

**问题**：音效需要与 Remotion 动画精确同步

**解决方案**：
```typescript
// 使用 Remotion 的 spring 进度来触发音效
const reveal = spring({ frame, fps, config: { damping: 20 } });

// 当动画达到特定进度时触发
useEffect(() => {
  if (reveal > 0.5 && !triggered) {
    // 触发音效
    setTriggered(true);
  }
}, [reveal]);
```

### 挑战 2：音效文件体积

**问题**：大量音效文件会增加项目体积

**解决方案**：
- 使用 MP3 格式，控制比特率在 128kbps
- 按需加载（lazy loading）
- CDN 托管音效文件
- 音效文件压缩优化

### 挑战 3：浏览器音频限制

**问题**：某些浏览器限制自动播放音频

**解决方案**：
- Remotion 渲染时不受限制
- 在预览模式中，首次播放前提示用户点击允许

### 挑战 4：多音效冲突

**问题**：多个音效同时播放可能造成混乱

**解决方案**：
- 限制同时播放的音效数量（最多 3-4 个）
- 使用音频混音算法
- 调整各层音效的音量平衡

---

## 🧪 测试计划

### 单元测试

```typescript
// lib/audio/sfx-manager.test.ts
import { SFXManager } from "./sfx-manager";

describe("SFXManager", () => {
  it("should apply volume correctly", () => {
    const manager = new SFXManager({
      masterVolume: 0.5,
      cardVolume: 0.8,
    });
    
    const sfx = {
      src: "/test.mp3",
      volume: 0.4,
      startFrame: 0,
    };
    
    const applied = manager.applyVolume(sfx, "card");
    expect(applied.volume).toBe(0.4 * 0.5 * 0.8); // 0.16
  });
  
  it("should generate list item SFX correctly", () => {
    const manager = new SFXManager();
    const sfxList = manager.generateListItemSFX(3, 15);
    
    expect(sfxList).toHaveLength(3);
    expect(sfxList[0].startFrame).toBe(15);
    expect(sfxList[1].startFrame).toBe(21); // 15 + 6
    expect(sfxList[2].startFrame).toBe(27); // 15 + 12
  });
});
```

### 集成测试

```typescript
// 测试音效是否正确加载和播放
describe("Card SFX Integration", () => {
  it("should render stat card with SFX", async () => {
    const { getByTestId } = render(
      <StatTemplate shot={mockStatShot} durationInFrames={120} />
    );
    
    // 验证音效组件是否渲染
    const audioElements = document.querySelectorAll("audio");
    expect(audioElements.length).toBeGreaterThan(0);
  });
});
```

---

## 📈 性能优化

### 1. 音效预加载

```typescript
// 预加载常用音效
export function preloadCommonSFX() {
  const commonSounds = [
    "/sfx/card-entry/default.mp3",
    "/sfx/emphasis/reveal.mp3",
  ];
  
  commonSounds.forEach(src => {
    const audio = new Audio();
    audio.src = src;
    audio.load();
  });
}
```

### 2. 音效池管理

```typescript
// 限制同时播放的音效数量
class SFXPool {
  private maxConcurrent = 4;
  private playing: Set<string> = new Set();
  
  canPlay(id: string): boolean {
    return this.playing.size < this.maxConcurrent;
  }
  
  register(id: string): void {
    this.playing.add(id);
  }
  
  unregister(id: string): void {
    this.playing.delete(id);
  }
}
```

---

## 🔮 未来扩展方向

### 1. AI 音效生成

集成 ElevenLabs 或其他 AI 音效生成 API：

```typescript
// lib/audio/ai-sfx-generator.ts
export async function generateSFXFromDescription(
  description: string,
  duration: number = 1.5
): Promise<string> {
  const response = await fetch("/api/generate-sfx", {
    method: "POST",
    body: JSON.stringify({ description, duration }),
  });
  
  const { audioUrl } = await response.json();
  return audioUrl;
}

// 使用示例
const customSFX = await generateSFXFromDescription(
  "uplifting whoosh with digital ascending tone"
);
```

### 2. 音效情感匹配

根据内容情感动态调整音效：

```typescript
export function selectEmotionalSFX(
  variant: CardVariant,
  emotion: "positive" | "urgent" | "neutral"
): string {
  // 根据情感选择不同的音效变体
}
```

### 3. 用户自定义音效库

允许用户上传和管理自己的音效：

```typescript
export interface CustomSFXLibrary {
  userId: string;
  sounds: Record<string, {
    name: string;
    url: string;
    uploadedAt: string;
  }>;
}
```

---

## 📝 总结

### 实施优先级

**必须完成（MVP）**：
1. ✅ 类型系统和音效库配置
2. ✅ 音效管理器实现
3. ✅ 至少 5 种卡片集成音效
4. ✅ 基础音效素材（20-30 个文件）

**应该完成**：
1. ✅ 所有 11 种卡片集成音效
2. ✅ 用户控制界面
3. ✅ 动态音效生成（列表、时间线）

**可以完成**：
1. ⭕ 音效预览功能
2. ⭕ 用户自定义音效
3. ⭕ AI 音效生成

### 预估工作量

- **基础实现**：1-2 天（开发）+ 1 天（音效素材）
- **完整实现**：3-4 天（开发）+ 2 天（音效素材）
- **高级功能**：2-3 天（按需）

### 技术栈

- **核心**：Remotion Audio API
- **状态管理**：React useState/useEffect
- **音效库**：自建 + 第三方素材
- **未来扩展**：AI 音效生成 API

---

## 📞 需要帮助？

如果在实施过程中遇到问题，可以：

1. 查看 Remotion Audio 文档：https://www.remotion.dev/docs/using-audio
2. 参考本文档的代码示例
3. 在新对话或 AI Agent 中提问具体问题

祝实施顺利！🎉
