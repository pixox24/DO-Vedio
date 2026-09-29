import { loadEnvConfig } from "@next/env";
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { alignWords, contentCount } from "../lib/core/align";
import { splitSentences } from "../lib/core/lines";
import { voiceSettingsSchema, type VoiceSettings } from "../lib/core/types";
import { decodeWav, durationMsOf, encodeWav, findSilences, frameDb, silenceThreshold, sliceWav, speechBounds, silenceLine, splitBySilence, splitByTimestamps, type SplitResult, type Wav } from "../lib/pipeline/tts-split";
import { ttsProviderOf, ttsRequestOf } from "../lib/providers/tts/factory";
import { GEMINI_TTS_FLASH_MODEL } from "../lib/providers/tts/gemini";
import type { SynthWord } from "../lib/providers/tts/types";

/**
 * P0 探针：逐句合成 vs 段落合成（再切分）的 A/B 对比。
 *   npm run tts:paragraph-probe -- [--models=cosyvoice-v3-flash,gemini-3.8-flash-tts] [--paragraphs=4] [--text-file=稿.txt] [--output=目录]
 * 客观指标：相邻句响度差、相邻句音高差（半音）、语速离散度；段落模式另记切分来源、置信度，
 * 有时间戳的模型同时跑静音切分，用时间戳切点当「标准答案」量出静音切分的误差（Gemini 只能靠静音切分）。
 * 主观评测：ab/ 下每对音频随机标 A/B，答案在 ab-key.json，试听后填 ratings.json。
 */

const PARAGRAPHS = [
  "一九六九年七月二十日，阿波罗十一号的登月舱缓缓降落在静海。舱内的警报灯却在最后几分钟接连亮起。导航计算机过载了，所有人都屏住了呼吸。地面控制中心只有几秒钟来决定：继续，还是放弃。一个年仅二十六岁的工程师给出了答案。他说，继续。",
  "那天夜里，村口的狗一声都没有叫。第二天清晨，老李家的门虚掩着，屋里却空无一人。桌上的饭菜还冒着热气，筷子整整齐齐地摆在碗边。他去了哪里？为什么连一双鞋都没有带走？整整三十年，这个问题没有人能回答。",
  "我们每天都在呼吸，却很少想过氧气是从哪里来的。很多人以为地球上的氧气主要来自热带雨林，但事实上，海洋里那些肉眼几乎看不见的浮游植物，贡献了地球上一半以上的氧气。它们在阳光下进行光合作用，吸收二氧化碳，释放出氧气。可以说，我们的每一次呼吸，都有一半要感谢大海。",
  "他在工地上干了二十年，手上的老茧比硬币还厚。女儿考上大学的那天，他特意换上了唯一一件白衬衫。站在校门口，他不敢往里走，怕自己的样子给孩子丢人。女儿却跑过来，一把挽住了他的胳膊。爸，这是我的学校，也是你的。",
];

/** 时间轴里逐句模式的段内停顿（lib/core/timeline.ts TIMING.pauseInSegmentMs） */
const LINE_PAUSE_MS = 250;

type ModelSpec = { id: string; voice: VoiceSettings; joiners: string[] };

function modelSpec(id: string): ModelSpec {
  if (/^gemini/i.test(id)) return { id, voice: voiceSettingsSchema.parse({ provider: "google-gemini", model: id, voiceId: process.env.TTS_PROBE_GEMINI_VOICE || "Kore", google: {} }), joiners: ["", "\n"] };
  if (id.startsWith("qwen-audio-")) return { id, voice: voiceSettingsSchema.parse({ provider: "dashscope", model: id, voiceId: process.env.TTS_PROBE_QWEN_AUDIO_VOICE || "longanhuan_v3.6" }), joiners: [""] };
  return { id, voice: voiceSettingsSchema.parse({ provider: "dashscope", model: id, voiceId: process.env.TTS_PROBE_COSYVOICE_VOICE || "longanyang" }), joiners: [""] };
}

// ---------- 声学指标 ----------

