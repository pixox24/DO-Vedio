import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aixBundleSchema } from "../lib/aix/schema";
import { canonicalJson, readJson, safeFile, validateSource } from "./aix-data";

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const input = path.join(root, "vendor/aix-style-library");
  const actual = await validateSource(input);
  const bundle = aixBundleSchema.parse(await readJson(path.join(input, "bundle.json")));
  if (canonicalJson(actual.items) !== canonicalJson(bundle.items) || actual.meta.sourceDigest !== bundle.meta.sourceDigest) throw new Error("生成目录与输入不一致");
  const catalog = await readJson(path.join(root, "public/aix/catalog.json"));
  if (canonicalJson(catalog) !== canonicalJson({ meta: bundle.meta, items: bundle.items })) throw new Error("public catalog 已过期");
  if (canonicalJson(await readJson(path.join(root, "public/aix/catalog-meta.json"))) !== canonicalJson(bundle.meta)) throw new Error("public metadata 已过期");
  for (const d of bundle.details) {
    const bytes = await fs.readFile(await safeFile(path.join(root, "public"), d.assets.thumbnailPath.slice(1)));
    const source = await fs.readFile(await safeFile(input, `styles/${d.style.id}/thumbnail.webp`));
    if (!bytes.equals(source)) throw new Error(`${d.style.id} 缩略图与来源不一致`);
  }
  console.log(`Aix ${bundle.meta.libraryVersion}: checked ${bundle.items.length} active styles; ${bundle.meta.sourceDigest}`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
