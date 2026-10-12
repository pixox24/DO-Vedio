"use client";

import { AbsoluteFill, Html5Audio, Sequence } from "remotion";
import { Player } from "@remotion/player";
import { sfxSpecs, transitionSfxMount, WHOOSH_LEAD_MS } from "@/lib/core/sfx";
import { Motion } from "@/remotion/layers/motion";
import { TransitionLayer } from "@/remotion/layers/transitions";
import type { Motion as CameraMove, TransitionIn } from "@/lib/core/types";

const FRAMES = 90;

function Plate({ tone }: { tone: "out" | "in" }) {
  const background = tone === "out" ? "#1b2830" : "#24352c";
  const ink = tone === "out" ? "#d7e36a" : "#f4f0e8";
  return (
    <AbsoluteFill style={{ background }}>
      <div style={{ position: "absolute", left: "16%", top: "20%", width: "48%", height: "58%", borderRadius: 28, background: ink }} />
      <div style={{ position: "absolute", right: "14%", top: "16%", width: "18%", height: "18%", borderRadius: 999, border: `10px solid ${ink}` }} />
    </AbsoluteFill>
  );
}

function CameraScene({ kind }: { kind: CameraMove }) {
  return <Motion kind={kind} durationInFrames={FRAMES}><Plate tone="in" /></Motion>;
}

function TransitionScene({ kind, sfxSrc }: { kind: TransitionIn; sfxSrc?: string }) {
  const overlap = kind === "cut" ? 0 : 28;
  const role = transitionSfxMount[kind];
  const spec = role ? sfxSpecs[role] : undefined;
  const leadMs = role === "whoosh" ? -WHOOSH_LEAD_MS : 0;
  const from = spec ? Math.max(0, 36 + Math.round((leadMs / 1000) * 30)) : 0;
  const frames = spec ? Math.max(1, Math.round((spec.durationMs / 1000) * 30)) : 1;
  return (
    <AbsoluteFill>
      <Plate tone="out" />
      <Sequence from={36} durationInFrames={54}>
        <TransitionLayer durationInFrames={54} transitionIn={kind} overlapInFrames={overlap}>
          <Plate tone="in" />
        </TransitionLayer>
      </Sequence>
      {spec && sfxSrc && (
        <Sequence from={from} durationInFrames={frames} layout="none">
          <Html5Audio src={sfxSrc} volume={spec.gain} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
}

const player = { durationInFrames: FRAMES, compositionWidth: 960, compositionHeight: 540, fps: 30, acknowledgeRemotionLicense: true, autoPlay: true, loop: true, style: { width: "100%", height: "100%" } } as const;

export function CameraShelfPreview({ id }: { id: CameraMove }) {
  return <Player component={CameraScene} inputProps={{ kind: id }} {...player} />;
}

export function TransitionShelfPreview({ id, sfxSrc }: { id: TransitionIn; sfxSrc?: string }) {
  return <Player component={TransitionScene} inputProps={{ kind: id, sfxSrc }} {...player} />;
}
