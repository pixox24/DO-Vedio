"use client";

// 句子面板：逐句配音、重录、段落模式、筛选与批量操作。

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioButton, Icon, Select, Spinner } from "@/components/ui";
import { postJson } from "@/lib/client";
import { voiceTagChoices, type Job, type ProjectDoc, type VoiceTag } from "@/lib/core/types";
import { isTtsStage, lineSpeech, ttsRequestForLine } from "@/lib/core/keys";
import { paragraphIndexes, paragraphSupported } from "@/lib/core/blocks";
import { cleanSelectedWord } from "@/lib/selection";
import { costSuffix, costSuffixAtLeast, needsConfirm } from "@/lib/core/interaction";
import { useFeedback } from "@/components/feedback";
import { costLabelText, jobBatchId, type LineInfo, type ProjectStore } from "./shared";

export function SentencePanel({ id, store, jobs, onChanged, onSeek }: { id: string; store: ProjectStore; jobs?: Map<string, Job>; onChanged?: () => void; onSeek?: (lineId: string) => void }) {
  const [lines, setLines] = useState<LineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [lexWord, setLexWord] = useState("");
  const [lexSay, setLexSay] = useState("");
  const [lexBusy, setLexBusy] = useState(false);
  const [error, setError] = useState("");
  const [lexOpen, setLexOpen] = useState(false);
  const [selectionPoint, setSelectionPoint] = useState({ x: 0, y: 0 });
  const [previewSrc, setPreviewSrc] = useState("");
  const [batchBusy, setBatchBusy] = useState<"all" | "missing" | null>(null);
  /** 本次提交的配音批次；用它显示进度、停止本次 */
  const [batch, setBatch] = useState<{ id: string; mode: "all" | "missing"; at: number } | null>(null);
  const [batchStopping, setBatchStopping] = useState(false);
  const [lineQuery, setLineQuery] = useState("");
  const [lineFilter, setLineFilter] = useState<"all" | "missing" | "paragraph">("all");
  const [collapsedParagraphs, setCollapsedParagraphs] = useState<Set<string>>(new Set());
  const lineRefs = useRef<Record<string, HTMLDivElement | null>>({});
  /** 只有 Worker 成功写入新音频后才出现「撤销」，避免撤销半成品或失败任务。 */
  const [pendingUndo, setPendingUndo] = useState<{ jobIds: string[]; keys: string[]; label: string } | null>(null);
  const { confirm, toast } = useFeedback();
  const ttsExpressionRevision = store.doc?.lines.map((line) => `${line.id}:${line.mood ?? ""}:${line.voiceTag ?? "auto"}:${line.ttsIsolated ? "isolated" : ""}`).join("|") ?? "";
  const voiceSettings = store.doc?.settings.voice;
  const capabilities = lines[0]?.capabilities ?? [];
  const supportsEmotionTags = capabilities.includes("emotion-tags");
  const supportsStylePrompt = capabilities.includes("style-prompt");

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
    const paragraphMode = !!voiceSettings && voiceSettings.granularity === "paragraph" && paragraphSupported(voiceSettings);
    const jobs = paragraphMode ? new Set(candidates.map((item) => item.block?.key ?? item.id)).size : count;
    const cost = batchCostOf(candidates);
    const label = mode === "all" ? "全部重录" : "补齐缺失配音";
    const countLabel = paragraphMode ? `${count} 句，合并为 ${jobs} 个段落任务` : `${count} 句`;
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
    if (!selected || !lexWord.trim() || !lexSay.trim()) return;
    setLexBusy(true);
    setError("");
    try {
      await postJson("/api/lexicon", { scope: id, word: lexWord.trim(), say: lexSay.trim() });
      setLexOpen(false);
      setLexWord("");
      setLexSay("");
      setError("词典已保存，正在重新排队本句配音…");
      try {
        await postJson(`/api/projects/${id}/lines/${selected}`, {});
        onChanged?.();
        await refresh();
        setError("");
      } catch { setError("词典已保存，但本句重新配音排队失败。请点击本句“重录”重试。"); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLexBusy(false);
    }
  }

  function captureSelection(lineId: string, element: HTMLParagraphElement) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
    const word = cleanSelectedWord(selection.toString());
    if (!word) return;
    const rect = range.getBoundingClientRect();
    setSelected(lineId);
    setLexWord(word);
    setLexSay(word);
    setSelectionPoint({ x: Math.min(rect.left, window.innerWidth - 145), y: Math.min(rect.bottom + 8, window.innerHeight - 48) });
    setLexOpen(false);
  }

  async function previewLexicon() {
    const line = store.doc?.lines.find((l) => l.id === selected);
    if (!line || !lexWord.trim() || !lexSay.trim()) return;
    setLexBusy(true);
    try {
      const rows = await fetch(`/api/lexicon?projectId=${encodeURIComponent(id)}`).then((r) => r.json()) as { scope: string; word: string; say: string }[];
      const entries = new Map(rows.sort((a, b) => Number(a.scope === id) - Number(b.scope === id)).map((r) => [r.word, r.say]));
      entries.set(lexWord.trim(), lexSay.trim());
      const text = lineSpeech(line, [...entries].map(([word, say]) => ({ word, say }))).spoken;
      const preview = ttsRequestForLine(text, line, store.doc!.settings.voice.model);
      const { src } = await postJson<{ src: string }>("/api/voices/preview", { voice: store.doc!.settings.voice, text: preview.text, textType: preview.textType });
      setPreviewSrc(src);
      new Audio(src).play().catch(() => setError("试听播放失败"));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLexBusy(false); }
  }

  const paragraphMode = !!voiceSettings && voiceSettings.granularity === "paragraph" && paragraphSupported(voiceSettings);
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
      store.setDoc((doc) => ({ ...doc, lines: doc.lines.map((item) => item.id === lineId ? { ...item, ttsIsolated: isolated } : item) }));
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
  const entries = lines.flatMap((item, index) => {
    const line = lineById.get(item.id);
    return line ? [{ item, line, index }] : [];
  });
  const selectedLineIndex = selected ? store.doc?.lines.findIndex((line) => line.id === selected) ?? -1 : -1;
  const selectedParagraph = selectedLineIndex >= 0 ? paragraphNumbers[selectedLineIndex] : -1;
  const normalizedQuery = lineQuery.trim().toLocaleLowerCase();
  const visibleEntries = entries.filter(({ item, line, index }) => {
    const matchesQuery = !normalizedQuery || `${line.text} ${item.spoken}`.toLocaleLowerCase().includes(normalizedQuery);
    const matchesFilter = lineFilter === "all"
      || (lineFilter === "missing" && !item.audio)
      || (lineFilter === "paragraph" && selectedParagraph >= 0 && paragraphNumbers[index] === selectedParagraph && line.segmentIndex === store.doc?.lines[selectedLineIndex]?.segmentIndex);
    return matchesQuery && matchesFilter;
  });
  const groups: { items: typeof entries; block: NonNullable<LineInfo["block"]> | null }[] = [];
  for (const entry of visibleEntries) {
    const previous = groups.at(-1);
    if (entry.item.block && previous?.block?.key === entry.item.block.key) previous.items.push(entry);
    else groups.push({ items: [entry], block: entry.item.block });
  }
  const paragraphGroups: { key: string; paragraph: number; segment: number; groups: typeof groups }[] = [];
  for (const group of groups) {
    const first = group.items[0];
    const paragraph = paragraphNumbers[first.index] ?? -1;
    const segment = first.line.segmentIndex;
    const key = `${segment}:${paragraph}`;
    const current = paragraphGroups.at(-1);
    if (current?.key === key) current.groups.push(group);
    else paragraphGroups.push({ key, paragraph, segment, groups: [group] });
  }

  const scrollToLine = (lineId: string | null) => {
    if (!lineId) return;
    lineRefs.current[lineId]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    onSeek?.(lineId);
  };

  const isolationControl = (item: LineInfo, line: ProjectDoc["lines"][number]) => {
    if (!paragraphMode || paragraphCountOf(line) < 2) return null;
    const request = ttsRequestForLine(item.spoken, line, voiceSettings!.model);
    if (request.textType || request.text !== item.spoken) return <span className="text-[11px] text-white/40">本句含表达标签，已单独成块</span>;
    return <button className="text-xs text-white/50 hover:text-white" onClick={() => void toggleIsolated(line.id)}>{line.ttsIsolated ? "取消单独录制" : "单独录制此句"}</button>;
  };

  const blockStatus = (items: typeof entries) => {
    const blocks = items.map(({ item }) => item.block!).filter(Boolean);
    const outcomes = blocks.map((block) => block.outcome);
    const labels: string[] = [];
    if (outcomes.some((outcome) => outcome === null)) labels.push("未配音");
    else if (outcomes.some((outcome) => outcome === "line")) labels.push("切分不可靠，已逐句合成");
    else if (outcomes.some((outcome) => outcome === "halved")) labels.push("已拆小合成");
    else if (outcomes.every((outcome) => outcome === "block") && blocks.every((block) => block.splitSource === "provider")) labels.push("精确切分");
    else if (outcomes.every((outcome) => outcome === "block") && blocks.every((block) => block.splitSource === "vad")) labels.push("估算切分");
    if (blocks.some((block) => block.confidence != null && block.confidence < 0.8)) labels.push("切分待复核");
    return labels;
  };

  const blockAudios = (group: { items: typeof entries; block: NonNullable<LineInfo["block"]> }) => {
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

  const renderLine = (entry: typeof entries[number], grouped: boolean) => {
    const { item, line, index } = entry;
    const open = selected === item.id;
    return <div ref={(element) => { lineRefs.current[item.id] = element; }} key={item.id} className={`rounded-xl border p-3 ${grouped ? "border-white/[0.05] bg-white/[0.015]" : open ? "border-accent/30 bg-accent/[0.04]" : "border-white/[0.07] bg-white/[0.02]"}`}>
      <div className="flex items-start gap-3">
        <span className="pt-0.5 text-[11px] tabular-nums text-white/30">{String(index + 1).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1 text-left">
          <p tabIndex={0} className="select-text text-sm leading-6 text-white/85" onMouseUp={(e) => captureSelection(item.id, e.currentTarget)} onTouchEnd={(e) => captureSelection(item.id, e.currentTarget)} onKeyUp={(e) => captureSelection(item.id, e.currentTarget)}>{line.text}</p>
          <p className="mt-1 truncate text-xs text-white/35">朗读：{item.spoken}</p>
          <button className="mt-1 text-xs text-white/45 hover:text-white" onClick={() => { const next = open ? null : item.id; setSelected(next); scrollToLine(next); }}>{open ? "已定位" : "定位句子"}</button>
        </div>
        <button className={`chip h-7 px-2.5 ${line.locked ? "chip-on" : ""}`} title={line.locked ? "解锁句子" : "锁定句子"} onClick={() => toggleLock(line.id)}>
          {line.locked ? "已锁定" : "锁定"}
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-7">
        {item.audio ? <><AudioButton src={item.audio.src} startMs={item.audio.startMs} endMs={item.audio.endMs} /><span className="text-[11px] text-white/40">{item.audio.alignmentSource === "provider" ? "精确对齐" : "估算对齐"}</span></> : <span className="text-sm text-amber-200/80">未配音</span>}
        {!grouped && item.job && <span className="text-xs text-white/35">{item.job.status === "running" ? "合成中" : item.job.status === "queued" ? "排队中" : item.job.error || item.job.status}</span>}
        {!grouped && <button className="chip h-7 px-2.5" title={`重录这一句${costLabelText(revoiceCostOf(item.id))}`} onClick={() => revoice(item.id)}>重录 · 1 句{costLabelText(revoiceCostOf(item.id))}</button>}
        {isolationControl(item, line)}
      </div>
      {open && (
        <div className="mt-3 ml-7 border-t border-white/[0.06] pt-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(180px,240px)_1fr] sm:items-end">
            <label className="block space-y-1.5">
              <span className="label">旁白表达</span>
              <Select className="h-8 min-h-8 py-1.5 text-xs" value={line.voiceTag ?? "auto"} disabled={!supportsEmotionTags} aria-label="旁白表达" onChange={(value) => updateVoiceTag(line.id, value as VoiceTag)}>
                {voiceTagChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </Select>
            </label>
            <p className="pb-1 text-[11px] leading-5 text-white/40">{supportsEmotionTags ? line.voiceTag?.startsWith("ssml:") ? "SSML 只调节句内停顿；本句不叠加情绪标签或全局表达指令。点击「重录」试听。" : `句子情绪：${line.mood ?? "未标注"}；修改后点击本句「重录」生效。` : supportsStylePrompt ? "当前模型使用制作设置中的全局表达指令，不提供逐句情绪标签。" : "当前模型不支持逐句表达控制。"}</p>
          </div>
          <button className="mb-2 text-xs text-white/55 hover:text-white" onClick={() => { setLexOpen(true); setLexWord(""); setLexSay(""); }}>添加词典规则</button>
          {lexOpen && <>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input className="input h-8 py-1.5 text-xs" value={lexWord} onChange={(e) => setLexWord(e.target.value)} placeholder="词语" />
              <input className="input h-8 py-1.5 text-xs" value={lexSay} onChange={(e) => setLexSay(e.target.value)} placeholder="朗读为" />
              <button className="chip h-8" disabled={lexBusy || !lexWord.trim() || !lexSay.trim()} onClick={addLexicon}>{lexBusy ? <Spinner className="size-3" /> : "保存"}</button>
            </div>
            <div className="mt-2 flex gap-3"><button className="text-xs text-white/60" disabled={lexBusy} onClick={previewLexicon}>试听整句</button><button className="text-xs text-white/40" onClick={() => { setLexOpen(false); setLexWord(""); }}>取消</button></div>
            <p className="mt-2 text-[11px] text-white/45">该规则会作用于本项目中出现的同名词语。字幕原文不变。</p>
            {previewSrc && <audio className="sr-only" src={previewSrc} />}
          </>}
        </div>
      )}
    </div>;
  };

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label">句子</p>
          <h2 className="mt-1 text-base font-medium">句子与配音</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-white/35">{lines.length} 句</span>
          <button className="btn btn-ghost btn-sm" disabled={!!batchBusy || batchActive || batchStopping || !lines.length} onClick={() => batchRevoice("missing")} title={missingCount ? `补齐 ${missingCount} 句没有配音的句子${costLabelText(missingCost)}` : "没有缺失的配音"}>{batchBusy === "missing" ? <Spinner className="size-3" /> : null}补齐缺失{missingCount ? ` · ${missingCostSuffix}` : ""}</button>
          <button className="btn btn-ghost btn-sm" disabled={!!batchBusy || batchActive || batchStopping || !lines.length} onClick={() => batchRevoice("all")} title={`按当前音色重新生成全部 ${lines.length} 句${costLabelText(batchCostOf(lines))}`}>{batchBusy === "all" ? <Spinner className="size-3" /> : null}全部重录 · {lines.length} 句{costLabelText(batchCostOf(lines))}</button>
        </div>
      </div>
      {missingCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2 text-xs text-amber-100/80">
          <span>有 {missingCostSuffix} 需要重新配音</span>
          <span className="text-amber-100/50">当前已有配音继续可用，补齐后才会替换缺失句。</span>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-red-300/80">{error}</p>}
      {batch && batchTotal > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-xs">
          {batchActive ? <Spinner className="size-3 text-accent" /> : null}
          <span className="text-white/70">
            {batch.mode === "all" ? "全部重录" : "补齐缺失"} · {batchDone}/{batchTotal}
            {batchFailed ? <span className="text-red-300/80"> · 失败 {batchFailed}</span> : null}
          </span>
          {batchActive
            ? <button className="chip ml-auto h-6 px-2.5 text-[11px]" disabled={batchStopping} onClick={() => void stopBatch()}>{batchStopping ? <><Spinner className="size-3" />正在停止…</> : <><Icon name="stop" className="size-3" />停止本次</>}</button>
            : <button className="ml-auto text-[11px] text-white/35 hover:text-white" onClick={() => setBatch(null)}>收起</button>}
          <span className="w-full text-[11px] text-white/35">
            {batchActive ? "已完成的任务不受影响，可随时停止" : batchFailed ? "有任务失败，可点上方「重试」" : "本次配音已结束"}
          </span>
        </div>
      )}
      <div className="mt-4 grid gap-2 border-t border-white/[0.06] pt-4 sm:grid-cols-[minmax(180px,1fr)_auto_auto]">
        <label className="relative block">
          <span className="sr-only">搜索句子</span>
          <input className="input h-9 w-full text-xs" value={lineQuery} onChange={(event) => setLineQuery(event.target.value)} placeholder="搜索文案或朗读内容" aria-label="搜索句子" />
        </label>
        <Select className="h-9 text-xs" value={lineFilter} onChange={(value) => setLineFilter(value as typeof lineFilter)} aria-label="筛选句子">
          <option value="all">全部句子</option>
          <option value="missing">缺失配音</option>
          <option value="paragraph" disabled={selectedParagraph < 0}>当前段落</option>
        </Select>
        <div className="flex items-center justify-end gap-2 text-xs text-white/40">
          <span>{visibleEntries.length}/{entries.length} 句</span>
          <button className="chip h-8 px-2.5" disabled={!selected} onClick={() => scrollToLine(selected)}>定位当前句</button>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-8 text-white/40"><Spinner /></div>
      ) : lines.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/35">先在文案页生成稿件</p>
      ) : visibleEntries.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/35">没有符合条件的句子</p>
      ) : (
        <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {paragraphGroups.map((paragraphGroup) => {
            const collapsed = collapsedParagraphs.has(paragraphGroup.key);
            const paragraphEntries = paragraphGroup.groups.flatMap((group) => group.items);
            return <div key={paragraphGroup.key} className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-2">
              <button className="flex w-full items-center justify-between gap-3 px-2 py-1 text-left text-xs text-white/65" aria-expanded={!collapsed} onClick={() => setCollapsedParagraphs((current) => { const next = new Set(current); if (next.has(paragraphGroup.key)) next.delete(paragraphGroup.key); else next.add(paragraphGroup.key); return next; })}>
                <span className="font-medium">第 {paragraphGroup.segment + 1} 段 · {paragraphEntries.length} 句{paragraphGroup.paragraph >= 0 ? ` · 段落 ${paragraphGroup.paragraph + 1}` : ""}</span>
                <span className="text-white/35">{collapsed ? "展开" : "收起"}</span>
              </button>
              {!collapsed && <div className="mt-2 space-y-2">{paragraphGroup.groups.map((group) => {
                if (!group.block) return renderLine(group.items[0], false);
                const statuses = blockStatus(group.items);
                const audioGroup = { ...group, block: group.block };
                const audios = blockAudios(audioGroup);
                const job = group.items.find(({ item }) => item.job)?.item.job;
                return <div key={group.block.key} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2">
                  <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-2 pb-2 text-xs text-white/55">
                    <span className="font-medium text-white/75">第 {group.items[0].index + 1}–{group.items.at(-1)!.index + 1} 句 · {group.items.length} 句</span>
                    {statuses.map((status) => <span key={status} className="chip h-6 px-2 text-[11px]">{status}</span>)}
                    {job && <span className="text-white/40">{job.status === "running" ? "合成中" : job.status === "queued" ? "排队中" : job.error || job.status}</span>}
                    {audios.map((audio) => <AudioButton key={`${audio.src}-${audio.start}`} src={audio.src} label={audio.label} />)}
                    <button className="chip ml-auto h-7 px-2.5" title={`整段重录${costLabelText(revoiceCostOf(group.items[0].item.id))}`} onClick={() => revoice(group.items[0].item.id)}>重录本段 · {group.items.length} 句{costLabelText(revoiceCostOf(group.items[0].item.id))}</button>
                  </div>
                  <div className="mt-2 space-y-2">{group.items.map((entry) => renderLine(entry, true))}</div>
                </div>;
              })}</div>}
            </div>;
          })}
        </div>
      )}
      {selected && lexWord && !lexOpen && <button className="fixed z-50 rounded bg-white px-3 py-2 text-xs font-medium text-black shadow-xl max-sm:!top-auto max-sm:bottom-4 max-sm:!left-1/2 max-sm:-translate-x-1/2" style={{ left: selectionPoint.x, top: selectionPoint.y }} onMouseDown={(e) => e.preventDefault()} onClick={() => setLexOpen(true)}>设置读法</button>}
    </section>
  );
}
