import { Composition } from "remotion";
import type { Timeline } from "@/lib/core/timeline";
import { defaultTheme } from "@/lib/core/theme";
import { Video, type VideoProps } from "./video";

const empty: Timeline = {
  fps: 30,
  width: 1920,
  height: 1080,
  aspect: "16:9",
  durationMs: 3000,
  durationInFrames: 90,
  title: "",
  theme: defaultTheme,
  voice: [],
  lines: [],
  shots: [],
  cues: [],
  music: [],
  sfx: [],
  subtitle: { enabled: true, highlight: true },
  aiLabel: { enabled: true, position: "top-right" },
  issues: [],
};

/** 只注册一个合成，尺寸、帧率、时长全部来自 inputProps 里的时间轴 */
export function Root() {
  return (
    <Composition
      id="Main"
      component={Video}
      defaultProps={{ timeline: empty } satisfies VideoProps}
      calculateMetadata={({ props }) => ({
        width: props.timeline.width,
        height: props.timeline.height,
        fps: props.timeline.fps,
        durationInFrames: props.timeline.durationInFrames,
      })}
    />
  );
}
