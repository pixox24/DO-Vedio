"use client";

import { useState } from "react";
import { postJson } from "@/lib/client";
import {
  importStatuses, memeCategories, memeCircles, memeKinds, memeRisks, parseSinceMonth, sinceBucket,
  type ImportCandidate, type ImportStatus, type MemeCategory, type MemeInput, type MemeRisk,
} from "@/lib/memes";
import { useFeedback } from "./feedback";
import { AutoTextarea, Icon, Select, Spinner, Switch } from "./ui";

type Extracted = { candidates: ImportCandidate[]; dropped: number; publishedAt: string };
type Row = ImportCandidate & { checked: boolean };

const statusTone: Record<ImportStatus, string> = {
  new: "border-accent/40 text-accent",
  existing: "border-white/15 text-white/45",
  blocked: "border-red-300/30 text-red-200/70",
};

/** 在原文摘录里高亮这个梗（英文忽略大小写） */
function Highlight({ text, forms }: { text: string; forms: string[] }) {
  const lower = text.toLowerCase();
  const f = forms.map((x) => x.trim()).find((x) => x && lower.includes(x.toLowerCase()));
  if (!f) return <>{text}</>;
  const i = lower.indexOf(f.toLowerCase());
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-accent/20 px-0.5 text-accent">{text.slice(i, i + f.length)}</mark>
      {text.slice(i + f.length)}
    </>
  );
}

/**
 * 粘贴导入：抽取 → 预览 → 确认入库。
 * 抽取只返回候选；每个梗都必须出现在原文里，原文摘录由程序截取。用户勾选、修改后才入库。
 */
