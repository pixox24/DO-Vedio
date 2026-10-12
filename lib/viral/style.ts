import type { StyleTemplate } from "../types";
import type { ViralStyleSnapshot, ViralTemplateSource } from "./types";

/** A deep copy, so editing a global template cannot change a running creation. */
export function captureViralStyle(template: ViralTemplateSource, at = new Date().toISOString()): ViralStyleSnapshot {
  return {
    templateId: template.id,
    templateName: template.name,
    capturedAt: at,
    tone: template.tone,
    dos: [...template.dos],
    donts: [...template.donts],
    rules: [],
    sample: template.sample,
    speechRate: template.speechRate,
  };
}

/** Examples stay in the UI snapshot, never in a writing request or evidence pool. */
export function generationStyle(style: ViralStyleSnapshot): ViralStyleSnapshot {
  return { ...style, dos: [...style.dos], donts: [...style.donts], rules: [...style.rules], sample: "" };
}

export function asViralTemplate(style: ViralStyleSnapshot): StyleTemplate {
  return {
    id: style.templateId, name: style.templateName, description: "本期风格快照", tone: style.tone,
    speechRate: style.speechRate, structureHints: "以本期已确认的角度和大纲为准", ideation: "",
    slang: "off", dos: [...style.dos, ...style.rules], donts: [...style.donts], sample: "",
  };
}
