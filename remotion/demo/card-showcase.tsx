import { AbsoluteFill, Sequence } from "remotion";
import {
  CinematicCardTemplate,
} from "../animation/ui2v";
import type { Shot } from "@/lib/core/types";
import type { TimelineShot } from "@/lib/core/timeline";

/**
 * 卡片动画效果展示 Demo
 *
 * 展示统一的电影海报式卡片系统。
 * 四张代表帧用于确认字体、留白、细线和动效节奏。
 *
 * 每个卡片展示5秒，总时长20秒
 */

const CARD_DURATION = 150; // 5秒 @ 30fps
export const CARD_SHOWCASE_DURATION_IN_FRAMES = CARD_DURATION * 4;

// 模拟镜头数据
const createMockShot = (card: NonNullable<Shot["card"]>, chapterIndex: number): TimelineShot => ({
  shotId: "demo",
  startMs: 0,
  endMs: 4000,
  kind: "placeholder",
  mode: "motion",
  card: card ?? { variant: "headline", headline: "" },
  description: "示例卡片",
  caption: "示例文案",
  keywords: ["FILM STUDY"],
  chapter: { index: chapterIndex, title: "" },
  seed: 0,
  motion: "none",
});

export const CardShowcase = () => {
  const cards = [
    // 1. 短结论
    {
      name: "短结论",
      shot: createMockShot({ variant: "quote", headline: "留白制造注意力" }, 1),
      Component: CinematicCardTemplate,
    },

    // 2. 数据卡
    {
      name: "数据卡",
      shot: createMockShot({ variant: "stat", stat: { value: "85", unit: "%", label: "用户留存" } }, 2),
      Component: CinematicCardTemplate,
    },

    // 3. 列表卡
    {
      name: "列表卡",
      shot: createMockShot({ variant: "list", headline: "三个转折", items: ["观察", "删减", "重组"] }, 3),
      Component: CinematicCardTemplate,
    },

    // 4. 时间线卡
    {
      name: "时间线卡",
      shot: createMockShot({
        variant: "timeline",
        timeline: [
          { time: "2020", event: "启动" },
          { time: "2022", event: "发布" },
          { time: "2024", event: "更新" },
        ],
      }, 4),
      Component: CinematicCardTemplate,
    },
  ];

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {cards.map((card, index) => (
        <Sequence
          key={card.name}
          from={index * CARD_DURATION}
          durationInFrames={CARD_DURATION}
        >
          <AbsoluteFill>
            <card.Component shot={card.shot} durationInFrames={CARD_DURATION} anchors={[]} params={{}} />
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
