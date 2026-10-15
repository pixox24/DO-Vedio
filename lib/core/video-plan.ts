import { anchorText, lookAt } from "./cast";
import { quickHash } from "./hash";
import type { ProjectDoc, Shot, VideoPlan } from "./types";

export const videoDescriptionHash = (description: string) => quickHash(description.trim());

/** Old plans remain usable until the user actually edits their Chinese description. */
export function videoPlanNeedsSync(shot: Shot): boolean {
  return shot.kind === "video" && !!shot.videoPlan && !!shot.videoPlanDescriptionHash
    && shot.videoPlanDescriptionHash !== videoDescriptionHash(shot.description);
}

/** Save boundary: every client, including older clients, must invalidate the old plan. */
export function markVideoPlanDescriptionEdits(previous: ProjectDoc, next: ProjectDoc): ProjectDoc {
  const before = new Map(previous.shots.map((shot) => [shot.id, shot]));
  return { ...next, shots: next.shots.map((shot) => {
    const old = before.get(shot.id);
    if (shot.kind !== "video" || !shot.videoPlan || !old?.videoPlan) return shot;
    if (old.description.trim() === shot.description.trim()) return videoPlanNeedsSync(old) ? { ...shot, videoPlanDescriptionHash: old.videoPlanDescriptionHash } : shot;
    return { ...shot, videoPlanDescriptionHash: old.videoPlanDescriptionHash ?? videoDescriptionHash(old.description), sourceImageConfirmedHash: undefined };
  }) };
}

/** Only semantic inputs: completing an auxiliary image does not invalidate translation. */
export function videoPlanSyncFingerprint(doc: ProjectDoc, shot: Shot): string {
  const scene = doc.scenes.find((entry) => entry.id === shot.sceneId);
  return quickHash({
    version: 1, id: shot.id, at: shot.at, description: shot.description, previousPlan: shot.videoPlan, shotSize: shot.shotSize,
    line: doc.lines.find((line) => line.id === shot.at.lineId)?.text,
    characters: shot.characterIds.map((id) => {
      const card = doc.characters.find((entry) => entry.id === id);
      return { id, anchor: card ? anchorText(card, lookAt(card, shot.at.lineId, doc.lines)) : undefined };
    }),
    scene: scene && { id: scene.id, name: scene.name, description: scene.description }, style: doc.visualStyle,
  });
}

// ponytail: lexical guard for legacy plans, not a semantic translator. New plans
// must still be authored as silent visual actions by the director.
const vocalOrOverlay = /\b(?:says?|saying|speaks?|speaking|spoke|spoken|whispers?|whispering|talks?|talking|shouts?|shouting|yells?|yelling|sings?|singing|repl(?:y|ies|ying)|utters?|utter(?:ed|ing)|announc(?:e|es|ing)|dialogue|dialog|voice-?over|narration|lips?|lip[ -]?(?:sync\w*|mov\w*)|mouth\w*|subtitles?|captions?|on[ -]screen text|text overlay)\b|台词|对白|对话|说|低语|耳语|开口|张嘴|嘴唇|口型|口形|唇形|字幕|旁白|配音|唱歌|喊道|喊出|文字(?:浮现|出现|叠加)|(?:绘制|显示|添加|生成|叠加)(?:文字|文本)/iu;

function silentVisualText(text: string, fallback: string): string {
  const cleaned = text
    .replace(/<d\b[^>]*>[\s\S]*?<\/d>/giu, "")
    .replace(/\bwithout\s+(?:speaking|talking|dialogue|lip[ -]sync(?:hronization)?)(?:\s+or\s+(?:speaking|talking|dialogue))?/giu, "")
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|(?<!\p{L})'[^'\n]*'(?!\p{L})/gu, "");
  if (!vocalOrOverlay.test(cleaned)) return cleaned.trim() || fallback;
  const clauses = cleaned.split(/(?:[.!?;。！？；\n]+|[,，]|\s+(?:and(?: then)?|then|while)\s+|然后|随后|并且|同时|接着|并)/iu);
  const visual = clauses.map((clause) => clause.trim()).filter((clause) => clause && !vocalOrOverlay.test(clause));
  return visual.length ? `${visual.join(". ").replace(/[.:：\s]+$/u, "")}.` : fallback;
}

/** Strip performance/text instructions before either static or motion generation. */
export function sanitizeVideoPlan(plan: VideoPlan): VideoPlan {
  return {
    startState: silentVisualText(plan.startState, "The established subjects are still in their planned environment."),
    action: silentVisualText(plan.action, "The subjects remain silent with subtle natural motion."),
    camera: silentVisualText(plan.camera, "Maintain the opening composition with a steady camera."),
    endState: silentVisualText(plan.endState, "The subjects settle naturally in the established environment."),
  };
}


export function videoReferenceDescription(shot: Shot): string {
  return shot.videoPlan ? sanitizeVideoPlan(shot.videoPlan).startState : silentVisualText(shot.description, "The established subjects are still in their planned environment.");
}
