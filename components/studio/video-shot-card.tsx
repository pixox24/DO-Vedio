"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Icon } from "@/components/ui";
import type { OutputSpec, Shot } from "@/lib/core/types";
import type { Timeline, TimelineShot } from "@/lib/core/timeline";
import { shotTime } from "./shot-view";
import { VideoShotPreview } from "./video-shot-preview";
import styles from "./video-storyboard.module.css";

export type ShotCardStatus = {
  label: string;
  tone: "neutral" | "working" | "success" | "warning" | "danger";
  activity?: "image" | "video" | "plan";
  ready: boolean;
};

export function VideoShotCard({ shot, index, frame, timeline, timed, caption, assetId, mediaLabel, status, isOpen, hovered, redo, onRedo, onToggle, onHover, ownerRef }: {
  shot: Shot; index: number; frame: OutputSpec; timeline: Timeline | null; timed?: TimelineShot;
  caption: string; assetId?: string; mediaLabel?: string; status: ShotCardStatus; isOpen: boolean; hovered: boolean;
  redo: boolean; onRedo?: (value: boolean) => void; onToggle: () => void; onHover: (value: boolean) => void;
  ownerRef: RefObject<HTMLVideoElement | null>;
}) {
  const card = useRef<HTMLElement>(null);
  const mediaKey = assetId ? `video:${assetId}` : shot.sourceImageAssetId ? `image:${shot.sourceImageAssetId}` : "placeholder";
  // A polling update, reopening details, or returning to an old candidate is not a new result.
  const seenMedia = useRef(new Set([mediaKey]));
  const [loadedMedia, setLoadedMedia] = useState("");
  const [failedMedia, setFailedMedia] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const element = card.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => { element.dataset.motionActive = String(entry.isIntersecting); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!completed) return;
    const timer = window.setTimeout(() => setCompleted(false), 650);
    return () => window.clearTimeout(timer);
  }, [completed]);

  function mediaReady() {
    setLoadedMedia(mediaKey);
    setFailedMedia("");
    if (!seenMedia.current.has(mediaKey)) {
      seenMedia.current.add(mediaKey);
      // Results arriving off screen are visible on return, without replaying a celebration.
      if (card.current?.dataset.motionActive === "true" && !document.hidden) setCompleted(true);
    }
  }
  const unavailable = failedMedia === mediaKey;
  const loadingVideo = status.ready && !!assetId && loadedMedia !== mediaKey;
  const label = unavailable ? "画面加载失败 · 展开处理" : redo ? "已标记重做" : loadingVideo ? "正在载入视频" : status.label;
  const tone = unavailable ? "danger" : redo ? "warning" : loadingVideo ? "neutral" : status.tone;

  return <article ref={card} id={`shot-card-${shot.id}`} aria-label={`镜头 ${index}`} data-storyboard-card data-open={isOpen} data-motion-active="false" className={`${styles.card} ${completed ? styles.completed : ""}`}
    onPointerEnter={(event) => { if (event.pointerType === "mouse") onHover(true); }} onPointerLeave={() => onHover(false)}>
    <div className={styles.media} style={{ aspectRatio: `${frame.width} / ${frame.height}` }}>
      <VideoShotPreview key={mediaKey} assetId={assetId} referenceAssetId={shot.sourceImageAssetId} timed={timed} timeline={timeline} compact hovered={hovered && !isOpen} ownerRef={ownerRef} label={`镜头 ${index}视频`} onReady={mediaReady} onMediaError={() => setFailedMedia(mediaKey)} />
      <button type="button" data-shot-toggle className={styles.mediaToggle} aria-expanded={isOpen} aria-controls={`video-detail-${shot.id}`} aria-label={`镜头 ${index}，${isOpen ? "收起" : "展开"}编辑`} onClick={onToggle} />
      {mediaLabel && <span className={styles.mediaLabel}>{mediaLabel}</span>}
      {status.activity === "image" && !assetId && !shot.sourceImageAssetId && <span className={styles.imageShimmer} aria-hidden="true" />}
    </div>
    <button type="button" className={styles.summary} aria-expanded={isOpen} aria-controls={`video-detail-${shot.id}`} aria-label={`镜头 ${index}详情`} onClick={onToggle}>
      <span className="flex items-center gap-1.5 text-xs"><span className="font-medium">镜头 {String(index).padStart(2, "0")}</span><Icon name="chevron" className={`size-3 ${styles.chevron}`} />{shot.locked && <Icon name="lock" className="size-3 text-text-muted" />}<span className="ml-auto shrink-0 text-2xs tabular-nums text-text-muted">{timed ? `${shotTime(timed.startMs)}–${shotTime(timed.endMs)}` : "计算中"}</span></span>
      <span className="mt-1.5 block truncate text-xs text-text-secondary" title={caption}>{caption}</span>
    </button>
    <div className={styles.footer}>
      <p role="status" className={styles.status} data-tone={tone} title={label}>
        {unavailable || tone === "danger" || tone === "warning" ? <Icon name={redo ? "undo" : "alert"} className="size-3 shrink-0" />
          : status.activity === "video" ? <span className={styles.videoActivity} aria-hidden="true"><span /><span /><span /></span>
            : status.activity ? <span className={`${styles.dot} ${styles.liveDot}`} aria-hidden="true" />
              : status.ready && !loadingVideo ? <Icon name="check" className="size-3 shrink-0" /> : <span className={styles.dot} aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </p>
      {onRedo && <label className="flex min-h-6 shrink-0 cursor-pointer items-center gap-1.5 text-2xs text-text-muted pointer-coarse:min-h-11"><input type="checkbox" className="size-3 accent-accent" aria-label={`镜头 ${index}参考图需要重做`} checked={redo} onChange={(event) => onRedo(event.target.checked)} />重做</label>}
    </div>
    {status.activity && <div className={styles.activityClip} aria-hidden="true"><span className={styles.activityTrack} /></div>}
  </article>;
}
