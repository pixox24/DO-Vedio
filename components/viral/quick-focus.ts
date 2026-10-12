/** A successful explicit quick submit can finish after the new-draft route has been replaced. */
export const VIRAL_QUICK_FOCUS_KEY = "do-vedio:viral-new-quick-focus";
export const VIRAL_QUICK_FOCUS_EVENT = "do-vedio:viral-new-quick-submitted";
type FocusStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type ViralQuickFocusIntent = { draftId: string; taskId: string };

export function storeViralQuickFocus(storage: FocusStorage, intent: ViralQuickFocusIntent): void {
  storage.setItem(VIRAL_QUICK_FOCUS_KEY, JSON.stringify(intent));
}

/** Reading is not claiming: a route effect may be cleaned up while its load is still pending. */
export function readViralQuickFocus(storage: FocusStorage, draftId: string): ViralQuickFocusIntent | null {
  const raw = storage.getItem(VIRAL_QUICK_FOCUS_KEY);
  if (!raw) return null;
  let intent: ViralQuickFocusIntent;
  try { intent = JSON.parse(raw); } catch { storage.removeItem(VIRAL_QUICK_FOCUS_KEY); return null; }
  if (intent?.draftId !== draftId || typeof intent.taskId !== "string" || !intent.taskId) return null;
  return intent;
}

/** Only the destination draft consumes the explicit intent, once. Polling never creates an intent. */
export function takeViralQuickFocus(storage: FocusStorage, draftId: string, expectedTaskId?: string): ViralQuickFocusIntent | null {
  const intent = readViralQuickFocus(storage, draftId);
  if (!intent || (expectedTaskId !== undefined && intent.taskId !== expectedTaskId)) return null;
  storage.removeItem(VIRAL_QUICK_FOCUS_KEY);
  return intent;
}
