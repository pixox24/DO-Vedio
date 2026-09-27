import { quickHash } from "../../core/hash";
import { anchorText, sheetKindLabels, sheetSourceHash, type SheetKind } from "../../core/cast";
import { STAGE_VERSION } from "../../core/keys";
import { compilePrompt, type CompiledPrompt } from "../../core/prompt-compiler";
import type { CharacterCard, ProjectDoc, ShotSize } from "../../core/types";
import { beginGenerationRun, failGenerationRun, finishGenerationRun, noteGenerationRun } from "../../providers/runs";
import { getProject, mutateProject } from "../../server/projects";
import { generateBatch, generateMediaAssets, mediaProviderId } from "../media-gen";
import { defineStage, PermanentError } from "../stage";

/**
 * 定妆：先出立绘候选 → 用户选定 → 以立绘为参考出三视图、表情组、各套造型。
 * 全部套用项目的画面风格；选定的立绘和三视图之后作为镜头生成的参考图。
 */

export { sheetKinds, sheetKindLabels, type SheetKind } from "../../core/cast";

const BACKDROP = "站在纯浅灰色背景前，柔和均匀的棚拍光，画面里只有这一个角色";

/** 每种定妆要生成的画面；返回的每一项生成一张图 */
export function sheetShots(card: CharacterCard, kind: SheetKind, lookId?: string, count = 4): { name: string; content: string; shotSize: ShotSize; lookId?: string }[] {
  if (kind === "portrait") return Array.from({ length: count }, (_, i) => ({ name: `立绘 ${i + 1}`, content: `角色定妆照：正面半身像，中性表情，看向镜头，完整展示发型、面部和服装，${BACKDROP}`, shotSize: "medium" as const }));
  if (kind === "turnaround")
    return [
      { name: "正面", content: `角色三视图之正面：正面全身站立，双臂自然下垂，${BACKDROP}`, shotSize: "wide" },
      { name: "侧面", content: `角色三视图之侧面：正侧面全身站立，${BACKDROP}`, shotSize: "wide" },
      { name: "背面", content: `角色三视图之背面：背面全身站立，${BACKDROP}`, shotSize: "wide" },
    ];
  if (kind === "expressions")
    return ["开心地笑", "生气地皱眉", "难过低落", "惊讶地睁大眼睛"].map((e) => ({ name: e, content: `角色表情：头部特写，${e}，${BACKDROP}`, shotSize: "close" as const }));
  const look = card.looks.find((l) => l.id === lookId);
  if (!look) throw new PermanentError("造型不存在");
  return [{ name: look.name, content: `角色造型定妆照：正面全身站立，完整展示这套服装和道具，${BACKDROP}`, shotSize: "wide", lookId: look.id }];
}

export function sheetPrompts(doc: Pick<ProjectDoc, "visualStyle">, card: CharacterCard, kind: SheetKind, lookId?: string, count?: number): (CompiledPrompt & { name: string })[] {
  return sheetShots(card, kind, lookId, count).map((s) => {
    const look = card.looks.find((l) => l.id === s.lookId) ?? card.looks[0];
    return { name: s.name, ...compilePrompt({ content: s.content, filter: false, characters: [anchorText(card, look)], shotSize: s.shotSize, style: doc.visualStyle, sheet: true }) };
  });
}

/** 立绘用用户上传的参考；其余以选定立绘为准 */
export function sheetReferences(card: CharacterCard, kind: SheetKind) {
  if (kind === "portrait") return card.referenceAssetIds.slice(0, 4);
  if (!card.sheet.portraitAssetId) throw new PermanentError("请先生成并选定立绘");
  return [...new Set([card.sheet.portraitAssetId, ...card.referenceAssetIds])].slice(0, 4);
}

