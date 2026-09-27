import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemeInput } from "@/lib/memes";

let dir = "";
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "dovedio-memes-")); process.env.DATA_DIR = dir; });
afterAll(async () => { (await import("@/lib/server/db")).closeDb(); rmSync(dir, { recursive: true, force: true }); });

const input = (term: string, extra: Partial<MemeInput> = {}): MemeInput => ({
  term, variants: [], kind: "word", meaning: "含义", usage: "用法", example: "例句", tone: "", platform: "B站", since: "2026 年 8 月", heat: "rising", risk: "safe", say: "", circle: "", ...extra,
});

describe("梗库", () => {
  it("入库、续期不重复、保留用户改过的风险和读法", async () => {
    const { listMemes, saveFetched, updateMeme } = await import("@/lib/server/memes");
    expect(saveFetched([input("yyds", { say: "永远的神", variants: ["YYDS"] }), input("破防了")], 1000)).toEqual({ added: 2, updated: 0, dropped: 0, blocked: 0 });
    const yyds = listMemes().find((m) => m.term === "yyds")!;
    updateMeme(yyds.id, { risk: "caution", say: "永远滴神" });
    expect(saveFetched([input("YYDS", { heat: "fading", say: "永远的神" })], 2000)).toEqual({ added: 0, updated: 1, dropped: 0, blocked: 0 });
    const again = listMemes().find((m) => m.id === yyds.id)!;
    expect(again).toMatchObject({ heat: "fading", risk: "caution", say: "永远滴神", verifiedAt: 2000 });
    expect(listMemes()).toHaveLength(2);
  });

  it("梗的读法并入读音词典，用户词条优先", async () => {
    const { effectiveLexicon, upsertLexicon } = await import("@/lib/server/lexicon");
    expect(effectiveLexicon("p1")).toEqual(expect.arrayContaining([{ word: "yyds", say: "永远滴神" }, { word: "YYDS", say: "永远滴神" }]));
    upsertLexicon("p1", "yyds", "Y Y D S");
    expect(effectiveLexicon("p1")).toEqual(expect.arrayContaining([{ word: "yyds", say: "Y Y D S" }]));
  });

  it("抓取记录", async () => {
    const { lastFetch, recordFetch } = await import("@/lib/server/memes");
    recordFetch({ kind: "trending", query: "", model: "qwen", added: 3, updated: 1, dropped: 2, error: null });
    expect(lastFetch("trending")).toMatchObject({ added: 3, updated: 1, dropped: 2, error: null });
    expect(lastFetch("topic")).toBeUndefined();
  });
});

describe("过期与自动刷新", () => {
  it("没有抓取记录或超过 7 天需要刷新；过气梗交给去 AI 味", async () => {
    const { needsRefresh } = await import("@/lib/server/meme-fetch");
    const { lastFetch, listMemes, saveFetched, staleMemeTerms, updateMeme } = await import("@/lib/server/memes");
    const last = lastFetch("trending")!;
    expect(needsRefresh(last.createdAt + 86_400_000)).toBe(false);
    expect(needsRefresh(last.createdAt + 8 * 86_400_000)).toBe(true);
    saveFetched([input("蚌埠住了", { variants: ["绷不住了"] })], 3000, "manual");
    const m = listMemes().find((x) => x.term === "蚌埠住了")!;
    expect(m.source).toBe("manual");
    updateMeme(m.id, { heat: "dead" });
    expect(staleMemeTerms()).toEqual(expect.arrayContaining(["蚌埠住了", "绷不住了"]));
  });
  it("手动添加不要求流行时间和平台", async () => {
    const { saveFetched } = await import("@/lib/server/memes");
    expect(saveFetched([input("新词", { since: "", platform: "" })], 4000, "import")).toMatchObject({ added: 1 });
    expect(saveFetched([input("另一个", { since: "" })], 4000, "search")).toMatchObject({ added: 0, dropped: 1 });
  });
});

