import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { aixBundleSchema, aixIndexSchema, aixLibrarySchema, aixStyleSchema, type AixBundle } from "../lib/aix/schema";

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
// Matches Python json.dumps(sort_keys=True, ensure_ascii=False, separators=(',', ':')).
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const readJson = async (file: string): Promise<unknown> => JSON.parse(await fs.readFile(file, "utf8"));
export async function safeFile(root: string, relative: string) {
  const base = await fs.realpath(root);
  const file = await fs.realpath(path.resolve(base, relative));
  if (!file.startsWith(`${base}${path.sep}`)) throw new Error(`资源路径越界：${relative}`);
  return file;
}
export async function validateSource(root: string): Promise<AixBundle> {
  const library = aixLibrarySchema.parse(await readJson(await safeFile(root, "library.json")));
  const index = aixIndexSchema.parse(await readJson(await safeFile(root, "catalog/index.json")));
  if (library.library_version !== index.library_version) throw new Error("库版本与索引版本不一致");
  if (new Set(index.styles.map((s) => s.id)).size !== index.styles.length) throw new Error("目录 ID 重复");
  const digest = sha256(index.styles.map((s) => `${s.id} ${s.version} ${s.content_hash}\n`).join(""));
  if (digest !== index.source_digest) throw new Error("目录摘要不一致");
  const details = [];
  for (const entry of index.styles) {
    const raw = await readJson(await safeFile(root, `styles/${entry.id}/style.json`));
    const style = aixStyleSchema.parse(raw);
    const bytes = await fs.readFile(await safeFile(root, `styles/${entry.id}/${style.thumbnail.path}`));
    const hash = createHash("sha256").update(canonicalJson(raw)).update("\n").update(bytes).digest("hex");
    if (hash !== entry.content_hash) throw new Error(`${entry.id} contentHash 不一致`);
    const actualEntry = { id: style.id, version: style.version, status: style.status, name: style.name, description: style.description, category: style.category, tags: style.tags, aliases: style.aliases, thumbnail_path: `styles/${style.id}/thumbnail.webp`, thumbnail_alt: style.thumbnail.alt, content_hash: hash };
    if (canonicalJson(actualEntry) !== canonicalJson(entry)) throw new Error(`${entry.id} 索引已过期`);
    if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") throw new Error(`${entry.id} 缩略图不是 WebP`);
    if (style.status === "active") details.push({ style, contentHash: hash, assets: { thumbnailPath: `/aix/${digest}/thumbnails/${style.id}.webp`, thumbnailAlt: style.thumbnail.alt, examples: [] } });
  }
  if (!details.length) throw new Error("Aix active 风格目录为空");
  const items = details.map(({ style: s, contentHash, assets }) => ({ id: s.id, version: s.version, status: s.status, name: s.name, description: s.description, category: s.category, tags: s.tags, aliases: s.aliases, contentHash, thumbnailPath: assets.thumbnailPath, thumbnailAlt: assets.thumbnailAlt }));
  return aixBundleSchema.parse({ meta: { libraryVersion: library.library_version, schemaVersion: library.schema_version, sourceDigest: digest, activeCount: items.length, generatedAt: new Date().toISOString().slice(0, 10) }, items, details });
}
