import { listProviderProfiles } from "../providers/registry";

/**
 * 解析前端传来的生图模型（providerId::modelId）；不传时取第一个可用的。
 * 返回任务里使用的模型 ID：自定义模型保留 providerId::modelId，内置模型只用 modelId。
 */
export function resolveImageModel(requested?: string): string | null {
  const models = listProviderProfiles().filter((p) => p.kind === "image" && p.adapterStatus === "ready" && p.configured && p.enabled);
  const model = requested ? models.find((p) => `${p.providerId}::${p.modelId}` === requested) : models[0];
  if (!model) return null;
  return model.custom ? `${model.providerId}::${model.modelId}` : model.modelId;
}
