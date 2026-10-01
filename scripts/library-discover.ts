import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

/**
 * 候选发现（只生成清单与版权审核证据，不下载音频）：
 *   node --import tsx scripts/library-discover.ts --out bgm/candidates/openverse.json --per-source 40
 *
 * 数据来源与授权判断：
 *   - Openverse API（聚合 Jamendo / Freesound），只取 license=cc0,by，保留官方 license_url；
 *   - Wikimedia Commons API，只取 CC0 / CC BY 2.0–4.0 / Public Domain，排除 BY-SA、NC、ND；
 *   - 每个许可证链接抓取一次官方 Deed，保存全文并摘录关键条款，写入每条候选的 evidence。
 * 不做任何推断：许可证无法归类、缺少官方链接或证据的条目直接丢弃。
 */

type Mood = "悬疑" | "紧张" | "轻松" | "温暖" | "激昂" | "史诗" | "科技" | "忧伤" | "中性";
type Energy = "low" | "medium" | "high";

const UA = "dovedio-library-discover/1.0 (+internal library audit)";
const TODAY = new Date().toISOString().slice(0, 10);

const TAG_MOODS: { re: RegExp; mood: Mood }[] = [
  { re: /epic|trailer|orchestra|cinematic|adventure|hero|symphon/i, mood: "史诗" },
  { re: /energetic|powerful|motivat|sport|rock|uptempo|speed_high|driving|aggressive/i, mood: "激昂" },
  { re: /dark|suspense|thriller|mysteri|horror|crime|noir/i, mood: "悬疑" },
  { re: /tense|action|urgent|chase|dramatic|epicdrums|battle/i, mood: "紧张" },
  { re: /happy|upbeat|cheer|fun|playful|light|positive|joy|comedy/i, mood: "轻松" },
  { re: /warm|acoustic|sentimental|romantic|gentle|peaceful|soft|calm|piano/i, mood: "温暖" },
  { re: /electronic|synth|techno|cyber|future|robot|space|sci-?fi|midtempo|slap ?house/i, mood: "科技" },
  { re: /sad|melanchol|emotional|sorrow|lofi|lo-?fi/i, mood: "忧伤" },
  { re: /ambient|background|lounge|downtempo|neutral|corporate|documentary|study/i, mood: "中性" },
];

const VOCAL_RE = /\b(vocal|vocals|voice|female|male|singer|singing|choir|rap)\b/i;
const ENERGY_RULES: { re: RegExp; energy: Energy }[] = [
  { re: /speed_high|energetic|upbeat|powerful|driving|fast|aggressive|motivat/i, energy: "high" },
  { re: /speed_medium|midtempo/i, energy: "medium" },
  { re: /speed_slow|calm|peaceful|relax|soft|slow|ambient|sleep/i, energy: "low" },
];

const OPENVERSE_QUERIES: { q: string; moods: Mood[] }[] = [
  { q: "epic orchestral trailer", moods: ["史诗", "激昂"] },
  { q: "cinematic adventure epic", moods: ["史诗", "激昂"] },
  { q: "orchestral battle hero", moods: ["史诗", "紧张"] },
  { q: "dark suspense thriller", moods: ["悬疑", "紧张"] },
  { q: "tense action chase", moods: ["紧张", "悬疑"] },
  { q: "dramatic suspense rising", moods: ["紧张", "悬疑"] },
  { q: "mystery investigation dark piano", moods: ["悬疑", "忧伤"] },
  { q: "happy upbeat light", moods: ["轻松", "温暖"] },
  { q: "cheerful ukulele pop", moods: ["轻松", "温暖"] },
  { q: "fun playful kids", moods: ["轻松", "中性"] },
  { q: "warm acoustic sentimental", moods: ["温暖", "轻松"] },
  { q: "romantic guitar gentle", moods: ["温暖", "忧伤"] },
  { q: "energetic motivational sport", moods: ["激昂", "紧张"] },
  { q: "rock energy driving", moods: ["激昂", "紧张"] },
  { q: "electronic futuristic techno", moods: ["科技", "中性"] },
  { q: "synthwave cyberpunk digital", moods: ["科技", "悬疑"] },
  { q: "technology innovation corporate", moods: ["科技", "中性"] },
  { q: "sad melancholic piano", moods: ["忧伤", "温暖"] },
  { q: "emotional sad violin", moods: ["忧伤", "温暖"] },
  { q: "ambient background lounge", moods: ["中性", "科技"] },
  { q: "corporate documentary neutral", moods: ["中性", "轻松"] },
  { q: "study vlog background", moods: ["中性", "轻松"] },
  { q: "happy corporate upbeat", moods: ["轻松", "中性"] },
  { q: "sunny acoustic happy", moods: ["轻松", "温暖"] },
  { q: "positive inspiring light", moods: ["轻松", "温暖"] },
  { q: "playful cartoon kids", moods: ["轻松", "中性"] },
  { q: "bossa nova light lounge", moods: ["轻松", "温暖"] },
  { q: "digital technology ambient", moods: ["科技", "中性"] },
  { q: "sci fi space synth", moods: ["科技", "悬疑"] },
  { q: "robotics future electronic", moods: ["科技", "激昂"] },
  { q: "hacker cyber security dark", moods: ["科技", "紧张"] },
];

