import { speechRates, type Brief, type SpeechRate, type StyleTemplate } from "./types";

/** 允许的时长偏差比例，超出则提示校准 */
export const TOLERANCE = 0.15;

/** 口播字数：每个汉字算 1，每个英文单词/数字串算 1，标点和空白不计 */
export function countChars(text: string) {
  const cjk = text.match(/[㐀-鿿豈-﫿]/g)?.length ?? 0;
  const words = text.match(/[A-Za-z0-9]+(?:['.-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + words;
}

export function secondsFor(text: string, rate: SpeechRate) {
  return (countChars(text) / speechRates[rate]) * 60;
}

export function charsFor(minutes: number, rate: SpeechRate) {
  return Math.round(minutes * speechRates[rate]);
}

export function timeline(texts: string[], rate: SpeechRate) {
  let t = 0;
  return texts.map((text) => {
    const start = t;
    t += secondsFor(text, rate);
    return { start, end: t };
  });
}

export function formatTime(seconds: number) {
  const s = Math.round(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** 实际相对目标的偏差比例，正数偏长、负数偏短 */
export function deviation(actual: number, target: number) {
  return target > 0 ? (actual - target) / target : 0;
}

export function resolveRate(rate: Brief["rate"], template?: Pick<StyleTemplate, "speechRate">): SpeechRate {
  return rate === "auto" ? (template?.speechRate ?? "medium") : rate;
}

/** 按比例缩放各章时长，使总和等于目标分钟数 */
export function normalizeMinutes<T extends { minutes: number }>(sections: T[], total: number): T[] {
  const sum = sections.reduce((s, x) => s + x.minutes, 0);
  if (sum <= 0) return sections.map((x) => ({ ...x, minutes: total / sections.length }));
  return sections.map((x) => ({ ...x, minutes: Math.round((x.minutes / sum) * total * 100) / 100 }));
}
