import { aspects, outputSpecs, type Aspect, type OutputSpec, type OutputSpecId, type ProjectDoc, type Settings } from "./types";

export type GenerationFrame = { aspect: Aspect; width: number; height: number; fps?: number };

export function outputSpecIdForAspect(aspect: Aspect): OutputSpecId {
  return aspect === "9:16" ? "portrait-1080p" : "landscape-1080p";
}

export function outputSpecsFor(settings: Pick<Settings, "aspects" | "outputSpecIds">): OutputSpec[] {
  const ids = settings.outputSpecIds?.length ? settings.outputSpecIds : settings.aspects.map(outputSpecIdForAspect);
  return ids.map((id) => outputSpecs[id]);
}

export function normalizeSettings(input: unknown): Settings {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<Settings>;
  const aspectsValue: Aspect[] = raw.aspects?.length ? [...raw.aspects] : ["16:9"];
  const outputSpecIds: OutputSpecId[] = raw.outputSpecIds?.length ? [...raw.outputSpecIds] : aspectsValue.map(outputSpecIdForAspect);
  const previewAspect = raw.previewAspect && outputSpecsFor({ aspects: aspectsValue, outputSpecIds }).some((spec) => spec.aspect === raw.previewAspect)
    ? raw.previewAspect
    : outputSpecs[outputSpecIds[0]].aspect;
  return {
    ...raw,
    aspects: aspectsValue,
    outputSpecIds,
    previewAspect,
    assetFraming: raw.assetFraming ?? "smart-dual",
  } as Settings;
}

export function outputSpecsForDoc(doc: Pick<ProjectDoc, "settings">) {
  return outputSpecsFor(normalizeSettings(doc.settings));
}

export function previewSpecFor(settings: Settings): OutputSpec {
  const normalized = normalizeSettings(settings);
  return outputSpecsFor(normalized).find((spec) => spec.aspect === normalized.previewAspect) ?? outputSpecsFor(normalized)[0];
}

export function aspectsForSettings(settings: Settings): Aspect[] {
  return outputSpecsFor(normalizeSettings(settings)).map((spec) => spec.aspect);
}

export function isOutputAspect(value: string): value is Aspect {
  return aspects.includes(value as Aspect);
}

export function outputSpecForRequest(settings: Settings, outputSpecId?: OutputSpecId, aspect?: Aspect): OutputSpec {
  const specs = outputSpecsFor(normalizeSettings(settings));
  if (outputSpecId) return outputSpecs[outputSpecId] ?? specs[0];
  if (aspect) return specs.find((spec) => spec.aspect === aspect) ?? outputSpecs[outputSpecIdForAspect(aspect)];
  return previewSpecFor(settings);
}