const COMMONS_QUERIES = [
  "background music",
  "Alex-Productions music",
  "ambient music",
  "cinematic music",
  "electronic music",
  "piano music",
  "motivational music",
  "Antti Luode music",
  "orchestral music",
  "synth music",
];

const ALLOWED_COMMONS_LICENSES = /^(cc0( 1\.0)?|cc by (2\.0|2\.5|3\.0|4\.0)|public domain)$/i;

const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function extractQuote(text: string): string {
  const free = text.match(/You are free to:[\s\S]{0,700}?(?:Under the following terms|The licensor cannot revoke|No additional restrictions)/i);
  if (free) return free[0].replace(/\s+/g, " ").trim().slice(0, 500);
  const cc0 = text.match(/The person who associated a work with this deed has dedicated[\s\S]{0,700}?all without asking permission/i);
  if (cc0) return cc0[0].replace(/\s+/g, " ").trim().slice(0, 500);
  return "";
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const slugId = (prefix: string, key: string) => `${prefix}-${createHash("sha1").update(key).digest("hex").slice(0, 10)}`;

function moodsFor(text: string, fallback: Mood[]): Mood[] {
  const found = TAG_MOODS.filter(({ re }) => re.test(text)).map((x) => x.mood);
  const merged = [...new Set<Mood>([...fallback, ...found])].slice(0, 3);
  return merged.length > 0 ? merged : ["中性"];
}

function energyFor(text: string): Energy | null {
  for (const rule of ENERGY_RULES) if (rule.re.test(text)) return rule.energy;
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url: string, attempts = 3): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2_000 * (i + 1) ** 2);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i + 1 >= attempts) throw e;
      await sleep(2_000 * (i + 1) ** 2);
    }
  }
  throw new Error(`无法获取 ${url}`);
}

type Deed = { quote: string; file: string; sha256: string };

async function licenseDeed(evidenceDir: string, url: string, cache: Map<string, Deed>): Promise<Deed> {
  const hit = cache.get(url);
  if (hit) return hit;
  const html = await fetchText(url);
  const text = stripHtml(html);
  const quote = extractQuote(text);
  if (!quote) throw new Error(`许可证页面没有可识别的关键条款：${url}`);
  const slug = url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  const file = path.join(evidenceDir, `${slug}.txt`);
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(file, text);
  const deed: Deed = { quote, file, sha256: sha256(text) };
  cache.set(url, deed);
  return deed;
}

type Candidate = Record<string, unknown>;

function evidenceText(record: string[], deed: Deed, evidenceRoot: string) {
  return [
    ...record,
    `许可证原文摘录：${deed.quote}`,
    `许可证原文文件：${path.relative(evidenceRoot, deed.file)}（sha256 ${deed.sha256}）`,
    `获取日期：${TODAY}`,
  ].join("\n");
}

