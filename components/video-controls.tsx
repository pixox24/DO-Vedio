"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { AudioButton, AutoTextarea, Field, Icon, RangeField, Select, SegmentedControl, Spinner, Switch } from "@/components/ui";
import { jobAction, postJson, type SaveState } from "@/lib/client";
import { mediaUrl } from "@/lib/core/types";
import { animationFamilies, p1ShotKinds, shotKindLabels, shotSizeLabels, shotSizes, voiceTagChoices, type CardVariant, type Job, type MusicCue, type ProjectDoc, type Shot, type VoiceSettings, type VoiceTag } from "@/lib/core/types";
import { newId } from "@/lib/core/sync";
import { stampShots } from "@/lib/core/shots";
import { assetStale, compileShotPrompt, MAX_SHOT_CHARACTERS, needsGeneratedImage, type CompiledPrompt } from "@/lib/core/prompt-compiler";
import { useFeedback } from "@/components/feedback";
import { PresetSection } from "@/components/preset-dialog";
import type { Timeline } from "@/lib/core/timeline";
import type { TimelineShot } from "@/lib/core/timeline";
import { isTtsStage, lineSpeech, ttsRequestForLine } from "@/lib/core/keys";
import { paragraphIndexes, paragraphSupported } from "@/lib/core/blocks";
import { cleanSelectedWord } from "@/lib/selection";
import { costLabel, costSuffix, costSuffixAtLeast, needsConfirm } from "@/lib/core/interaction";
import { outputSpecIdForAspect, outputSpecsFor } from "@/lib/core/output-spec";
import { defaultUi2vTemplateForShot, ui2vTemplateOptions, ui2vTemplates } from "@/lib/core/ui2v";

const ShotThumbnail = dynamic(() => import("./shot-thumbnail").then((m) => m.ShotThumbnail), { ssr: false, loading: () => <div className="grid h-full place-items-center bg-[#17242c] text-xs text-white/40">正在加载预览</div> });

type ProjectStore = {
  doc: ProjectDoc | null;
  setDoc: (fn: (doc: ProjectDoc) => ProjectDoc) => void;
  save: SaveState;
  flush: () => Promise<unknown>;
  reload: () => Promise<void>;
};

type LineInfo = {
  id: string;
  spoken: string;
  /** 这一句当前的配音缓存键；撤销重录时用它定位归档记录 */
  ttsKey: string;
  /** 重录这句的预估费用（元）；段落模式下按块计费，见 blockCostYuan */
  costYuan?: number;
  /** 段落模式：重录本段的预估费用（整块重算） */
  blockCostYuan?: number | null;
  audio: { src: string; startMs: number; endMs: number; aligned: boolean; alignmentSource?: "provider" | "forced" | "estimated" } | null;
  capabilities?: string[];
  job: { id: string; status: string; error: string | null } | null;
  /** 段落配音：同一块的句子一起合成、一起重录 */
  block: { key: string; index: number; count: number; confidence: number | null; blockSrc: string | null; outcome: "block" | "halved" | "line" | null; splitSource: "provider" | "vad" | null; subKey: string | null } | null;
};

type ImageJobInput = { batchId?: string };

/** 把预估费用拼进句子文案；无法估算时返回空串 */
function costLabelText(costYuan: number | null | undefined) {
  const label = costLabel(typeof costYuan === "number" ? costYuan : null);
  return label ? `，${label}` : "";
}

/** 任务所属的批次 id（配音与生图共用同一约定：写在 input.batchId） */
function jobBatchId(job: Job) {
  if (!job.input || typeof job.input !== "object") return undefined;
  const value = (job.input as ImageJobInput).batchId;
  return typeof value === "string" ? value : undefined;
}

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
  const groups: { items: typeof entries; block: NonNullable<LineInfo["block"]> | null }[] = [];
  for (const entry of entries) {
    const previous = groups.at(-1);
    if (entry.item.block && previous?.block?.key === entry.item.block.key) previous.items.push(entry);
    else groups.push({ items: [entry], block: entry.item.block });
  }

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
    return <div key={item.id} className={`rounded-xl border p-3 ${grouped ? "border-white/[0.05] bg-white/[0.015]" : open ? "border-accent/30 bg-accent/[0.04]" : "border-white/[0.07] bg-white/[0.02]"}`}>
      <div className="flex items-start gap-3">
        <span className="pt-0.5 text-[11px] tabular-nums text-white/30">{String(index + 1).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1 text-left">
          <p tabIndex={0} className="select-text text-sm leading-6 text-white/85" onMouseUp={(e) => captureSelection(item.id, e.currentTarget)} onTouchEnd={(e) => captureSelection(item.id, e.currentTarget)} onKeyUp={(e) => captureSelection(item.id, e.currentTarget)}>{line.text}</p>
          <p className="mt-1 truncate text-xs text-white/35">朗读：{item.spoken}</p>
          <button className="mt-1 text-xs text-white/45 hover:text-white" onClick={() => { setSelected(open ? null : item.id); onSeek?.(item.id); }}>定位句子</button>
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
      {error && <p className="mt-3 text-xs text-red-300/80">{error}</p>}
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
      {loading ? (
        <div className="flex justify-center py-8 text-white/40"><Spinner /></div>
      ) : lines.length === 0 ? (
        <p className="py-8 text-center text-sm text-white/35">先在文案页生成稿件</p>
      ) : (
        <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {groups.map((group) => {
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
          })}
        </div>
      )}
      {selected && lexWord && !lexOpen && <button className="fixed z-50 rounded bg-white px-3 py-2 text-xs font-medium text-black shadow-xl max-sm:!top-auto max-sm:bottom-4 max-sm:!left-1/2 max-sm:-translate-x-1/2" style={{ left: selectionPoint.x, top: selectionPoint.y }} onMouseDown={(e) => e.preventDefault()} onClick={() => setLexOpen(true)}>设置读法</button>}
    </section>
  );
}

function shotUpdate(store: ProjectStore, id: string, fn: (shot: Shot) => Shot) {
  store.setDoc((doc) => ({ ...doc, shots: stampShots(doc.shots.map((s) => (s.id === id ? fn(s) : s)), doc.lines) }));
}

