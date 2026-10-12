/** 字幕或配乐改完后，后台补渲成片。和用户亲手点的生成分开记。 */
export const CATCH_UP_SETTLE_MS = 8_000;

export function isCatchUpInput(input: unknown): boolean {
  return Boolean(input && typeof input === "object" && (input as { catchUp?: unknown }).catchUp === true);
}
