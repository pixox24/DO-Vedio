import { AbsoluteFill, Img } from "remotion";
import type { TimelineShot } from "@/lib/core/timeline";
import { Motion } from "../layers/motion";
import { PlaceholderShot } from "./placeholder";

/** 图片镜头（上传图 / P2 的 AI 生图）：按焦点裁剪填满画面 + 运镜；底图模糊铺满防止黑边 */
export function ImageShot({ shot, durationInFrames }: { shot: TimelineShot; durationInFrames: number }) {
  if (!shot.imageSrc) return <PlaceholderShot shot={shot} durationInFrames={durationInFrames} />;
  const pos = `${Math.round((shot.focus?.x ?? 0.5) * 100)}% ${Math.round((shot.focus?.y ?? 0.5) * 100)}%`;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Motion kind={shot.motion} durationInFrames={durationInFrames} origin={pos}>
        <Img src={shot.imageSrc} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: pos }} />
      </Motion>
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.18), transparent 30%, transparent 62%, rgba(0,0,0,0.5))" }} />
    </AbsoluteFill>
  );
}