export function StoryboardPanel({ id, store, timeline, jobs, onSeek }: { id: string; store: ProjectStore; timeline: Timeline | null; jobs: Map<string, Job>; onSeek: (ms: number) => void }) {
  const doc = store.doc;
  const { confirm, toast } = useFeedback();
  const [uploading, setUploading] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [candidateCount, setCandidateCount] = useState(1);
  const [imageModels, setImageModels] = useState<{ id: string; label: string }[]>([]);
  const [imageModelId, setImageModelId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkBatch, setBulkBatch] = useState<{ id: string; createdAt: number; jobs: Job[] } | null>(null);
  const [bulkStopping, setBulkStopping] = useState(false);
  const [bulkStopRequested, setBulkStopRequested] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);
  /** 服务端裁决的镜头任务状态；客户端不再自己从 jobs Map 里猜（插入序不可靠） */
  const [shotStatus, setShotStatus] = useState<Record<string, { status: string; progress: number; message: string; error: string | null; total: number; done: number; failed: number; running: number }>>({});
  /** 任务有变化才重新裁决，避免每次渲染都打接口 */
  const shotJobSig = [...jobs.values()].filter((job) => job.stage === "shot-generate").map((job) => `${job.id}:${job.status}:${job.progress}`).sort().join("|");
  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${encodeURIComponent(id)}/shots/status`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => { if (alive) setShotStatus(data ?? {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, [id, shotJobSig]);
  useEffect(() => {
    fetch("/api/providers", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      const models = (data.providers ?? [] as { providerId: string; providerLabel: string; modelId: string; modelLabel: string; kind: string; configured: boolean; enabled: boolean }[])
        .filter((model: { kind: string; configured: boolean; enabled: boolean }) => model.kind === "image" && model.configured && model.enabled)
        .map((model: { providerId: string; providerLabel: string; modelId: string; modelLabel: string }) => ({ id: `${model.providerId}::${model.modelId}`, label: `${model.providerLabel} · ${model.modelLabel}` }));
      setImageModels(models);
      setImageModelId((current) => models.some((model: { id: string }) => model.id === current) ? current : models[0]?.id ?? "");
    }).catch(() => setImageModels([]));
  }, []);
  if (!doc) return null;
  const lines = doc.lines;
  const ordered = [...doc.shots].sort((a, b) => doc.lines.findIndex((l) => l.id === a.at.lineId) - doc.lines.findIndex((l) => l.id === b.at.lineId) || a.at.char - b.at.char);
  const lineIndex = new Map(doc.lines.map((l, i) => [l.id, i]));
  // 需要生成画面的镜头：缺图的 + 描述或风格改过导致过期的（信息卡、标题卡、金句卡不生图）
  const wanting = ordered.filter((shot) => !shot.locked && needsGeneratedImage(shot));
  const missing = wanting.filter((shot) => !shot.assetId).length;
  const stale = wanting.filter((shot) => assetStale(doc, shot)).length;
  const remaining = missing + stale;
  const imageJobs = [...jobs.values()].filter((job) => job.stage === "shot-generate" && job.projectId === id);
  const activeImages = imageJobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const completedImages = imageJobs.filter((job) => job.status === "succeeded").length;
  const failedImages = imageJobs.filter((job) => job.status === "failed").length;
  const queuedImages = imageJobs.filter((job) => job.status === "queued").length;
  const latestBatchJob = imageJobs.filter((job) => jobBatchId(job)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const latestBatchId = latestBatchJob ? jobBatchId(latestBatchJob) ?? null : null;
  const selectedBatchId = latestBatchJob && (!bulkBatch || latestBatchJob.createdAt > bulkBatch.createdAt) ? latestBatchId : bulkBatch?.id ?? latestBatchId;
  const streamedBulkJobs = selectedBatchId ? imageJobs.filter((job) => jobBatchId(job) === selectedBatchId) : [];
  const bulkJobs = streamedBulkJobs.length ? streamedBulkJobs : selectedBatchId === bulkBatch?.id ? bulkBatch.jobs : [];
  const bulkActive = bulkJobs.some((job) => job.status === "queued" || job.status === "running");
  const bulkStopped = !!selectedBatchId && bulkJobs.some((job) => job.status === "canceled") && !bulkActive;
  const stoppingSelectedBatch = bulkStopping || bulkStopRequested === selectedBatchId;

  async function generateAll() {
    if (!imageModelId || remaining === 0) return;
    const detail = [missing && `缺图 ${missing} 个`, stale && `已过期 ${stale} 个`].filter(Boolean).join("、");
    const styleNote = doc?.visualStyle ? `画面风格：${doc.visualStyle.name}。` : "还没有选择画面风格，将自动采用推荐风格（可在「画面风格」里修改）。";
    const units = remaining * candidateCount;
    if (needsConfirm({ units, costYuan: null }) && !(await confirm({
      title: "生成缺失和过期的图片？",
      message: `将为 ${remaining} 个镜头（${detail}）提交 ${units} 张图片生成请求，费用由图片服务商收取。${styleNote}`,
      confirmLabel: "开始生成",
      tone: "danger",
      bullets: [
        `预计费用：图片单价暂无法估算，以服务商账单为准（${units} 张）。`,
        `影响范围：${remaining} 个缺图或已过期镜头；已有图片会保留，生成完成后才替换。`,
        "可撤销：排队中的请求可以停止；服务商已接单的请求仍可能计费。",
      ],
    }))) return;
    setBulkBusy(true);
    setErrors((current) => ({ ...current, bulk: "" }));
    try {
      if ((await store.flush()) == null) throw new Error("项目设置保存失败，请重试");
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId: imageModelId, candidateCount }) });
      const data = await response.json() as { batchId?: string; count?: number; jobs?: Job[]; error?: string };
      if (!response.ok) throw new Error(data.error || "提交批量任务失败");
      if (data.batchId && data.count) {
        setBulkBatch({ id: data.batchId, createdAt: data.jobs?.at(-1)?.createdAt ?? Date.now(), jobs: data.jobs ?? [] });
        setBulkStopRequested(null);
      }
    } catch (cause) { setErrors((current) => ({ ...current, bulk: cause instanceof Error ? cause.message : String(cause) })); }
    finally { setBulkBusy(false); }
  }

  async function stopBulkGeneration() {
    if (!selectedBatchId || stoppingSelectedBatch || !bulkActive) return;
    if (!(await confirm({
      title: "停止本次全量生图？",
      message: "已完成的图片会保留，排队中的任务会取消；正在服务商处理的请求可能已经产生费用。停止后可以继续生成未完成的图片。",
      confirmLabel: "停止生成",
      tone: "danger",
      bullets: [
        "预计费用：已经提交给服务商的请求仍可能计费。",
        "影响范围：只停止本次批量任务，已完成的图片和单镜任务不受影响。",
        "可恢复：停止后可以继续生成未完成的镜头。",
      ],
    }))) return;
    setBulkStopping(true);
    setBulkStopRequested(selectedBatchId);
    setErrors((current) => ({ ...current, bulk: "" }));
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/generate/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: selectedBatchId }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "停止生成失败");
    } catch (cause) {
      setBulkStopRequested(null);
      setErrors((current) => ({ ...current, bulk: cause instanceof Error ? cause.message : String(cause) }));
    } finally { setBulkStopping(false); }
  }

  async function upload(shot: Shot, file: File) {
    setUploading(shot.id);
    try {
      const res = await fetch("/api/media", { method: "POST", headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }, body: file });
      const asset = (await res.json()) as { hash?: string; kind?: string; error?: string };
      if (!res.ok || !asset.hash) throw new Error(asset.error || "上传失败");
      shotUpdate(store, shot.id, (s) => ({ ...s, kind: "upload", assetId: asset.hash }));
    } catch (e) {
      setErrors((old) => ({ ...old, [shot.id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setUploading(null);
    }
  }

  async function generate(shot: Shot) {
    if (!imageModelId) return;
    setGenerating(shot.id);
    setErrors((old) => ({ ...old, [shot.id]: "" }));
    try {
      if ((await store.flush()) == null) throw new Error("镜头设置保存失败，请重试");
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/${encodeURIComponent(shot.id)}/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "image", modelId: imageModelId, candidateCount }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "提交生成任务失败");
    } catch (e) {
      setErrors((old) => ({ ...old, [shot.id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setGenerating(null);
    }
  }

  async function selectCandidate(shot: Shot, candidateId: string) {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/shots/${encodeURIComponent(shot.id)}/generate`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId }) });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error || "切换候选失败");
      }
      setErrors((old) => ({ ...old, [shot.id]: "" }));
    } catch (e) { setErrors((old) => ({ ...old, [shot.id]: e instanceof Error ? e.message : String(e) })); }
  }

  function split(shot: Shot) {
    const index = lineIndex.get(shot.at.lineId) ?? 0;
    const next = lines[index + 1];
    if (!next || ordered.some((s) => s.at.lineId === next.id && s.at.char === 0)) return;
    store.setDoc((d) => ({ ...d, shots: stampShots([...d.shots, { ...shot, id: newId(), at: { lineId: next.id, char: 0 }, locked: false }], d.lines) }));
    toast("已拆分镜头，现有成片需要重新渲染", "info");
  }

  function merge(shot: Shot) {
    const index = ordered.findIndex((s) => s.id === shot.id);
    const next = ordered[index + 1];
    if (!next || next.locked) return;
    store.setDoc((d) => ({ ...d, shots: stampShots(d.shots.filter((s) => s.id !== next.id), d.lines) }));
    toast("已合并镜头，现有成片需要重新渲染", "info");
  }

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="label">分镜</p><h2 className="mt-1 text-base font-medium">分镜板</h2></div>
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-white/45">
          <span>{ordered.length} 镜头 · {missing} 待补图{stale > 0 ? ` · ${stale} 已过期` : ""}</span>
          {imageJobs.length > 0 && <span className="text-white/60">图片任务：完成 {completedImages} · 生成中 {activeImages} · 排队 {queuedImages}{failedImages ? ` · 失败 ${failedImages}` : ""}</span>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <Select className="w-full min-w-0 flex-1 basis-full text-xs sm:basis-auto" value={imageModelId} aria-label="生图模型" onChange={setImageModelId}><option value="">{imageModels.length ? "选择生图模型" : "暂无可用生图模型"}</option>{imageModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</Select>
        <Select className="w-auto min-w-32 text-xs" value={String(candidateCount)} aria-label="每镜候选数" onChange={(value) => setCandidateCount(Number(value))}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} 张/镜</option>)}</Select>
        {bulkActive ? <button className="btn btn-ghost btn-sm" disabled={stoppingSelectedBatch} onClick={() => void stopBulkGeneration()}>{stoppingSelectedBatch ? <Spinner className="size-3.5" /> : <Icon name="stop" className="size-3.5" />}{stoppingSelectedBatch ? "正在停止…" : "停止本次生成"}</button> : <button className="btn btn-primary btn-sm" disabled={!imageModelId || !remaining || bulkBusy || activeImages > 0} onClick={() => void generateAll()}>{bulkBusy ? <Spinner className="size-3.5" /> : <Icon name="sparkle" className="size-3.5" />}{bulkStopped ? "继续生成图片" : `全量生成图片 · ${remaining * candidateCount} 张`}</button>}
      </div>
      {bulkStopped && <p className="mt-2 text-xs text-amber-200/75">本次生成已停止，已完成图片保留。</p>}
      {errors.bulk && <p className="mt-2 text-xs text-red-300">{errors.bulk}</p>}
      {ordered.length === 0 ? <p className="py-8 text-center text-sm text-white/35">配音完成后会自动生成分镜</p> : <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map((shot, index) => {
          const timed = timeline?.shots.find((item) => item.shotId === shot.id);
          const job = [...jobs.values()].findLast((item) => item.stage === "shot-generate" && item.target === `镜头 ${shot.id}`);
          // 状态以服务端裁决为准（见 /shots/status）。客户端这份 job 只用于「重试」拿到 id。
          const serverStatus = shotStatus[shot.id];
          return <ShotCard key={shot.id} shot={shot} timed={timed} timeline={timeline} index={index} active={active === shot.id} lineIndex={lineIndex.get(shot.at.lineId) ?? 0} lineIds={doc.lines.map((l) => l.id)} estimated={timeline?.lines.some((l) => l.estimated) ?? true} store={store} error={errors[shot.id]} job={job} serverStatus={serverStatus} uploading={uploading === shot.id} generating={generating === shot.id} imageReady={!!imageModelId} canMerge={index < ordered.length - 1 && !ordered[index + 1]?.locked} candidateCount={candidateCount} confirm={confirm} toast={toast} onSelect={() => { setActive(shot.id); if (timed) onSeek(timed.startMs); }} onUpload={(file) => upload(shot, file)} onGenerate={() => generate(shot)} onCandidate={(candidateId) => selectCandidate(shot, candidateId)} onSplit={() => split(shot)} onMerge={() => merge(shot)} />;
        })}
      </div>}
    </section>
  );
}

