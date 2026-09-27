export function cleanSelectedWord(text: string) {
  const word = text.trim();
  return word && !/[<>\x00-\x1f\x7f]/.test(word) && word.length <= 80 ? word : "";
}
