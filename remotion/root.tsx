import { CardShowcase, CARD_SHOWCASE_DURATION_IN_FRAMES } from "./demo/card-showcase";
import { CinematicTemplateStills, CINEMATIC_TEMPLATE_STILL_DURATION } from "./demo/cinematic-template-stills";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { TypographyExploration, TYPOGRAPHY_STUDIES } from "./demo/typography-explorations";
import { SwissTypographyStill, SWISS_TYPOGRAPHY_STUDIES } from "./demo/swiss-typography-stills";
import type { Timeline } from "@/lib/core/timeline";
import { videoCompositionMetadata } from "@/lib/core/video-composition";
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

const calculateVideoMetadata: CalculateMetadataFunction<VideoProps> = ({ props }) => videoCompositionMetadata(props.timeline);

/** 只注册一个合成。渲染时用时间轴上的输出规格覆盖默认的 3 秒、1920×1080。 */
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
        calculateMetadata={calculateVideoMetadata}
      />

      <Composition
        id="CardShowcase"
        component={CardShowcase}
        durationInFrames={CARD_SHOWCASE_DURATION_IN_FRAMES}
        fps={30}
        width={1920}
        height={1080}
      />

      <Composition
        id="CinematicTemplateStills"
        component={CinematicTemplateStills}
        durationInFrames={CINEMATIC_TEMPLATE_STILL_DURATION * 9}
        fps={30}
        width={1920}
        height={1080}
      />
      {TYPOGRAPHY_STUDIES.map((study, index) => (
        <Composition
          key={study.id}
          id={study.id}
          component={TypographyExploration}
          defaultProps={{ study: index }}
          durationInFrames={1}
          fps={30}
          width={1920}
          height={1080}
        />
      ))}
      {SWISS_TYPOGRAPHY_STUDIES.map((study, index) => (
        <Composition
          key={study.id}
          id={study.id}
          component={SwissTypographyStill}
          defaultProps={{ study: index }}
          durationInFrames={1}
          fps={30}
          width={1920}
          height={1080}
        />
      ))}
    </>
  );
}