export function characterSheetKey(doc: ProjectDoc, card: CharacterCard, kind: SheetKind, modelId: string, lookId?: string, count?: number) {
  const refs = kind === "portrait" ? card.referenceAssetIds : [card.sheet.portraitAssetId, ...card.referenceAssetIds];
  return `character-sheet:${quickHash({ v: STAGE_VERSION.characterSheet, card: card.id, kind, lookId, prompts: sheetPrompts(doc, card, kind, lookId, count).map((p) => p.hash), refs, modelId })}`;
}

export type CharacterSheetInput = { projectId: string; characterId: string; kind: SheetKind; lookId?: string; modelId: string; count?: number };

export const characterSheetStage = defineStage<CharacterSheetInput, { assets: string[] }>({
  name: "character-sheet",
  concurrency: 4,
  async run(input, ctx) {
    const project = getProject(input.projectId);
    const card = project?.doc.characters.find((c) => c.id === input.characterId);
    if (!project || !card) throw new PermanentError("角色不存在");
    if (card.locked) throw new PermanentError("角色已锁定，请先解锁后再定妆");
    if (card.presentation !== "full") throw new PermanentError("这个角色不露正脸，不需要定妆");
    const count = Math.max(1, Math.min(4, input.count ?? 4));
    const prompts = sheetPrompts(project.doc, card, input.kind, input.lookId, count);
    const references = sheetReferences(card, input.kind);
    const key = characterSheetKey(project.doc, card, input.kind, input.modelId, input.lookId, count);
    const label = sheetKindLabels[input.kind];
    // 完成一张写回一张：前端立刻能看到；失败的不影响已成功的
    const slots: (string | undefined)[] = prompts.map(() => undefined);
    const writeBack = () =>
      mutateProject(input.projectId, (doc) => ({
        ...doc,
        characters: doc.characters.map((c) => {
          if (c.id !== card.id) return c;
          const sheet = { ...c.sheet };
          const got = slots.filter((x): x is string => !!x);
          if (input.kind === "portrait") Object.assign(sheet, { candidates: [...got, ...sheet.candidates.filter((x) => !got.includes(x))].slice(0, 16), sourceHash: sheetSourceHash(card, doc.visualStyle) });
          else if (input.kind === "turnaround") sheet.turnaroundAssetIds = got;
          else if (input.kind === "expressions") sheet.expressionAssetIds = got;
          else if (input.lookId && got[0]) sheet.lookAssetIds = { ...sheet.lookAssetIds, [input.lookId]: got[0] };
          return { ...c, sheet };
        }),
      }));
    const assets = await generateBatch(prompts, {
      // 同一个任务的重试共用缓存；再点一次「再来 4 张」是新任务，会生成新的图
      itemKey: (k) => `${key}:${ctx.job.id}:${k}`,
      signal: ctx.signal,
      onProgress: (done, total) => ctx.progress(done / total, `${label}：已完成 ${done}/${total}`),
      onAsset: (k, asset) => {
        slots[k] = asset;
        writeBack();
      },
      run: async (prompt, k) => {
        const run = beginGenerationRun({ projectId: input.projectId, jobId: ctx.job.id, providerId: mediaProviderId("image", input.modelId), modelId: input.modelId, kind: "image", inputHash: `${key}:${k}`, params: { stage: "character-sheet", characterId: card.id, sheet: input.kind, name: prompt.name, prompt: prompt.full, referenceAssetIds: references } });
        try {
          const result = await generateMediaAssets({ kind: "image", modelId: input.modelId, prompt: prompt.full, references, meta: { projectId: input.projectId, characterId: card.id, sheet: input.kind, name: prompt.name } }, ctx.signal);
          if (result.referenceFallback) noteGenerationRun(run.id, { referenceFallback: result.referenceFallback });
          finishGenerationRun(run.id, { status: "succeeded", latencyMs: Date.now() - run.startedAt, outputAssets: [result.assets[0]] });
          return result.assets[0];
        } catch (e) {
          failGenerationRun(run, e, ctx.signal.aborted);
          throw e;
        }
      },
    });
    ctx.progress(1, `${sheetKindLabels[input.kind]}已生成`);
    return { assets };
  },
});
