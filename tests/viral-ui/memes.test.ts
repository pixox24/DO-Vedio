import { describe, expect, it, vi } from "vitest";
import { loadVerifiedViralMemes, selectViralMeme, verifiedViralMemes } from "@/components/viral/memes";
import type { Meme } from "@/lib/memes";
import { defaultViralInput } from "@/lib/viral/state";

const now = 1_800_000_000_000;
function meme(id: string, patch: Partial<Meme> = {}): Meme {
  return { id, term: id, variants: [], kind: "word", category: "hot", meaning: "表达的含义", usage: "用于轻松调侃", example: "某公司收入翻倍的示例事实", tone: "", platform: "", since: "", heat: "peak", risk: "safe", say: "", circle: "", source: "manual", trust: "verified", sinceMonth: "", verifiedAt: now, createdAt: now, updatedAt: now, ...patch };
}

describe("热梗只能由用户显式选用", () => {
  it("候选仅有已核实且符合既有安全与时效规则的表达，例句事实不进入快照", () => {
    const candidates = verifiedViralMemes([
      meme("可用"), meme("未核实", { trust: "unchecked" }), meme("存疑", { trust: "doubtful" }),
      meme("慎用", { risk: "caution" }), meme("过气", { heat: "dead" }),
      meme("过期", { verifiedAt: now - 61 * 86_400_000 }), meme("日常", { category: "daily", heat: "fading" }),
    ], now);
    expect(candidates.map((item) => item.id)).toEqual(["可用", "日常"]);
    expect(candidates[0].text).toBe("表达的含义\n用于轻松调侃");
    expect(JSON.stringify(candidates)).not.toContain("收入翻倍");
    expect(defaultViralInput().memes).toEqual([]);
  });
  it("只记录点选项，不能选择候选外表达，库更新不覆盖旧快照", () => {
    const candidates = verifiedViralMemes([meme("a"), meme("b")], now);
    expect(selectViralMeme([], candidates, "未核实", true)).toEqual([]);
    const chosen = selectViralMeme([], candidates, "a", true);
    expect(chosen).toEqual([{ ...candidates[0], verified: true }]);
    expect(selectViralMeme(chosen, [{ ...candidates[0], text: "后来修改" }], "a", true)).toBe(chosen);
    expect(selectViralMeme(chosen, [], "a", false)).toEqual([]);
  });
  it("读取候选只调用已有GET库接口，不调用自动选梗模型", async () => {
    const requester = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ memes: [meme("a", { verifiedAt: Date.now() })] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    expect((await loadVerifiedViralMemes(undefined, requester)).map((item) => item.id)).toEqual(["a"]);
    expect(requester).toHaveBeenCalledExactlyOnceWith("/api/memes", { method: "GET", cache: "no-store", signal: undefined });
  });
});
