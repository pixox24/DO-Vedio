import { AbsoluteFill, Freeze, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import type { TimelineShot } from "@/lib/core/timeline";
import { PlaceholderShot } from "./placeholder";
import { renderOverlayAnimation } from "../animation/overlay";
import { FocusTextShot } from "../animation/focus-text";

/** Video trims and Freeze frames use composition fps, never source frame counts. */
export function videoPlaybackFrames(shot: TimelineShot, fps: number) {
  const trimBefore = Math.max(0, Math.round((shot.videoTrimStartMs ?? 0) * fps / 1000));
  const playableMs = shot.videoPlayableDurationMs ?? Math.max(0, shot.endMs - shot.startMs);
  const holdMs = shot.videoHoldLastFrameMs ?? 0;
  const hold = shot.videoDurationReady === true && holdMs > 0 && holdMs <= 100;
  const holdFrom = Math.max(1, Math.ceil(playableMs * fps / 1000));
  const sourceFps = shot.videoSourceFps;
  // A fractional Freeze frame seeks the actual final source frame even at 24 → 30 fps.
  const lastSourceMs = shot.videoSourceDurationMs !== undefined && sourceFps && sourceFps > 0
    ? Math.max(0, shot.videoSourceDurationMs - 1000 / sourceFps)
    : undefined;
  const freezeFrame = lastSourceMs === undefined
    ? holdFrom - 1
    : Math.max(0, lastSourceMs * fps / 1000 - trimBefore);
  return { trimBefore, hold, holdFrom, freezeFrame };
}

/** AI 视频镜头。视频自身静音，整片旁白和配乐仍由 AudioLayer 统一混音。 */
export function VideoShot({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!shot.videoSrc) return <PlaceholderShot shot={shot} durationInFrames={durationInFrames} />;
  const playback = videoPlaybackFrames(shot, fps);
  const pos = `${Math.round((shot.focus?.x ?? 0.5) * 100)}% ${Math.round((shot.focus?.y ?? 0.5) * 100)}%`;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Freeze frame={playback.freezeFrame} active={playback.hold && frame >= playback.holdFrom}>
        <OffthreadVideo src={shot.videoSrc} muted trimBefore={playback.trimBefore} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: pos }} />
      </Freeze>
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.18), transparent 30%, transparent 62%, rgba(0,0,0,0.5))" }} />
      {shot.mode === "composite" && renderOverlayAnimation(shot, durationInFrames)}
      {shot.focusText && <FocusTextShot shot={shot} durationInFrames={durationInFrames} overlay />}
    </AbsoluteFill>
  );
}
