import { describe, expect, it } from "vitest";
import { groupReferenceStatuses, mediaIssue, shotReferenceStatus } from "./reference-status";
import { blankShot } from "./shots";
import { characterCardSchema, emptyDoc, sceneCardSchema, type Shot } from "./types";
import { missingVideoStandards, sourceImageSnapshot } from "./video";
import { sheetSourceHash } from "./cast";

const frame = { aspect: "16:9" as const, width: 1920, height: 1080, fps: 30 };
function fixture() {
  const doc = emptyDoc();
  doc.settings.visualPipeline = "video";
  doc.settings.video.referenceImageModelId = "provider::image";
  const shot: Shot = { ...blankShot("s0", "l0"), kind: "video" };
  doc.shots = [shot];
  const job = { stage: "shot-reference", status: "failed" as const, input: { shotId: shot.id, modelId: "image" }, key: `shot-reference:${shot.id}:${sourceImageSnapshot(doc, shot, frame).promptHash}`, error: '{"detail":"Model not found"}', createdAt: 1 };
  return { doc, shot, job };
}

describe("reference feedback", () => {
  it("maps provider JSON to an actionable model issue without claiming an outage", () => {
    expect(mediaIssue('{"detail":"Model not found"}')).toMatchObject({ code: "model", settings: true });
    expect(mediaIssue("分组 provider:test 下模型 image-model 无可用渠道 (request id: )")).toMatchObject({ code: "model", settings: true });
    expect(mediaIssue('{"error":{"message":"Too many requests"}}')).toMatchObject({ code: "rate", settings: false });
    expect(mediaIssue("Connection timed out")).toMatchObject({ code: "network", settings: false });
  });

  it("does not confuse missing images, failed references, and video errors", () => {
    const { doc, shot, job } = fixture();
    expect(shotReferenceStatus(doc, shot, frame, [])).toMatchObject({ kind: "missing", usable: false });
    expect(shotReferenceStatus(doc, shot, frame, [job])).toMatchObject({ kind: "failed", error: job.error });
    expect(shotReferenceStatus(doc, shot, frame, [{ ...job, stage: "shot-generate" }])).toMatchObject({ kind: "missing" });
  });

  it("drops old failure feedback after inputs change and preserves a valid image", () => {
    const { doc, shot, job } = fixture();
    doc.settings.video.referenceImageModelId = "provider::new-image";
    expect(shotReferenceStatus(doc, shot, frame, [job]).kind).toBe("missing");
    shot.sourceImageAssetId = "ready";
    expect(shotReferenceStatus(doc, shot, frame, [job])).toMatchObject({ kind: "ready", usable: true });
    shot.sourceImagePromptHash = "old-input";
    expect(shotReferenceStatus(doc, shot, frame, [job])).toMatchObject({ kind: "stale", usable: false });
  });

  it("shows a newer retry instead of its earlier failure", () => {
    const { doc, shot, job } = fixture();
    expect(shotReferenceStatus(doc, shot, frame, [job, { ...job, status: "running", createdAt: 2 }])).toMatchObject({ kind: "running", usable: false });
  });

  it("keeps missing linked standards blocked after failure and releases only after adoption", () => {
    const { doc, shot, job } = fixture();
    shot.sceneId = "scene0";
    doc.scenes = [sceneCardSchema.parse({ id: "scene0" })];
    const scene = { ...job, stage: "scene-reference", input: { sceneId: "scene0" }, status: "running" as const };
    expect(shotReferenceStatus(doc, shot, frame, [scene])).toMatchObject({ kind: "standard", label: "等待角色和场景标准图" });
    expect(shotReferenceStatus(doc, shot, frame, [{ ...scene, status: "failed" }])).toMatchObject({ kind: "standard", label: "前置标准图需处理", usable: false });
    expect(shotReferenceStatus(doc, shot, frame, [{ ...scene, input: { sceneId: "unrelated" } }])).toMatchObject({ kind: "standard", label: "待补齐角色和场景标准图" });
    doc.scenes[0].referenceAssetIds = ["adopted-scene"];
    shot.sourceImageAssetId = "ready";
    expect(shotReferenceStatus(doc, shot, frame, [{ ...scene, status: "failed" }])).toMatchObject({ kind: "ready", usable: true });
    shot.sceneId = undefined;
    expect(missingVideoStandards(doc, shot)).toEqual([]);
  });

  it("requires current adopted character images while preserving uploaded refs and appearance exceptions", () => {
    const { doc, shot } = fixture();
    const card = characterCardSchema.parse({ id: "c0", locked: true, sheet: { candidates: ["candidate"] } });
    doc.characters = [card, characterCardSchema.parse({ id: "unrelated" })];
    shot.characterIds = [card.id];
    card.sheet.sourceHash = sheetSourceHash(card, doc.visualStyle);
    expect(missingVideoStandards(doc, shot)).toEqual([{ kind: "character", id: card.id }]);
    card.sheet.portraitAssetId = "adopted";
    expect(missingVideoStandards(doc, shot)).toEqual([]);
    card.hair = "changed";
    expect(missingVideoStandards(doc, shot)).toHaveLength(1);
    card.referenceAssetIds = ["uploaded"];
    expect(missingVideoStandards(doc, shot)).toEqual([]);
    card.referenceAssetIds = [];
    card.kind = "group";
    expect(missingVideoStandards(doc, shot)).toEqual([]);
    card.kind = "person";
    card.presentation = "back";
    expect(missingVideoStandards(doc, shot)).toEqual([]);
  });

  it("groups identical causes while separating models and normal waiting", () => {
    const { doc, shot, job } = fixture();
    const failed = shotReferenceStatus(doc, shot, frame, [job]);
    const groups = groupReferenceStatuses([
      { shot, status: failed }, { shot: { ...shot, id: "s1" }, status: failed },
      { shot: { ...shot, id: "s2" }, status: { ...failed, modelId: "other" } },
      { shot: { ...shot, id: "s3" }, status: { kind: "standard", usable: false, label: "等待标准图" } },
      { shot: { ...shot, id: "s4" }, status: { kind: "ready", usable: true, label: "就绪" } },
    ]);
    expect(groups.map((group) => group.shots.length)).toEqual([2, 1, 1]);
    expect(groups[2].issue).toBeUndefined();
  });
});
