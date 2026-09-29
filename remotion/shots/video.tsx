import { AbsoluteFill, Video as RemotionVideo } from "remotion";
import type { TimelineShot } from "@/lib/core/timeline";
import { Motion } from "../layers/motion";
import { PlaceholderShot } from "./placeholder";

/** AI 视频镜头。视频自身静音，整片旁白和配乐仍由 AudioLayer 统一混音。 */
export function VideoShot({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  if (!shot.videoSrc) return <PlaceholderShot shot={shot} durationInFrames={durationInFrames} />;
  const pos = `${Math.round((shot.focus?.x ?? 0.5) * 100)}% ${Math.round((shot.focus?.y ?? 0.5) * 100)}%`;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Motion kind={shot.motion} durationInFrames={durationInFrames} origin={pos}>
        <RemotionVideo src={shot.videoSrc} muted loop style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: pos }} />
      </Motion>
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.18), transparent 30%, transparent 62%, rgba(0,0,0,0.5))" }} />
    </AbsoluteFill>
  );
}
