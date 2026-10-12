import type { ViralMaterial } from "./types";

export function validMaterialIds(ids: readonly string[], materials: readonly ViralMaterial[]): string[] {
  const available = new Set(materials.map((material) => material.id));
  return [...new Set(ids)].filter((id) => available.has(id));
}

/** Copy provenance verbatim. A model claim cannot promote user input to verified evidence. */
export function generationMaterials(materials: readonly ViralMaterial[]): ViralMaterial[] {
  return materials.filter((material) => material.text.trim()).map((material) => ({ ...material }));
}

export function materialSupport(ids: readonly string[], materials: readonly ViralMaterial[]) {
  return materials.filter((material) => ids.includes(material.id));
}

/** Applied only to model-identified specific factual claims, not to ordinary views or common facts. */
export function unsupportedNumbers(claim: string, materials: readonly ViralMaterial[]): string[] {
  const numbers = (text: string) => text.match(/\d+(?:[.,]\d+)*(?:%|％)?/g) ?? [];
  const supplied = new Set(numbers(materials.map((material) => material.text).join("\n")).map((number) => number.replace(/,/g, "").replace(/％/g, "%")));
  return [...new Set(numbers(claim).map((number) => number.replace(/,/g, "").replace(/％/g, "%")))].filter((number) => !supplied.has(number));
}
