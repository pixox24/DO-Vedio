import type { ViralScriptVersion } from "./types";

/** Export has one source: the selected version, with no reports or provenance metadata. */
export function viralPlainText(version: Pick<ViralScriptVersion, "title" | "segments">): string {
  return [version.title.trim(), ...version.segments.map((segment) => segment.text.trim()).filter(Boolean)].filter(Boolean).join("\n\n");
}

export function viralMarkdown(version: Pick<ViralScriptVersion, "title" | "segments">): string {
  return `# ${version.title.replace(/\r?\n/g, " ").trim()}\n\n${version.segments.map((segment) => segment.text.trim()).filter(Boolean).join("\n\n")}\n`;
}

export function viralExportFilename(version: Pick<ViralScriptVersion, "title">): string {
  return `${version.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80) || "口播稿"}.md`;
}

export const exportViralMarkdown = viralMarkdown;
