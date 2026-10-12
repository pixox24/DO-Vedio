/** 项目选定的文本模型优先；不在当前可用名单里时用名单第一项。 */
export function pickTextModelId(preferred: Array<string | null | undefined>, models: { id: string }[]): string {
  for (const id of preferred) {
    if (id && models.some((model) => model.id === id)) return id;
  }
  return models[0]?.id ?? "";
}
