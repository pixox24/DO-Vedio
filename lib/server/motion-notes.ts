import { randomUUID } from "crypto";
import { motionNoteSchema, type MotionNote, type MotionNoteInput } from "../core/motion-notes";
import { all, get, run } from "./db";

type Row = {
  id: string;
  name: string;
  summary: string;
  link: string;
  shelf: string;
  energy: string;
  created_at: number;
};

function fromRow(row: Row): MotionNote {
  return motionNoteSchema.parse({
    id: row.id,
    name: row.name,
    summary: row.summary,
    link: row.link,
    shelf: row.shelf,
    energy: row.energy,
    createdAt: row.created_at,
  });
}

export function listMotionNotes(): MotionNote[] {
  return all<Row>("SELECT * FROM motion_notes ORDER BY created_at DESC, rowid DESC").map(fromRow);
}

export function createMotionNote(input: MotionNoteInput): MotionNote {
  const id = randomUUID();
  const createdAt = Date.now();
  run(
    "INSERT INTO motion_notes (id, name, summary, link, shelf, energy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    input.name,
    input.summary,
    input.link,
    input.shelf,
    input.energy,
    createdAt,
  );
  const row = get<Row>("SELECT * FROM motion_notes WHERE id = ?", id);
  if (!row) throw new Error("待做成没有写入");
  return fromRow(row);
}

export function deleteMotionNote(id: string) {
  return run("DELETE FROM motion_notes WHERE id = ?", id).changes > 0;
}
