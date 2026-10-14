"use client";

import { useState } from "react";
import Image from "next/image";
import { Alert, AutoTextarea, Button, Icon, Select } from "@/components/ui";
import { mediaUrl, sceneCardSchema, type Job, type SceneCard } from "@/lib/core/types";
import { newId } from "@/lib/core/sync";
import { sceneSourceHash } from "@/lib/core/scenes";
import { jobAction, postJson, useImageModels } from "@/lib/client";
import { useFeedback } from "@/components/feedback";
import type { ProjectStore } from "@/components/studio/shared";

export function ScenePanel({ id, store, jobs }: { id: string; store: ProjectStore; jobs: Map<string, Job> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm } = useFeedback();
  const doc = store.doc;
  if (!doc) return null;
  const active = doc.scenes.find((scene) => scene.id === selectedId) ?? doc.scenes[0];
  const castJob = [...jobs.values()].findLast((job) => job.stage === "cast");
  const analyzing = busy || !!castJob && ["queued", "running"].includes(castJob.status);

  async function analyze() {
    if (!(await confirm({ title: "识别角色和场景？", message: `会阅读全文并补齐主要地点；已有场景描述和参考图保留。${doc!.settings.autoPortrait ? "已开启自动标准图，将为缺少图片的角色和场景各生成 1 张，图片费用以服务商账单为准。" : "本次只识别描述，不生成图片。"}`, confirmLabel: "开始识别" }))) return;
    setBusy(true);
    setError("");
    try { await store.flush(); await postJson(`/api/projects/${id}/cast`, { force: true }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  function createScene() {
    const scene = sceneCardSchema.parse({ id: newId(), name: `新场景 ${doc!.scenes.length + 1}` });
    store.setDoc((current) => ({ ...current, scenes: [...current.scenes, scene] }));
    setSelectedId(scene.id);
  }

  return <div className="space-y-5">
    <header className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-text">{doc.scenes.length} 个场景</p>
        <p className="mt-1 text-xs text-text-muted">阅读全文识别主要地点；同一空间共用一张标准图。{doc.settings.autoPortrait ? "已开启自动生成。" : "可在设置中开启自动生成角色和场景标准图。"}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" loading={analyzing} onClick={() => void analyze()}>识别角色和场景</Button>
        <Button size="sm" icon={<Icon name="plus" className="size-3.5" />} onClick={createScene}>新增场景</Button>
      </div>
    </header>
    {error && <Alert tone="danger" size="sm">{error}</Alert>}
    {castJob?.status === "failed" && <Alert tone="danger" size="sm">识别失败：{castJob.error}</Alert>}
    {!doc.scenes.length && <p className="rounded-surface border border-dashed border-line px-6 py-10 text-center text-sm text-text-muted">还没有场景。写好正文后识别角色和场景，也可以手动创建。</p>}
    <div className="grid grid-cols-2 gap-3 @md:grid-cols-3">
      {doc.scenes.map((scene) => <button key={scene.id} type="button" aria-pressed={active?.id === scene.id} onClick={() => setSelectedId(scene.id)} className={`overflow-hidden rounded-surface border text-left ${active?.id === scene.id ? "border-accent" : "border-line hover:border-line-strong"}`}>
        <div className="relative aspect-video bg-stage">
          {scene.referenceAssetIds[0] ? <Image src={mediaUrl(scene.referenceAssetIds[0])} alt="" fill sizes="240px" unoptimized className="object-cover" /> : <span className="absolute inset-0 grid place-items-center text-xs text-text-faint">暂无参考图</span>}
        </div>
        <div className="space-y-1 p-3">
          <p className="truncate text-sm text-text">{scene.name || "未命名场景"}</p>
          <p className="line-clamp-2 text-xs text-text-muted">{scene.description || "尚未填写空间陈设"}</p>
        </div>
      </button>)}
    </div>
    {active && <SceneEditor key={active.id} id={id} scene={active} store={store} jobs={jobs} />}
  </div>;
}

function SceneEditor({ id, scene, store, jobs }: { id: string; scene: SceneCard; store: ProjectStore; jobs: Map<string, Job> }) {
  const [url, setUrl] = useState(scene.referenceAssetIds[0] ? mediaUrl(scene.referenceAssetIds[0]) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modelId, setModelId] = useState("");
  const models = useImageModels();
  const { confirm } = useFeedback();
  const model = modelId || models?.[0]?.id || "";
  const job = [...jobs.values()].findLast((job) => job.stage === "scene-reference" && (job.input as { sceneId?: string } | null)?.sceneId === scene.id);
  const running = !!job && ["queued", "running"].includes(job.status);
  const stale = !!scene.referenceAssetIds.length && !!scene.referenceSourceHash && scene.referenceSourceHash !== sceneSourceHash(scene, store.doc!.visualStyle);
  const update = (patch: Partial<SceneCard>) => store.setDoc((doc) => ({ ...doc, scenes: doc.scenes.map((card) => card.id === scene.id ? { ...card, ...patch } : card) }));

  async function generate() {
    if (!(await confirm({ title: "生成场景标准图？", message: "生成 1 张空场景图并设为标准参考图。图片费用由服务商收取，生成后替换当前参考图。", confirmLabel: "生成 1 张" }))) return;
    setBusy(true);
    setError("");
    try { await store.flush(); await postJson(`/api/projects/${id}/scenes/${scene.id}/reference`, { modelId: model }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function saveReference(blob: Blob, name: string) {
    const response = await fetch("/api/media", { method: "POST", headers: { "content-type": blob.type || "application/octet-stream", "x-file-name": encodeURIComponent(name) }, body: blob });
    const asset = await response.json() as { hash?: string; kind?: string; error?: string };
    if (!response.ok || !asset.hash || asset.kind !== "image") throw new Error(asset.error || "请使用有效的图片文件");
    update({ referenceAssetIds: [asset.hash], referenceSourceHash: undefined });
    setUrl(mediaUrl(asset.hash));
  }

  async function importReference(file?: File) {
    setBusy(true);
    setError("");
    try {
      if (file) {
        await saveReference(file, file.name);
      } else {
        const source = new URL(url.trim(), window.location.origin);
        if (!["http:", "https:"].includes(source.protocol)) throw new Error("请填写 HTTP 或 HTTPS 图片地址");
        const response = await fetch(source.href, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`读取参考图失败（HTTP ${response.status}）`);
        await saveReference(await response.blob(), source.href);
      }
    } catch (e) {
      setError(e instanceof TypeError ? "无法读取图片链接，请使用允许跨域读取的地址，或上传图片。" : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return <section className="space-y-4 rounded-surface border border-line p-4">
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium text-text">编辑场景</p>
      <Button size="sm" variant="ghost" onClick={() => update({ locked: !scene.locked })}>{scene.locked ? "解锁场景" : "锁定场景"}</Button>
    </div>
    <label className="block space-y-1.5 text-xs text-text-muted">
      <span>名称</span>
      <input className="input w-full" value={scene.name} disabled={scene.locked} onChange={(e) => update({ name: e.target.value })} placeholder="如：街角咖啡厅" />
    </label>
    <div className="space-y-2">
      {models && models.length > 0 && <Select value={model} onChange={setModelId} aria-label="场景生图模型">{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</Select>}
      <div className="flex items-center gap-2">
        <Button size="sm" loading={busy || running} disabled={!model || scene.locked || !scene.description.trim()} onClick={() => void generate()}>{job?.status === "failed" ? "重试生成 1 张场景图" : "生成 1 张场景图"}</Button>
        {running && <Button size="sm" variant="ghost" onClick={() => { void jobAction(job!.id, "cancel").catch((e) => setError(e instanceof Error ? e.message : String(e))); }}>取消</Button>}
      </div>
      {!model && <p className="text-xs text-text-muted">请在模型中心配置并启用生图模型。</p>}
      {running && <p className="text-xs text-text-muted">场景图生成中{job?.progress ? ` · ${Math.round(job.progress * 100)}%` : ""}，关联镜头会等待这张图。</p>}
      {stale && <Alert tone="warn" size="sm">场景标准图已过期，需按当前描述更新。{store.doc!.settings.autoPortrait ? "自动更新已开启。" : "可点击生成 1 张场景图。"}</Alert>}
      {job?.status === "failed" && <Alert tone="danger" size="sm">场景图生成失败：{job.error}。关联镜头可继续使用描述，或重试生成标准图。</Alert>}
    </div>
    <label className="block space-y-1.5 text-xs text-text-muted">
      <span>空间陈设描述</span>
      <AutoTextarea className="input min-h-24 w-full" value={scene.description} disabled={scene.locked} onChange={(e) => update({ description: e.target.value })} placeholder="如：临街落地窗，窗边圆木桌，墨绿座椅，入口对面的吧台" />
    </label>
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void importReference(); }}>
      <label className="block space-y-1.5 text-xs text-text-muted">
        <span>参考图 URL</span>
        <input className="input w-full" value={url} disabled={scene.locked || busy} onChange={(e) => setUrl(e.target.value)} placeholder="https://… 或 /api/media/…" />
      </label>
      <p className="text-xs text-text-faint">只保留一张标准参考图。外链需允许跨域读取，也可直接上传图片。</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={scene.locked || !url.trim()}>使用参考图</Button>
        <label className={`chip h-8 px-3 text-xs ${scene.locked || busy ? "opacity-50" : "cursor-pointer"}`}>
          上传图片
          <input type="file" accept="image/*" className="hidden" disabled={scene.locked || busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void importReference(file); e.target.value = ""; }} />
        </label>
        {!!scene.referenceAssetIds.length && <Button type="button" size="sm" variant="ghost" disabled={scene.locked || busy} onClick={() => { update({ referenceAssetIds: [], referenceSourceHash: undefined }); setUrl(""); }}>清除参考图</Button>}
      </div>
    </form>
    {error && <Alert tone="danger" size="sm">{error}</Alert>}
    <p className="text-xs text-text-faint">修改自动保存，已生成的关联镜头会标记为过期，重新生图后生效。</p>
  </section>;
}
