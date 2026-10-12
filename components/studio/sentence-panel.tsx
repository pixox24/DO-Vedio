"use client";

// 句子面板：逐句配音、重录、段落模式、筛选与批量操作。
//
// 版面的主次写在结构里，不靠字重堆：
//   1. 顶部动作区：一句话说清「现在缺什么」，并把当前真正该做的那件事做成主按钮；
//   2. 状态行：计数、进度、批量进度都只占一行——它随状态切换内容，不额外再堆一张卡片；
//   3. 工具行：搜索、筛选、展开控制；
//   4. 列表区：章节 → 段落 →（段落配音的）块 → 句子，四层各自的层级落在缩进、字号和分隔线上。
//
// 句子行只留三个动作：定位、试听、重录、展开。锁定、旁白表达、词典、单独录制都属于
// 「偶尔才调一次」的设置，收进展开层，行上只标状态。原文与朗读文本不同时才显示朗读行。

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AudioButton, Button, Icon, Select, Spinner } from "@/components/ui";
import { postJson } from "@/lib/client";
import { voiceTagChoices, type Job, type ProjectDoc, type VoiceTag } from "@/lib/core/types";
import { isTtsStage, lineSpeech, ttsRequestForLine } from "@/lib/core/keys";
import { paragraphIndexes, paragraphSupported } from "@/lib/core/blocks";
import { cleanSelectedWord } from "@/lib/selection";
import { costSuffix, costSuffixAtLeast, needsConfirm } from "@/lib/core/interaction";
import { useFeedback } from "@/components/feedback";
import { costLabelText, jobBatchId, type LineInfo, type ProjectStore } from "./shared";

type Entry = { item: LineInfo; line: ProjectDoc["lines"][number]; index: number };
/** 段落配音模式下同一块的句子；逐句模式下每一项只有一句 */
type BlockGroup = { key: string; block: LineInfo["block"]; items: Entry[] };
type ParagraphGroup = { key: string; paragraph: number; segment: number; groups: BlockGroup[] };
type ChapterGroup = { segment: number; paragraphs: ParagraphGroup[]; count: number; voiced: number; missing: number };
type LineFilter = "all" | "missing" | "paragraph";
type LexDraft = { lineId: string; word: string; say: string; busy: boolean; preview: string };

/** 句子上能做的事。收成一个对象，避免把十几个回调逐个穿过四层组件 */
type RowApi = {
  seek: (lineId: string) => void;
  revoice: (lineId: string) => void;
  toggleLock: (lineId: string) => void;
  toggleIsolated: (lineId: string) => void;
  setVoiceTag: (lineId: string, tag: VoiceTag) => void;
  toggleExpand: (lineId: string) => void;
  openLex: (lineId: string, word: string, say: string) => void;
  closeLex: () => void;
  editLex: (patch: Partial<Pick<LexDraft, "word" | "say">>) => void;
  saveLex: () => void;
  previewLex: () => void;
};