/** 每 10ms 一帧的基频（Hz，0 = 清音/静音）：降采样到 8kHz 后做归一化自相关 */
function f0Track(w: Wav, db: Float32Array, thr: number): Float32Array {
  const factor = Math.max(1, Math.round(w.sampleRate / 8000));
  const rate = w.sampleRate / factor;
  const x = new Float32Array(Math.floor(w.pcm.length / factor));
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += w.pcm[i * factor + k];
    x[i] = s / factor;
  }
  const hop = Math.round(rate / 100);
  const win = Math.round(rate * 0.04);
  const minLag = Math.floor(rate / 400);
  const maxLag = Math.ceil(rate / 60);
  const out = new Float32Array(db.length);
  for (let f = 0; f < db.length; f++) {
    if (db[f] < thr + 6) continue;
    const a = f * hop;
    if (a + win + maxLag >= x.length) break;
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let xy = 0;
      let xx = 0;
      let yy = 0;
      for (let n = 0; n < win; n++) {
        const p = x[a + n];
        const q = x[a + n + lag];
        xy += p * q;
        xx += p * p;
        yy += q * q;
      }
      const r = xy / Math.sqrt(xx * yy + 1e-9);
      if (r > best) {
        best = r;
        bestLag = lag;
      }
    }
    if (best > 0.5) out[f] = rate / bestLag;
  }
  return out;
}

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

type LineMetric = { text: string; loudnessDb: number; f0Hz: number; charsPerSec: number; speechMs: number };

function measure(w: Wav, region: { startMs: number; endMs: number }, text: string, cache: { db: Float32Array; thr: number; f0: Float32Array }): LineMetric {
  const a = Math.max(0, Math.floor(region.startMs / 10));
  const b = Math.min(cache.db.length, Math.ceil(region.endMs / 10));
  let energy = 0;
  let voiced = 0;
  const f0: number[] = [];
  for (let f = a; f < b; f++) {
    if (cache.db[f] >= cache.thr) {
      energy += 10 ** (cache.db[f] / 10);
      voiced++;
    }
    if (cache.f0[f] > 0) f0.push(cache.f0[f]);
  }
  const speechMs = Math.max(1, region.endMs - region.startMs);
  return { text, loudnessDb: voiced ? 10 * Math.log10(energy / voiced) : -120, f0Hz: median(f0), charsPerSec: contentCount(text) / (speechMs / 1000), speechMs };
}

function analyse(w: Wav) {
  const db = frameDb(w);
  const thr = silenceThreshold(db);
  return { db, thr, f0: f0Track(w, db, thr) };
}

type Continuity = { loudnessDeltaDb: number; pitchDeltaSemitones: number; rateCv: number };

function continuity(lines: LineMetric[]): Continuity {
  const pairs = lines.slice(1).map((cur, k) => [lines[k], cur] as const);
  const avg = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0);
  const pitched = pairs.filter(([p, c]) => p.f0Hz > 0 && c.f0Hz > 0);
  const rates = lines.map((l) => l.charsPerSec);
  const mean = avg(rates);
  const std = Math.sqrt(avg(rates.map((r) => (r - mean) ** 2)));
  return {
    loudnessDeltaDb: round(avg(pairs.map(([p, c]) => Math.abs(c.loudnessDb - p.loudnessDb)))),
    pitchDeltaSemitones: round(avg(pitched.map(([p, c]) => Math.abs(12 * Math.log2(c.f0Hz / p.f0Hz))))),
    rateCv: round(mean ? std / mean : 0, 3),
  };
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- 音频拼接 ----------

function concat(parts: Wav[], gapsMs: number[]): Wav {
  const rate = parts[0].sampleRate;
  const gaps = gapsMs.map((ms) => Math.round((ms / 1000) * rate));
  const pcm = new Int16Array(parts.reduce((s, p) => s + p.pcm.length, 0) + gaps.reduce((s, g) => s + g, 0));
  let at = 0;
  parts.forEach((p, k) => {
    pcm.set(p.pcm, at);
    at += p.pcm.length + (gaps[k] ?? 0);
  });
  return { pcm, sampleRate: rate };
}

/** 段落朗读文本里每句的首字开始、末字结束 */
function lineTimesFromWords(lines: string[], joiner: string, words: SynthWord[]) {
  const text = lines.join(joiner);
  const times = alignWords(text, words);
  let offset = 0;
  return lines.map((line) => {
    const inside = times.slice(offset, offset + line.length).filter((t) => t !== null);
    offset += line.length + joiner.length;
    return inside.length ? { startMs: inside[0].startMs, endMs: inside[inside.length - 1].endMs } : { startMs: 0, endMs: 0 };
  });
}

