import { createHash, timingSafeEqual } from "node:crypto";

export const ACCESS_TOKEN_ENV = "DO_VEDIO_ACCESS_TOKEN";
export const ACCESS_COOKIE_NAME = "do_vedio_access";
export const ACCESS_TOKEN_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Read the shared token at request time so local development can change .env.local
 * without needing a separate generated config file.
 */
export function configuredAccessToken(): string | null {
  const token = process.env[ACCESS_TOKEN_ENV]?.trim();
  return token || null;
}

export function accessControlEnabled(): boolean {
  return configuredAccessToken() !== null;
}

export function productionAccessControlMisconfigured(): boolean {
  return process.env.NODE_ENV === "production" && !accessControlEnabled();
}

/** Compare secrets without leaking length or matching-prefix timing. */
export function accessTokensMatch(candidate: string, expected = configuredAccessToken()): boolean {
  if (!expected) return false;
  const candidateHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

/** Keep redirects inside this app; reject protocol-relative and absolute URLs. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || /^\/[\\/]/.test(value)) return "/";
  return value;
}
