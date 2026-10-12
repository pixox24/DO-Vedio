"use client";

import { AbsoluteFill, Html5Audio, Sequence } from "remotion";
import { Player } from "@remotion/player";
import type { MotionCatalogItem } from "@/lib/core/motion-library";
import { scoreShot } from "@/lib/core/sfx";
import { defaultTheme } from "@/lib/core/theme";
import type { TimelineShot } from "@/lib/core/timeline";
import { ShotView } from "@/remotion/video";

const FPS = 30;
const FRAMES = 90;

function previewShot(item: MotionCatalogItem): TimelineShot {
  return {
    shotId: `motion-${item.id}`,
    kind: "placeholder",
    startMs: 0,
    endMs: (FRAMES / FPS) * 1000,
    motion: "none",
    description: item.name,
    caption: item.sampleText,
    keywords: [item.sampleText],
    seed: 1,
    mode: "motion",
    focusText: {
      text: item.sampleText,
      support: item.sampleSupport,
      layoutMode: "manual",
      presetId: item.id,
    },
    card: { variant: "headline", headline: item.sampleText },
  };
}

function MotionScene({ item, sfxSrc }: { item: MotionCatalogItem; sfxSrc?: string }) {
  const shot = previewShot(item);
  const cue = scoreShot(shot);
  const from = cue ? Math.max(0, Math.round((cue.offsetMs / 1000) * FPS)) : 0;
  const frames = cue ? Math.max(1, Math.round((cue.durationMs / 1000) * FPS)) : 1;
  return (
    <AbsoluteFill>
      <ShotView shot={shot} theme={defaultTheme} durationInFrames={FRAMES} />
      {cue && sfxSrc && (
        <Sequence from={from} durationInFrames={frames} layout="none">
          <Html5Audio src={sfxSrc} volume={cue.gain} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
}

export function MotionPreview({ item, sfxSrc }: { item: MotionCatalogItem; sfxSrc?: string }) {
  return (
    <Player
      component={MotionScene}
      inputProps={{ item, sfxSrc }}
      durationInFrames={FRAMES}
      compositionWidth={960}
      compositionHeight={540}
      fps={FPS}
      acknowledgeRemotionLicense
      autoPlay
      loop
      style={{ width: "100%", height: "100%" }}
    />
  );
}
