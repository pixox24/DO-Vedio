import { AbsoluteFill, Sequence } from "remotion";
import type { TimelineShot } from "@/lib/core/timeline";
import type { Card, ShotKind } from "@/lib/core/types";
import { CinematicCardTemplate } from "../animation/legacy-templates";

export const CINEMATIC_TEMPLATE_STILL_DURATION = 90;

type StillCase = {
  label: string;
  kind: ShotKind;
  card: Card;
};

const cases: StillCase[] = [
  { label: "片头", kind: "title", card: { variant: "headline", headline: "新的观看方式" } },
  { label: "金句", kind: "quote", card: { variant: "quote", headline: "留白制造注意力" } },
  { label: "对照", kind: "placeholder", card: { variant: "split", sides: ["堆叠", "留白"] } },
  { label: "数据", kind: "placeholder", card: { variant: "stat", stat: { value: "85", unit: "%", label: "用户留存" } } },
  { label: "列表", kind: "placeholder", card: { variant: "list", headline: "三个转折", items: ["观察", "删减", "重组"] } },
  { label: "提示", kind: "placeholder", card: { variant: "alert", alert: { type: "info", content: "保留真正重要的部分" } } },
  { label: "定义", kind: "placeholder", card: { variant: "definition", definition: { term: "留白", meaning: "让信息拥有呼吸" } } },
  { label: "时间线", kind: "placeholder", card: { variant: "timeline", timeline: [{ time: "2020", event: "启动" }, { time: "2022", event: "发布" }, { time: "2024", event: "更新" }] } },
  { label: "人物", kind: "placeholder", card: { variant: "profile", profile: { name: "张伟", role: "首席设计师", bio: "长期研究观看体验" } } },
];

function mockShot(item: StillCase, index: number): TimelineShot {
  return {
    shotId: `cinematic-still-${index}`,
    startMs: 0,
    endMs: 3000,
    kind: item.kind,
    mode: "motion",
    card: item.card,
    description: item.label,
    caption: item.label,
    keywords: [item.label],
    seed: index,
    motion: "none",
    chapter: { index: index + 1, title: item.label },
    animation: { family: "none", intensity: 1, anchors: [], params: { seriesTotal: 9 } },
  };
}

export function CinematicTemplateStills() {
  return (
    <AbsoluteFill style={{ background: "#050505" }}>
      {cases.map((item, index) => (
        <Sequence key={item.label} from={index * CINEMATIC_TEMPLATE_STILL_DURATION} durationInFrames={CINEMATIC_TEMPLATE_STILL_DURATION}>
          <CinematicCardTemplate shot={mockShot(item, index)} durationInFrames={CINEMATIC_TEMPLATE_STILL_DURATION} anchors={[]} params={{}} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
