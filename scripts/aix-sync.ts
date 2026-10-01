import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSource, safeFile } from "./aix-data";

async function main() {
  const args = process.argv.slice(2);
  const sourceArg = args[args.indexOf("--source") + 1];
  if (!args.includes("--source") || !sourceArg || sourceArg.startsWith("--")) { console.error("请通过 --source 指定 Aix Skill 根目录"); process.exitCode = 2; return; }
  const source = path.resolve(sourceArg);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const bundle = await validateSource(source);
  const parent = path.join(root, "vendor");
  await fs.mkdir(parent, { recursive: true });
  const staging = await fs.mkdtemp(path.join(parent, ".aix-staging-"));
  const target = path.join(parent, "aix-style-library");
  const backup = `${staging}-previous`;
  let previous = false;
  try {
    // Preserve the complete signed input index, including deprecated records for validation.
    for (const relative of ["library.json", "catalog/index.json", "LICENSE.md"]) {
      await fs.mkdir(path.dirname(path.join(staging, relative)), { recursive: true });
      await fs.copyFile(await safeFile(source, relative), path.join(staging, relative));
    }
    const index = JSON.parse(await fs.readFile(path.join(staging, "catalog/index.json"), "utf8")) as { styles: { id: string }[] };
    const assetRoot = path.join(root, "public/aix", bundle.meta.sourceDigest);
    await fs.mkdir(path.join(assetRoot, "thumbnails"), { recursive: true });
    for (const { id } of index.styles) {
      await fs.mkdir(path.join(staging, "styles", id), { recursive: true });
      for (const name of ["style.json", "thumbnail.webp"]) await fs.copyFile(await safeFile(source, `styles/${id}/${name}`), path.join(staging, "styles", id, name));
    }
    for (const { style } of bundle.details) await fs.copyFile(path.join(staging, "styles", style.id, "thumbnail.webp"), path.join(assetRoot, "thumbnails", `${style.id}.webp`));
    await fs.writeFile(path.join(staging, "bundle.json"), JSON.stringify(bundle));
    try { await fs.rename(target, backup); previous = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    try { await fs.rename(staging, target); } catch (e) { if (previous) await fs.rename(backup, target); throw e; }
    // Versioned assets are published before switching the catalog pointer.
    for (const [name, payload] of [["catalog", { meta: bundle.meta, items: bundle.items }], ["catalog-meta", bundle.meta]] as const) {
      const temp = path.join(root, "public/aix", `${name}.tmp`);
      await fs.writeFile(temp, JSON.stringify(payload));
      await fs.rename(temp, path.join(root, "public/aix", `${name}.json`));
    }
    if (previous) await fs.rm(backup, { recursive: true });
    console.log(JSON.stringify({ ...bundle.meta, categories: Object.fromEntries([...new Set(bundle.items.map((s) => s.category))].map((c) => [c, bundle.items.filter((s) => s.category === c).length])) }));
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
