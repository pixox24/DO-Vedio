import { compilePrompt } from "../../core/prompt-compiler";
import { canAdoptSceneReference, needsAutoScene, sceneSourceHash } from "../../core/scenes";
import { beginGenerationRun, failGenerationRun, finishGenerationRun } from "../../providers/runs";
import { getProject, mutateProject } from "../../server/projects";
import { ensureProjectVisualStyle } from "../../visual-styles/store";
import { defaultGenerationFrame, generateBatch, generateMediaAssets, mediaProviderId } from "../media-gen";
import { defineStage, PermanentError } from "../stage";

export type SceneReferenceInput = { projectId: string; sceneId: string; modelId: string; auto?: boolean; sourceHash?: string };

export const sceneReferenceStage = defineStage<SceneReferenceInput, { assets: string[] }>({
  name: "scene-reference",
  concurrency: 4,
  async run(input, ctx) {
    const project = await ensureProjectVisualStyle(input.projectId) ?? getProject(input.projectId);
    const scene = project?.doc.scenes.find((card) => card.id === input.sceneId);
    if (!project || !scene) throw new PermanentError("场景不存在");
    if (scene.locked) throw new PermanentError("场景已锁定，请先解锁");
    if (!scene.description.trim()) throw new PermanentError("请先填写空间陈设描述");
    const sourceHash = sceneSourceHash(scene, project.doc.visualStyle);
    if (input.auto && (!needsAutoScene(scene, project.doc) || (input.sourceHash && input.sourceHash !== sourceHash))) return { assets: [] };
    const prompt = compilePrompt({
      content: `场景标准参考图：${scene.name}。${scene.description}。空场景，无人物；广角全景，展示固定陈设、门窗与家具的位置关系，空间清晰；不画文字、拼图或多个视角。${scene.style}`,
      filter: false, shotSize: "wide", style: project.doc.visualStyle,
    });
    const assets = await generateBatch([prompt], {
      itemKey: () => `scene-reference:${ctx.job.id}:${sourceHash}`, signal: ctx.signal, current: ctx.current,
      onProgress: (done) => ctx.progress(done === 1 ? 1 : 0.1, "生成场景标准图"),
      onAsset: (_, asset) => {
        if (!ctx.current()) return;
        mutateProject(input.projectId, (doc) => ctx.current() ? ({ ...doc, scenes: doc.scenes.map((current) => {
          if (current.id !== scene.id || !canAdoptSceneReference(current, scene, doc.visualStyle, sourceHash)) return current;
          return { ...current, referenceAssetIds: [asset], referenceSourceHash: sourceHash };
        }) }) : null);
      },
      run: async () => {
        const run = beginGenerationRun({ projectId: input.projectId, jobId: ctx.job.id, providerId: mediaProviderId("image", input.modelId), modelId: input.modelId, kind: "image", inputHash: sourceHash, params: { stage: "scene-reference", sceneId: scene.id, prompt: prompt.full, frame: defaultGenerationFrame } });
        try {
          const result = await generateMediaAssets({ kind: "image", modelId: input.modelId, prompt: prompt.full, frame: defaultGenerationFrame, meta: { projectId: input.projectId, sceneId: scene.id } }, ctx.signal);
          finishGenerationRun(run.id, { status: "succeeded", latencyMs: Date.now() - run.startedAt, outputAssets: [result.assets[0]] });
          return result.assets[0];
        } catch (e) {
          failGenerationRun(run, e, ctx.signal.aborted);
          throw e;
        }
      },
    });
    ctx.progress(1, "场景标准图已生成");
    return { assets };
  },
});
