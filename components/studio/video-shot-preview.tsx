"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { Icon } from "@/components/ui";
import { mediaUrl } from "@/lib/core/types";
import type { Timeline, TimelineShot } from "@/lib/core/timeline";
import styles from "./video-storyboard.module.css";

const ShotThumbnail = dynamic(() => import("../shot-thumbnail").then((module) => module.ShotThumbnail), { ssr: false });

/** Both the overview and editor share one player: only one shot plays at a time. */
export function stopShotPreview(ownerRef: RefObject<HTMLVideoElement | null>) {
  const video = ownerRef.current;
  if (!video) return;
  ownerRef.current = null;
  video.pause();
  if (video.readyState > 0) video.currentTime = 0;
}

export function VideoShotPreview({ assetId, referenceAssetId, timed, timeline, compact = false, hovered = false, ownerRef, label, onReady, onMediaError }: {
  assetId?: string; referenceAssetId?: string; timed?: TimelineShot; timeline: Timeline | null;
  compact?: boolean; hovered?: boolean; ownerRef: RefObject<HTMLVideoElement | null>; label: string;
  onReady?: () => void; onMediaError?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reset = () => {
      video.pause();
      if (video.readyState > 0) video.currentTime = 0;
      if (ownerRef.current === video) ownerRef.current = null;
    };
    const observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) reset(); });
    observer.observe(video);
    return () => { observer.disconnect(); reset(); };
  }, [assetId, ownerRef]);

  useEffect(() => {
    if (!compact || !hovered || !assetId) return;
    const video = ref.current;
    const timer = window.setTimeout(() => { if (!document.hidden) void video?.play().catch(() => {}); }, 200);
    return () => {
      window.clearTimeout(timer);
      video?.pause();
      if (video && video.readyState > 0) video.currentTime = 0;
    };
  }, [compact, hovered, assetId]);

  function mediaReady() { setReady(true); setFailed(false); onReady?.(); }
  function mediaFailed() { setFailed(true); setPlaying(false); onMediaError?.(); }

  const error = failed && <span className={styles.previewError} role="status"><Icon name="alert" className="size-3.5 shrink-0" />{assetId ? "视频暂不可用，请展开检查" : "参考图暂不可用"}</span>;
  if (assetId) return <>
    {!ready && (referenceAssetId ? <Image src={mediaUrl(referenceAssetId)} alt={`${label}参考图`} fill unoptimized sizes={compact ? "400px" : "720px"} className="object-contain" /> : <span className={styles.placeholder}>正在载入视频</span>)}
    <video ref={ref} src={mediaUrl(assetId)} aria-label={label} muted playsInline loop={compact} controls={!compact && !failed} preload="metadata" data-ready={ready} className={`${styles.previewVideo} ${compact ? "pointer-events-none" : ""}`}
      onLoadedData={mediaReady} onError={mediaFailed}
      onPlay={(event) => {
        if (ownerRef.current !== event.currentTarget) stopShotPreview(ownerRef);
        ownerRef.current = event.currentTarget;
        setPlaying(true);
      }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    {compact && !failed && <>
      {!playing && ready && <span className={styles.playCenter}><span><Icon name="play" className="size-4" /></span></span>}
      <button type="button" className={styles.playButton} aria-pressed={playing} aria-label={`${playing ? "暂停" : "播放"}${label}`} onClick={() => {
        const video = ref.current;
        if (video?.paused) void video.play().catch(() => {}); else video?.pause();
      }}><Icon name={playing ? "pause" : "play"} /></button>
    </>}
    {error}
  </>;
  if (referenceAssetId) return <><Image src={mediaUrl(referenceAssetId)} alt={`${label}参考图`} fill unoptimized sizes={compact ? "400px" : "720px"} className={styles.previewImage} onLoad={mediaReady} onError={mediaFailed} />{error}</>;
  // Reuse the image-pipeline placeholder, without leaking another output's media.
  if (timed && timeline) return <span className="pointer-events-none absolute inset-0"><ShotThumbnail shot={{ ...timed, kind: "placeholder", imageSrc: undefined, videoSrc: undefined }} width={timeline.width} height={timeline.height} fps={timeline.fps} theme={timeline.theme} animated={false} /></span>;
  return <span className={styles.placeholder}><span className="flex flex-col items-center gap-2"><Icon name="frames" className="size-5" />分镜已就绪</span></span>;
}
