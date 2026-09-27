import { Html5Audio, Sequence, useVideoConfig } from "remotion";
import { dbToGain, envelopeAt, fadeAt } from "@/lib/core/mix";
import type { Timeline } from "@/lib/core/timeline";

const f = (ms: number, fps: number) => Math.round((ms / 1000) * fps);

/** 旁白、配乐（带自动压低和淡入淡出）、音效。预览和渲染同一份代码 */
export function AudioLayer({ t }: { t: Timeline }) {
  const { fps } = useVideoConfig();
  return (
    <>
      {t.voice.map((v) => (
        <Sequence key={`v-${v.lineId}`} from={f(v.startMs, fps)} durationInFrames={Math.max(1, f(v.durationMs + 120, fps))} name={`旁白 ${v.lineId.slice(0, 4)}`} layout="none">
          <Html5Audio src={v.src} trimBefore={f(v.trimStartMs, fps)} pauseWhenBuffering />
        </Sequence>
      ))}
      {t.music.map((m, k) => {
        const len = m.endMs - m.startMs;
        return (
          <Sequence key={`m-${k}`} from={f(m.startMs, fps)} durationInFrames={Math.max(1, f(len, fps))} name={`配乐 ${m.trackId}`} layout="none">
            <Html5Audio
              src={m.src}
              loop={m.loop}
              trimBefore={f(m.offsetMs, fps)}
              loopVolumeCurveBehavior="extend"
              volume={(frame) => {
                const local = (frame / fps) * 1000;
                return m.baseGain * dbToGain(envelopeAt(m.envelope, m.startMs + local)) * fadeAt(local, len, m.fadeInMs, m.fadeOutMs);
              }}
            />
          </Sequence>
        );
      })}
      {t.sfx.map((s, k) => (
        <Sequence key={`s-${k}`} from={f(s.atMs, fps)} durationInFrames={f(1500, fps)} name="音效" layout="none">
          <Html5Audio src={s.src} volume={s.gain} />
        </Sequence>
      ))}
    </>
  );
}