function ShotCard({ shot, timed, timeline, index, lineIndex, lineIds, estimated, active, store, error, job, serverStatus, uploading, generating, imageReady, canMerge, candidateCount, confirm, toast, onSelect, onUpload, onGenerate, onCandidate, onSplit, onMerge }: {
  shot: Shot; timed?: TimelineShot; timeline: Timeline | null; index: number; lineIndex: number; lineIds: string[]; estimated: boolean; active: boolean; store: ProjectStore; error?: string; job?: Job; serverStatus?: { status: string; progress: number; message: string; error: string | null; total: number; done: number; failed: number; running: number }; uploading: boolean; generating: boolean; imageReady: boolean; canMerge: boolean; candidateCount: number;
  confirm: (options: { title: string; message?: string; confirmLabel?: string; tone?: "default" | "danger"; bullets?: string[] }) => Promise<boolean>;
  toast: (message: string, kind?: "info" | "success" | "error") => void;
  onSelect: () => void; onUpload: (file: File) => void; onGenerate: () => void; onCandidate: (id: string) => void; onSplit: () => void; onMerge: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef(shot.description);
  useEffect(() => { if (active) cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [active]);
  /**
   * 重试与首次生成走同一套成本规则：首次要确认的，重试也要。
   * 否则用户会学会「靠重试绕过确认」——而重试同样调用服务商、同样计费。
   */
  const retryJobWithCost = async () => {
    if (!job) return;
    const units = candidateCount;
    if (needsConfirm({ units, costYuan: null })) {
      const ok = await confirm({
        title: "重试这次生成？",
        message: `将为这个镜头重新提交 ${units} 张图片生成请求，费用由图片服务商收取。上次失败可能已经产生费用。`,
        bullets: [
          `预计费用：图片单价暂无法估算，以服务商账单为准（${units} 张）。`,
          "影响范围：只重新提交这个镜头，已有图片会保留。",
          "可恢复：任务可以再次取消或重试；服务商已接单的请求仍可能计费。",
        ],
        confirmLabel: "重试",
        tone: "danger",
      });
      if (!ok) return;
    }
    await jobAction(job.id, "retry");
  };
  const covered = timed && timeline ? timeline.lines.filter((l) => l.endMs > timed.startMs && l.startMs < timed.endMs).map((l) => lineIds.indexOf(l.id) + 1).filter((i) => i > 0) : [];
  const time = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const wantsImage = needsGeneratedImage(shot);
  const compiled = wantsImage && store.doc ? compileShotPrompt(store.doc, shot) : null;
  const stale = !!store.doc && assetStale(store.doc, shot);
  const hasImage = !!shot.assetId;
  const animationFamily = shot.animation?.family ?? "none";
  const animationIntensity = shot.animation?.intensity ?? 1;
  const ui2vTemplateId = shot.animation?.templateId ?? defaultUi2vTemplateForShot(shot);
  const updateAnimation = (patch: Partial<NonNullable<Shot["animation"]>>) => shotUpdate(store, shot.id, (s) => ({ ...s, animation: { family: "none", intensity: 1, anchors: [], params: {}, ...s.animation, ...patch } }));
  /**
   * 状态以服务端裁决为准：客户端按 target 字符串找任务在多任务并存时不可靠。
   * 服务端没返回（例如刚提交、还没来得及刷新）时退回本地 job，保证按钮立刻有反馈。
   */
  const serverJobStatus = serverStatus?.status;
  const effectiveStatus = serverJobStatus ?? job?.status;
  const runningJob = effectiveStatus === "queued" || effectiveStatus === "running";
  const status = effectiveStatus === "failed" ? "failed" : effectiveStatus === "canceled" ? "canceled" : runningJob ? (effectiveStatus === "queued" ? "queued" : "running") : effectiveStatus === "succeeded" && hasImage ? "done" : "idle";
  const effectiveProgress = serverStatus && serverStatus.total > 0 ? serverStatus.progress : (job?.progress ?? 0);
  const effectiveError = serverStatus?.error ?? job?.error;
  const statusLabel = { queued: "排队中", running: `生成中 · ${Math.round(effectiveProgress * 100)}%`, done: "已完成", failed: "生成失败", canceled: "已取消", idle: hasImage ? "已有图片" : "待生成" }[status];
  return <div ref={cardRef} className={`min-w-0 rounded-lg border bg-white/[0.02] p-3 transition-colors ${active ? "border-white" : status === "running" ? "border-accent/60 generation-card-running" : status === "queued" ? "border-amber-200/30" : status === "failed" ? "border-red-400/35" : status === "done" ? "border-accent/20" : "border-white/[0.07]"}`}>
    <div className="flex items-center justify-between gap-2"><button className="min-w-0 truncate text-left text-xs text-white/75 hover:text-white" onClick={onSelect}>镜头 {index + 1} · {timed ? `${time(timed.startMs)}–${time(timed.endMs)}` : "计算中"} · {covered.length ? `第 ${covered[0]}${covered.length > 1 ? `–${covered.at(-1)}` : ""} 句` : `第 ${lineIndex + 1} 句`}{estimated ? " · 估算" : ""}</button><button className={`chip h-7 px-2.5 ${shot.locked ? "chip-on" : ""}`} onClick={() => shotUpdate(store, shot.id, (s) => ({ ...s, locked: !s.locked }))}>{shot.locked ? "已锁定" : "锁定"}</button></div>
    <button className={`relative mt-2 block w-full overflow-hidden rounded-md border bg-[#17242c] text-left ${status === "running" ? "border-accent/50" : status === "queued" ? "border-amber-200/25" : status === "failed" ? "border-red-400/35" : "border-white/10"}`} style={{ aspectRatio: timeline ? `${timeline.width} / ${timeline.height}` : "16 / 9" }} onClick={onSelect} aria-label={`跳转到镜头 ${index + 1}`}>
      <span className="absolute inset-0 block">{shot.assetId && shot.kind === "video" ? <video key={shot.assetId} muted playsInline preload="metadata" src={mediaUrl(shot.assetId)} className={`h-full w-full object-cover ${status === "done" ? "generation-image-complete" : ""}`} /> : shot.assetId ? <Image key={shot.assetId} src={mediaUrl(shot.assetId)} alt="" fill sizes="(max-width: 640px) 100vw, 320px" unoptimized className={`object-cover ${status === "done" ? "generation-image-complete" : ""}`} /> : timed && timeline ? <ShotThumbnail shot={timed} width={timeline.width} height={timeline.height} fps={timeline.fps} theme={timeline.theme} /> : <span className="grid h-full place-items-center text-xs text-white/40">正在加载预览</span>}</span>
      {runningJob && <span className="pointer-events-none absolute inset-0 bg-black/25" />}
      {runningJob && <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-accent/35 bg-black/65 px-2 py-1 text-[10px] text-accent backdrop-blur"><span className="generation-live-dot size-1.5 rounded-full bg-accent" />{statusLabel}</span>}
      {status === "queued" && <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded bg-black/65 px-2 py-1 text-[10px] text-amber-100/85 backdrop-blur">等待空闲并发</span>}
      {status === "failed" && <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded bg-red-950/80 px-2 py-1 text-[10px] text-red-100 backdrop-blur">生成失败 · 可重试</span>}
      {runningJob && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/45"><span className="block h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round(effectiveProgress * 100)}%` }} /></span>}
    </button>
    <p className="mt-2 line-clamp-2 min-h-9 text-xs leading-5 text-white/55">{timed?.caption || "暂无覆盖句子"}</p>
    <p className="mt-1.5 text-[11px] text-white/40">{shotExpression(shot, timed)}</p>
    {wantsImage && store.doc && shot.characterIds.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{shot.characterIds.map((cid) => store.doc!.characters.find((c) => c.id === cid)).filter(Boolean).map((c) => <span key={c!.id} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/60">{c!.name}</span>)}</p>}
    {shot.intent && <p className="mt-1 text-xs leading-5 text-white/70" title="导演意图：观众此刻应该看到或感受到什么"><span className="text-white/40">意图 · </span>{shot.intent}</p>}
    {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    {generating && <p className="mt-2 flex items-center gap-1.5 text-xs text-accent"><span className="generation-live-dot size-1.5 rounded-full bg-accent" />正在提交生成任务…</p>}
    {runningJob && <p className="mt-2 flex items-center gap-1.5 text-xs text-accent"><span className="generation-live-dot size-1.5 rounded-full bg-accent" />{statusLabel}{serverStatus?.message ? ` · ${serverStatus.message}` : job?.message ? ` · ${job.message}` : ""}</p>}
    {status === "done" && shot.assetId && <p className="mt-2 text-xs text-accent/75">图片已就绪，可在预览区播放</p>}
    {status === "failed" && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><p className="text-red-300">{effectiveError || "生成失败"}</p>{job && <button className="chip h-6 px-2.5 text-[11px]" title={`重新提交这个镜头的生成请求（${candidateCount} 张）`} onClick={() => void retryJobWithCost()}>重试 · {candidateCount} 张</button>}</div>}
    {status === "canceled" && <p className="mt-2 text-xs text-white/45">任务已取消，可重新生成</p>}
    {wantsImage && !shot.assetId && !generating && <p className="mt-2 text-xs text-amber-200/70">暂无素材，使用占位画面</p>}
    {stale && <p className="mt-2 text-xs text-amber-200/80">画面描述或风格已改，图片已过期</p>}
    <AutoTextarea value={shot.description} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, description: e.target.value }))} onBlur={() => { if (descriptionRef.current !== shot.description) { descriptionRef.current = shot.description; toast("已修改画面描述，现有成片需要重新渲染", "info"); } }} className="input mt-2 min-h-16 text-xs" placeholder="画面描述" />
    {wantsImage && <button className="btn btn-ghost btn-sm mt-2" disabled={generating || shot.locked || !imageReady || runningJob} title={`${shot.assetId ? "重新生成" : "生成"} ${candidateCount} 张候选图`} onClick={onGenerate}>{generating ? <Spinner className="size-3" /> : <Icon name="sparkle" className="size-3.5" />}{shot.assetId ? "重新生成图片" : "生成图片"} · {candidateCount} 张</button>}
    {(shot.kind === "image" || shot.kind === "video") && <>
      {shot.candidates.length > 0 && <div className="mt-2 grid grid-cols-4 gap-1.5">{shot.candidates.map((candidate) => <button key={candidate.id} className={`overflow-hidden rounded border ${candidate.selected ? "border-accent" : "border-white/10"}`} title="选择候选" onClick={() => onCandidate(candidate.id)}>{shot.kind === "video" ? <video muted preload="metadata" src={mediaUrl(candidate.assetId)} className="aspect-video w-full object-cover" /> : <Image src={mediaUrl(candidate.assetId)} alt="" width={96} height={64} unoptimized className="aspect-video w-full object-cover" />}</button>)}</div>}
    </>}
    <div className="mt-3 flex flex-wrap items-center gap-2"><label className="chip h-7 cursor-pointer px-2.5">{uploading ? <Spinner className="size-3" /> : "上传图片"}<input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} /></label><button className="chip h-7 px-2.5" onClick={onSplit}>拆分</button><button className="chip h-7 px-2.5" disabled={!canMerge} onClick={onMerge}>合并下一镜</button></div>
    <div className="mt-2"><Select value={ui2vTemplateId ?? ""} onChange={(v) => updateAnimation({ templateId: v ? v as NonNullable<Shot["animation"]>["templateId"] : undefined })}><option value="">自动匹配（默认模板）</option>{ui2vTemplateOptions.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}</Select></div>
    <details className="mt-3 border-t border-white/10 pt-2 text-xs text-white/50"><summary className="cursor-pointer">高级</summary><div className="mt-2 grid gap-2"><p className="text-[11px] leading-4 text-white/45">动画、强度、转场等修改会自动保存并刷新左侧预览；已有样片或成片不会自动重渲染，请点击上方“生成样片”或“生成成片”。</p><Select value={shot.kind} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, kind: v as Shot["kind"] }))}>{[...p1ShotKinds, "image", "video", "stock", "chart"].map((kind) => <option key={kind} value={kind}>{shotKindLabels[kind as Shot["kind"]]}</option>)}</Select><Select value={animationFamily} onChange={(v) => updateAnimation({ family: v as NonNullable<Shot["animation"]>["family"] })}>{animationFamilies.map((family) => { const implemented = ["none", "editorial", "kinetic", "stat", "compare", "process", "callout", "timeline", "collage", "hud", "ink"].includes(family); return <option key={family} value={family} disabled={!implemented}>{family === "none" ? "无（旧运镜）" : implemented ? family : `${family}（开发中）`}</option>; })}</Select>{animationFamily === "none" && <Select value={shot.motion} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, motion: v as Shot["motion"] }))}><option value="zoom-in">推进</option><option value="zoom-out">拉远</option><option value="pan-left">左移</option><option value="pan-right">右移</option><option value="none">静止</option></Select>}<SegmentedControl value={String(animationIntensity)} options={[{ value: "1", label: "克制" }, { value: "2", label: "标准" }, { value: "3", label: "强调" }]} onChange={(v) => updateAnimation({ intensity: Number(v) as 1 | 2 | 3 })} label="强度" /><Select value={shot.transitionIn ?? "cut"} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, transitionIn: v as NonNullable<Shot["transitionIn"]> }))}><option value="cut">切镜</option><option value="fade">淡入</option><option value="wipe">擦除</option><option value="whip">甩镜</option><option value="push">推入</option><option value="dissolve">溶解</option></Select><Select value={shot.mode === "motion" ? "motion" : shot.mode === "composite" ? "composite" : shot.mode === "real" ? "real" : "generate"} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, mode: v as Shot["mode"], shotSize: v === "generate" ? (s.shotSize ?? "medium") : s.shotSize }))}><option value="generate">生成画面</option><option value="motion">信息卡（代码动画）</option><option value="composite">画面 + 动画层</option><option value="real">真实素材</option></Select>{shot.mode !== "motion" && <Select value={shot.shotSize ?? "medium"} onChange={(v) => shotUpdate(store, shot.id, (s) => ({ ...s, shotSize: v as Shot["shotSize"] }))}>{shotSizes.map((size) => <option key={size} value={size}>{shotSizeLabels[size]}</option>)}</Select>}<input className="input h-8 py-1.5 text-xs" value={shot.onScreenText ?? ""} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, onScreenText: e.target.value || undefined }))} placeholder="屏幕文字" />{wantsImage && <><AutoTextarea value={shot.prompt ?? ""} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, prompt: e.target.value || undefined }))} className="input min-h-12 text-xs" placeholder="自定义画面内容（留空用画面描述；画面风格仍会自动加上）" /><input className="input h-8 py-1.5 text-xs" type="number" min={0} value={shot.seed ?? ""} onChange={(e) => shotUpdate(store, shot.id, (s) => ({ ...s, seed: e.target.value === "" ? undefined : Number(e.target.value) }))} placeholder="seed" />{store.doc && store.doc.characters.some((c) => !c.absent) && <div className="space-y-1"><p className="text-[11px] text-white/40">画面里的角色（最多 {MAX_SHOT_CHARACTERS} 个；外貌自动从角色卡加入）</p><div className="flex flex-wrap gap-1.5">{store.doc.characters.filter((c) => !c.absent || shot.characterIds.includes(c.id)).map((c) => { const on = shot.characterIds.includes(c.id); return <button key={c.id} type="button" className={`chip h-7 px-2.5 ${on ? "chip-on" : ""}`} disabled={!on && shot.characterIds.length >= MAX_SHOT_CHARACTERS} onClick={() => shotUpdate(store, shot.id, (s) => ({ ...s, characterIds: on ? s.characterIds.filter((x) => x !== c.id) : [...s.characterIds, c.id] }))}>{c.name}</button>; })}</div></div>}{compiled && <PromptSlots compiled={compiled} />}</>}</div></details>
  </div>;
}

type Track = {
  id: string;
  title: string;
  src: string;
  moods: string[];
  durationMs: number;
  license: string;
  source: string;
  author: string;
  rightsStatus: "pending" | "verified" | "rejected" | "quarantine";
  usable: boolean;
  energy: "low" | "medium" | "high" | null;
  bpm: number | null;
  disabledReason: string;
  sourcePage: string;
};

const trackRightsLabel: Record<Track["rightsStatus"], string> = { verified: "已核实", pending: "待核实", rejected: "已排除", quarantine: "隔离" };
const trackRightsClass: Record<Track["rightsStatus"], string> = {
  verified: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
  pending: "border-amber-300/25 bg-amber-300/10 text-amber-200",
  rejected: "border-red-300/25 bg-red-300/10 text-red-200",
  quarantine: "border-violet-300/25 bg-violet-300/10 text-violet-200",
};
const trackEnergyLabel: Record<"low" | "medium" | "high", string> = { low: "低能量", medium: "中能量", high: "高能量" };
const musicMoodOptions = ["悬疑", "紧张", "轻松", "温暖", "激昂", "史诗", "科技", "忧伤", "中性"] as const;

export function MusicPanel({ id, store }: { id: string; store: ProjectStore }) {
  const doc = store.doc;
  const [tracks, setTracks] = useState<Track[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [filters, setFilters] = useState({ mood: "all", energy: "all", status: "all", q: "" });
  useEffect(() => {
    fetch("/api/library/music", { cache: "no-store" }).then((r) => r.json()).then((d) => { setTracks(d.tracks ?? []); setProblems(d.problems ?? []); });
  }, [id]);
  if (!doc) return null;
  const usable = tracks.filter((t) => t.usable);
  const shown = tracks.filter(
    (t) =>
      (filters.mood === "all" || t.moods.includes(filters.mood)) &&
      (filters.energy === "all" || t.energy === filters.energy) &&
      (filters.status === "all" || t.rightsStatus === filters.status) &&
      (!filters.q || [t.title, t.author, t.source].join(" ").toLowerCase().includes(filters.q.toLowerCase())),
  );
  const first = doc.lines[0]?.id;
  const last = doc.lines.at(-1)?.id;
  const ensureCue = () => {
    if (!first || !last || usable.length === 0) return;
    store.setDoc((d) => ({ ...d, music: d.music.length ? d.music : [{ trackId: usable[0].id, fromLineId: first, toLineId: last, mood: "中性", offsetMs: 0, locked: false }] }));
  };
  const updateCue = (index: number, patch: Partial<MusicCue>) => store.setDoc((d) => ({ ...d, music: d.music.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  return <section className="panel p-5">
    <div className="flex items-center justify-between gap-3"><div><p className="label">配乐</p><h2 className="mt-1 text-base font-medium">配乐</h2></div><label className="flex items-center gap-2 text-sm text-text-muted">启用 <Switch checked={doc.settings.music.enabled} label="启用配乐" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, music: { ...d.settings.music, enabled: checked } } }))} /></label></div>
    {problems.length > 0 && <p className="mt-3 text-xs leading-5 text-amber-200/65">{problems.join("；")}</p>}
    {tracks.length === 0 ? <p className="py-8 text-center text-sm text-white/35">曲库尚未导入。运行 npm run library:ingest。</p> : <>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={filters.mood} onChange={(v) => setFilters((f) => ({ ...f, mood: v }))} aria-label="按情绪筛选">
          <option value="all">全部情绪</option>
          {musicMoodOptions.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Select value={filters.energy} onChange={(v) => setFilters((f) => ({ ...f, energy: v }))} aria-label="按能量筛选">
          <option value="all">全部能量</option>
          <option value="low">低能量</option>
          <option value="medium">中能量</option>
          <option value="high">高能量</option>
        </Select>
        <Select value={filters.status} onChange={(v) => setFilters((f) => ({ ...f, status: v }))} aria-label="按授权状态筛选">
          <option value="all">全部授权状态</option>
          <option value="verified">已核实</option>
          <option value="pending">待核实</option>
          <option value="rejected">已排除</option>
          <option value="quarantine">隔离</option>
        </Select>
        <input className="input h-9 text-xs" placeholder="搜索标题 / 作者 / 来源" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} aria-label="搜索曲目" />
      </div>
      <p className="mt-2 text-xs text-white/40">共 {tracks.length} 首 · 可选 {usable.length} 首（自动选曲只使用已核实授权且未禁用的曲目）</p>
      <details className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3" open={usable.length === 0}>
        <summary className="cursor-pointer text-sm text-white/70">浏览曲库（{shown.length}）</summary>
        <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
          {shown.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-white/[0.05] px-2.5 py-2 text-xs">
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${trackRightsClass[t.rightsStatus]}`}>{trackRightsLabel[t.rightsStatus]}</span>
              <span className="min-w-0 flex-1 truncate" title={`${t.title}${t.author ? ` · ${t.author}` : ""}`}>{t.title}{t.author ? ` · ${t.author}` : ""}</span>
              <span className="hidden shrink-0 text-white/40 sm:inline">{t.moods.join("、")}</span>
              {t.energy && <span className="hidden shrink-0 text-white/40 md:inline">{trackEnergyLabel[t.energy]}{t.bpm ? ` · ${t.bpm}BPM` : ""}</span>}
              <span className="shrink-0 text-white/40">{Math.round(t.durationMs / 1000)}s</span>
              {t.src ? <AudioButton src={t.src} label="试听" /> : <span className="text-white/25">无音频</span>}
            </div>
          ))}
          {shown.length === 0 && <p className="py-4 text-center text-white/35">没有符合筛选条件的曲目</p>}
        </div>
        {shown.some((t) => !t.usable && t.disabledReason) && <p className="mt-2 text-[11px] leading-4 text-amber-200/60">待核实/隔离原因：{[...new Set(shown.filter((t) => t.disabledReason).map((t) => t.disabledReason))].slice(0, 3).join("；")}</p>}
      </details>
      <div className="mt-4 space-y-3">
        {doc.music.map((cue, index) => { const track = tracks.find((t) => t.id === cue.trackId); const current = track && !track.usable ? track : null; const options = current ? [current, ...usable] : usable; return <div key={`${cue.fromLineId}-${index}`} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="flex items-center gap-2"><Select value={cue.trackId} onChange={(v) => updateCue(index, { trackId: v })} className="min-w-0 flex-1">{options.map((t) => <option key={t.id} value={t.id}>{t.title} · {t.moods.join("、")}{t.usable ? "" : `（${trackRightsLabel[t.rightsStatus]}，不参与自动选曲）`}</option>)}</Select><button className={`chip h-8 px-2.5 ${cue.locked ? "chip-on" : ""}`} onClick={() => updateCue(index, { locked: !cue.locked })}>{cue.locked ? "已锁定" : "锁定"}</button><button className="chip h-8 px-2.5" onClick={() => store.setDoc((d) => ({ ...d, music: d.music.filter((_, i) => i !== index) }))}>移除</button></div>
          {track && <div className="mt-2 flex items-center gap-3"><AudioButton src={track.src} label="试听配乐" /><span className="text-sm text-text-muted">{Math.round(track.durationMs / 1000)}s</span>{!track.usable && <span className={`rounded-full border px-2 py-0.5 text-[11px] ${trackRightsClass[track.rightsStatus]}`}>{trackRightsLabel[track.rightsStatus]}</span>}</div>}
          {cue.reason && <p className="mt-1 text-[11px] leading-4 text-white/35">{cue.reason}</p>}
        </div>; })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4"><button className="btn btn-ghost btn-sm" disabled={!first || !last || usable.length === 0} title={usable.length === 0 ? "没有已核实授权的可用曲目" : undefined} onClick={ensureCue}>添加配乐片段</button><div className="min-w-[220px] flex-1"><RangeField label="音量" value={doc.settings.music.gainDb} min={-24} max={6} step={1} suffix=" dB" onChange={(value) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, music: { ...d.settings.music, gainDb: value } } }))} /></div></div>
    </>}
  </section>;
}

type VoiceCatalog = { providers: { id: string; label: string; models: { id: string; label: string; configured?: boolean; configurationHint?: string; capabilities?: string[]; voices: { id: string; name: string; gender: string; style: string; timestamps: boolean; instruct?: boolean; ssml?: boolean; emotionTags?: boolean }[] }[] }[] };

type VoiceChange = { status: "pending" | "applied"; voice: VoiceSettings; total: number; ready: number; missing: number; failed: number; revertible: boolean; batchId?: string };
type VoiceQuote = { total: number; existing: number; affected: number; reusable: number; generate: number; jobs: number; estimatedCostYuan: number | null; changed: boolean };

export function SettingsPanel({ id, store, draft, setDraft, onChanged, change, setChange, refreshChange }: { id: string; store: ProjectStore; draft: VoiceSettings | null; setDraft: Dispatch<SetStateAction<VoiceSettings | null>>; onChanged?: () => void; change: VoiceChange | null; setChange: (value: VoiceChange | null) => void; refreshChange: () => Promise<void> }) {
  const doc = store.doc;
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const { confirm, toast } = useFeedback();
  useEffect(() => { fetch("/api/voices").then((r) => r.json()).then(setCatalog).catch(() => setCatalog(null)); }, []);
  const [quote, setQuote] = useState<VoiceQuote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const quoteCache = useRef(new Map<string, VoiceQuote>());
  /**
   * 成本前置：改了音色就自动取一次报价，让按钮上直接显示「几句 · 约多少钱」，
   * 用户不必点开弹窗才知道代价。300ms 防抖，避免拖动滑块时刷爆接口。
   * 依赖只用 draft / change（不涉及 doc）——它必须留在 `if (!doc) return null` 之前，
   * 否则 hook 调用数会在渲染之间变化。
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // 首次打开项目时 change 为空，但草稿仍然需要报价；只有正在应用中的
    // 切换不能再次报价，避免把 pending 状态误显示成可提交的新操作。
    if (!draft || change?.status === "pending") { setQuote(null); return; }
    let alive = true;
    const snapshot = draft;
    const cacheKey = JSON.stringify(snapshot);
    const cached = quoteCache.current.get(cacheKey);
    if (cached) {
      setQuote(cached);
      setQuoteBusy(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setQuoteBusy(true);
      postJson<VoiceQuote>(`/api/projects/${id}/voice-change`, { action: "quote", voice: snapshot })
        .then((q) => {
          quoteCache.current.set(cacheKey, q);
          if (alive) setQuote(q);
        })
        .catch(() => { if (alive) setQuote(null); })
        .finally(() => { if (alive) setQuoteBusy(false); });
    }, 300);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [draft, change, id]);
  /* eslint-enable react-hooks/set-state-in-effect */
  if (!doc) return null;
  const voice = draft ?? (change?.status === "pending" ? change.voice : doc.settings.voice);
  const pending = change?.status === "pending";
  const dirtyVoice = JSON.stringify(voice) !== JSON.stringify(doc.settings.voice);
  const currentProvider = catalog?.providers.find((p) => p.id === voice.provider);
  const models = currentProvider?.models ?? [];
  const currentModel = models.find((m) => m.id === voice.model) ?? models[0];
  const voices = currentModel?.voices ?? [];
  const updateVoice = (patch: Partial<VoiceSettings>) => setDraft({ ...voice, ...patch });
  /**
   * 「应用到项目 · 8 句 · 约 ¥0.03」的按钮后缀。
   * 没有已生成配音时只是保存设置、不会花钱，明确写「不生成」而不是显示 ¥0.00。
   */
  const applySuffix = (() => {
    if (!quote?.changed) return "";
    if (!quote.existing) return "（只保存，不生成）";
    const cost = costLabel(quote.estimatedCostYuan);
    return ` · ${quote.generate} 句${cost ? ` · ${cost}` : ""}`;
  })();
  async function applyVoice() {
    setVoiceBusy(true);
    try {
      if ((await store.flush()) == null) throw new Error("项目设置保存失败，请重试");
      const quote = await postJson<VoiceQuote>(`/api/projects/${id}/voice-change`, { action: "quote", voice });
      if (!quote.changed) return;
      const cost = quote.estimatedCostYuan == null ? "费用暂无法准确估算，以服务商账单为准。" : `预计费用约 ¥${quote.estimatedCostYuan.toFixed(2)}，实际以服务商账单为准。`;
      const paragraphMode = voice.granularity === "paragraph" && paragraphSupported(voice);
      const jobLabel = paragraphMode && quote.jobs > 0 ? `预计需生成 ${quote.generate} 句，合并为 ${quote.jobs} 个段落任务。` : `预计需生成 ${quote.generate} 句。`;
      const message = quote.existing ? `当前 ${quote.existing} 句已有配音，其中 ${quote.affected} 句会受新设置影响。新设置可复用 ${quote.reusable} 句缓存，${jobLabel}生成期间继续使用旧配音，全部就绪后统一切换。${cost}` : `当前没有已生成配音，本次只保存配音设置，不会发起配音请求。`;
      if (!(await confirm({
        title: "应用配音设置？",
        message,
        confirmLabel: quote.generate ? "应用并生成" : "应用设置",
        bullets: [
          `预计费用：${quote.estimatedCostYuan == null ? "暂无法准确估算，以服务商账单为准" : `约 ¥${quote.estimatedCostYuan.toFixed(2)}`}。`,
          `影响范围：${quote.generate ? `${quote.generate} 句新配音，全部就绪后统一切换` : "只保存设置，不发起配音任务"}。`,
          "可撤回：已应用的音色可以恢复；服务商已接单的请求仍可能计费。",
        ],
      }))) return;
      const result = await postJson<{ change: VoiceChange | null }>(`/api/projects/${id}/voice-change`, { action: "apply", voice });
      setChange(result.change);
      await refreshChange();
      setDraft(null);
      if (result.change?.status === "applied") { await store.reload(); onChanged?.(); }
      toast(quote.generate ? `已开始生成 ${quote.generate} 句新配音` : "配音设置已应用", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally { setVoiceBusy(false); }
  }
  async function voiceAction(action: "retry" | "cancel" | "revert") {
    setVoiceBusy(true);
    try {
      const result = await postJson<{ change: VoiceChange | null }>(`/api/projects/${id}/voice-change`, { action });
      setChange(result.change);
      await refreshChange();
      if (action === "cancel") setDraft(change?.voice ?? null);
      if (action === "revert" || result.change?.status === "applied") { await store.reload(); onChanged?.(); }
      toast(action === "retry" ? "已补齐排队中的新配音" : action === "cancel" ? "已取消，继续使用原配音" : "已恢复原配音", "success");
    } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); }
    finally { setVoiceBusy(false); }
  }
  async function stopVoiceBatch() {
    if (!change?.batchId) return;
    setVoiceBusy(true);
    try {
      await postJson(`/api/projects/${id}/lines/tts/cancel`, { batchId: change.batchId });
      await refreshChange();
      toast("已停止本次配音，已完成的音频继续保留", "info");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally { setVoiceBusy(false); }
  }
  async function previewVoice() {
    setPreviewing(true);
    try {
      const result = await postJson<{ src: string }>("/api/voices/preview", { voice });
      setPreview(result.src);
      window.setTimeout(() => (document.getElementById("voice-preview") as HTMLAudioElement | null)?.play().catch(() => undefined), 0);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setPreviewing(false);
    }
  }
  async function toggleAiLabel(enabled: boolean) {
    if (!enabled && !(await confirm({ title: "关闭 AI 生成标识？", message: "部分发布平台要求保留 AI 生成标识，请确认你仍要关闭。", confirmLabel: "关闭标识", tone: "danger", bullets: ["预计费用：不产生新的服务商费用。", "影响范围：后续导出的视频不再显示 AI 生成标识。", "可恢复：可以随时重新打开标识。"] }))) return;
    store.setDoc((d) => ({ ...d, settings: { ...d.settings, aiLabel: { ...d.settings.aiLabel, enabled } } }));
  }
  return <section className="panel p-5"><div className="flex items-center justify-between gap-3"><div><p className="label">设置</p><h2 className="mt-1 text-base font-medium">制作设置</h2></div><span className="text-sm text-text-muted">{store.save === "saving" ? "保存中" : store.save === "saved" ? "已保存" : ""}</span></div>
    <PresetSection doc={doc} store={store} catalog={catalog} />
    <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium text-white/85">输出规格</p><p className="mt-1 text-xs text-white/40">分辨率与帧率由预设决定，当前固定 30fps。</p></div><span className="text-xs text-white/45">当前预览：{doc.settings.previewAspect ?? outputSpecsFor(doc.settings)[0].aspect}</span></div>
      <div className="mt-3 flex flex-wrap gap-2">{(["16:9", "9:16"] as const).map((aspect) => { const active = doc.settings.aspects.includes(aspect); return <button key={aspect} className={`chip h-8 px-3 ${active ? "chip-on" : ""}`} onClick={() => store.setDoc((d) => { const next = d.settings.aspects.includes(aspect) ? d.settings.aspects.filter((item) => item !== aspect) : [...d.settings.aspects, aspect]; const aspects = next.length ? next : [aspect]; return { ...d, settings: { ...d.settings, aspects, outputSpecIds: aspects.map(outputSpecIdForAspect), previewAspect: aspects.includes(d.settings.previewAspect ?? "16:9") ? d.settings.previewAspect : aspects[0] } }; })}>{aspect} · {aspect === "16:9" ? "1920×1080" : "1080×1920"}</button>; })}</div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-white/50"><span>素材策略</span><Select className="h-8 min-h-8 py-1.5 text-xs" value={doc.settings.assetFraming} onChange={(value) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, assetFraming: value as ProjectDoc["settings"]["assetFraming"] } }))}><option value="smart-dual">智能双版</option><option value="per-output">全部分别生成</option><option value="shared">全部共享素材</option></Select><span>{outputSpecsFor(doc.settings).map((spec) => `${spec.label} · ${spec.fps}fps`).join(" · ")}</span></div>
    </div>
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <Field label="配音服务商"><Select value={voice.provider} disabled={pending} onChange={(value) => { const provider = catalog?.providers.find((item) => item.id === value); const model = provider?.models.find((item) => item.configured !== false) ?? provider?.models[0]; updateVoice({ provider: value as VoiceSettings["provider"], model: model?.id ?? voice.model, voiceId: model?.voices[0]?.id ?? voice.voiceId }); }}>{catalog?.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</Select></Field>
      {voice.provider === "google-gemini" && <p className="md:col-span-2 -mt-2 text-xs leading-5 text-amber-200/70">启用 Google Gemini 后，本项目的配音文本会发送到 Google Gemini API。</p>}
      <Field label="音色模型"><Select value={voice.model} disabled={pending} onChange={(v) => { const m = models.find((x) => x.id === v); updateVoice({ model: v, voiceId: m?.voices[0]?.id ?? voice.voiceId }); }}><option value={voice.model}>{currentModel?.label ?? voice.model}{currentModel && !currentModel.configured ? `（${currentModel.configurationHint ?? "待配置"}）` : ""}</option>{models.filter((m) => m.id !== voice.model).map((m) => <option key={m.id} value={m.id} disabled={m.configured === false}>{m.label}{m.configured === false ? `（${m.configurationHint ?? "待配置"}）` : ""}</option>)}</Select></Field>
      <Field label="音色"><div className="flex gap-2"><Select value={voice.voiceId} disabled={pending} onChange={(v) => updateVoice({ voiceId: v })} className="min-w-0 flex-1">{voices.length ? voices.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.style}</option>) : <option value={voice.voiceId}>{voice.voiceId}</option>}</Select><button className="btn btn-ghost btn-sm" disabled={previewing} onClick={previewVoice}>{previewing ? <Spinner className="size-3" /> : "试听"}</button>{preview && <audio id="voice-preview" className="hidden" src={preview} />}</div></Field>
      <Field label="合成粒度" hint={paragraphSupported(voice) ? (voice.granularity === "paragraph" ? `实验：按自然段合成再切成单句，句间衔接更自然、停顿更舒展；改一句会整段重录；同样文案成片约长 5–15%${voice.provider === "google-gemini" ? "。Gemini 没有字级时间戳，按停顿切分，切不准时自动拆小或逐句合成" : ""}` : "每句单独合成，改一句只重录一句") : "当前服务商暂只支持逐句合成"}><Select value={paragraphSupported(voice) ? voice.granularity : "line"} disabled={pending || !paragraphSupported(voice)} onChange={(v) => updateVoice({ granularity: v as VoiceSettings["granularity"] })}><option value="line">逐句</option><option value="paragraph">段落（实验）</option></Select></Field>
      <Field label="语速"><fieldset disabled={pending}><RangeField label="" value={voice.rate} min={0.5} max={2} step={0.05} suffix="x" onChange={(value) => updateVoice({ rate: value })} /></fieldset></Field>
      <Field label="音量"><fieldset disabled={pending}><RangeField label="" value={voice.volume} min={0} max={100} step={1} suffix="" onChange={(value) => updateVoice({ volume: value })} /></fieldset></Field>
      <Field label={voice.provider === "google-gemini" ? "旁白表达指令（暂不可用）" : "旁白表达指令"} hint={voice.provider === "google-gemini" ? "当前不生效；已填写内容保留。" : "应用后生效"}><AutoTextarea value={voice.provider === "google-gemini" ? voice.google?.stylePrompt ?? "" : voice.instruction} onChange={(event) => updateVoice({ instruction: event.target.value })} className="input min-h-16 py-2 text-xs leading-5" placeholder="例如：沉稳、清晰，略带悬念的纪录片旁白表达" maxLength={voice.provider === "google-gemini" ? 1000 : 500} disabled={voice.provider === "google-gemini" || pending} /></Field>
      <Field label="预算（元）"><input className="input" type="number" min="0" step="1" value={doc.settings.budgetYuan ?? ""} onChange={(e) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, budgetYuan: e.target.value ? Number(e.target.value) : null } }))} placeholder="不设上限" /></Field>
      <Field label="AI 标识"><Select value={doc.settings.aiLabel.position} onChange={(v) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, aiLabel: { ...d.settings.aiLabel, enabled: true, position: v as "auto" | "top-left" | "top-right" } } }))}><option value="auto">自动位置</option><option value="top-left">左上角</option><option value="top-right">右上角</option></Select></Field>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-4 text-sm">
      {pending ? (
        <>
          <span className="text-white/65">新配音 {change.ready}/{change.total} 句就绪，当前仍播放原配音{change.failed ? `；${change.failed} 句生成失败` : ""}</span>
          <button className="btn btn-ghost btn-sm" disabled={voiceBusy || change.missing === 0} onClick={() => void voiceAction("retry")}>补齐缺失句</button>
          {change.batchId && <button className="btn btn-ghost btn-sm" disabled={voiceBusy} onClick={() => void stopVoiceBatch()}>停止本次</button>}
          <button className="btn btn-ghost btn-sm" disabled={voiceBusy} onClick={() => void voiceAction("cancel")}>取消应用</button>
        </>
      ) : (
        <>
          <button className="btn btn-primary btn-sm" disabled={!dirtyVoice || voiceBusy} onClick={() => void applyVoice()}>{voiceBusy ? <Spinner className="size-3" /> : null}应用到项目{applySuffix}</button>
          {dirtyVoice && <button className="btn btn-ghost btn-sm" disabled={voiceBusy} onClick={() => setDraft(null)}>放弃修改</button>}
          {change?.status === "applied" && change.revertible && !dirtyVoice && <button className="btn btn-ghost btn-sm" disabled={voiceBusy} onClick={() => void voiceAction("revert")}>撤回本次应用</button>}
          {dirtyVoice && <span className="text-white/45">{quoteBusy ? "正在估算费用…" : "待应用；当前配音不变"}</span>}
        </>
      )}
    </div>
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 border-t border-white/[0.06] pt-4 text-sm text-text-muted"><label className="flex items-center gap-2">字幕 <Switch checked={doc.settings.subtitle.enabled} label="字幕" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, subtitle: { ...d.settings.subtitle, enabled: checked } } }))} /></label><label className="flex items-center gap-2">关键词高亮 <Switch checked={doc.settings.subtitle.highlight} label="关键词高亮" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, subtitle: { ...d.settings.subtitle, highlight: checked } } }))} /></label><label className="flex items-center gap-2">AI 生成标识 <Switch checked={doc.settings.aiLabel.enabled} label="AI 生成标识" onChange={(checked) => { void toggleAiLabel(checked); }} /></label><label className="flex items-center gap-2">转场音效 <Switch checked={doc.settings.sfx.enabled} label="转场音效" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, sfx: { enabled: checked } } }))} /></label><label className="flex items-center gap-2">样片后暂停 <Switch checked={doc.settings.pauseAfterPreview} label="样片后暂停" onChange={(checked) => store.setDoc((d) => ({ ...d, settings: { ...d.settings, pauseAfterPreview: checked } }))} /></label></div>
  </section>;
}

