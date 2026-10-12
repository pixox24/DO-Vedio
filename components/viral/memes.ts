import { isCandidate, type Meme } from "@/lib/memes";
import type { ViralInput } from "@/lib/viral/types";
import type { ViralMemeCandidate } from "./view-props";

/** Read the existing library without invoking its model-based automatic picker. */
export async function loadVerifiedViralMemes(signal?: AbortSignal, requester: typeof fetch = fetch): Promise<ViralMemeCandidate[]> {
  const response = await requester("/api/memes", { method: "GET", cache: "no-store", signal });
  if (!response.ok) throw new Error("热梗暂时未能读取，可继续创作或稍后重试");
  const data = await response.json() as { memes: Meme[] };
  return verifiedViralMemes(data.memes);
}

export function verifiedViralMemes(memes: Meme[], now = Date.now()): ViralMemeCandidate[] {
  return memes.filter((meme) => meme.trust === "verified" && isCandidate(meme, now)).map((meme) => ({
    id: meme.id,
    name: meme.term,
    // Examples may contain unrelated factual stories. Only expression instructions become a snapshot.
    text: [meme.meaning, meme.usage, meme.say ? `口播读法：${meme.say}` : ""].filter(Boolean).join("\n"),
  }));
}

/** Library refreshes never select, overwrite, or remove an existing draft's choices. */
export function selectViralMeme(current: ViralInput["memes"], candidates: ViralMemeCandidate[], id: string, selected: boolean): ViralInput["memes"] {
  if (!selected) return current.filter((meme) => meme.id !== id);
  if (current.some((meme) => meme.id === id)) return current;
  const candidate = candidates.find((meme) => meme.id === id);
  return candidate ? [...current, { ...candidate, verified: true }] : current;
}