// ---------- 主流程 ----------

type ModeResult = { mode: string; joiner?: string; requests: number; elapsedMs: number; speechMs: number; audioMs: number; continuity: Continuity; lines: LineMetric[]; file: string };
type SplitReport = { joiner: string; source: SplitResult["source"]; confidence: number; boundaries: number; silenceCandidates: number; vadConfidence: number; vadErrorMs?: { mean: number; max: number }; durationRatio: number; gapsMs: number[] };
type ParagraphReport = { model: string; paragraph: number; lines: string[]; lineMode?: ModeResult; paragraphModes: (ModeResult & { split: SplitReport })[]; error?: string };

async function synth(spec: ModelSpec, text: string) {
  const res = await ttsProviderOf(spec.voice).synthesize(ttsRequestOf(spec.voice, text));
  return { wav: decodeWav(res.audio), words: res.words, usage: res.usage, billedChars: res.billedChars };
}

async function runParagraph(spec: ModelSpec, index: number, paragraph: string, dir: string, usage: Map<string, number>): Promise<ParagraphReport> {
  const lines = splitSentences(paragraph);
  const report: ParagraphReport = { model: spec.id, paragraph: index + 1, lines, paragraphModes: [] };
  const tag = `p${index + 1}`;
  const addUsage = (u: { usage?: { unit: string; quantity: number }; billedChars: number }) => {
    const unit = u.usage?.unit ?? "characters";
    usage.set(unit, (usage.get(unit) ?? 0) + (u.usage?.quantity ?? u.billedChars));
  };

  // A：逐句合成，按时间轴规则拼接（只取有效语音区间，句间 250ms）
  const started = Date.now();
  const pieces: Wav[] = [];
  const metrics: LineMetric[] = [];
  for (const line of lines) {
    const r = await synth(spec, line);
    addUsage(r);
    const cache = analyse(r.wav);
    const bounds = speechBounds(cache.db, cache.thr);
    metrics.push(measure(r.wav, bounds, line, cache));
    pieces.push(sliceWav(r.wav, bounds.startMs, bounds.endMs + 60));
  }
  const lineWav = concat(pieces, pieces.map(() => LINE_PAUSE_MS - 60));
  const lineFile = `${tag}-line.wav`;
  await fs.writeFile(path.join(dir, lineFile), encodeWav(lineWav));
  const lineSpeech = metrics.reduce((s, m) => s + m.speechMs, 0);
  report.lineMode = { mode: "line", requests: lines.length, elapsedMs: Date.now() - started, speechMs: lineSpeech, audioMs: Math.round(durationMsOf(lineWav)), continuity: continuity(metrics), lines: metrics, file: lineFile };

  // B：段落合成，再切成单句
  for (const joiner of spec.joiners) {
    const t0 = Date.now();
    const r = await synth(spec, lines.join(joiner));
    addUsage(r);
    const cache = analyse(r.wav);
    const durationMs = durationMsOf(r.wav);
    const weights = lines.map((l) => silenceLine(l));
    const vad = splitBySilence(cache.db, weights, durationMs);
    const ts = r.words.length ? splitByTimestamps(cache.db, lineTimesFromWords(lines, joiner, r.words), durationMs) : null;
    const chosen = ts ?? vad;
    const suffix = joiner ? "-nl" : "";
    const file = `${tag}-paragraph${suffix}.wav`;
    await fs.writeFile(path.join(dir, file), encodeWav(r.wav));
    const sliceDir = path.join(dir, `${tag}-paragraph${suffix}-slices`);
    await fs.mkdir(sliceDir, { recursive: true });
    for (const [k, l] of chosen.lines.entries()) await fs.writeFile(path.join(sliceDir, `${String(k + 1).padStart(2, "0")}.wav`), encodeWav(sliceWav(r.wav, l.cutStartMs, l.cutEndMs)));
    const pm = chosen.lines.map((l, k) => measure(r.wav, l, lines[k], cache));
    const errors = ts ? ts.boundaries.map((b, k) => Math.abs(b.cutMs - vad.boundaries[k].cutMs)) : [];
    const speechMs = pm.reduce((s, m) => s + m.speechMs, 0);
    const bounds = speechBounds(cache.db, cache.thr);
    report.paragraphModes.push({
      mode: "paragraph",
      joiner: JSON.stringify(joiner),
      requests: 1,
      elapsedMs: Date.now() - t0,
      speechMs,
      audioMs: Math.round(durationMs),
      continuity: continuity(pm),
      lines: pm,
      file,
      split: {
        joiner: JSON.stringify(joiner),
        source: chosen.source,
        confidence: chosen.confidence,
        boundaries: chosen.boundaries.length,
        silenceCandidates: findSilences(cache.db, { thresholdDb: cache.thr, minMs: 80 }).filter((s) => s.startMs > bounds.startMs && s.endMs < bounds.endMs).length,
        vadConfidence: vad.confidence,
        vadErrorMs: errors.length ? { mean: Math.round(errors.reduce((s, e) => s + e, 0) / errors.length), max: Math.round(Math.max(...errors)) } : undefined,
        // 段落整段语音时长 / 逐句语音时长之和；偏离过大提示漏读或重读
        durationRatio: round((bounds.endMs - bounds.startMs) / Math.max(1, lineSpeech + LINE_PAUSE_MS * (lines.length - 1))),
        gapsMs: chosen.boundaries.map((b) => Math.round(b.gapMs)),
      },
    });
  }
  return report;
}

