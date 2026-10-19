import { loadEnvConfig } from "@next/env";
import { z } from "zod";

/**
 * 分镜探针：复刻 `stages/storyboard.ts` 里的一次真实请求，把模型原始返回打出来。
 *
 *   node --import tsx scripts/storyboard-probe.ts <projectId> <from> <to> [modelId]
 *
 * 只读：不写缓存、不写项目。用来定位 `response did not match schema` 到底是
 * 哪个字段、哪个 refine 失败——失败时 generation_runs 只记长度，不留响应。
 */

loadEnvConfig(process.cwd());

const projectId = process.argv[2] ?? "62bf50c2-580d-47ed-82a6-4184f8afac5c";
const from = Number(process.argv[3] ?? 5);
const to = Number(process.argv[4] ?? 5);
const modelId = process.argv[5] ?? "deepseek";

/** 与 lib/llm.ts 的 getModel 一致（那里没导出）。 */
async function getModel(id: string) {
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const { baseUrlOf, getBuiltinTextModel, modelEnvName } = await import("../lib/providers/catalog");
  const { customTextModel } = await import("../lib/providers/registry");
  const env = (name: string) => process.env[name]?.trim() || undefined;
  const custom = customTextModel(id);
  if (custom) {
    if (custom.interfaceType === "anthropic") {
      const anthropic = createAnthropic({ apiKey: custom.apiKey, baseURL: custom.baseUrl });
      return { model: anthropic(custom.modelId), isClaude: true };
    }
    const provider = createOpenAICompatible({ name: custom.providerId, apiKey: custom.apiKey, baseURL: custom.baseUrl });
    return { model: provider(custom.modelId), isClaude: false };
  }
  const providerId = id === "claude" ? "anthropic" : id;
  if (providerId === "anthropic") {
    const anthropic = createAnthropic({ apiKey: env("ANTHROPIC_API_KEY")!, baseURL: env("ANTHROPIC_BASE_URL") });
    return { model: anthropic(modelEnvName(getBuiltinTextModel("anthropic")!)), isClaude: true };
  }
  const p = getBuiltinTextModel(providerId)!;
  const provider = createOpenAICompatible({ name: p.providerId, apiKey: env(p.authEnv!)!, baseURL: baseUrlOf(p)! });
  return { model: provider(modelEnvName(p)), isClaude: false };
}

async function main() {
  const { generateText, Output, NoObjectGeneratedError } = await import("ai");
  const { getProject } = await import("../lib/server/projects");
  const { loadArtifacts } = await import("../lib/pipeline/artifacts");
  const { layoutLines } = await import("../lib/core/timeline");
  const { castForStoryboard } = await import("../lib/pipeline/stages/storyboard");
  const { storyboardPrompt } = await import("../lib/prompts");
  const { getTemplate } = await import("../lib/templates/store");
  const { anchorText, lookAt } = await import("../lib/core/cast");
  const { isStock, isVideoForm } = await import("../lib/core/video");
  const { storyboardKey } = await import("../lib/core/keys");

  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");
  const doc = project.doc;
  const art = loadArtifacts(doc, projectId);
  const laid = layoutLines(doc.lines, art);
  const ms = new Map(laid.lines.map((l) => [l.id, l.endMs - l.startMs]));
  const template = await getTemplate(doc.brief.templateId).catch(() => undefined);
  const points = doc.sections.length === doc.segments.length ? doc.sections.map((x) => x.points) : [];
  const video = isVideoForm(doc.settings.visualPipeline);
  const stock = isStock(doc.settings.visualPipeline);
  const cast = castForStoryboard(doc);

  const slice = doc.lines.slice(from, to + 1);
  const r = { from, to };
  const partial = from === 0 && to === doc.lines.length - 1 ? undefined : (await import("../lib/pipeline/stages/storyboard")).partialContext(doc, r);
  const payload = {
    title: doc.brief.title,
    visualPipeline: video ? (stock ? "stock" : "video") : undefined,
    visualStyle: video ? JSON.stringify(doc.visualStyle) : undefined,
    brief: { summary: doc.brief.summary, audience: doc.brief.audience, perspective: doc.brief.perspective },
    style: template && { name: template.name, description: template.description, tone: template.tone },
    segments: doc.segments.map((s, index) => ({ index, title: s.title, points: points[index] || undefined })),
    cast: cast.length ? cast.map((entry) => ({ ...entry, anchor: video ? slice.map((line) => `${line.id}: ${anchorText(doc.characters.find((card) => card.id === entry.id)!, lookAt(doc.characters.find((card) => card.id === entry.id)!, line.id, doc.lines))}`).join("\n") : undefined })) : undefined,
    scenes: doc.scenes.map(({ id, name, description }) => ({ id, name, description })),
    lines: slice.map((l) => {
      const time = laid.lines.find((item) => item.id === l.id)!;
      return { id: l.id, segmentIndex: l.segmentIndex, text: l.text, ms: ms.get(l.id) ?? 0, keywords: l.keywords, mood: l.mood, ...(video ? { startMs: time.startMs, endMs: time.endMs, chars: time.chars, estimated: time.estimated } : {}) };
    }),
    partial,
  } as Parameters<typeof storyboardPrompt>[0];

  const prompt = storyboardPrompt(payload);
  const key = storyboardKey({ payload, modelId, ...(video ? { directorVersion: 3 } : {}) }, projectId);
  console.log(`管线=${doc.settings.visualPipeline} 范围=${from}–${to}（第 ${from + 1}–${to + 1} 句）模型=${modelId} 缓存键=${key.slice(0, 24)}…`);
  console.log(`instructions ${prompt.instructions.length} 字 / prompt ${prompt.prompt.length} 字`);

  const stage = await import("../lib/pipeline/stages/storyboard");
  const schema = video ? (stock ? stage.stockDraftSchema : stage.videoDraftSchema) : stage.draftSchema;
  const { model } = await getModel(modelId);
  try {
    const { output, finishReason, usage } = await generateText({
      model,
      instructions: `${prompt.instructions}\n\n只输出一个 JSON 对象，不要任何解释，结构必须符合以下 JSON Schema：\n${JSON.stringify(z.toJSONSchema(schema))}`,
      prompt: prompt.prompt,
      ...(video ? { maxOutputTokens: 8192 } : {}),
      output: Output.object({ schema }),
    });
    console.log("\n✅ 解析成功：", JSON.stringify(output, null, 2));
    console.log("finishReason:", finishReason, "usage:", usage.outputTokens);
  } catch (e) {
    console.log("\n❌ 失败：", e instanceof Error ? e.message : e);
    if (NoObjectGeneratedError.isInstance(e)) {
      console.log("finishReason:", e.finishReason, "usage:", JSON.stringify(e.usage));
      console.log("---- 原始响应 ----\n" + (e.text ?? "(空)") + "\n---- 响应结束 ----");
      let parsed: unknown;
      try {
        parsed = JSON.parse(e.text ?? "");
      } catch (parseError) {
        console.log("JSON.parse 失败：", parseError instanceof Error ? parseError.message : parseError);
        return;
      }
      const check = schema.safeParse(parsed);
      if (check.success) {
        console.log("safeParse 通过（说明失败发生在 SDK 的 JSON 修复阶段，而不是 zod）");
        return;
      }
      console.log("zod 问题清单：");
      for (const issue of check.error.issues) console.log(`  · ${issue.path.join(".") || "(根)"} — ${issue.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
