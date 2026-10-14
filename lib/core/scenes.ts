import { quickHash } from "./hash";
import { sceneCardSchema, type ProjectDoc, type SceneCard } from "./types";

export type SceneDraft = { name: string; description: string; mentions: string[] };
const sceneKey = (name: string) => name.trim().toLowerCase().replace(/[\s\p{P}]/gu, "");

/** 同名场景保留用户内容、图片和 ID；只追加有正文依据的新地点。地点别名由识别模型归并。 */
export function reconcileScenes(existing: SceneCard[], drafts: SceneDraft[], lineIds: Set<string>, newId: () => string): SceneCard[] {
  const out = [...existing];
  const seen = new Set(existing.map((scene) => sceneKey(scene.name)));
  for (const draft of drafts) {
    const name = draft.name.trim();
    const description = draft.description.trim();
    const key = sceneKey(name);
    if (!key || !description || seen.has(key) || !draft.mentions.some((id) => lineIds.has(id))) continue;
    seen.add(key);
    out.push(sceneCardSchema.parse({ id: newId(), name, description }));
  }
  return out;
}

export function sceneSourceHash(scene: SceneCard, style: ProjectDoc["visualStyle"]) {
  return quickHash({ v: 1, name: scene.name, description: scene.description, style: scene.style, visualStyle: style });
}

export function needsAutoScene(scene: SceneCard, doc: ProjectDoc): boolean {
  if (!doc.settings.autoPortrait || scene.locked || !scene.description.trim()) return false;
  // 没有生成指纹的已有图片是用户参考图，自动任务不能覆盖。
  if (scene.referenceAssetIds.length && !scene.referenceSourceHash) return false;
  return !scene.referenceAssetIds.length || scene.referenceSourceHash !== sceneSourceHash(scene, doc.visualStyle);
}

/** 生成期间编辑、锁定或上传图片时不采用旧结果。 */
export function canAdoptSceneReference(current: SceneCard, snapshot: SceneCard, currentStyle: ProjectDoc["visualStyle"], sourceHash: string) {
  return !current.locked && sceneSourceHash(current, currentStyle) === sourceHash
    && current.referenceSourceHash === snapshot.referenceSourceHash
    && current.referenceAssetIds[0] === snapshot.referenceAssetIds[0];
}
