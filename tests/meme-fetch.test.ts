import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { builtinTemplates } from "@/lib/templates/builtin";
import type { MemeCategory, MemeInput } from "@/lib/memes";
import type { Brief } from "@/lib/types";

/** 抓梗流程：模型调用用假数据代替，只验证搜索 → 整理 → 逐个核实 → 入库的编排 */
const searchModelMock = vi.hoisted(() => vi.fn(() => ({ id: "qwen", label: "通义千问 · qwen-plus" })));
const meme = (term: string, category: MemeCategory = "hot"): MemeInput => ({
  term, variants: [], kind: "word", category, meaning: `${term}的含义`, usage: "", example: "", tone: "", platform: "B站", since: "2026年9月", heat: "peak", risk: "safe", say: "", circle: "职场",
});
const replies: Record<string, string> = {
  真梗: "结论：真实\n独立来源：5\n流行起始：2026-07\n当前热度：刚起来\n原文：今天又是真梗的一天",
  编的梗: "结论：查不到\n独立来源：0\n流行起始：不详\n当前热度：不详\n原文：无",
  半真梗: "结论：存疑\n独立来源：1\n流行起始：2026-09\n当前热度：正火\n原文：有人说半真梗",
  老梗: "结论：真实\n独立来源：8\n流行起始：2024-05\n当前热度：在退潮\n原文：老梗还有人用",
  班味: "结论：真实\n独立来源：6\n流行起始：2023-09\n当前热度：已经过气\n原文：一身班味",
};
const prompts: string[] = [];

vi.mock("@/lib/llm", () => ({
  searchModel: searchModelMock,
  listModels: () => [{ id: "qwen" }],
  errorMessage: (e: unknown) => String(e),
  generatePlain: async (_id: string, p: { prompt: string }) => {
    prompts.push(p.prompt);
    const hit = Object.keys(replies).find((t) => p.prompt.includes(`网络用语「${t}」`));
    return hit ? replies[hit] : "调研笔记";
  },
  generateJson: async (_id: string, _schema: unknown, p: { prompt: string }) =>
    p.prompt.includes("候选表达")
      ? { picks: [{ index: 0, where: "自然的场景" }] }
      : p.prompt.includes("用户粘贴的材料")
      ? {
          publishedAt: "2024-05",
          memes: [
            { ...meme("班味"), since: "", explained: true },
            { ...meme("材料里没有的词"), explained: true },
            { ...meme("老梗"), explained: false },
            { ...meme("屏蔽梗"), explained: true },
          ],
        }
      : { memes: [meme("真梗"), meme("编的梗"), meme("半真梗"), meme("老梗")] },
}));

let dir = "";
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "dovedio-fetch-")); process.env.DATA_DIR = dir; });
afterAll(async () => { (await import("@/lib/server/db")).closeDb(); rmSync(dir, { recursive: true, force: true }); });

describe("fetchMemes", () => {
  it("新梗逐个核实：查不到丢弃，存疑标待核实，真实的带上核实给的热度和流行时间；老梗顺带复核", async () => {
    const { saveFetched, listMemes } = await import("@/lib/server/memes");
    saveFetched([meme("老梗")], 1000);
    const { fetchMemes } = await import("@/lib/server/meme-fetch");
    const r = await fetchMemes("circle", "", "职场", 3);
    expect(r).toMatchObject({ added: 2, updated: 1, unverified: 1, verified: 1, doubtful: 1, rechecked: 1 });
    const get = (t: string) => listMemes().find((m) => m.term === t);
    expect(get("编的梗")).toBeUndefined();
    expect(get("真梗")).toMatchObject({ trust: "verified", heat: "rising", sinceMonth: "2026-07" });
    expect(get("半真梗")).toMatchObject({ trust: "doubtful" });
    expect(get("老梗")).toMatchObject({ trust: "verified", heat: "fading", sinceMonth: "2024-05" });
    // 搜索提示词带上时间窗口和圈层
    expect(prompts[0]).toContain("最近 3 个月");
    expect(prompts[0]).toContain("「职场」圈层");
  });

  it("只启用接地气表达时从本地词库挑选，不查找或刷新热梗", async () => {
    const { saveFetched } = await import("@/lib/server/memes");
    saveFetched([meme("日常表达", "daily")], Date.now(), "manual");
    searchModelMock.mockClear();
    const { pickMemes } = await import("@/lib/server/meme-fetch");
    const brief: Brief = {
      title: "生活话题", summary: "", minutes: 3, templateId: "serious", audience: "", perspective: "first",
      mustInclude: "", avoid: "", rate: "auto", slang: "off", memes: null, groundedEnabled: true, groundedLevel: "medium",
    };

    const result = await pickMemes(brief, builtinTemplates[0], "qwen");

    expect(searchModelMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ fetched: false, refreshing: false, candidates: [{ term: "日常表达", category: "daily" }] });
  });
});

describe("粘贴导入", () => {
  const text = "2024 年热梗盘点：班味、老梗，还有屏蔽梗。";
  it("抽取：原文里没有的丢弃；标出新梗、已有、屏蔽过；没写流行时间用发布时间兜底", async () => {
    const { deleteMeme, listMemes, saveFetched } = await import("@/lib/server/memes");
    saveFetched([meme("屏蔽梗")], 2000);
    deleteMeme(listMemes().find((m) => m.term === "屏蔽梗")!.id, true);
    const { extractMemes } = await import("@/lib/server/meme-fetch");
    const r = await extractMemes(text);
    expect(r.dropped).toBe(1);
    expect(r.candidates.map((c) => [c.input.term, c.status, c.inferred])).toEqual([
      ["班味", "new", false],
      ["老梗", "existing", true],
      ["屏蔽梗", "blocked", false],
    ]);
    expect(r.candidates[0].input.since).toBe("2024-05");
    expect(r.candidates[0].context).toBe(text);
  });

  it("入库：勾选屏蔽过的会解除屏蔽；核实只更新热度和流行时间；算已核实", async () => {
    const { extractMemes, importCandidates } = await import("@/lib/server/meme-fetch");
    const { listBlocks, listMemes } = await import("@/lib/server/memes");
    const { candidates } = await extractMemes(text);
    const r = await importCandidates([candidates[0].input, candidates[2].input], { verify: true });
    expect(r).toMatchObject({ added: 2 });
    expect(listMemes().find((m) => m.term === "班味")).toMatchObject({ source: "import", trust: "verified", heat: "dead", sinceMonth: "2023-09" });
    expect(listMemes().some((m) => m.term === "屏蔽梗")).toBe(true);
    expect(listBlocks().some((b) => b.term === "屏蔽梗")).toBe(false);
  });
});
