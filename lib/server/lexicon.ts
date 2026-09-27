import { randomUUID } from "crypto";
import type { LexEntry } from "../core/lines";
import { all, run } from "./db";
import { memeReadings } from "./memes";

/** 读音词典：scope 为 "global" 或项目 ID；项目词条覆盖全局同名词条 */

export type LexiconRow = { id: string; scope: string; word: string; say: string; note: string; created_at: number };

export function listLexicon(projectId?: string): LexiconRow[] {
  return projectId
    ? all<LexiconRow>("SELECT * FROM lexicon WHERE scope IN ('global', ?) ORDER BY word", projectId)
    : all<LexiconRow>("SELECT * FROM lexicon WHERE scope = 'global' ORDER BY word");
}

export function effectiveLexicon(projectId: string): LexEntry[] {
  const m = new Map<string, string>();
  // 梗库里的读法（yyds → 永远的神）垫底，用户的全局和项目词条覆盖它
  for (const r of memeReadings()) m.set(r.word, r.say);
  for (const r of listLexicon(projectId).sort((a, b) => (a.scope === "global" ? -1 : 1) - (b.scope === "global" ? -1 : 1))) m.set(r.word, r.say);
  return [...m].map(([word, say]) => ({ word, say }));
}

export function upsertLexicon(scope: string, word: string, say: string, note = "") {
  run(
    "INSERT INTO lexicon (id, scope, word, say, note, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(scope, word) DO UPDATE SET say = excluded.say, note = excluded.note",
    randomUUID(),
    scope,
    word.trim(),
    say.trim(),
    note,
    Date.now(),
  );
}

export function deleteLexicon(id: string) {
  return run("DELETE FROM lexicon WHERE id = ?", id).changes > 0;
}
