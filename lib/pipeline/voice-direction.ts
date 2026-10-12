import { quickHash } from "../core/hash";
import { deliveryTagChoices, type DeliveryTag, type ProjectDoc } from "../core/types";
import { templateForDirection } from "../templates/store";

/** 生成失败记成 null。下次用户开始制作时清掉，同一次自动推进不再反复调用。 */
export type VoiceDirectionCache = { instruction: string | null };

const deliveryLabels = new Map(deliveryTagChoices.map((choice) => [choice.value, choice.label]));

export function sanitizeVoiceInstruction(raw: string) {
  const cleaned = raw.replace(/\[[^\]\n]{0,80}\]/g, "").replace(/\s+/g, " ").trim();
  const sentence = (cleaned.match(/^.*?[。！？]/)?.[0] ?? cleaned).trim();
  const text = [...sentence].slice(0, 80).join("");
  return /[A-Za-z0-9\u4e00-\u9fff]/.test(text) ? text : "";
}

export function voiceDirectionMaterial(doc: ProjectDoc) {
  const moods = new Map<string, number>();
  const tagged: { text: string; tag: string }[] = [];
  for (const line of doc.lines) {
    if (line.mood) moods.set(line.mood, (moods.get(line.mood) ?? 0) + 1);
    if (line.voiceTag && line.voiceTag !== "auto" && line.voiceTag !== "none" && !line.voiceTag.startsWith("ssml:")) {
      tagged.push({ text: line.text, tag: deliveryLabels.get(line.voiceTag as DeliveryTag) ?? line.voiceTag });
    }
  }
  return {
    title: doc.brief.title,
    perspective: doc.brief.perspective,
    style: templateForDirection(doc.brief.templateId),
    script: doc.lines.map((line) => line.text).join("\n"),
    moods: [...moods.entries()].map(([mood, count]) => ({ mood, count })),
    tagged,
  };
}

export function voiceDirectionKey(doc: ProjectDoc, modelId: string) {
  return `voice-direction:${quickHash({ v: 1, modelId, ...voiceDirectionMaterial(doc) })}`;
}
