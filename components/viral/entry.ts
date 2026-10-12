/** Transfer reference text privately between the home composer and a new draft; never use a query parameter. */
export const VIRAL_REFERENCE_ENTRY_KEY = "do-vedio:viral-reference";
export const VIRAL_NEW_STASH_KEY = "do-vedio:viral-unsaved:new";

export function storeViralReference(text: string): void {
  sessionStorage.removeItem(VIRAL_NEW_STASH_KEY);
  sessionStorage.setItem(VIRAL_REFERENCE_ENTRY_KEY, text);
}
