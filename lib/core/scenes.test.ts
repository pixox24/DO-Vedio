import { describe, expect, it } from "vitest";
import { canAdoptSceneReference, needsAutoScene, reconcileScenes, sceneSourceHash } from "./scenes";
import { emptyDoc, sceneCardSchema } from "./types";
import { aixFixture } from "../aix/test-fixture";

const cafe = () => sceneCardSchema.parse({ id: "cafe", name: "街角咖啡厅", description: "落地窗、窗边木桌、入口对面的吧台" });

describe("场景标准图", () => {
  it("按正文地点追加，保留已有描述、ID、锁定和用户参考图", () => {
    const existing = { ...cafe(), locked: true, referenceAssetIds: ["uploaded"] };
    const drafts = [
      { name: "街角咖啡厅", description: "被模型改写", mentions: ["a"] },
      { name: "街角咖啡厅", description: "重复", mentions: ["b"] },
      { name: "店外街道", description: "石板路和路灯", mentions: ["b"] },
      { name: "凭空地点", description: "不存在", mentions: ["missing"] },
    ];
    const scenes = reconcileScenes([existing], drafts, new Set(["a", "b"]), () => "outside");
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toBe(existing);
    expect(scenes[1]).toMatchObject({ id: "outside", name: "店外街道" });
  });

  it("默认关闭、只更新自动图片；描述或风格变化才生成新的一张", () => {
    const doc = emptyDoc();
    const scene = cafe();
    expect(needsAutoScene(scene, doc)).toBe(false);
    doc.settings.autoPortrait = true;
    expect(needsAutoScene(scene, doc)).toBe(true);
    const generated = { ...scene, referenceAssetIds: ["generated"], referenceSourceHash: sceneSourceHash(scene, null) };
    expect(needsAutoScene(generated, doc)).toBe(false);
    expect(needsAutoScene({ ...generated, description: "改成红砖墙" }, doc)).toBe(true);
    expect(needsAutoScene(generated, { ...doc, visualStyle: aixFixture() })).toBe(true);
    expect(needsAutoScene({ ...generated, locked: true }, doc)).toBe(false);
    expect(needsAutoScene({ ...scene, referenceAssetIds: ["uploaded"] }, doc)).toBe(false);
  });

  it("生成期间上传图片、改描述、改风格或锁定，不覆盖当前选择", () => {
    const scene = cafe();
    const hash = sceneSourceHash(scene, null);
    expect(canAdoptSceneReference(scene, scene, null, hash)).toBe(true);
    for (const current of [{ ...scene, referenceAssetIds: ["uploaded"] }, { ...scene, description: "新描述" }, { ...scene, locked: true }]) {
      expect(canAdoptSceneReference(current, scene, null, hash)).toBe(false);
    }
    expect(canAdoptSceneReference(scene, scene, aixFixture(), hash)).toBe(false);
  });
});