const cardVariantLabels: Record<CardVariant, string> = { headline: "标题", stat: "数据", list: "要点", split: "对比", quote: "引语" };

const animationFamilyLabels: Record<NonNullable<Shot["animation"]>["family"], string> = {
  none: "旧运镜",
  editorial: "编辑式",
  kinetic: "动词组",
  stat: "数字",
  compare: "对比",
  process: "流程",
  callout: "重点",
  timeline: "时间线",
  collage: "拼贴",
  hud: "HUD",
  ink: "水墨",
};

/** 镜头卡上的表达方式标签：生成画面 · 景别 / 信息卡 · family · 版式 */
function shotExpression(shot: Shot, timed: TimelineShot | undefined) {
  const family = timed?.animation?.family ?? shot.animation?.family ?? "none";
  const templateId = timed?.animation?.templateId ?? defaultUi2vTemplateForShot(shot);
  const templateLabel = templateId ? ` · ${ui2vTemplates[templateId].label}` : "";
  if (shot.kind === "title" || shot.kind === "quote") return `${shotKindLabels[shot.kind]}${templateLabel}`;
  if (shot.mode === "motion") return `信息卡 · ${animationFamilyLabels[family]}${templateLabel} · ${cardVariantLabels[(timed?.card ?? shot.card)?.variant ?? "headline"]}`;
  if (shot.mode === "composite") return `复合画面 · 两层视差${shot.shotSize ? ` · ${shotSizeLabels[shot.shotSize]}` : ""}`;
  return `生成画面${shot.shotSize ? ` · ${shotSizeLabels[shot.shotSize]}` : ""}`;
}

/** 编译后发给生图模型的提示词，按槽位展示 */
function PromptSlots({ compiled }: { compiled: CompiledPrompt }) {
  const rows: [string, string][] = [["内容", compiled.slots.content], ["人物", compiled.slots.characters], ["镜头", compiled.slots.camera], ["风格", compiled.slots.style], ["情绪", compiled.slots.mood], ["负面", compiled.negative.join("、")]];
  return <div className="space-y-1 rounded-md border border-white/10 bg-black/20 p-2 text-[11px] leading-5">
    <p className="text-white/40">发给生图模型的提示词</p>
    {rows.filter(([, text]) => text).map(([label, text]) => <p key={label}><span className="text-white/35">{label} · </span><span className="text-white/70">{text}</span></p>)}
    {compiled.removed.length > 0 && <p className="text-amber-200/70">已从画面描述中去掉画风词：{compiled.removed.join("、")}（画风由画面风格统一决定）</p>}
    {compiled.moodConflict && <p className="text-amber-200/70">画面风格不承载「{compiled.moodConflict}」情绪，保持风格基调</p>}
  </div>;
}
