import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { dataDir } from "../server/db";
import { visualStyleSchema, type VisualStyle, type VisualStyleInput } from "../core/types";
import { recommendedAixVisualStyle as getRecommendedAixVisualStyle } from "../aix/catalog";

/** 用户自定义视觉风格存储；Aix 系统目录由 lib/aix/catalog 提供。 */

const file = () => path.join(dataDir(), "visual-styles.json");

async function readCustom(): Promise<VisualStyle[]> {
  try {
    return visualStyleSchema.array().parse(JSON.parse(await fs.readFile(file(), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function writeCustom(list: VisualStyle[]) {
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(list, null, 2), "utf8");
}

export async function listVisualStyles() {
  return readCustom();
}

export async function getVisualStyle(id: string) {
  return (await listVisualStyles()).find((s) => s.id === id);
}

export async function createVisualStyle(input: VisualStyleInput) {
  const style: VisualStyle = { ...input, id: randomUUID() };
  await writeCustom([...(await readCustom()), style]);
  return style;
}

export async function updateVisualStyle(id: string, input: VisualStyleInput) {
  const list = await readCustom();
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return undefined;
  list[i] = { ...input, id };
  await writeCustom(list);
  return list[i];
}

export async function deleteVisualStyle(id: string) {
  const list = await readCustom();
  const next = list.filter((s) => s.id !== id);
  if (next.length === list.length) return false;
  await writeCustom(next);
  return true;
}

/** 项目没有选风格时的推荐：适合当前解说风格的第一张 */
export async function recommendedAixVisualStyle(templateId: string) {
  return getRecommendedAixVisualStyle(templateId);
}

/**
 * 生图前的确认点：项目还没选风格时，写入推荐风格的快照（界面上可见、可改）。
 * 返回最新的项目。
 */
export async function ensureProjectVisualStyle(projectId: string) {
  const { getProject, mutateProject } = await import("../server/projects");
  const project = getProject(projectId);
  if (!project || project.doc.visualStyle) return project;
  const style = await recommendedAixVisualStyle(project.doc.brief.templateId);
  if (!style) return project;
  return mutateProject(projectId, (doc) => (doc.visualStyle ? null : { ...doc, visualStyle: style }));
}