export function MemeImport({ searchAvailable, onImported }: { searchAvailable: boolean; onImported: () => void }) {
  const [text, setText] = useState("");
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<null | "extract" | "import">(null);
  const [verify, setVerify] = useState(searchAvailable);
  const { toast } = useFeedback();

  async function extract() {
    setBusy("extract");
    try {
      const r = await postJson<Extracted>("/api/memes/import/extract", { text });
      setExtracted(r);
      // 新梗默认勾选；库里已有的不勾（避免用文章里的热度覆盖），屏蔽过的不勾
      setRows(r.candidates.map((c) => ({ ...c, checked: c.status === "new" })));
      if (!r.candidates.length) toast(r.dropped ? `抽出的 ${r.dropped} 个在原文里都找不到原词，已丢弃` : "材料里没有找到像梗的表达", "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    const items = rows.filter((r) => r.checked).map((r) => r.input);
    setBusy("import");
    try {
      const verifyHot = verify && items.some((item) => item.category === "hot");
      const r = await postJson<{ added: number; updated: number; rechecked: number }>("/api/memes/import", { items, verify: verifyHot });
      toast(`导入完成：新增 ${r.added} 个，续期 ${r.updated} 个${verifyHot ? `，已联网核实 ${r.rechecked} 个热梗热度` : ""}`, "success");
      setExtracted(null);
      setRows([]);
      setText("");
      onImported();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const edit = (i: number, patch: Partial<MemeInput>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, input: { ...r.input, ...patch } } : r)));
  const toggle = (i: number) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, checked: !r.checked } : r)));
  const checked = rows.filter((r) => r.checked).length;
  const count = (s: ImportStatus) => rows.filter((r) => r.status === s).length;
  const published = extracted?.publishedAt ? parseSinceMonth(extracted.publishedAt) : "";
  const old = published && ["y1", "older"].includes(sinceBucket(published));

  if (!extracted)
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">粘贴导入</p>
        <p className="text-xs leading-relaxed text-white/40">
          粘贴词库、评论区或弹幕，AI 从原文整理出可复用的表达，先预览和分类，确认后才入库。只收原文里真的出现过的词。
        </p>
        <AutoTextarea className="input max-h-96 min-h-32 text-sm leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} placeholder="把包含梗的文字粘贴到这里，一次最多 2 万字" />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-white/30">{text.trim().length.toLocaleString()} / 20,000 字</span>
          <button className="btn btn-primary btn-sm" disabled={text.trim().length < 10 || text.length > 20_000 || busy !== null} onClick={extract}>
            {busy === "extract" ? <Spinner className="size-3.5" /> : <Icon name="sparkle" className="size-3.5" />}
            {busy === "extract" ? "正在整理…" : "整理预览"}
          </button>
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-medium">
          抽出 {rows.length} 个
          <span className="ml-2 text-xs font-normal text-white/40">
            {(["new", "existing", "blocked"] as const)
              .filter((s) => count(s))
              .map((s) => `${importStatuses[s].replace(/，.*/, "")} ${count(s)}`)
              .join(" · ")}
            {extracted.dropped > 0 && ` · 另有 ${extracted.dropped} 个在原文里找不到原词，已丢弃`}
          </span>
        </p>
        <button className="cursor-pointer text-xs text-white/40 hover:text-white" onClick={() => setExtracted(null)}>
          重新粘贴
        </button>
      </div>

      {old && (
        <p className="rounded-xl border border-amber-300/20 bg-amber-300/[0.04] px-4 py-2.5 text-xs text-amber-100/80">
          这份材料大约发布于 {published}，里面的梗现在可能已经退潮或过气，建议开启下面的「联网核实热度」。
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((r, i) => (
          <article key={r.input.term} className={`rounded-xl border p-3.5 transition ${r.checked ? "border-accent/40 bg-accent/[0.03]" : "border-white/[0.07] opacity-60"}`}>
            <div className="flex items-start justify-between gap-3">
              <label className="flex min-w-0 cursor-pointer items-center gap-2">
                <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={r.checked} onChange={() => toggle(i)} />
                <span className="truncate text-[15px] font-medium">{r.input.term}</span>
                <span className="shrink-0 text-[11px] text-white/35">{memeKinds[r.input.kind]}</span>
              </label>
              <span className="flex shrink-0 items-center gap-1.5">
                {r.inferred && <span className="rounded-full border border-amber-300/30 px-2 py-0.5 text-[10px] text-amber-200/80" title="原文没解释这个梗，含义是 AI 按上下文推测的，请检查">含义为推测</span>}
                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusTone[r.status]}`} title={r.existingTerm && r.existingTerm !== r.input.term ? `库里的写法：${r.existingTerm}` : undefined}>
                  {importStatuses[r.status]}
                </span>
              </span>
            </div>
            <p className="mt-2 border-l-2 border-white/15 pl-2 text-xs leading-relaxed text-white/55">
              <Highlight text={r.context} forms={[r.input.term, ...r.input.variants]} />
            </p>
            <div className="mt-3 space-y-2 text-xs">
              <AutoTextarea className="input min-h-0 py-1.5 text-xs leading-relaxed" value={r.input.meaning} onChange={(e) => edit(i, { meaning: e.target.value })} placeholder="含义" aria-label="含义" />
              <input className="input h-8 py-0 text-xs" value={r.input.usage} onChange={(e) => edit(i, { usage: e.target.value })} placeholder="用法：在句子里怎么用、适合放在哪" aria-label="用法" />
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/45">
                <Select value={r.input.category} onChange={(value) => edit(i, { category: value as MemeCategory })} className="w-auto min-w-28" aria-label="表达类别">
                  {Object.entries(memeCategories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </Select>
                <Select value={r.input.circle} onChange={(value) => edit(i, { circle: value })} className="w-auto min-w-24" aria-label="圈层">
                  <option value="">未分类</option>
                  {memeCircles.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
                <Select value={r.input.risk} onChange={(value) => edit(i, { risk: value as MemeRisk })} className="w-auto min-w-28" aria-label="风险">
                  {Object.entries(memeRisks).map(([id, label]) => (
                    <option key={id} value={id}>风险：{label}</option>
                  ))}
                </Select>
                {r.input.since && <span>{parseSinceMonth(r.input.since) || r.input.since} 起</span>}
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
        <label className="flex items-center gap-2.5 text-xs">
          <Switch checked={verify && searchAvailable} onChange={setVerify} label="联网核实热梗热度" />
          <span className={searchAvailable ? "text-white/65" : "text-white/30"}>
            联网核实热梗热度
            <span className="ml-1.5 text-white/35">{searchAvailable ? "只核实选中的热梗，接地气表达不会联网刷新" : "需要配置通义千问"}</span>
          </span>
        </label>
        <button className="btn btn-primary btn-sm" disabled={!checked || busy !== null} onClick={commit}>
          {busy === "import" ? <Spinner className="size-3.5" /> : <Icon name="check" className="size-3.5" />}
          {busy === "import" ? (verify ? "正在核实并导入…" : "正在导入…") : `导入选中的 ${checked} 个`}
        </button>
      </div>
    </div>
  );
}
