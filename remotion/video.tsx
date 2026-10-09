import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { Timeline, TimelineShot } from "@/lib/core/timeline";
import type { VideoTheme } from "@/lib/core/theme";
import { isCodeCardShot } from "@/lib/core/legacy-templates";
import { ensureFonts } from "./fonts";
import { AiLabel } from "./layers/ai-label";
import { AudioLayer } from "./layers/audio";
import { Subtitles } from "./layers/subtitles";
import { ImageShot } from "./shots/image";
import { PlaceholderShot } from "./shots/placeholder";
import { QuoteShot } from "./shots/quote";
import { TitleShot } from "./shots/title";
import { VideoShot } from "./shots/video";
import { ChartShot, StockShot, UnsupportedModeShot } from "./shots/special";
import { ThemeContext } from "./theme";
import { TransitionLayer } from "./layers/transitions";
import { renderLegacyTemplate } from "./animation/legacy-templates";
import { FocusTextShot, isFocusTextShot } from "./animation/focus-text";

ensureFonts();

export type VideoProps = { timeline: Timeline };

export function ShotView({ shot, durationInFrames, theme }: { shot: TimelineShot; durationInFrames: number; theme?: VideoTheme }) {
  if (shot.mode === "real" && !shot.imageSrc && !shot.videoSrc) return <UnsupportedModeShot shot={shot} durationInFrames={durationInFrames} />;
  if (isFocusTextShot(shot)) {
    const view = <FocusTextShot shot={shot} durationInFrames={durationInFrames} />;
    return theme ? <ThemeContext.Provider value={theme}>{view}</ThemeContext.Provider> : view;
  }
  const legacyView = isCodeCardShot(shot) && shot.animation?.templateId
    ? renderLegacyTemplate(shot, durationInFrames)
    : null;
  const view = legacyView ?? (() => {
    switch (shot.kind) {
      case "title":
        return <TitleShot shot={shot} durationInFrames={durationInFrames} />;
      case "quote":
        return <QuoteShot shot={shot} durationInFrames={durationInFrames} />;
      case "placeholder":
        return <PlaceholderShot shot={shot} durationInFrames={durationInFrames} />;
      case "upload":
      case "image":
        return <ImageShot shot={shot} durationInFrames={durationInFrames} />;
      case "video":
        return <VideoShot shot={shot} durationInFrames={durationInFrames} />;
      case "stock":
        return <StockShot shot={shot} durationInFrames={durationInFrames} />;
      case "chart":
        return <ChartShot shot={shot} durationInFrames={durationInFrames} />;
      default:
        return <UnsupportedModeShot shot={shot} durationInFrames={durationInFrames} />;
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
      {t.shots.map((s, k) => {
        const from = fr(s.startMs);
        const baseDur = Math.max(1, fr(s.endMs) - from);
        const dur = baseDur + (s.overlapOutFrames ?? 0);
        const next = t.shots[k + 1];
        return (
          <Sequence key={s.shotId} from={from} durationInFrames={dur} name={`镜头 ${s.kind}`}>
            <TransitionLayer durationInFrames={dur} transitionIn={s.transitionIn} transitionOut={next?.transitionIn} overlapInFrames={s.overlapInFrames} overlapOutFrames={s.overlapOutFrames}>
              <ShotView shot={s} durationInFrames={dur} />
            </TransitionLayer>
          </Sequence>
        );
      })}
      {t.subtitle.enabled && t.subtitle.burnIn && <Subtitles blocks={t.subtitleBlocks} config={t.subtitle} />}
      {t.aiLabel.enabled && <AiLabel position={t.aiLabel.position} />}
      <AudioLayer t={t} />
    </AbsoluteFill>
    </ThemeContext.Provider>
  );
}