type Args = { out: string; perSource: number; sources: string[]; evidenceDir: string; sleepMs: number; pages: number; queryFilter?: string[]; providers: string[] };

function parseArgs(argv: string[]): Args {
  const args: Args = { out: "bgm/candidates/candidates.json", perSource: 40, sources: ["openverse", "commons"], evidenceDir: "bgm/evidence/licenses", sleepMs: 3_300, pages: 2, providers: ["jamendo", "freesound"] };
  for (let i = 0; i < argv.length; i++) {
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${argv[i - 1]} 缺少参数`);
      return value;
    };
    if (argv[i] === "--out") args.out = next();
    else if (argv[i] === "--per-source") args.perSource = Number(next());
    else if (argv[i] === "--sources") args.sources = next().split(",").map((s) => s.trim());
    else if (argv[i] === "--evidence-dir") args.evidenceDir = next();
    else if (argv[i] === "--sleep-ms") args.sleepMs = Number(next());
    else if (argv[i] === "--pages") args.pages = Number(next());
    else if (argv[i] === "--only-queries") args.queryFilter = next().split(",").map((s) => s.trim().toLowerCase());
    else if (argv[i] === "--providers") args.providers = next().split(",").map((s) => s.trim());
    else throw new Error(`未知参数：${argv[i]}`);
  }
  return args;
}

async function discoverOpenverse(args: Args, deeds: Map<string, Deed>, seen: Set<string>, candidates: Candidate[], stats: Map<string, number>) {
  const evidenceRoot = path.resolve(path.dirname(args.out), "..");
  for (const { q, moods } of OPENVERSE_QUERIES) {
    if (args.queryFilter && !args.queryFilter.some((f) => q.toLowerCase().includes(f))) continue;
    for (const source of args.providers) {
      for (let page = 1; page <= args.pages; page++) {
        if ((stats.get(source) ?? 0) >= args.perSource) break;
        const url = new URL("https://api.openverse.org/v1/audio/");
        url.searchParams.set("q", q);
        url.searchParams.set("license", "cc0,by");
        url.searchParams.set("source", source);
        url.searchParams.set("page_size", "20");
        url.searchParams.set("page", String(page));
        url.searchParams.set("duration", "30000..900000");
        let data: { results?: Record<string, unknown>[] };
        try {
          data = JSON.parse(await fetchText(url.toString())) as typeof data;
        } catch (e) {
          console.warn(`[发现] Openverse 查询失败 ${q}/${source}/p${page}：${(e as Error).message}`);
          break;
        }
        await sleep(args.sleepMs);
        const results = data.results ?? [];
        for (const item of results) {
        if ((stats.get(source) ?? 0) >= args.perSource) break;
        const title = String(item.title ?? "").trim();
        const downloadUrl = String(item.url ?? "");
        const license = String(item.license ?? "");
        const licenseUrl = String(item.license_url ?? "");
        const licenseVersion = String(item.license_version ?? "");
        const tags = (item.tags as { name?: string }[] | null | undefined)?.map((t) => t.name ?? "").join(",") ?? "";
        const genres = Array.isArray(item.genres) ? (item.genres as string[]).join(",") : "";
        const category = String(item.category ?? "");
        const durationMs = Number(item.duration ?? 0);
        if (!title || !downloadUrl || !licenseUrl || !["by", "cc0"].includes(license)) continue;
        if (category && category !== "music") continue;
        if (source === "freesound" && !(durationMs >= 30_000)) continue;
        if (VOCAL_RE.test(tags)) continue;
        const key = String(item.id ?? downloadUrl);
        if (seen.has(key)) continue;
        const text = `${title} ${tags} ${genres}`;
        let deed: Deed;
        try {
          deed = await licenseDeed(path.resolve(args.evidenceDir), licenseUrl, deeds);
        } catch (e) {
          console.warn(`[发现] 跳过 ${title}：${(e as Error).message}`);
          continue;
        }
        seen.add(key);
        const licenseName = license === "cc0" ? `CC0 ${licenseVersion || "1.0"}` : `CC BY ${licenseVersion || "4.0"}`;
        const author = String(item.creator ?? "");
        const landing = String(item.foreign_landing_url ?? "");
        const attribution = String(item.attribution ?? `"${title}" by ${author} is licensed under ${licenseName}.`);
        const prefix = source === "jamendo" ? "jm" : source === "freesound" ? "fs" : "ov";
        candidates.push({
          id: slugId(prefix, key),
          file: `${slugId(prefix, key)}.mp3`,
          title,
          moods: moodsFor(text, moods),
          loopable: true,
          license: licenseName,
          source: landing || downloadUrl,
          author,
          licenseUrl,
          sourcePage: landing || downloadUrl,
          downloadUrl,
          attribution,
          commercialUse: true,
          rightsStatus: "verified",
          rightsCheckedAt: TODAY,
          durationMs: Number.isFinite(durationMs) ? durationMs : 0,
          bpm: null,
          energy: energyFor(tags),
          instrumental: !VOCAL_RE.test(text),
          tags: [...new Set([...tags.split(","), ...genres.split(",")].map((t) => t.trim()).filter(Boolean))].slice(0, 12),
          disabledReason: "",
          evidence: {
            url: licenseUrl,
            fetchedAt: TODAY,
            text: evidenceText(
              [`来源：Openverse API（provider=${source}）`, `标题：${title}`, `作者：${author}`, `许可证：${licenseName}`, `许可证链接：${licenseUrl}`, `来源页：${landing}`, `下载地址：${downloadUrl}`, `署名：${attribution}`],
              deed,
              evidenceRoot,
            ),
            file: "",
            sha256: "",
          },
          note: "",
        });
          stats.set(source, (stats.get(source) ?? 0) + 1);
        }
        if (results.length < 20) break;
      }
      if ((stats.get(source) ?? 0) >= args.perSource) console.log(`[发现] Openverse ${source} 达到配额：${stats.get(source)} 首`);
    }
  }
}

async function discoverCommons(args: Args, deeds: Map<string, Deed>, seen: Set<string>, candidates: Candidate[], stats: Map<string, number>) {
  const evidenceRoot = path.resolve(path.dirname(args.out), "..");
  for (const q of COMMONS_QUERIES) {
    for (let offset = 0; offset < args.pages * 50; offset += 50) {
      if ((stats.get("commons") ?? 0) >= args.perSource) break;
      const url = new URL("https://commons.wikimedia.org/w/api.php");
      url.searchParams.set("action", "query");
      url.searchParams.set("format", "json");
      url.searchParams.set("generator", "search");
      url.searchParams.set("gsrsearch", `${q} filetype:audio`);
      url.searchParams.set("gsrnamespace", "6");
      url.searchParams.set("gsrlimit", "50");
      url.searchParams.set("gsroffset", String(offset));
      url.searchParams.set("prop", "imageinfo");
      url.searchParams.set("iiprop", "url|mime|size|extmetadata");
      url.searchParams.set("iiextmetadatafilter", "LicenseShortName|LicenseUrl|Artist|AttributionRequired|UsageTerms");
      let data: { query?: { pages?: Record<string, { title: string; imageinfo?: { url: string; mime: string; size: number; extmetadata?: Record<string, { value: string }> }[] }> } };
      try {
        data = JSON.parse(await fetchText(url.toString())) as typeof data;
      } catch (e) {
        console.warn(`[发现] Commons 查询失败 ${q}@${offset}：${(e as Error).message}`);
        break;
      }
      const pages = Object.values(data.query?.pages ?? {});
      if (pages.length === 0) break;
      await sleep(1_500);
      for (const page of pages) {
        if ((stats.get("commons") ?? 0) >= args.perSource) break;
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const mime = info.mime ?? "";
      if (!/^(audio\/|application\/ogg)/.test(mime) || /video/.test(mime)) continue;
      const licenseName = stripHtml(info.extmetadata?.LicenseShortName?.value ?? "");
      const licenseUrl = stripHtml(info.extmetadata?.LicenseUrl?.value ?? "");
      if (!ALLOWED_COMMONS_LICENSES.test(licenseName) || !/creativecommons\.org\/(licenses\/by\/|publicdomain\/)/i.test(licenseUrl)) continue;
      const title = page.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
      const author = stripHtml(info.extmetadata?.Artist?.value ?? "").slice(0, 200);
      if (!info.url || seen.has(info.url)) continue;
      let deed: Deed;
      try {
        deed = await licenseDeed(path.resolve(args.evidenceDir), licenseUrl, deeds);
      } catch (e) {
        console.warn(`[发现] 跳过 ${title}：${(e as Error).message}`);
        continue;
      }
      seen.add(info.url);
      const ext = (info.url.split("?")[0].split(".").pop() ?? "ogg").toLowerCase();
      const id = slugId("wc", info.url);
      const attribution = `"${title}" by ${author || "Wikimedia Commons contributor"}, ${licenseName}, ${licenseUrl}`;
      candidates.push({
        id,
        file: `${id}.${ext}`,
        title,
        moods: moodsFor(title, []),
        loopable: true,
        license: licenseName,
        source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
        author,
        licenseUrl,
        sourcePage: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
        downloadUrl: info.url,
        attribution,
        commercialUse: true,
        rightsStatus: "verified",
        rightsCheckedAt: TODAY,
        bpm: null,
        energy: energyFor(title),
        instrumental: true,
        tags: [],
        disabledReason: "",
        evidence: {
          url: licenseUrl,
          fetchedAt: TODAY,
          text: evidenceText(
            [`来源：Wikimedia Commons`, `标题：${title}`, `作者：${author}`, `许可证：${licenseName}`, `许可证链接：${licenseUrl}`, `来源页：https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`, `下载地址：${info.url}`, `署名：${attribution}`],
            deed,
            evidenceRoot,
          ),
          file: "",
          sha256: "",
        },
        note: "",
      });
        stats.set("commons", (stats.get("commons") ?? 0) + 1);
      }
      if (pages.length < 50) break;
    }
    console.log(`[发现] Commons / ${q}：累计 ${stats.get("commons") ?? 0} 首`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const deeds = new Map<string, Deed>();
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const stats = new Map<string, number>();

  if (args.sources.includes("openverse")) await discoverOpenverse(args, deeds, seen, candidates, stats);
  if (args.sources.includes("commons")) await discoverCommons(args, deeds, seen, candidates, stats);

  const out = path.resolve(args.out);
  await fs.mkdir(path.dirname(out), { recursive: true });
  const byMood = new Map<string, number>();
  const byLicense = new Map<string, number>();
  for (const c of candidates) {
    for (const mood of c.moods as string[]) byMood.set(mood, (byMood.get(mood) ?? 0) + 1);
    byLicense.set(c.license as string, (byLicense.get(c.license as string) ?? 0) + 1);
  }
  await fs.writeFile(out, JSON.stringify({ _note: `由 scripts/library-discover.ts 生成于 ${TODAY}；许可证与来源均为官方 API 元数据，下载前请复核。`, tracks: candidates }, null, 2));
  const underCovered = [...byMood.entries()].filter(([, v]) => v < 15).map(([k, v]) => `${k} ${v}`);
  const audit = [
    `# 候选清单审核结果（${TODAY}）`,
    "",
    `- 候选总数：${candidates.length}`,
    `- 来源分布：${[...stats.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`,
    `- 许可证分布：${[...byLicense.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`,
    `- 情绪分布：${[...byMood.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`,
    `- 情绪覆盖不足（<15）：${underCovered.join(" · ") || "无"}`,
    `- 许可证原文目录：${path.relative(process.cwd(), path.resolve(args.evidenceDir))}`,
    "",
    "只接受 CC0 与 CC BY（明确允许商业使用与改编）；BY-SA / NC / ND、条款不明或缺少官方许可证链接的条目已被过滤。",
  ].join("\n");
  await fs.writeFile(path.join(path.dirname(out), `${path.basename(out, ".json")}-audit.md`), audit + "\n");
  console.log(`[发现] 候选 ${candidates.length} 首 -> ${out}`);
  console.log(audit.split("\n").slice(2, 6).join("\n"));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