describe("屏蔽、排除已收录、本次新增", () => {
  it("删除并不再收录后，刷新搜到它（任何写法）都跳过；恢复后重新收录", async () => {
    const { deleteMeme, listBlocks, listMemes, saveFetched, unblock } = await import("@/lib/server/memes");
    saveFetched([input("假梗甲", { variants: ["假梗乙"] })], 5000);
    const m = listMemes().find((x) => x.term === "假梗甲")!;
    expect(deleteMeme(m.id, true)).toBe(true);
    expect(saveFetched([input("假梗乙")], 6000)).toMatchObject({ added: 0, blocked: 1 });
    const [block] = listBlocks().filter((b) => b.term === "假梗甲");
    expect(block).toBeDefined();
    unblock(block.id);
    expect(saveFetched([input("假梗乙")], 7000)).toMatchObject({ added: 1, blocked: 0 });
  });

  it("普通删除不屏蔽；手动添加会解除屏蔽", async () => {
    const { deleteMeme, listBlocks, listMemes, saveFetched, unblockTerm } = await import("@/lib/server/memes");
    saveFetched([input("临时梗")], 8000);
    deleteMeme(listMemes().find((x) => x.term === "临时梗")!.id);
    expect(listBlocks().some((b) => b.term === "临时梗")).toBe(false);
    saveFetched([input("又一个")], 8000);
    deleteMeme(listMemes().find((x) => x.term === "又一个")!.id, true);
    unblockTerm("又一个");
    expect(listBlocks().some((b) => b.term === "又一个")).toBe(false);
  });

  it("排除清单：近 30 天确认过的和屏蔽的；更早的留给续期", async () => {
    const { deleteMeme, knownTerms, listMemes, saveFetched } = await import("@/lib/server/memes");
    const now = 100 * 86_400_000;
    saveFetched([input("新近的")], now - 5 * 86_400_000);
    saveFetched([input("很久前的")], now - 45 * 86_400_000);
    saveFetched([input("被屏蔽的")], now);
    deleteMeme(listMemes().find((x) => x.term === "被屏蔽的")!.id, true);
    const known = knownTerms(30, 150, now);
    expect(known).toEqual(expect.arrayContaining(["新近的", "被屏蔽的"]));
    expect(known).not.toContain("很久前的");
  });

  it("圈层入库，续期时不覆盖已有圈层；抓取记录和入库同一时间戳", async () => {
    const { latestSuccessfulFetch, listMemes, recordFetch, saveFetched } = await import("@/lib/server/memes");
    saveFetched([input("职场梗", { circle: "职场" })], 9000);
    saveFetched([input("职场梗", { circle: "游戏" })], 9500);
    expect(listMemes().find((x) => x.term === "职场梗")!.circle).toBe("职场");
    const at = 10_000_000_000_000;
    saveFetched([input("本次新梗")], at);
    recordFetch({ kind: "circle", query: "职场", model: "qwen", added: 1, updated: 0, dropped: 0, error: null, at });
    expect(latestSuccessfulFetch()?.createdAt).toBe(listMemes().find((x) => x.term === "本次新梗")!.createdAt);
  });
});

describe("可信度", () => {
  it("联网抓的默认未核实，手动添加和粘贴导入算已核实；流行时间读时解析", async () => {
    const { listMemes, saveFetched } = await import("@/lib/server/memes");
    saveFetched([input("抓来的", { since: "2026年8月下旬" })], 20_000);
    saveFetched([input("手动的", { since: "" })], 20_000, "manual");
    const get = (t: string) => listMemes().find((m) => m.term === t)!;
    expect(get("抓来的")).toMatchObject({ trust: "unchecked", sinceMonth: "2026-08" });
    expect(get("手动的").trust).toBe("verified");
  });

  it("复核：查得到续期并更新热度和流行时间；查不到只标待核实不删；一键屏蔽待核实", async () => {
    const { applyVerdict, blockDoubtful, listBlocks, listMemes, recheckTargets, saveFetched } = await import("@/lib/server/memes");
    saveFetched([input("复核甲"), input("复核乙")], 30_000);
    const a = listMemes().find((m) => m.term === "复核甲")!;
    const b = listMemes().find((m) => m.term === "复核乙")!;
    expect(recheckTargets(1000).map((m) => m.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    applyVerdict(a.id, { trust: "verified", found: true, sources: 4, sinceMonth: "2025-06", heat: "fading", evidence: "" }, 40_000);
    applyVerdict(b.id, { trust: "doubtful", found: false, sources: 0, sinceMonth: "", evidence: "" }, 40_000);
    const after = (id: string) => listMemes().find((m) => m.id === id)!;
    expect(after(a.id)).toMatchObject({ trust: "verified", sinceMonth: "2025-06", heat: "fading", verifiedAt: 40_000 });
    expect(after(b.id)).toMatchObject({ trust: "doubtful", verifiedAt: 30_000 });
    expect(blockDoubtful()).toBeGreaterThanOrEqual(1);
    expect(listMemes().some((m) => m.id === b.id)).toBe(false);
    expect(listBlocks().some((x) => x.term === "复核乙")).toBe(true);
  });
});

describe("联网搜索参数", () => {
  it("只对带 web-search 能力的模型注入 enable_search", async () => {
    const { searchOptions } = await import("@/lib/llm");
    expect(searchOptions("qwen")).toEqual({ qwen: { enable_search: true, search_options: { forced_search: true, search_strategy: "max" } } });
    expect(searchOptions("qwen", "turbo")).toEqual({ qwen: { enable_search: true, search_options: { forced_search: true, search_strategy: "turbo" } } });
    expect(searchOptions("deepseek")).toBeUndefined();
    expect(searchOptions("claude")).toBeUndefined();
  });
});
