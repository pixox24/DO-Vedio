import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { styleTemplateSchema, type StyleTemplate, type TemplateInput } from "../types";
import { builtinTemplates } from "./builtin";

const file = path.join(process.cwd(), "data", "templates.json");

async function readCustom(): Promise<StyleTemplate[]> {
  try {
    return styleTemplateSchema.array().parse(JSON.parse(await fs.readFile(file, "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function writeCustom(list: StyleTemplate[]) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(list, null, 2), "utf8");
}

export async function listTemplates() {
  return [...builtinTemplates, ...(await readCustom())];
}

export async function getTemplate(id: string) {
  return (await listTemplates()).find((t) => t.id === id);
}

export async function createTemplate(input: TemplateInput) {
  const t: StyleTemplate = { ...input, id: randomUUID() };
  await writeCustom([...(await readCustom()), t]);
  return t;
}

export async function updateTemplate(id: string, input: TemplateInput) {
  const list = await readCustom();
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return undefined;
  list[i] = { ...input, id };
  await writeCustom(list);
  return list[i];
}

export async function deleteTemplate(id: string) {
  const list = await readCustom();
  const next = list.filter((t) => t.id !== id);
  await writeCustom(next);
  return next.length < list.length;
}
