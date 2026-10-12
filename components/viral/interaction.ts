import type { ViralCommand, ViralMode } from "@/lib/viral/types";
import type { ViralClientState } from "./draft-client";
import type { ViralFocusRequest, ViralViewStage } from "./view-props";

const fieldOrder = ["referenceText", "topic", "platform", "targetSeconds", "materials", "modelId"];

export function explicitCommandFocus(command: ViralCommand, mode: ViralMode, fields: Record<string, string>, token: number): ViralFocusRequest | null {
  const field = fieldOrder.find((name) => fields[name]) ?? Object.keys(fields)[0];
  if (field) return { token, target: "field", field };
  return command === "quick" && mode === "quick" ? { token, target: "result" } : null;
}

export function fieldViewStage(field: string): ViralViewStage | null {
  if (field.startsWith("reference")) return "reference";
  if (["topic", "platform", "targetSeconds", "audience", "coreClaim", "contentKind"].includes(field)) return "task";
  if (["modelId", "style", "rate", "perspective", "memes", "humanize", "mustInclude", "avoid", "ending", "handoff"].includes(field)) return "style";
  return null;
}

/** Publishing a new address must not unmount an explicit submit or hide its validation feedback. */
export function canNavigateCreatedDraft(createdId: string | null, busy: boolean, state: Pick<ViralClientState, "error" | "saveState">, commandsReady: boolean, dirty: boolean): boolean {
  return Boolean(createdId && commandsReady && !busy && !dirty && !state.error && state.saveState !== "saving" && state.saveState !== "error" && state.saveState !== "conflict");
}

export function errorRecoveryKind(state: Pick<ViralClientState, "error" | "errorOrigin" | "saveState">, failedTask: boolean, failedCommand: boolean): "save" | "resume" | "command" | "reload" | "sync" | null {
  if (state.error) {
    if (state.errorOrigin === "save" && (state.saveState === "error" || state.saveState === "conflict")) return "save";
    if (state.errorOrigin === "command" && failedCommand) return "command";
    if (state.errorOrigin === "sync") return "sync";
    if (state.errorOrigin === "load" || state.errorOrigin === "poll") return "reload";
    return null;
  }
  return failedTask ? "resume" : null;
}
