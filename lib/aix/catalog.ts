import { promises as fs } from "node:fs";
import path from "node:path";
import { aixBundleSchema, type AixBundle, type AixCompact, type AixDetail } from "./schema";
import { aixToVisualStyle } from "./adapter";
import { candidatesForTemplate } from "./template-map";

const bundleFile = path.join(process.cwd(), "vendor/aix-style-library/bundle.json");
let cache: AixBundle | undefined;
async function bundle(): Promise<AixBundle> {
  if (!cache) cache = aixBundleSchema.parse(JSON.parse(await fs.readFile(bundleFile, "utf8")));
  return cache;
}

export async function listAixStyles(query?: { q?: string; category?: string; includeDeprecated?: boolean }): Promise<AixCompact[]> {
  const data = await bundle();
  const q = query?.q?.trim().toLocaleLowerCase();
  return data.items.filter((s) => (query?.includeDeprecated || s.status === "active") && (!query?.category || s.category === query.category) && (!q || [s.id, s.name, s.description, ...s.tags, ...s.aliases].join(" ").toLocaleLowerCase().includes(q)));
}

export async function getAixDetail(id: string): Promise<AixDetail | undefined> {
  const data = await bundle();
  return data.details.find((d) => d.style.id.toLowerCase() === id.toLowerCase());
}

export async function getAixVisualStyle(id: string) {
  const detail = await getAixDetail(id);
  return detail ? aixToVisualStyle(detail, "normal", (await bundle()).meta.libraryVersion) : undefined;
}

/**
 * 某个解说风格模板推荐的第一张可用 Aix 风格。
 * 按 template-map 里的候选顺序取第一个存在且 active 的；全部失效时退回目录第一张。
 */
export async function recommendedAixVisualStyle(templateId?: string) {
  const data = await bundle();
  const active = new Map(data.details.filter((d) => d.style.status === "active").map((d) => [d.style.id.toLowerCase(), d]));
  const detail = candidatesForTemplate(templateId).map((id) => active.get(id.toLowerCase())).find(Boolean) ?? data.details[0];
  return detail ? aixToVisualStyle(detail, "normal", data.meta.libraryVersion) : undefined;
}

export async function aixMeta() {
  return (await bundle()).meta;
}