function markdown(reports: ParagraphReport[], usage: Record<string, Record<string, number>>, dir: string) {
  const ok = reports.filter((r) => r.lineMode);
  const byModel = new Map<string, ParagraphReport[]>();
  for (const r of ok) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  const avg = (v: number[]) => (v.length ? round(v.reduce((s, x) => s + x, 0) / v.length, 3) : 0);
  const out = [
    "# 段落级 TTS 探针报告（P0）",
    "",
    `生成时间：${new Date().toISOString()}`,
    `音频目录：${dir}`,
    "",
    "## 连贯性对比（越小越连贯）",
    "",
    "| 模型 | 模式 | 相邻句响度差 dB | 相邻句音高差 半音 | 语速离散度 CV | 请求数 | 语音总时长 |",
    "|---|---|---:|---:|---:|---:|---:|",
  ];
  for (const [model, rs] of byModel) {
    const rows: [string, ModeResult[]][] = [["逐句", rs.map((r) => r.lineMode!)]];
    const joiners = [...new Set(rs.flatMap((r) => r.paragraphModes.map((m) => m.joiner!)))];
    for (const j of joiners) rows.push([`段落 连接=${j}`, rs.flatMap((r) => r.paragraphModes.filter((m) => m.joiner === j))]);
    for (const [label, ms] of rows) out.push(`| ${model} | ${label} | ${avg(ms.map((m) => m.continuity.loudnessDeltaDb))} | ${avg(ms.map((m) => m.continuity.pitchDeltaSemitones))} | ${avg(ms.map((m) => m.continuity.rateCv))} | ${ms.reduce((s, m) => s + m.requests, 0)} | ${Math.round(ms.reduce((s, m) => s + m.speechMs, 0) / 1000)} s |`);
  }
  out.push("", "## 切分质量", "", "| 模型 | 段 | 连接 | 句数 | 切分来源 | 置信度 | 静音切分置信度 | 静音候选 | 静音切分误差 平均/最大 | 时长比 | 句间自然停顿 ms |", "|---|---:|---|---:|---|---:|---:|---:|---|---:|---|");
  for (const r of ok) for (const m of r.paragraphModes) {
    const s = m.split;
    const flag = s.durationRatio < 0.75 || s.durationRatio > 1.3 ? " ⚠" : "";
    out.push(`| ${r.model} | ${r.paragraph} | ${s.joiner} | ${r.lines.length} | ${s.source} | ${s.confidence} | ${s.vadConfidence} | ${s.silenceCandidates} | ${s.vadErrorMs ? `${s.vadErrorMs.mean} / ${s.vadErrorMs.max} ms` : "无标准答案"} | ${s.durationRatio}${flag} | ${s.gapsMs.join(", ")} |`);
  }
  const failed = reports.filter((r) => r.error);
  if (failed.length) out.push("", "## 失败", "", ...failed.map((r) => `- ${r.model} 第 ${r.paragraph} 段：${r.error}`));
  out.push("", "## 用量", "", ...Object.entries(usage).map(([m, u]) => `- ${m}：${Object.entries(u).map(([k, v]) => `${k} ${v}`).join("，")}`));
  out.push(
    "",
    "## 人工试听",
    "",
    "- `ab/` 下每段一对音频，A/B 随机分配（答案在 `ab-key.json`，先别看）。试听后在 `ratings.json` 填：更自然的一方、两方的连贯性 1–5 分、备注。",
    "- `pN-paragraph*-slices/` 是切分后的单句，检查句首句尾是否被切掉、有无爆音。",
    "- 时长比 ⚠：段落语音时长与逐句差异过大，可能漏读或重读，需要对照原文听。",
    "",
    "指标说明：响度为有声帧平均电平；音高为有声帧基频中位数（自相关估计，存在倍频误差，只看趋势）；语速离散度为各句「字/秒」的变异系数。",
  );
  return `${out.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const arg = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("用法：npm run tts:paragraph-probe -- [--models=a,b] [--paragraphs=4] [--text-file=稿.txt（空行分段）] [--output=目录]");
    return;
  }
  const models = (arg("models") ?? `cosyvoice-v3-flash,${process.env.GOOGLE_GEMINI_TTS_FLASH_MODEL?.trim() || GEMINI_TTS_FLASH_MODEL}`).split(",").map((s) => s.trim()).filter(Boolean);
  const file = arg("text-file");
  const source = file ? (await fs.readFile(file, "utf8")).split(/\n\s*\n/).map((p) => p.replace(/\s+/g, "")).filter(Boolean) : PARAGRAPHS;
  const paragraphs = source.slice(0, Number(arg("paragraphs")) || source.length);
  const dir = arg("output") || `data/tts-probes/paragraph-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
  await fs.mkdir(dir, { recursive: true });

  const reports: ParagraphReport[] = [];
  const usage: Record<string, Record<string, number>> = {};
  for (const id of models) {
    const spec = modelSpec(id);
    const mdir = path.join(dir, id);
    await fs.mkdir(mdir, { recursive: true });
    const u = new Map<string, number>();
    for (const [k, p] of paragraphs.entries()) {
      process.stdout.write(`${id} 第 ${k + 1}/${paragraphs.length} 段… `);
      try {
        const r = await runParagraph(spec, k, p, mdir, u);
        reports.push(r);
        const pm = r.paragraphModes[0];
        console.log(`逐句 Δ响度 ${r.lineMode!.continuity.loudnessDeltaDb}dB / 段落 ${pm.continuity.loudnessDeltaDb}dB，切分 ${pm.split.source} 置信度 ${pm.split.confidence}`);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        reports.push({ model: id, paragraph: k + 1, lines: splitSentences(p), paragraphModes: [], error });
        console.log(`失败：${error}`);
      }
    }
    usage[id] = Object.fromEntries(u);
  }

  // 盲听配对：逐句拼接 vs 段落原音频（第一种连接方式）
  const abDir = path.join(dir, "ab");
  await fs.mkdir(abDir, { recursive: true });
  const key: Record<string, { A: string; B: string }> = {};
  for (const r of reports.filter((x) => x.lineMode && x.paragraphModes.length)) {
    const pair = `${r.model}-p${r.paragraph}`;
    const files = [r.lineMode!.file, r.paragraphModes[0].file];
    if (Math.random() < 0.5) files.reverse();
    key[pair] = { A: files[0].includes("-line") ? "逐句" : "段落", B: files[1].includes("-line") ? "逐句" : "段落" };
    await fs.copyFile(path.join(dir, r.model, files[0]), path.join(abDir, `${pair}-A.wav`));
    await fs.copyFile(path.join(dir, r.model, files[1]), path.join(abDir, `${pair}-B.wav`));
  }
  await fs.writeFile(path.join(dir, "ab-key.json"), JSON.stringify(key, null, 2));
  await fs.writeFile(path.join(dir, "ratings.json"), JSON.stringify(Object.keys(key).map((pair) => ({ pair, preferred: null as "A" | "B" | "same" | null, continuityA: null, continuityB: null, notes: "" })), null, 2));
  await fs.writeFile(path.join(dir, "report.json"), JSON.stringify({ models, paragraphs, reports, usage }, null, 2));
  await fs.writeFile(path.join(dir, "report.md"), markdown(reports, usage, dir));
  console.log(`\n报告：${dir}/report.md`);
  return reports;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