/** 用 grid 行高过渡展开，收起时 inert，收起的内容不会抢焦点 */
function Collapse({ open, children, className = "" }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div inert={!open} className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${className}`} style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}>
      <div className="min-h-0 overflow-hidden">
        {/* 留出焦点环的空间，否则 overflow 会把输入框的光圈裁掉 */}
        <div className="-m-1 p-1">{children}</div>
      </div>
    </div>
  );
}

/** 试听按钮的通道：同一时刻只有一句在播，点新的会停掉前一句 */
const AUDIO_CHANNEL = "sentences";

export function SentencePanel({ id, store, jobs, onChanged, onSeek }: { id: string; store: ProjectStore; jobs?: Map<string, Job>; onChanged?: () => void; onSeek?: (lineId: string) => void }) {
  const [lines, setLines] = useState<LineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lex, setLex] = useState<LexDraft | null>(null);
  const [error, setError] = useState("");
  const [batchBusy, setBatchBusy] = useState<"all" | "missing" | null>(null);
  /** 本次提交的配音批次；用它显示进度、停止本次 */
  const [batch, setBatch] = useState<{ id: string; mode: "all" | "missing"; at: number } | null>(null);
  const [batchStopping, setBatchStopping] = useState(false);
  const [lineQuery, setLineQuery] = useState("");
  const [lineFilter, setLineFilter] = useState<LineFilter>("all");
  const [collapsedParagraphs, setCollapsedParagraphs] = useState<Set<string>>(new Set());
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(new Set());
  const [activeChapter, setActiveChapter] = useState<number | null>(null);
  const sectionRefs = useRef(new Map<number, HTMLElement>());
  const listRef = useRef<HTMLDivElement>(null);
  /** 只有 Worker 成功写入新音频后才出现「撤销」，避免撤销半成品或失败任务。 */
  const [pendingUndo, setPendingUndo] = useState<{ jobIds: string[]; keys: string[]; label: string } | null>(null);
  const { confirm, toast } = useFeedback();
  const ttsExpressionRevision = store.doc?.lines.map((line) => `${line.id}:${line.mood ?? ""}:${line.voiceTag ?? "auto"}:${line.ttsIsolated ? "isolated" : ""}`).join("|") ?? "";
  const voiceSettings = store.doc?.settings.voice;
  const capabilities = lines[0]?.capabilities ?? [];
  const supportsEmotionTags = capabilities.includes("emotion-tags");
  const paragraphMode = !!voiceSettings && voiceSettings.granularity === "paragraph" && paragraphSupported(voiceSettings);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}/lines`, { cache: "no-store" });
      const data = (await res.json()) as { lines?: LineInfo[]; error?: string };
      if (!res.ok) throw new Error(data.error || "读取句子失败");
      setLines(data.lines ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  const ttsJobRevision = jobs ? [...jobs.values()].filter((job) => isTtsStage(job.stage)).map((job) => `${job.id}:${job.status}`).sort().join("|") : "";

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    refresh();
  }, [refresh, store.doc?.lines.length, ttsExpressionRevision, voiceSettings?.provider, voiceSettings?.model, voiceSettings?.voiceId, voiceSettings?.rate, voiceSettings?.pitch, voiceSettings?.volume, voiceSettings?.instruction, voiceSettings?.google?.stylePrompt, ttsJobRevision]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggleLock = (lineId: string) => {
    store.setDoc((doc) => ({ ...doc, lines: doc.lines.map((l) => (l.id === lineId ? { ...l, locked: !l.locked } : l)) }));
  };

  const updateVoiceTag = (lineId: string, voiceTag: VoiceTag) => {
    store.setDoc((doc) => ({ ...doc, lines: doc.lines.map((line) => (line.id === lineId ? { ...line, voiceTag } : line)) }));
  };

  /** 还没有配音的句子数（按钮上的「补齐缺失」用） */
  const missingCount = lines.filter((item) => !item.audio).length;
  const voicedCount = lines.length - missingCount;

  /**
   * 本次配音批次的实时进度。jobs 里同一个 key 可能有历史任务，
   * 所以按 batchId 过滤，避免把旧任务的完成数算进来（进度条数字不能骗人）。
   */
  const batchJobs = batch && jobs ? [...jobs.values()].filter((job) => isTtsStage(job.stage) && jobBatchId(job) === batch.id) : [];
  const batchDone = batchJobs.filter((job) => job.status === "succeeded").length;
  const batchTotal = batchJobs.length;
  const batchActive = batchJobs.some((job) => job.status === "queued" || job.status === "running");
  const batchFailed = batchJobs.filter((job) => job.status === "failed").length;

  /** 重录这一句的预估费用：段落模式按块计费（贵），逐句模式按句 */
  const revoiceCostOf = (lineId: string) => {
    const item = lines.find((entry) => entry.id === lineId);
    const value = paragraphMode ? item?.blockCostYuan : item?.costYuan;
    return typeof value === "number" ? value : null;
  };

  /** 一批句子的预估总费用。段落模式下同一块只算一次，否则会重复计费、虚高 */
  const batchCostOf = (candidates: LineInfo[]) => {
    if (!paragraphMode) return candidates.reduce((sum, item) => sum + (item.costYuan ?? 0), 0);
    const perBlock = new Map<string, number>();
    for (const item of candidates) {
      const key = item.block?.key ?? item.id;
      if (!perBlock.has(key)) perBlock.set(key, item.blockCostYuan ?? item.costYuan ?? 0);
    }
    return [...perBlock.values()].reduce((sum, value) => sum + value, 0);
  };

  /** 按统一阈值决定弹不弹窗；不弹时靠按钮上的标签传达代价 */
  const confirmSpend = async (title: string, message: string, units: number, costYuan: number | null, confirmLabel: string, bullets: string[]) => {
    if (!needsConfirm({ units, costYuan })) return true;
    return confirm({ title, message, confirmLabel, tone: "danger", bullets });
  };

  /**
   * 撤销上一次重录：把归档的旧配音写回缓存。
   * 只对真正被覆盖的 key 有效（改了文案再重录会生成新 key，旧 key 本来就没被动过）。
   */
  const undoTakes = useCallback(async (keys: string[], label: string) => {
    try {
      await postJson(`/api/projects/${id}/lines/takes/undo`, { keys });
      toast(`${label}已撤销，恢复为上一次的配音`, "success");
      onChanged?.();
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [id, onChanged, refresh, toast]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!pendingUndo || !jobs || pendingUndo.jobIds.length === 0 || pendingUndo.keys.length === 0) return;
    const statuses = pendingUndo.jobIds.map((id) => [...jobs.values()].find((job) => job.id === id));
    // SSE 可能分批推送，未看到所有任务之前不能误判为完成。
    if (statuses.some((job) => !job)) return;
    if (statuses.some((job) => job?.status === "failed" || job?.status === "canceled")) {
      setPendingUndo(null);
      return;
    }
    if (!statuses.every((job) => job?.status === "succeeded")) return;
    const ready = pendingUndo;
    setPendingUndo(null);
    toast(`${ready.label}已完成`, "success", { label: "撤销", run: () => undoTakes(ready.keys, ready.label) });
  }, [jobs, pendingUndo, toast, undoTakes]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function revoice(lineId: string) {
    setError("");
    const entry = lines.find((item) => item.id === lineId);
    const block = entry?.block;
    if (block) {
      const cost = revoiceCostOf(lineId);
      const ok = await confirmSpend(
        "重录本段？",
        `段落配音下，本句与同段共 ${block.count} 句一起合成。重录会整段重新生成（按 ${block.count} 句计费${costLabelText(cost)}），新音频成功后替换。`,
        block.count,
        cost,
        "重录本段",
        [
          `预计费用：${costLabelText(cost).replace(/^，/, "") || "暂无法准确估算，以服务商账单为准"}。`,
          `影响范围：同段 ${block.count} 句会一起重新合成，已有音频在新音频成功前继续可用。`,
          "可撤销：成功后可在通知中恢复上一版；服务商已接单的请求仍可能计费。",
        ],
      );
      if (!ok) return;
    }
    try {
      if ((await store.flush()) == null) throw new Error("句子设置保存失败，请重试");
      const result = await postJson<{ job?: { id: string } }>(`/api/projects/${id}/lines/${lineId}`, {});
      // 只有当前 key 确实已有旧音频时，force 写入才会产生可撤销归档。
      // 改过文案会生成新 key，旧音频仍在旧 key 上，此时不能给一个必然 409 的撤销按钮。
      const undoKeys = block
        ? lines.filter((item) => item.block?.key === block.key && item.audio).map((item) => item.ttsKey)
        : entry?.audio && entry.ttsKey ? [entry.ttsKey] : [];
      if (undoKeys.length) {
        if (result.job?.id) setPendingUndo({ jobIds: [result.job.id], keys: undoKeys, label: block ? `本段重录（${block.count} 句）` : "重录" });
      } else {
        toast(block ? `已提交本段重录（${block.count} 句）` : "已提交重录", "success");
      }
      onChanged?.();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function batchRevoice(mode: "all" | "missing") {
    const candidates = mode === "all" ? lines : lines.filter((item) => !item.audio);
    const count = candidates.length;
    if (!count) return;
    const jobsCount = paragraphMode ? new Set(candidates.map((item) => item.block?.key ?? item.id)).size : count;
    const cost = batchCostOf(candidates);
    const label = mode === "all" ? "全部重录" : "补齐缺失配音";
    const countLabel = paragraphMode ? `${count} 句，合并为 ${jobsCount} 个段落任务` : `${count} 句`;
    // 段落模式下块内缺一句也要整块重录，按句累加会低估，用「起」标注
    const costText = costLabelText(cost);
    const message = mode === "all"
      ? `将按当前音色重新生成 ${countLabel}${costText}。已有音频会在新音频成功后逐句替换，费用由配音服务商收取。`
      : `只会生成还没有配音的 ${countLabel}${costText}，已有音频不会重复计费。`;
    if (needsConfirm({ units: count, costYuan: cost })) {
      if (!(await confirm({
        title: `${label}？`,
        message,
        confirmLabel: "开始生成",
        tone: "danger",
        bullets: [
          `预计费用：${costText ? costText.replace(/^，/, "") : "暂无法准确估算，以服务商账单为准"}。`,
          `影响范围：${countLabel}；${mode === "all" ? "已有音频会在新音频成功后替换" : "已有音频不会重复生成"}。`,
          "可撤销：全部重录成功后可恢复上一版；服务商已接单的请求仍可能计费。",
        ],
      }))) return;
    }
    setBatchBusy(mode);
    setError("");
    try {
      if ((await store.flush()) == null) throw new Error("项目设置保存失败，请重试");
      const result = await postJson<{ count: number; jobs: number; items?: { id: string }[]; batchId?: string }>(`/api/projects/${id}/lines/tts`, { mode });
      // 记住批次 id：界面据此显示进度、提供「停止本次」。不再立刻清空 busy，
      // 否则任务还在跑、界面却回到静止，用户以为出错了。
      if (result.batchId) setBatch({ id: result.batchId, mode, at: Date.now() });
      setBatchStopping(false);
      // 「全部重录」只有覆盖已有 key 的任务才有归档；等任务成功后再显示撤销。
      const undoKeys = mode === "all" ? candidates.filter((item) => item.audio).map((item) => item.ttsKey) : [];
      if (undoKeys.length && result.items?.length) {
        setPendingUndo({ jobIds: result.items.map((job) => job.id), keys: undoKeys, label: "全部重录" });
        toast(paragraphMode ? `已排队 ${result.count} 句（${result.jobs} 个段落任务）` : `已排队 ${result.count} 句配音`, "info");
      } else {
        toast(paragraphMode ? `已排队 ${result.count} 句（${result.jobs} 个段落任务）` : `已排队 ${result.count} 句配音`, "success");
      }
      onChanged?.();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchBusy(null);
    }
  }

  /** 只停止本次提交的批次；单独重录的任务不受影响 */
  async function stopBatch() {
    if (!batch || batchStopping || !batchActive) return;
    const ok = await confirm({
      title: "停止本次配音？",
      message: `已完成 ${batchDone}/${batchTotal} 个任务，已生成的音频会保留。排队中的会取消；服务商已经接单的请求仍可能计费。停止后${batch.mode === "all" ? "可以再次点「全部重录」继续" : "可以点「补齐缺失」继续"}。`,
      confirmLabel: "停止配音",
      tone: "danger",
      bullets: [
        `预计费用：已完成 ${batchDone}/${batchTotal} 个任务；服务商已接单的请求仍可能计费。`,
        "影响范围：只停止这次批量提交，已完成的音频和单独重录不受影响。",
        `可恢复：${batch.mode === "all" ? "可以再次点「全部重录」" : "可以点「补齐缺失」"}继续。`,
      ],
    });
    if (!ok) return;
    setBatchStopping(true);
    setError("");
    try {
      await postJson(`/api/projects/${id}/lines/tts/cancel`, { batchId: batch.id });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchStopping(false);
    }
  }

  async function addLexicon() {
    if (!lex || !lex.word.trim() || !lex.say.trim()) return;
    const current = lex;
    setLex({ ...current, busy: true });
    setError("");
    try {
      await postJson("/api/lexicon", { scope: id, word: current.word.trim(), say: current.say.trim() });
      setLex(null);
      try {
        await postJson(`/api/projects/${id}/lines/${current.lineId}`, {});
        toast("词典已保存，正在重新排队本句配音", "success");
        onChanged?.();
        await refresh();
      } catch {
        toast("词典已保存，但本句重新配音排队失败。请点这一句的「重录」重试。", "error");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLex((cur) => (cur ? { ...cur, busy: false } : cur));
    }
  }

  function captureSelection(lineId: string, element: HTMLParagraphElement) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
    const word = cleanSelectedWord(selection.toString());
    if (!word) return;
    // 划词即展开这一句的词典输入，不再飘一个按钮：用户已经用行动表达了意图
    setExpandedId(lineId);
    setLex({ lineId, word, say: word, busy: false, preview: "" });
  }

  async function previewLexicon() {
    const line = store.doc?.lines.find((l) => l.id === lex?.lineId);
    if (!line || !lex?.word.trim() || !lex.say.trim()) return;
    const current = lex;
    setLex({ ...current, busy: true });
    try {
      const rows = await fetch(`/api/lexicon?projectId=${encodeURIComponent(id)}`).then((r) => r.json()) as { scope: string; word: string; say: string }[];
      const entries = new Map(rows.sort((a, b) => Number(a.scope === id) - Number(b.scope === id)).map((r) => [r.word, r.say]));
      entries.set(current.word.trim(), current.say.trim());
      const text = lineSpeech(line, [...entries].map(([word, say]) => ({ word, say }))).spoken;
      const preview = ttsRequestForLine(text, line, store.doc!.settings.voice.model);
      const { src } = await postJson<{ src: string }>("/api/voices/preview", { voice: store.doc!.settings.voice, text: preview.text, textType: preview.textType });
      setLex((cur) => (cur ? { ...cur, preview: src, busy: false } : cur));
      new Audio(src).play().catch(() => setError("试听播放失败"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLex((cur) => (cur ? { ...cur, busy: false } : cur));
    }
  }

  const missingLines = lines.filter((item) => !item.audio);
  const missingCost = batchCostOf(missingLines);
  const missingCostSuffix = paragraphMode
    ? costSuffixAtLeast({ units: missingCount, unit: "句", costYuan: missingCost })
    : costSuffix({ units: missingCount, unit: "句", costYuan: missingCost });
  const paragraphNumbers = store.doc ? paragraphIndexes(store.doc.lines, store.doc.segments) : [];
  const paragraphCounts = new Map<string, number>();
  store.doc?.lines.forEach((line, index) => {
    const paragraph = paragraphNumbers[index];
    if (paragraph >= 0) {
      const key = `${line.segmentIndex}:${paragraph}`;
      paragraphCounts.set(key, (paragraphCounts.get(key) ?? 0) + 1);
    }
  });
  const paragraphCountOf = (line: ProjectDoc["lines"][number]) => paragraphCounts.get(`${line.segmentIndex}:${paragraphNumbers[store.doc?.lines.findIndex((item) => item.id === line.id) ?? -1]}`) ?? 1;

  async function toggleIsolated(lineId: string) {
    if (!store.doc || !voiceSettings || !paragraphMode) return;
    const line = store.doc.lines.find((item) => item.id === lineId);
    if (!line) return;
    const count = paragraphCountOf(line);
    if (count < 2) return;
    const isolated = !line.ttsIsolated;
    setError("");
    try {
      store.setDoc((doc) => ({ ...doc, lines: doc.lines.map((item) => (item.id === lineId ? { ...item, ttsIsolated: isolated } : item)) }));
      if ((await store.flush()) == null) throw new Error("句子设置保存失败，请重试");
      await postJson(`/api/projects/${id}/lines/tts`, { mode: "missing" });
      toast(isolated ? `已单独录制本句，同段其余 ${count - 1} 句将重新合成` : `已恢复段落录制，同段其余 ${count - 1} 句将重新合成`, "info");
      onChanged?.();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const lineById = new Map(store.doc?.lines.map((l) => [l.id, l]) ?? []);
  const entries: Entry[] = lines.flatMap((item, index) => {
    const line = lineById.get(item.id);
    return line ? [{ item, line, index }] : [];
  });
  const expandedLineIndex = expandedId ? store.doc?.lines.findIndex((line) => line.id === expandedId) ?? -1 : -1;
  const expandedParagraph = expandedLineIndex >= 0 ? paragraphNumbers[expandedLineIndex] : -1;
  const normalizedQuery = lineQuery.trim().toLocaleLowerCase();
  const searching = normalizedQuery.length > 0;
  const visibleEntries = entries.filter(({ item, line, index }) => {
    const matchesQuery = !normalizedQuery || `${line.text} ${item.spoken}`.toLocaleLowerCase().includes(normalizedQuery);
    const matchesFilter = lineFilter === "all"
      || (lineFilter === "missing" && !item.audio)
      || (lineFilter === "paragraph" && expandedParagraph >= 0 && paragraphNumbers[index] === expandedParagraph && line.segmentIndex === store.doc?.lines[expandedLineIndex]?.segmentIndex);
    return matchesQuery && matchesFilter;
  });

  const groups: BlockGroup[] = [];
  for (const entry of visibleEntries) {
    const previous = groups.at(-1);
    if (entry.item.block && previous?.block?.key === entry.item.block.key) previous.items.push(entry);
    else groups.push({ key: entry.item.block?.key ?? entry.item.id, block: entry.item.block, items: [entry] });
  }
  const paragraphGroups: ParagraphGroup[] = [];
  for (const group of groups) {
    const first = group.items[0];
    const paragraph = paragraphNumbers[first.index] ?? -1;
    const segment = first.line.segmentIndex;
    const key = `${segment}:${paragraph}`;
    const current = paragraphGroups.at(-1);
    if (current?.key === key) current.groups.push(group);
    else paragraphGroups.push({ key, paragraph, segment, groups: [group] });
  }
  const chapters: ChapterGroup[] = [];
  for (const paragraphGroup of paragraphGroups) {
    let chapter = chapters.at(-1);
    if (!chapter || chapter.segment !== paragraphGroup.segment) {
      chapter = { segment: paragraphGroup.segment, paragraphs: [], count: 0, voiced: 0, missing: 0 };
      chapters.push(chapter);
    }
    chapter.paragraphs.push(paragraphGroup);
    for (const group of paragraphGroup.groups) {
      for (const { item } of group.items) {
        chapter.count += 1;
        if (item.audio) chapter.voiced += 1;
        else chapter.missing += 1;
      }
    }
  }
  const multiChapter = chapters.length > 1;
  const allCollapsed = chapters.length > 0 && chapters.every((chapter) => collapsedChapters.has(chapter.segment));
  const chapterKey = chapters.map((chapter) => chapter.segment).join(",");

  /** 序号按钮：跳转预览，不改变展开状态 */
  const seekLine = (lineId: string) => {
    onSeek?.(lineId);
  };
  const toggleExpand = (lineId: string) => setExpandedId((current) => (current === lineId ? null : lineId));
  const scrollToChapter = (segment: number) => {
    setCollapsedChapters((current) => {
      if (!current.has(segment)) return current;
      const next = new Set(current);
      next.delete(segment);
      return next;
    });
    // scrollIntoView 会连页面和右侧整栏一起滚动。章节只在句子列表内部对齐。
    const root = listRef.current;
    const section = sectionRefs.current.get(segment);
    if (root && section) {
      const top = section.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      root.scrollTo({ top, behavior: "smooth" });
    }
    setActiveChapter(segment);
  };

  // 章节导航跟着滚动走：只认列表容器里的可视区域
  useEffect(() => {
    const root = listRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((records) => {
      const visible = records
        .filter((record) => record.isIntersecting)
        .map((record) => Number((record.target as HTMLElement).dataset.segment))
        .filter((segment) => !Number.isNaN(segment));
      if (visible.length) setActiveChapter(Math.min(...visible));
    }, { root, rootMargin: "-4% 0px -70% 0px", threshold: 0 });
    for (const element of sectionRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [chapterKey, visibleEntries.length]);

  const api: RowApi = {
    seek: (lineId) => { seekLine(lineId); },
    revoice: (lineId) => { void revoice(lineId); },
    toggleLock,
    toggleIsolated: (lineId) => { void toggleIsolated(lineId); },
    setVoiceTag: updateVoiceTag,
    toggleExpand,
    openLex: (lineId, word, say) => { setExpandedId(lineId); setLex({ lineId, word, say, busy: false, preview: "" }); },
    closeLex: () => setLex(null),
    editLex: (patch) => setLex((current) => (current ? { ...current, ...patch } : current)),
    saveLex: () => { void addLexicon(); },
    previewLex: () => { void previewLexicon(); },
  };

  const blockStatuses = (items: Entry[]) => {
    const blocks = items.map(({ item }) => item.block!).filter(Boolean);
    const outcomes = blocks.map((block) => block.outcome);
    const labels: string[] = [];
    if (outcomes.some((outcome) => outcome === "line")) labels.push("切分不可靠，已逐句合成");
    else if (outcomes.some((outcome) => outcome === "halved")) labels.push("已拆小合成");
    else if (outcomes.every((outcome) => outcome === "block") && blocks.every((block) => block.splitSource === "provider")) labels.push("精确切分");
    else if (outcomes.every((outcome) => outcome === "block") && blocks.every((block) => block.splitSource === "vad")) labels.push("估算切分");
    if (blocks.some((block) => block.confidence != null && block.confidence < 0.8)) labels.push("切分待复核");
    return labels;
  };

  const blockAudios = (group: { items: Entry[]; block: NonNullable<LineInfo["block"]> }) => {
    const unique = new Map<string, { src: string; start: number; end: number }>();
    group.items.forEach(({ item }, index) => {
      const block = item.block;
      if (!block?.blockSrc || block.outcome === "line") return;
      const key = block.subKey ?? block.blockSrc;
      const current = unique.get(key);
      if (current) current.end = index;
      else unique.set(key, { src: block.blockSrc, start: index, end: index });
    });
    return [...unique.values()].map((audio) => ({ ...audio, label: unique.size === 1 ? "整段试听" : `试听第 ${group.items[audio.start].index + 1}–${group.items[audio.end].index + 1} 句` }));
  };

  const isolationFor = (item: LineInfo, line: ProjectDoc["lines"][number]) => {
    if (!paragraphMode || paragraphCountOf(line) < 2) return null;
    const request = ttsRequestForLine(item.spoken, line, voiceSettings!.model);
    if (request.textType || request.text !== item.spoken) return { kind: "note" as const, text: "本句含表达标签，已单独成块" };
    return { kind: "toggle" as const, isolated: !!line.ttsIsolated };
  };

  const busyBlocked = !!batchBusy || batchActive || batchStopping || !lines.length;

  const renderRow = (entry: Entry, grouped: boolean) => {
    const { item, line, index } = entry;
    const cost = revoiceCostOf(item.id);
    const running = item.job?.status === "running" || item.job?.status === "queued";
    return (
      <SentenceRow
        key={item.id}
        entry={entry}
        grouped={grouped}
        expanded={expandedId === item.id}
        lex={lex && lex.lineId === item.id ? lex : null}
        isolation={isolationFor(item, line)}
        imageCount={paragraphCountOf(line)}
        supportsEmotionTags={supportsEmotionTags}
        costText={costLabelText(cost)}
        api={api}
        captureSelection={captureSelection}
        audioHint={running ? (item.job!.status === "running" ? "合成中" : "排队中") : ""}
        index={index}
      />
    );
  };

  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-5 pb-4 pt-5 sm:px-6">
        <div className="min-w-0">
          <p className="label">句子</p>
          <h2 className="mt-1 text-base font-medium">句子与配音</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 主按钮永远指向「现在缺的那件事」；没有缺失时不给主操作，避免为不存在的问题制造压力 */}
          {missingCount > 0 ? (
            <>
              <Button size="sm" variant="primary" disabled={busyBlocked} loading={batchBusy === "missing"} icon={<Icon name="sparkle" className="size-3.5" />} onClick={() => void batchRevoice("missing")} title={`只为 ${missingCount} 句没有配音的句子生成配音${costLabelText(missingCost)}`}>
                补齐缺失 · {missingCostSuffix}
              </Button>
              <Button size="sm" variant="ghost" disabled={busyBlocked} loading={batchBusy === "all"} onClick={() => void batchRevoice("all")} title={`按当前音色重新生成全部 ${lines.length} 句${costLabelText(batchCostOf(lines))}`}>
                全部重录 · {lines.length} 句{costLabelText(batchCostOf(lines))}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={busyBlocked} loading={batchBusy === "all"} icon={<Icon name="undo" className="size-3.5" />} onClick={() => void batchRevoice("all")} title={`按当前音色重新生成全部 ${lines.length} 句${costLabelText(batchCostOf(lines))}`}>
              全部重录 · {lines.length} 句{costLabelText(batchCostOf(lines))}
            </Button>
          )}
        </div>
      </header>

      {/* 状态行：平时是一句结论，批量进行中就换成进度——同一块地方，不额外再堆提示条 */}
      <div className="border-y border-hairline bg-white/[0.015] px-5 py-2.5 sm:px-6">
        {batch && batchTotal > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {batchActive ? <Spinner className="size-3 text-accent" /> : <Icon name="check" className="size-3.5 text-accent" />}
              <span className="text-text">{batch.mode === "all" ? "全部重录" : "补齐缺失"}{batchActive ? "进行中" : "已结束"}</span>
              <span className="tabular-nums text-text-muted">{batchDone}/{batchTotal}</span>
              {batchFailed > 0 && <span className="text-danger">失败 {batchFailed}</span>}
              {batchActive ? (
                <Button size="sm" variant="ghost" className="ml-auto" disabled={batchStopping} loading={batchStopping} icon={<Icon name="stop" className="size-3" />} onClick={() => void stopBatch()}>
                  停止本次
                </Button>
              ) : (
                <button type="button" className="ml-auto cursor-pointer text-xs text-text-faint transition hover:text-text" onClick={() => setBatch(null)}>
                  收起
                </button>
              )}
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="本次配音进度" aria-valuemin={0} aria-valuemax={batchTotal} aria-valuenow={batchDone}>
              <span className={`block h-full rounded-full transition-[width] duration-500 ease-out ${batchFailed && !batchActive ? "bg-warn/70" : "bg-accent"}`} style={{ width: `${batchTotal ? (batchDone / batchTotal) * 100 : 0}%` }} />
            </div>
            <p className="text-2xs text-text-faint">
              {batchActive ? "已完成的任务不受影响，可随时停止" : batchFailed > 0 ? "有任务失败，可以再点一次「全部重录」重试" : "本次配音已结束"}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-2 text-text-muted">
              <span className={`size-1.5 rounded-full ${missingCount ? "bg-warn" : "bg-accent"}`} />
              已配音 <span className="tabular-nums text-text">{voicedCount}</span>/{lines.length} 句
            </span>
            {missingCount > 0
              ? <span className="text-warn">还差 {missingCount} 句 · {missingCostSuffix}</span>
              : <span className="text-text-faint">全部句子都有配音</span>}
            <span className="text-text-faint sm:ml-auto">补齐只生成缺失的句子，已有配音继续可用</span>
          </div>
        )}
      </div>

      {/* 工具行 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5 sm:px-5">
        <label className="relative min-w-[11rem] flex-1">
          <span className="sr-only">搜索句子</span>
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-faint" />
          <input className="input h-9 w-full pl-9 pr-8 text-xs" value={lineQuery} onChange={(event) => setLineQuery(event.target.value)} placeholder="搜索文案或朗读内容" aria-label="搜索句子" />
          {lineQuery && (
            <button type="button" className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-text-faint transition hover:bg-white/10 hover:text-text" onClick={() => setLineQuery("")} aria-label="清空搜索">
              <Icon name="close" className="size-3" />
            </button>
          )}
        </label>
        <div className="w-36 shrink-0">
          <Select className="h-9 text-xs" value={lineFilter} onChange={(value) => setLineFilter(value as LineFilter)} aria-label="筛选句子">
            <option value="all">全部句子</option>
            <option value="missing">缺失配音</option>
            <option value="paragraph" disabled={expandedParagraph < 0}>当前段落</option>
          </Select>
        </div>
        <span className="text-xs tabular-nums text-text-faint">{visibleEntries.length}/{entries.length} 句</span>
        {chapters.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setCollapsedChapters(allCollapsed ? new Set() : new Set(chapters.map((chapter) => chapter.segment)))}>
            {allCollapsed ? "全部展开" : "全部收起"}
          </Button>
        )}
      </div>

      {error && <p role="alert" className="border-b border-hairline px-5 py-2 text-xs text-danger sm:px-6">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-12 text-white/40"><Spinner /></div>
      ) : lines.length === 0 ? (
        <p className="py-12 text-center text-sm text-text-faint">先在文案页生成稿件</p>
      ) : visibleEntries.length === 0 ? (
        <div className="space-y-2 py-12 text-center">
          <p className="text-sm text-text-faint">没有符合条件的句子</p>
          {(searching || lineFilter !== "all") && (
            <button type="button" className="btn-text mx-auto" onClick={() => { setLineQuery(""); setLineFilter("all"); }}>
              清空筛选条件
            </button>
          )}
        </div>
      ) : (
        <div className={`grid ${multiChapter ? "lg:grid-cols-[11rem_minmax(0,1fr)]" : ""}`}>
          {multiChapter && (
            <nav aria-label="章节导航" className="hidden max-h-[min(70vh,780px)] overflow-y-auto border-r border-hairline px-2 py-3 lg:block">
              <p className="label px-2 pb-2">章节</p>
              <ul className="space-y-0.5">
                {chapters.map((chapter) => {
                  const active = activeChapter === chapter.segment;
                  return (
                    <li key={chapter.segment}>
                      <button
                        type="button"
                        className={`relative flex w-full cursor-pointer flex-col gap-1.5 rounded-control px-2 py-2 text-left transition-colors ${active ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}`}
                        aria-current={active ? "true" : undefined}
                        onClick={() => scrollToChapter(chapter.segment)}
                      >
                        <span aria-hidden className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent transition-opacity duration-200 ${active ? "opacity-100" : "opacity-0"}`} />
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`truncate text-xs ${active ? "text-text" : "text-text-secondary"}`}>第 {chapter.segment + 1} 章</span>
                          <span className="shrink-0 text-2xs tabular-nums text-text-faint">{chapter.voiced}/{chapter.count}</span>
                        </span>
                        <span className="block h-0.5 overflow-hidden rounded-full bg-white/10">
                          <span className={`block h-full rounded-full transition-[width] duration-500 ease-out ${chapter.missing ? "bg-warn/70" : "bg-accent/70"}`} style={{ width: `${chapter.count ? (chapter.voiced / chapter.count) * 100 : 0}%` }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
          <div ref={listRef} className="max-h-[min(70vh,780px)] space-y-4 overflow-y-auto px-3 py-3 sm:px-4">
            {chapters.map((chapter) => {
              // 搜索时强制展开：命中的句子被折叠藏起来，用户会以为没搜到
              const collapsed = !searching && collapsedChapters.has(chapter.segment);
              return (
                <section
                  key={chapter.segment}
                  data-segment={chapter.segment}
                  ref={(element) => { if (element) sectionRefs.current.set(chapter.segment, element); else sectionRefs.current.delete(chapter.segment); }}
                  className="space-y-2 scroll-mt-1"
                >
                  {multiChapter && (
                    <button
                      type="button"
                      className="sticky top-0 z-[1] flex w-full cursor-pointer items-center gap-3 border-b border-hairline bg-ink/92 px-2 py-2 text-left backdrop-blur-md"
                      aria-expanded={!collapsed}
                      onClick={() => setCollapsedChapters((current) => {
                        const next = new Set(current);
                        if (next.has(chapter.segment)) next.delete(chapter.segment);
                        else next.add(chapter.segment);
                        return next;
                      })}
                    >
                      <span className="text-xs font-medium text-text">第 {chapter.segment + 1} 章</span>
                      <span className="text-2xs tabular-nums text-text-faint">{chapter.count} 句 · 已配音 {chapter.voiced}</span>
                      {chapter.missing > 0 && <span className="text-2xs text-warn">缺 {chapter.missing}</span>}
                      <Icon name="chevron" className={`ml-auto size-3.5 shrink-0 text-text-faint transition-transform duration-300 ${collapsed ? "" : "rotate-180"}`} />
                    </button>
                  )}
                  <Collapse open={!collapsed}>
                    <div className="space-y-3">
                      {chapter.paragraphs.map((paragraphGroup) => {
                        const paragraphEntries = paragraphGroup.groups.flatMap((group) => group.items);
                        const paragraphCollapsed = collapsedParagraphs.has(paragraphGroup.key);
                        const paragraphMissing = paragraphEntries.filter(({ item }) => !item.audio).length;
                        return (
                          <div key={paragraphGroup.key} className="space-y-1.5">
                            {(chapter.paragraphs.length > 1 || paragraphGroup.paragraph >= 0) && (
                              <div className="flex items-center gap-2 px-1.5 py-1">
                                <span className="size-1 shrink-0 rounded-full bg-white/25" />
                                <span className="text-2xs text-text-muted">{paragraphGroup.paragraph >= 0 ? `第 ${paragraphGroup.paragraph + 1} 段` : "未分段"}</span>
                                <span className="text-2xs tabular-nums text-text-faint">{paragraphEntries.length} 句</span>
                                {paragraphMissing > 0 && <span className="text-2xs text-warn">缺 {paragraphMissing}</span>}
                                <span aria-hidden className="h-px flex-1 bg-white/[0.06]" />
                                <button
                                  type="button"
                                  className="cursor-pointer text-2xs text-text-faint transition hover:text-text"
                                  aria-expanded={!paragraphCollapsed}
                                  onClick={() => setCollapsedParagraphs((current) => {
                                    const next = new Set(current);
                                    if (next.has(paragraphGroup.key)) next.delete(paragraphGroup.key);
                                    else next.add(paragraphGroup.key);
                                    return next;
                                  })}
                                >
                                  {paragraphCollapsed ? "展开" : "收起"}
                                </button>
                              </div>
                            )}
                            <Collapse open={!paragraphCollapsed}>
                              <div className="space-y-1.5">
                                {paragraphGroup.groups.map((group) => {
                                  if (!group.block) return renderRow(group.items[0], false);
                                  const splitLabels = blockStatuses(group.items);
                                  const audios = blockAudios({ items: group.items, block: group.block });
                                  const job = group.items.find(({ item }) => item.job)?.item.job;
                                  const voicedInBlock = group.items.filter(({ item }) => item.audio).length;
                                  const blockCost = revoiceCostOf(group.items[0].item.id);
                                  return (
                                    <div key={group.key} className="rounded-surface border border-hairline bg-white/[0.015] p-1.5">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-hairline px-2 pb-2">
                                        <span className="text-2xs font-medium text-text-secondary">第 {group.items[0].index + 1}–{group.items.at(-1)!.index + 1} 句 · {group.items.length} 句</span>
                                        <span className={`text-2xs tabular-nums ${voicedInBlock === group.items.length ? "text-text-faint" : "text-warn"}`}>已配音 {voicedInBlock}/{group.items.length}</span>
                                        {splitLabels.map((label) => (
                                          <span key={label} className="inline-flex h-5 items-center rounded-full border border-line px-2 text-2xs text-text-muted">{label}</span>
                                        ))}
                                        {job && <span className="text-2xs text-text-muted">{job.status === "running" ? "合成中" : job.status === "queued" ? "排队中" : job.error || job.status}</span>}
                                        {audios.map((audio) => (
                                          <AudioButton key={`${audio.src}-${audio.start}`} src={audio.src} label={audio.label} channel={AUDIO_CHANNEL} />
                                        ))}
                                        <button type="button" className="chip ml-auto h-7 px-2.5" title={`整段重录${costLabelText(blockCost)}`} onClick={() => void revoice(group.items[0].item.id)}>
                                          重录本段 · {group.items.length} 句{costLabelText(blockCost)}
                                        </button>
                                      </div>
                                      <div className="space-y-0.5 pt-1.5">
                                        {group.items.map((entry) => renderRow(entry, true))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </Collapse>
                          </div>
                        );
                      })}
                    </div>
                  </Collapse>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/** 句子行：原文是主体，动作随状态出现，设置收进展开层 */
function SentenceRow({
  entry,
  grouped,
  expanded,
  lex,
  isolation,
  imageCount,
  supportsEmotionTags,
  costText,
  api,
  captureSelection,
  audioHint,
  index,
}: {
  entry: Entry;
  grouped: boolean;
  expanded: boolean;
  lex: LexDraft | null;
  isolation: { kind: "note"; text: string } | { kind: "toggle"; isolated: boolean } | null;
  imageCount: number;
  supportsEmotionTags: boolean;
  costText: string;
  api: RowApi;
  captureSelection: (lineId: string, element: HTMLParagraphElement) => void;
  audioHint: string;
  index: number;
}) {
  const { item, line } = entry;
  const audio = item.audio;
  const running = audioHint.length > 0;
  const failed = item.job && item.job.status === "failed";
  const spokenDiffers = item.spoken !== line.text;
  return (
    <div
      className={`group/row relative rounded-control border transition-colors duration-200 ${expanded ? "border-accent/25 bg-accent/[0.03]" : "border-transparent hover:border-hairline hover:bg-white/[0.02]"}`}
    >
      <div className="flex items-start gap-2.5 px-2.5 py-2">
        {/* 序号也是定位按钮：句子列表与预览之间的最短路径 */}
        <button
          type="button"
          className="mt-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded-full text-2xs tabular-nums text-text-faint transition hover:bg-white/10 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          onClick={() => api.seek(item.id)}
          title="在预览里定位这一句"
          aria-label={`在预览里定位第 ${index + 1} 句`}
        >
          {String(index + 1).padStart(2, "0")}
        </button>
        <div className="min-w-0 flex-1">
          <p
            tabIndex={0}
            className="select-text text-sm leading-6 text-text/85"
            onMouseUp={(event) => captureSelection(item.id, event.currentTarget)}
            onTouchEnd={(event) => captureSelection(item.id, event.currentTarget)}
            onKeyUp={(event) => captureSelection(item.id, event.currentTarget)}
          >
            {line.text}
          </p>
          {spokenDiffers && <p className="mt-0.5 truncate text-2xs text-text-faint" title={item.spoken}>朗读：{item.spoken}</p>}
          <div className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 transition-opacity duration-150 max-sm:opacity-100 ${expanded || running || failed || !audio ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"}`}>
            {audio ? (
              <>
                <AudioButton src={audio.src} startMs={audio.startMs} endMs={audio.endMs} channel={AUDIO_CHANNEL} />
                <span className="text-2xs text-text-faint">{audio.alignmentSource === "provider" ? "精确对齐" : "估算对齐"}</span>
              </>
            ) : running ? (
              <span className="inline-flex items-center gap-1.5 text-2xs text-text-muted"><Spinner className="size-3" />{audioHint}</span>
            ) : (
              <span className="inline-flex h-6 items-center rounded-full border border-warn-border bg-warn-surface px-2 text-2xs text-warn">未配音</span>
            )}
            {failed && <span className="min-w-0 truncate text-2xs text-danger" title={item.job?.error ?? ""}>失败：{item.job?.error || "未知原因"}</span>}
            {line.locked && (
              <span className="text-text-faint" title="已锁定：重新断句标注不会改写这一句">
                <Icon name="lock" className="size-3" />
              </span>
            )}
            {!grouped && (
              <button type="button" className="chip h-7 px-2.5" title={`重录这一句${costText}`} onClick={() => api.revoice(item.id)}>
                重录{costText}
              </button>
            )}
            {isolation?.kind === "toggle" && (
              <button type="button" className="cursor-pointer text-2xs text-text-muted transition hover:text-text" onClick={() => api.toggleIsolated(item.id)}>
                {isolation.isolated ? "取消单独录制" : "单独录制此句"}
              </button>
            )}
            {isolation?.kind === "note" && <span className="text-2xs text-text-faint">{isolation.text}</span>}
            <button
              type="button"
              className="ml-auto grid size-6 shrink-0 cursor-pointer place-items-center rounded-full text-text-faint transition hover:bg-white/10 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              aria-expanded={expanded}
              aria-label={expanded ? `收起第 ${index + 1} 句的设置` : `展开第 ${index + 1} 句的设置`}
              onClick={() => api.toggleExpand(item.id)}
            >
              <Icon name="chevron" className={`size-3.5 transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />
            </button>
          </div>
        </div>
      </div>
      <Collapse open={expanded}>
        <div className="ml-8 space-y-3 border-t border-hairline px-2.5 py-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(9rem,11rem)_minmax(0,1fr)] sm:items-end">
            <label className="block space-y-1.5">
              <span className="label">旁白表达</span>
              <Select className="h-8 min-h-8 py-1.5 text-xs" value={line.voiceTag ?? "auto"} disabled={!supportsEmotionTags} aria-label="旁白表达" onChange={(value) => api.setVoiceTag(item.id, value as VoiceTag)}>
                {voiceTagChoices.filter((choice) => choice.value !== "auto" || !line.voiceTag || line.voiceTag === "auto").map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </Select>
            </label>
            <p className="pb-1 text-2xs leading-5 text-text-faint">
              {supportsEmotionTags
                ? line.voiceTag?.startsWith("ssml:")
                  ? "SSML 只调节句内停顿，不叠加情绪标签或全片说明。"
                  : `内容情绪：${line.mood ?? "未标注"}，用于分镜和字幕。只在这一句要换念法时才选。`
                : "当前模型不使用逐句标签。"}
            </p>
          </div>
          <div className="space-y-2">
            {lex ? (
              <>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <input className="input h-8 py-1.5 text-xs" value={lex.word} onChange={(event) => api.editLex({ word: event.target.value })} placeholder="词语" aria-label="词语" autoFocus />
                  <input className="input h-8 py-1.5 text-xs" value={lex.say} onChange={(event) => api.editLex({ say: event.target.value })} placeholder="朗读为" aria-label="朗读为" />
                  <Button size="sm" variant="primary" disabled={lex.busy || !lex.word.trim() || !lex.say.trim()} loading={lex.busy} onClick={api.saveLex}>
                    保存
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="btn-text" disabled={lex.busy} onClick={api.previewLex}>试听整句</button>
                  {lex.preview && <AudioButton src={lex.preview} label="重听" channel={AUDIO_CHANNEL} />}
                  <button type="button" className="btn-text hover:text-text-muted" onClick={api.closeLex}>取消</button>
                </div>
                <p className="text-2xs leading-5 text-text-faint">该规则作用于本项目里出现的同名词语；字幕原文不变。保存后会重新排队这一句的配音。</p>
              </>
            ) : (
              <button type="button" className="btn-text" onClick={() => api.openLex(item.id, "", "")}>
                <Icon name="plus" className="size-3.5" />
                添加词典规则
              </button>
            )}
          </div>
          <div className="flex items-start justify-between gap-4 border-t border-hairline pt-3">
            <p className="min-w-0 text-2xs leading-5 text-text-faint">
              {isolation?.kind === "toggle" && imageCount > 1
                ? `锁定后不会改写这一句的读音、停顿和情绪；本句当前${isolation.isolated ? "单独录制" : `与同段共 ${imageCount} 句一起合成`}。`
                : "锁定后，重新断句标注不会改写这一句的读音、停顿和情绪。"}
            </p>
            <Button size="sm" variant="ghost" aria-pressed={!!line.locked} className={line.locked ? "border-line-bold text-text" : ""} icon={<Icon name="lock" className="size-3.5" />} onClick={() => api.toggleLock(item.id)}>
              {line.locked ? "已锁定" : "锁定"}
            </Button>
          </div>
        </div>
      </Collapse>
    </div>
  );
}
