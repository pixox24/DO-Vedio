import { CardShowcase, CARD_SHOWCASE_DURATION_IN_FRAMES } from "./demo/card-showcase";
import { Composition } from "remotion";
import type { Timeline } from "@/lib/core/timeline";
import { DEFAULT_SUBTITLE_CONFIG } from "@/lib/core/subtitle";
import { defaultTheme } from "@/lib/core/theme";
import { Video, type VideoProps } from "./video";

const empty: Timeline = {
  outputSpecId: "landscape-1080p",
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
  subtitleBlocks: [],
  music: [],
  sfx: [],
  subtitle: DEFAULT_SUBTITLE_CONFIG,
  aiLabel: { enabled: true, position: "top-right" },
  issues: [],
};

/** 只注册一个合成，尺寸、帧率、时长全部来自 inputProps 里的时间轴 */
export function Root() {
  return (
    <>
      <Composition
        id="Video"
        component={Video}
        durationInFrames={empty.durationInFrames}
        fps={empty.fps}
        width={empty.width}
        height={empty.height}
        defaultProps={{ timeline: empty } satisfies VideoProps}
      />

      <Composition
        id="CardShowcase"
        component={CardShowcase}
        durationInFrames={CARD_SHOWCASE_DURATION_IN_FRAMES}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
}
