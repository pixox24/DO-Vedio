import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { Timeline, TimelineShot } from "@/lib/core/timeline";
import type { VideoTheme } from "@/lib/core/theme";
import { ensureFonts } from "./fonts";
import { AiLabel } from "./layers/ai-label";
import { AudioLayer } from "./layers/audio";
import { Subtitles } from "./layers/subtitles";
import { ImageShot } from "./shots/image";
import { PlaceholderShot } from "./shots/placeholder";
import { QuoteShot } from "./shots/quote";
import { TitleShot } from "./shots/title";
import { VideoShot } from "./shots/video";
import { ThemeContext } from "./theme";

ensureFonts();

export type VideoProps = { timeline: Timeline };

export function ShotView({ shot, durationInFrames, theme }: { shot: TimelineShot; durationInFrames: number; theme?: VideoTheme }) {
  const view = (() => {
    switch (shot.kind) {
      case "title":
        return <TitleShot shot={shot} durationInFrames={durationInFrames} />;
      case "quote":
        return <QuoteShot shot={shot} durationInFrames={durationInFrames} />;
      case "upload":
      case "image":
        return <ImageShot shot={shot} durationInFrames={durationInFrames} />;
      case "video":
        return <VideoShot shot={shot} durationInFrames={durationInFrames} />;
      default:
        return <PlaceholderShot shot={shot} durationInFrames={durationInFrames} />;
    }
  })();
  return theme ? <ThemeContext.Provider value={theme}>{view}</ThemeContext.Provider> : view;
}

/** 整片合成：画面轨 → 字幕 → 标识 → 音频 */
export function Video({ timeline: t }: VideoProps) {
  const { fps } = useVideoConfig();
  const fr = (ms: number) => Math.round((ms / 1000) * fps);
  return (
    <ThemeContext.Provider value={t.theme}>
    <AbsoluteFill style={{ background: "#000" }}>
      {t.shots.map((s) => {
        const from = fr(s.startMs);
        const dur = Math.max(1, fr(s.endMs) - from);
        return (
          <Sequence key={s.shotId} from={from} durationInFrames={dur} name={`镜头 ${s.kind}`}>
            <ShotView shot={s} durationInFrames={dur} />
          </Sequence>
        );
      })}
      {t.subtitle.enabled && <Subtitles cues={t.cues} highlight={t.subtitle.highlight} />}
      {t.aiLabel.enabled && <AiLabel position={t.aiLabel.position} />}
      <AudioLayer t={t} />
    </AbsoluteFill>
    </ThemeContext.Provider>
  );
}
