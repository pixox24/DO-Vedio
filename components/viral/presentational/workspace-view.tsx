"use client";

import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from "react";
import Link from "next/link";
import type { ViralWorkspaceViewProps, ViralViewStage } from "../view-props";
import { VIRAL_PLATFORM_LABELS, VIRAL_PLATFORMS, type ViralAngle, type ViralMaterial, type ViralReviewIssue } from "@/lib/viral/types";
import styles from "@/app/viral/viral.module.css";
import { viralCopy as copy, viralReferenceCount } from "../copy";

type Props = ViralWorkspaceViewProps;
const stages: [ViralViewStage, string][] = [["reference", "参考拆解"], ["task", "创作任务"], ["angles", "角度与证据"], ["style", "个人风格"], ["outline", "大纲"], ["script", "口播稿"], ["review", "检查采用"]];
const materialKinds: [ViralMaterial["kind"], string][] = [["point", "观点"], ["fact", "事实"], ["experience", "亲历"], ["data", "数据"], ["testimonial", "证言"]];
// Preserve the trailing line break while a user is typing the next rule.
const lines = (text: string) => text.split("\n");
const committedLines = (text: string) => lines(text).filter((line) => line.trim());
const uniqueId = () => crypto.randomUUID();

function fitTextarea(element: HTMLTextAreaElement | null) {
  if (!element || element.clientWidth === 0) return;
  // Measure the actual wrapped text, including padding and the border-box edges.
  element.style.height = "auto";
  const borderHeight = element.offsetHeight - element.clientHeight;
  element.style.height = `${element.scrollHeight + borderHeight}px`;
}

function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const element = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => fitTextarea(element.current), [props.value]);
  useLayoutEffect(() => {
    const textarea = element.current;
    if (!textarea) return;
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      fitTextarea(textarea);
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, []);
  return <textarea {...props} ref={element} rows={1} />;
}

function Field({ id, label, error, children, hint }: { id: string; label: string; error?: string; children: ReactNode; hint?: ReactNode }) {
  const control = isValidElement<{ "aria-describedby"?: string; "aria-invalid"?: boolean }>(children)
    ? cloneElement(children, {
        "aria-describedby": [...new Set([...(children.props["aria-describedby"] || "").split(" "), hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean))].join(" ") || undefined,
        "aria-invalid": error ? true : children.props["aria-invalid"],
      })
    : children;
  return <div className={styles.field}><label htmlFor={id}>{label}</label>{control}{hint && <p id={`${id}-hint`} className={styles.hint}>{hint}</p>}{error && <p id={`${id}-error`} className={styles.fieldError} role="alert">{error}</p>}</div>;
}
function Fold({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className={styles.fold} open={open}><summary>{title}</summary><div className={styles.foldBody}>{children}</div></details>;
}
function Command({ p, command, children }: { p: Props; command: Parameters<Props["onCommand"]>[0]; children: ReactNode }) {
  return <button type="button" className={styles.primary} disabled={!p.commandsReady || p.locked || p.busy || p.loading} onClick={() => p.onCommand(command)}>{p.commandsReady ? children : "正在准备模型与默认设置…"}</button>;
}

function Reference({ p, compact = false }: { p: Props; compact?: boolean }) {
  const input = p.draft.input;
  return <section className={styles.section} aria-label={copy.fields.reference}>
    <Field id="viral-reference" label={copy.fields.reference} error={p.fieldErrors.referenceText} hint={`${viralReferenceCount(input.referenceText.length)} · ${copy.fields.referenceHint}`}>
      <textarea id="viral-reference" className={compact ? styles.referenceCompact : styles.reference} value={input.referenceText} disabled={p.locked || p.busy} aria-invalid={!!p.fieldErrors.referenceText} aria-describedby={`viral-reference-hint${p.fieldErrors.referenceText ? " viral-reference-error" : ""}`} placeholder={copy.entry.placeholder} onChange={(event) => p.onInputPatch({ referenceText: event.target.value })} />
    </Field>
    <Fold title="参考标题与来源备注">
      <Field id="viral-reference-title" label={copy.fields.referenceTitle}><input id="viral-reference-title" value={input.referenceTitle} disabled={p.locked || p.busy} onChange={(event) => p.onInputPatch({ referenceTitle: event.target.value })} /></Field>
      <Field id="viral-reference-source" label={copy.fields.referenceSource} hint={copy.fields.referenceSourceHint}><input id="viral-reference-source" value={input.referenceSource} disabled={p.locked || p.busy} onChange={(event) => p.onInputPatch({ referenceSource: event.target.value })} /></Field>
    </Fold>
  </section>;
}

function TaskFields({ p, expanded = false }: { p: Props; expanded?: boolean }) {
  const input = p.draft.input;
  return <section className={styles.section} aria-label="本期创作任务">
    <Field id="viral-topic" label={copy.fields.topic} error={p.fieldErrors.topic} hint={copy.fields.topicHint}><input id="viral-topic" value={input.topic} disabled={p.locked || p.busy} placeholder={copy.fields.topicPlaceholder} aria-invalid={!!p.fieldErrors.topic} aria-describedby={`viral-topic-hint${p.fieldErrors.topic ? " viral-topic-error" : ""}`} onChange={(event) => p.onInputPatch({ topic: event.target.value })} /></Field>
    <fieldset id="viral-platform" className={styles.platforms} disabled={p.locked || p.busy} aria-describedby={p.fieldErrors.platform ? "viral-platform-error" : undefined}><legend>目标平台</legend><div className={styles.platformGrid}>{VIRAL_PLATFORMS.map((platform) => <label key={platform} className={input.platform === platform ? styles.platformSelected : styles.platform}><input type="radio" name="viral-platform" value={platform} checked={input.platform === platform} onChange={() => p.onPlatform(platform)} />{VIRAL_PLATFORM_LABELS[platform]}</label>)}</div>{p.fieldErrors.platform && <p id="viral-platform-error" className={styles.fieldError} role="alert">{p.fieldErrors.platform}</p>}</fieldset>
    <div className={styles.split}><Field id="viral-duration" label={copy.fields.duration} error={p.fieldErrors.targetSeconds} hint={copy.fields.durationHint}><input id="viral-duration" type="number" min={30} max={1800} step={1} value={Number.isFinite(input.targetSeconds) ? input.targetSeconds : ""} disabled={p.locked || p.busy} aria-invalid={!!p.fieldErrors.targetSeconds} aria-describedby={`viral-duration-hint${p.fieldErrors.targetSeconds ? " viral-duration-error" : ""}`} onChange={(event) => p.onDuration(event.target.valueAsNumber)} /></Field><div className={styles.field}><span>制作画幅</span><strong className={styles.settingValue}>{input.handoff.aspectRatio}</strong><small className={styles.hint}>{input.durationIsManual ? copy.fields.manualDuration : copy.fields.defaultDuration}</small></div></div>
    {expanded && <><Field id="viral-audience" label="目标受众"><input id="viral-audience" value={input.audience} disabled={p.locked || p.busy} onChange={(event) => p.onInputPatch({ audience: event.target.value })} /></Field><Field id="viral-claim" label="核心主张"><textarea id="viral-claim" rows={3} value={input.coreClaim} disabled={p.locked || p.busy} onChange={(event) => p.onInputPatch({ coreClaim: event.target.value })} /></Field><Field id="viral-content-kind" label="内容性质"><select id="viral-content-kind" value={input.contentKind} disabled={p.locked || p.busy} onChange={(event) => p.onInputPatch({ contentKind: event.target.value as typeof input.contentKind })}><option value="auto">自动判断</option><option value="fact">事实与方法</option><option value="opinion">观点表达</option><option value="story">{copy.fields.story}</option></select></Field></>}
  </section>;
}

function Materials({ p }: { p: Props }) {
  const characterCount = p.draft.input.materials.reduce((total, material) => total + material.text.length, 0);
  return <section className={styles.section} aria-label="自己的素材"><div className={styles.sectionHead}><h3 id="viral-materials-heading" tabIndex={-1} aria-describedby={`viral-materials-hint${p.fieldErrors.materials ? " viral-materials-error" : ""}`}>自己的素材</h3><span className={styles.materialCount}>{characterCount.toLocaleString()} / 10,000 字符</span></div><p id="viral-materials-hint" className={styles.hint}>{copy.fields.materialsHint}</p>{p.fieldErrors.materials && <p id="viral-materials-error" className={styles.fieldError} role="alert">{p.fieldErrors.materials}</p>}
    {p.draft.input.materials.length <= 1 ? <Field id="viral-materials" label="素材速记"><textarea id="viral-materials" rows={4} value={p.draft.input.materials[0]?.text || ""} disabled={p.locked || p.busy} aria-invalid={!!p.fieldErrors.materials} aria-describedby={`viral-materials-hint${p.fieldErrors.materials ? " viral-materials-error" : ""}`} onChange={(event) => p.onMaterialsText(event.target.value)} placeholder={copy.fields.materialsPlaceholder} /></Field> : <p className={styles.hint}>已添加多条素材，请在下方逐条编辑，保留各自来源。</p>}
    {p.draft.input.materials.map((material, index) => <details key={material.id} className={styles.material}><summary>素材 {index + 1} · {materialKinds.find(([kind]) => kind === material.kind)?.[1]}</summary><div className={styles.foldBody}>
      <Field id={`material-text-${material.id}`} label="素材内容"><textarea id={`material-text-${material.id}`} rows={3} value={material.text} disabled={p.locked || p.busy} onChange={(event) => p.onMaterial(index, { text: event.target.value })} /></Field>
      <Field id={`material-kind-${material.id}`} label="素材类型"><select id={`material-kind-${material.id}`} value={material.kind} disabled={p.locked || p.busy} onChange={(event) => p.onMaterial(index, { kind: event.target.value as ViralMaterial["kind"] })}>{materialKinds.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></Field>
      <Field id={`material-source-${material.id}`} label={copy.fields.materialSource}><input id={`material-source-${material.id}`} value={material.source} disabled={p.locked || p.busy} onChange={(event) => p.onMaterial(index, { source: event.target.value })} /></Field>
      <Field id={`material-verification-${material.id}`} label={copy.fields.materialVerification}><select id={`material-verification-${material.id}`} value={material.verification} disabled={p.locked || p.busy} onChange={(event) => p.onMaterial(index, { verification: event.target.value as ViralMaterial["verification"] })}><option value="user_provided">我提供的素材</option><option value="pending">尚待核实</option><option value="verified">已核实</option></select></Field>
      <button type="button" disabled={p.locked || p.busy} onClick={() => p.onRemoveMaterial(index)}>移除这条素材</button>
    </div></details>)}<button type="button" disabled={p.locked || p.busy} onClick={p.onAddMaterial}>添加素材条目</button>
  </section>;
}

function MemeChoices({ p }: { p: Props }) {
  const selected = p.draft.input.memes;
  const choices = [...p.memeCandidates, ...selected.filter((meme) => !p.memeCandidates.some((candidate) => candidate.id === meme.id))];
  return <fieldset className={styles.evidence} disabled={p.locked || p.busy}>
    <legend id="viral-memes-heading" tabIndex={-1}>本期热梗（选填）</legend>
    <p className={styles.hint}>仅展示已核验的可选素材。你勾选的条目才会用于本期，默认不用梗。</p>
    {p.memesLoading && <p role="status" className={styles.hint}>正在读取可用热梗…</p>}
    {p.memesError && <div className={styles.notice}><p>{p.memesError}</p><button type="button" onClick={p.onReloadMemes}>重试读取热梗</button></div>}
    {choices.map((meme) => <label className={styles.memeChoice} key={meme.id}>
      <input type="checkbox" checked={selected.some((item) => item.id === meme.id)} onChange={(event) => p.onMeme(meme.id, event.target.checked)} />
      <span><strong>{meme.name}</strong><span className={styles.hint}>{meme.text}</span>{!p.memeCandidates.some((candidate) => candidate.id === meme.id) && <small className={styles.hint}>本期已选快照，可取消使用</small>}</span>
    </label>)}
    {!p.memesLoading && !p.memesError && !choices.length && <p className={styles.hint}>暂无已核验的可选热梗，文案仍可正常生成。</p>}
  </fieldset>;
}

function StyleFields({ p }: { p: Props }) {
  const input = p.draft.input;
  const updateStyle = (patch: Partial<typeof input.style>) => p.onInputPatch({ style: { ...input.style, ...patch } });
  return <section className={styles.section} aria-label="个人风格与设置">
    <Field id="viral-template" label="本期风格"><select id="viral-template" value={input.style.templateId} disabled={p.locked || p.busy} onChange={(event) => p.onTemplate(event.target.value)}>{!p.templates.some((template) => template.id === input.style.templateId) && <option value={input.style.templateId}>{input.style.templateName || "当前风格"}</option>}{p.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></Field><Link href={copy.model.styleHref} className={styles.textLink}>{copy.model.manageStyle}</Link>
    <Field id="viral-tone" label="语气"><textarea id="viral-tone" rows={2} value={input.style.tone} disabled={p.locked || p.busy} onChange={(event) => updateStyle({ tone: event.target.value })} /></Field>
    <Field id="viral-style-dos" label="推荐写法（每行一条）"><textarea id="viral-style-dos" rows={3} value={input.style.dos.join("\n")} disabled={p.locked || p.busy} onChange={(event) => updateStyle({ dos: lines(event.target.value) })} onBlur={(event) => updateStyle({ dos: committedLines(event.target.value) })} /></Field>
    <Field id="viral-style-donts" label="禁止写法（每行一条）"><textarea id="viral-style-donts" rows={3} value={input.style.donts.join("\n")} disabled={p.locked || p.busy} onChange={(event) => updateStyle({ donts: lines(event.target.value) })} onBlur={(event) => updateStyle({ donts: committedLines(event.target.value) })} /></Field>
    <Field id="viral-style-rules" label="本期风格规则（每行一条）"><textarea id="viral-style-rules" rows={3} value={input.style.rules.join("\n")} disabled={p.locked || p.busy} onChange={(event) => updateStyle({ rules: lines(event.target.value) })} onBlur={(event) => updateStyle({ rules: committedLines(event.target.value) })} /></Field>
    <div className={styles.split}><Field id="viral-perspective" label="叙述视角" hint={copy.fields.firstPersonHint}><select id="viral-perspective" value={input.perspective} disabled={p.locked || p.busy} onChange={(event) => p.onInputPatch({ perspective: event.target.value as typeof input.perspective })}><option value="first">第一人称</option><option value="third">第三人称</option></select></Field><Field id="viral-rate" label="口播语速"><select id="viral-rate" value={input.rate} disabled={p.locked || p.busy} onChange={(event) => p.onInputPatch({ rate: event.target.value as typeof input.rate })}><option value="auto">跟随风格</option><option value="slow">舒缓</option><option value="medium">适中</option><option value="fast">紧凑</option></select></Field></div>
    <Field id="viral-must-include" label="必须包含（每行一条）"><textarea id="viral-must-include" rows={2} value={input.mustInclude.join("\n")} disabled={p.locked || p.busy} onChange={(event) => p.onInputPatch({ mustInclude: lines(event.target.value) })} onBlur={(event) => p.onInputPatch({ mustInclude: committedLines(event.target.value) })} /></Field>
    <Field id="viral-avoid" label="本期避开（每行一条）"><textarea id="viral-avoid" rows={2} value={input.avoid.join("\n")} disabled={p.locked || p.busy} onChange={(event) => p.onInputPatch({ avoid: lines(event.target.value) })} onBlur={(event) => p.onInputPatch({ avoid: committedLines(event.target.value) })} /></Field>
    <Field id="viral-ending" label="结尾方式"><select id="viral-ending" value={input.ending} disabled={p.locked || p.busy} onChange={(event) => p.onInputPatch({ ending: event.target.value as typeof input.ending })}><option value="natural">自然收束</option><option value="discussion">发起讨论</option><option value="save">提示收藏</option><option value="business">业务引导</option></select></Field>
    <label className={styles.check}><input id="viral-humanize" type="checkbox" checked={input.humanize} disabled={p.locked || p.busy} onChange={(event) => p.onInputPatch({ humanize: event.target.checked })} />去 AI 味</label>
    <MemeChoices p={p} />
    <Field id="viral-aspect" label="制作画幅"><select id="viral-aspect" value={input.handoff.aspectRatio} disabled={p.locked || p.busy} onChange={(event) => p.onAspectRatio(event.target.value as typeof input.handoff.aspectRatio)}><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option></select></Field>
    <Field id="viral-model" label={copy.model.label} error={p.fieldErrors.modelId}><select id="viral-model" value={input.modelId} disabled={p.locked || p.busy || p.modelsLoading} onChange={(event) => p.onInputPatch({ modelId: event.target.value })}><option value="">{p.modelsLoading ? copy.model.loading : copy.model.select}</option>{p.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></Field>
    {!p.modelsLoading && !p.models.length && <p className={styles.notice}>{copy.model.unavailable} <Link href={copy.model.href}>{copy.model.configure}</Link></p>}
    <p className={styles.hint}>{copy.fields.styleSnapshot}</p>
  </section>;
}

function Analysis({ p }: { p: Props }) {
  const analysis = p.draft.analysis;
  const reference = useRef<HTMLTextAreaElement>(null);
  if (!analysis) return <p className={styles.emptyHint}>{copy.analysis.empty}</p>;
  return <section className={styles.section} aria-label="参考拆解报告"><p className={styles.bodyText}>{analysis.summary}</p><p className={styles.hint}>{copy.analysis.hypothesisHint}</p>
    <textarea ref={reference} aria-label="用于定位的参考原文" readOnly className={styles.referenceCompact} value={p.draft.input.referenceText} />
    {analysis.observations.map((observation) => <article className={styles.observation} key={observation.id}><blockquote>{observation.quote}</blockquote><p>观察：{observation.observation}</p><p className={styles.hint}>作用假设：{observation.hypothesis}</p><button type="button" onClick={() => { reference.current?.focus(); reference.current?.setSelectionRange(observation.start, observation.end); }}>定位参考原文</button></article>)}
    <h3>可迁移机制</h3>{analysis.mechanisms.map((mechanism) => <label className={styles.mechanism} key={mechanism.id}><span className={styles.check}><input type="checkbox" checked={mechanism.enabled} disabled={p.locked || p.busy} onChange={(event) => p.onMechanism(mechanism.id, event.target.checked)} />本期采用</span>{mechanism.description}</label>)}
    <Fold title={`独特表达提示 · ${analysis.distinctiveElements.length} 项`}>{analysis.distinctiveElements.map((item) => <article className={styles.observation} key={item.id}><blockquote>{item.text}</blockquote><p className={styles.hint}>{item.reason}</p></article>)}</Fold>
  </section>;
}

function AngleCard({ p, angle, index }: { p: Props; angle: ViralAngle; index: number }) {
  const selected = p.draft.selectedAngleId === angle.id;
  const patch = (values: Partial<ViralAngle>) => p.onAngle({ ...angle, ...values });
  return <article className={selected ? styles.angleSelected : styles.angle}>
    <div className={styles.row}><span className={styles.eyebrow}>角度 {index + 1}</span>{selected && <span className={styles.badge}>当前角度</span>}</div><h3>{angle.title}</h3><p className={styles.bodyText}>{angle.coreClaim}</p><p className={styles.hint}>{angle.recommendedReason}</p>
    <dl className={styles.description}><dt>核心问题</dt><dd>{angle.coreQuestion}</dd><dt>示例开头</dt><dd>{angle.hook}</dd><dt>证据路线</dt><dd><ol>{angle.route.map((step) => <li key={step.id}>{step.claim}<span className={styles.hint}>{step.materialIds.length ? ` · ${step.materialIds.length} 条素材` : " · 不依赖具体素材"}</span></li>)}</ol></dd></dl>
    {angle.missingEvidence.length > 0 && <p className={styles.notice}>尚缺依据：{angle.missingEvidence.join("；")}</p>}
    <details className={styles.fold}><summary>编辑角度与证据路线</summary><div className={styles.foldBody}>
      <Field id={`angle-title-${angle.id}`} label="角度标题"><input id={`angle-title-${angle.id}`} value={angle.title} disabled={p.locked || p.busy} onChange={(event) => patch({ title: event.target.value })} /></Field>
      <Field id={`angle-question-${angle.id}`} label="核心问题"><input id={`angle-question-${angle.id}`} value={angle.coreQuestion} disabled={p.locked || p.busy} onChange={(event) => patch({ coreQuestion: event.target.value })} /></Field>
      <Field id={`angle-claim-${angle.id}`} label="核心主张"><textarea id={`angle-claim-${angle.id}`} rows={2} value={angle.coreClaim} disabled={p.locked || p.busy} onChange={(event) => patch({ coreClaim: event.target.value })} /></Field>
      <Field id={`angle-hook-${angle.id}`} label="示例开头"><textarea id={`angle-hook-${angle.id}`} rows={2} value={angle.hook} disabled={p.locked || p.busy} onChange={(event) => patch({ hook: event.target.value })} /></Field>
      {angle.route.map((step, routeIndex) => <div className={styles.route} key={step.id}><Field id={`route-${step.id}`} label={`证据路线 ${routeIndex + 1}`}><textarea id={`route-${step.id}`} rows={2} value={step.claim} disabled={p.locked || p.busy} onChange={(event) => patch({ route: angle.route.map((item) => item.id === step.id ? { ...item, claim: event.target.value } : item) })} /></Field><fieldset className={styles.evidence} disabled={p.locked || p.busy}><legend>关联本期素材</legend>{p.draft.input.materials.map((material, materialIndex) => <label className={styles.check} key={material.id}><input type="checkbox" checked={step.materialIds.includes(material.id)} onChange={(event) => patch({ route: angle.route.map((item) => item.id === step.id ? { ...item, materialIds: event.target.checked ? [...item.materialIds, material.id] : item.materialIds.filter((id) => id !== material.id) } : item) })} />素材 {materialIndex + 1}：{material.text.slice(0, 50)}</label>)}</fieldset><button type="button" disabled={p.locked || p.busy} onClick={() => patch({ route: angle.route.filter((item) => item.id !== step.id) })}>移除这一步</button></div>)}
      <button type="button" disabled={p.locked || p.busy} onClick={() => patch({ route: [...angle.route, { id: uniqueId(), claim: "", materialIds: [] }] })}>添加证据路线</button>
    </div></details><button type="button" className={selected ? styles.secondary : styles.primary} disabled={p.locked || p.busy} onClick={() => p.onSelectAngle(angle.id)}>{selected ? "已选此角度" : "采用此角度"}</button>
  </article>;
}

function Angles({ p }: { p: Props }) {
  return <section className={styles.section} aria-label="角度与证据"><div className={styles.sectionHead}><div><h2>新的切入角度</h2><p className={styles.hint}>{copy.angles.selectionHint}</p></div><button type="button" disabled={p.locked || p.busy} onClick={() => p.onCommand("angles")}>{p.draft.angles.length ? "换一批角度" : "生成新角度"}</button></div>{p.draft.angles.length ? p.draft.angles.map((angle, index) => <AngleCard key={angle.id} p={p} angle={angle} index={index} />) : <p className={styles.emptyHint}>先填写自己的主题并选择平台，生成三种新角度。</p>}<Command p={p} command="generate">{p.draft.selectedAngleId ? (p.version ? copy.angles.regenerateScript : copy.angles.generateScript) : copy.angles.recommendedScript}</Command></section>;
}

function Outline({ p }: { p: Props }) {
  const outline = p.draft.outline;
  if (!outline) return <section className={styles.section}><h2>口播大纲</h2><p className={styles.emptyHint}>确认新角度后，按目标时长安排段落。</p><Command p={p} command="outline">生成大纲</Command></section>;
  const update = (id: string, patch: Partial<typeof outline.sections[number]>) => p.onOutline({ ...outline, sections: outline.sections.map((section) => section.id === id ? { ...section, ...patch } : section) });
  const move = (index: number, offset: number) => { const sections = [...outline.sections]; [sections[index], sections[index + offset]] = [sections[index + offset], sections[index]]; p.onOutline({ ...outline, sections }); };
  return <section className={styles.section} aria-label="可编辑大纲"><h2>口播大纲</h2>{outline.sections.map((section, index) => <article className={styles.outlineSection} key={section.id}><div className={styles.sectionHead}><span className={styles.eyebrow}>段落 {index + 1}</span><div className={styles.actions}><button type="button" disabled={p.locked || index === 0} aria-label={`上移段落 ${index + 1}`} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={p.locked || index === outline.sections.length - 1} aria-label={`下移段落 ${index + 1}`} onClick={() => move(index, 1)}>↓</button><button type="button" disabled={p.locked || outline.sections.length === 1} onClick={() => p.onOutline({ ...outline, sections: outline.sections.filter((item) => item.id !== section.id) })}>删除</button></div></div>
    <Field id={`outline-title-${section.id}`} label="段落标题"><input id={`outline-title-${section.id}`} value={section.title} disabled={p.locked || p.busy} onChange={(event) => update(section.id, { title: event.target.value })} /></Field><div className={styles.split}><Field id={`outline-function-${section.id}`} label="段落功能"><input id={`outline-function-${section.id}`} value={section.function} disabled={p.locked || p.busy} onChange={(event) => update(section.id, { function: event.target.value })} /></Field><Field id={`outline-seconds-${section.id}`} label="预计时长（秒）"><input id={`outline-seconds-${section.id}`} type="number" min={1} value={section.seconds} disabled={p.locked || p.busy} onChange={(event) => update(section.id, { seconds: event.target.valueAsNumber })} /></Field></div><Field id={`outline-points-${section.id}`} label="要点（每行一条）"><textarea id={`outline-points-${section.id}`} rows={3} value={section.points.join("\n")} disabled={p.locked || p.busy} onChange={(event) => update(section.id, { points: lines(event.target.value) })} onBlur={(event) => update(section.id, { points: committedLines(event.target.value) })} /></Field><fieldset className={styles.evidence} disabled={p.locked || p.busy}><legend>关联素材</legend>{p.draft.input.materials.map((material, materialIndex) => <label className={styles.check} key={material.id}><input type="checkbox" checked={section.materialIds.includes(material.id)} onChange={(event) => update(section.id, { materialIds: event.target.checked ? [...section.materialIds, material.id] : section.materialIds.filter((id) => id !== material.id) })} />素材 {materialIndex + 1}</label>)}</fieldset>
  </article>)}{p.fieldErrors.outline && <p className={styles.fieldError} role="alert">{p.fieldErrors.outline}</p>}<div className={styles.actions}><button type="button" disabled={p.locked || p.busy} onClick={() => p.onOutline({ ...outline, sections: [...outline.sections, { id: uniqueId(), title: "新段落", function: "展开", points: [], seconds: 30, materialIds: [] }] })}>添加段落</button><Command p={p} command="outline">重新生成大纲</Command><Command p={p} command="generate">按大纲成稿</Command></div></section>;
}

function Issue({ p, issue }: { p: Props; issue: ViralReviewIssue }) {
  return <article className={issue.severity === "blocker" ? styles.issueBlocker : styles.issue}>
    <div className={styles.row}><span className={styles.badge}>{issue.severity === "blocker" ? copy.review.blocker : issue.severity === "judgment" ? copy.review.judgment : copy.review.suggestion}</span>{issue.resolved && <span className={styles.hint}>已有处理记录</span>}</div>{issue.excerpt && <blockquote>{issue.excerpt}</blockquote>}<p>{issue.reason}</p><p className={styles.hint}>{issue.suggestion}</p>
    {issue.segmentId && <a className={styles.textLink} href={`#script-segment-${issue.segmentId}`} onClick={() => p.onStage("script")}>定位对应段落</a>}
    <details className={styles.fold}><summary>补充处理依据</summary><form className={styles.foldBody} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); p.onResolveIssue(issue.id, data.get("action") as "evidence" | "revised" | "citation", String(data.get("note") || ""), data.getAll("materials").map(String)); }}>
      <Field id={`issue-action-${issue.id}`} label="处理方式"><select id={`issue-action-${issue.id}`} name="action" disabled={p.locked || p.busy}><option value="evidence">补充素材依据</option><option value="revised">已修改相应内容</option><option value="citation">补充明确引用</option></select></Field><Field id={`issue-note-${issue.id}`} label="说明与依据"><textarea id={`issue-note-${issue.id}`} name="note" required rows={3} disabled={p.locked || p.busy} placeholder="说明哪里已修改，或提供可核查的依据" /></Field><fieldset className={styles.evidence} disabled={p.locked || p.busy}><legend>相关素材</legend>{p.draft.input.materials.map((material, index) => <label key={material.id} className={styles.check}><input type="checkbox" name="materials" value={material.id} />素材 {index + 1}：{material.text.slice(0, 60)}</label>)}</fieldset><button type="submit" disabled={p.locked || p.busy}>保存处理依据</button><p className={styles.hint}>{copy.review.resolutionHint}</p>
    </form></details>
  </article>;
}

function Review({ p }: { p: Props }) {
  return <section className={styles.section} aria-label="文案检查"><div className={styles.sectionHead}><h2>{copy.review.title}</h2><button type="button" disabled={p.locked || p.busy || !p.version} onClick={() => p.onCommand("review")}>重新检查</button></div>{p.assessment.reasons.length > 0 && <div className={styles.notice}>{p.assessment.reasons.map((reason) => <p key={reason}>{reason}</p>)}</div>}{p.draft.review ? <><p className={styles.hint}>检查时间：{p.draft.review.checkedAt.replace("T", " ").slice(0, 19)} · 报告关联对应的稿件版本</p>{p.draft.review.issues.length ? p.draft.review.issues.map((issue) => <Issue p={p} key={issue.id} issue={issue} />) : <p className={styles.hint}>{copy.review.noIssues}</p>}</> : <p className={styles.emptyHint}>正文完成后检查事实依据、独特表达、风格与时长。</p>}<p className={styles.hint}>{copy.review.boundaryHint}</p>{p.version?.manuallyEdited && <p className={styles.hint}>{copy.review.manualHint}</p>}</section>;
}

function Script({ p }: { p: Props }) {
  const version = p.version;
  const patch = (segmentId: string, values: { title?: string; text?: string }) => { if (version) p.onScript({ title: version.title, segments: version.segments.map((segment) => segment.id === segmentId ? { ...segment, ...values } : segment) }); };
  return <section className={styles.scriptPanel} aria-label="本期口播稿"><div className={styles.sectionHead}><div><span className={styles.eyebrow}>本期口播稿</span><h2 id="viral-result-heading" tabIndex={-1}>{version ? "把这一稿，讲成你的声音" : "一篇完整稿，从新的角度开始"}</h2></div>{version && <span className={styles.badge}>{p.locked ? "处理中 · 只读" : version.complete ? copy.script.complete : copy.script.incomplete}</span>}</div>
    {!version ? <div className={styles.empty}><span className={styles.emptySymbol} aria-hidden="true">↗</span><p>借鉴参考稿的吸引方式，<br />用自己的主题与素材重新创作。</p><p className={styles.hint}>得到可编辑的口播稿，再进入视频制作。</p></div> : <>
      {!version.complete && <p className={styles.notice}>{copy.script.incompleteHint}</p>}
      {p.estimate && <div className={styles.scriptMeta}><span>{p.estimate.charCount.toLocaleString()} 口播字</span><span>预计 {Math.round(p.estimate.estimatedSeconds)} 秒</span><span>目标 {p.draft.input.targetSeconds} 秒</span><p className={styles.hint}>{copy.script.estimateHint}</p></div>}
      {p.staleReasons.length > 0 && <div className={styles.notice}><strong>{copy.script.stale}</strong><p>{copy.script.staleHint}</p>{p.staleReasons.map((reason) => <p key={reason}>{reason}</p>)}<button type="button" disabled={p.locked || p.busy} onClick={() => p.onRestoreVersion(version.id)}>恢复此稿设置</button></div>}
      <Field id="viral-script-title" label="稿件标题"><AutoTextarea id="viral-script-title" className={styles.scriptTitle} value={version.title} readOnly={p.locked || p.busy} onChange={(event) => p.onScript({ title: event.target.value, segments: version.segments })} /></Field>
      {version.segments.map((segment, index) => <article className={styles.scriptSegment} key={segment.id} id={`script-segment-${segment.id}`} tabIndex={-1}><Field id={`script-heading-${segment.id}`} label={`段落 ${index + 1} 标题`}><input id={`script-heading-${segment.id}`} value={segment.title} readOnly={p.locked || p.busy} onChange={(event) => patch(segment.id, { title: event.target.value })} /></Field><Field id={`script-body-${segment.id}`} label={`段落 ${index + 1} 正文`}><AutoTextarea id={`script-body-${segment.id}`} className={styles.scriptBody} value={segment.text} readOnly={p.locked || p.busy} onChange={(event) => patch(segment.id, { text: event.target.value })} /></Field><details className={styles.rewrite}><summary>重写这一段</summary><form className={styles.foldBody} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); p.onCommand("rewrite", { segmentId: segment.id, instruction: String(data.get("instruction") || "") }); }}><Field id={`rewrite-${segment.id}`} label="你希望怎样修改？"><textarea id={`rewrite-${segment.id}`} rows={2} name="instruction" required disabled={p.locked || p.busy} placeholder="例如：保留核心观点，改成更自然的口语" /></Field><button type="submit" disabled={p.locked || p.busy}>生成这一段的候选</button></form></details></article>)}
      {p.estimate?.needsCalibration && <div className={styles.notice}><p>{copy.script.calibrationHint}</p><button type="button" disabled={p.locked || p.busy} onClick={() => p.onCommand("calibrate")}>校准时长</button></div>}
      <div className={styles.actions}><button type="button" onClick={p.onCopy}>复制当前稿</button><button type="button" onClick={p.onExport}>导出 Markdown</button>{p.draft.mode === "quick" && <button type="button" onClick={() => { p.onMode("workbench"); p.onStage("script"); }}>到工作台调整</button>}</div>
    </>}
    {p.candidate && <Fold title={copy.script.candidateTitle} open><p className={styles.hint}>{copy.script.candidateHint}</p><h3>{p.candidate.title}</h3>{p.candidate.segments.map((segment) => <div key={segment.id} className={styles.candidateText}><strong>{segment.title}</strong><p>{segment.text}</p></div>)}<button type="button" className={styles.primary} disabled={p.locked || p.busy} onClick={p.onAdoptCandidate}>采用这一候选</button></Fold>}
    {p.draft.versions.length > 1 && <Fold title={`历史稿件 · ${p.draft.versions.length} 版`}><div className={styles.history}>{[...p.draft.versions].reverse().map((item) => <article key={item.id}><strong>{item.title || "未命名稿件"}</strong><span className={styles.hint}>{item.createdAt.replace("T", " ").slice(0, 19)} · {item.complete ? "完整" : "未完成"}{item.manuallyEdited ? " · 人工编辑" : ""}</span><div className={styles.actions}><button type="button" aria-pressed={version?.id === item.id} onClick={() => p.onSelectVersion(item.id)}>{p.locked ? (version?.id === item.id ? "当前查看" : "查看此稿") : (version?.id === item.id ? "当前稿" : "选为当前稿")}</button><button type="button" disabled={p.locked || p.busy} onClick={() => p.onRestoreVersion(item.id)}>恢复此稿设置</button></div></article>)}</div></Fold>}
    {p.draft.mode === "quick" && <><Fold title="简洁拆解"><Analysis p={p} /></Fold><Fold title="其他角度 · 选择后再确认成稿"><Angles p={p} /></Fold><Fold title="检查说明"><Review p={p} /></Fold></>}
    <div className={styles.adoptionBar}><div><span className={styles.hint}>{copy.adoption.hint}</span>{p.assessment.reasons[0] && <p className={styles.hint}>{p.assessment.reasons[0]}</p>}</div><button type="button" className={styles.primary} disabled={p.adoptionDisabled} onClick={p.onAdopt}>{p.adoptionLabel}</button></div>
  </section>;
}

function SyncChoice({ p }: { p: Props }) {
  const impact = p.syncImpact;
  if (!impact) return null;
  return <section className={styles.syncChoice} aria-labelledby="viral-sync-title"><h2 id="viral-sync-title" tabIndex={-1}>{copy.sync.title}</h2><p>{impact.productionEdited ? copy.sync.productionEdited : copy.sync.existingProduction}</p><p className={styles.hint}>{copy.sync.impactHint}</p><ul className={styles.impactList}><li>断句标注：{impact.hasSentences ? copy.sync.existingAffected : copy.sync.notGenerated}</li><li>配音：{impact.hasVoices ? copy.sync.existingAffected : copy.sync.notGenerated}</li><li>分镜：{impact.hasShots ? copy.sync.existingAffected : copy.sync.notGenerated}</li><li>成片：{impact.hasRenders ? copy.sync.rendersRetained : copy.sync.notGenerated}</li></ul><div className={styles.actions}><button type="button" className={styles.primary} disabled={p.busy || p.locked} onClick={() => p.onSync("replace")}>{copy.sync.replace}</button><button type="button" disabled={p.busy || p.locked} onClick={() => p.onSync("new_project")}>{copy.sync.newProject}</button><button type="button" onClick={p.onCancelSync}>{copy.sync.cancel}</button></div></section>;
}

export function ViralWorkspaceView(p: Props) {
  const quick = p.draft.mode === "quick";
  const workspace = useRef<HTMLElement>(null);
  const quickInputs = useRef<HTMLDetailsElement>(null);
  const lastFocusToken = useRef<number | null>(null);
  useEffect(() => {
    const request = p.focusRequest;
    const root = workspace.current;
    if (!request || !root || lastFocusToken.current === request.token) return;
    const fieldIds: Record<string, string> = {
      referenceText: "viral-reference", referenceTitle: "viral-reference-title", referenceSource: "viral-reference-source",
      topic: "viral-topic", platform: "viral-platform", targetSeconds: "viral-duration", materials: "viral-materials",
      modelId: "viral-model", audience: "viral-audience", coreClaim: "viral-claim", contentKind: "viral-content-kind",
      style: "viral-template", rate: "viral-rate", perspective: "viral-perspective", memes: "viral-memes-heading",
      humanize: "viral-humanize", mustInclude: "viral-must-include", avoid: "viral-avoid", ending: "viral-ending", handoff: "viral-aspect",
    };
    const fieldElement = (field: string): HTMLElement | null => {
      if (field === "outline") return root.querySelector('input[id^="outline-seconds-"]:invalid') || root.querySelector('input[id^="outline-seconds-"]');
      if (field === "materials") return root.querySelector("#viral-materials") || root.querySelector("#viral-materials-heading");
      const node = root.querySelector<HTMLElement>(`#${fieldIds[field] || "viral-reference"}`);
      return field === "platform" ? node?.querySelector<HTMLInputElement>('input[type="radio"]') || null : node;
    };
    const reveal = (node: HTMLElement) => {
      let parent: HTMLElement | null = node.parentElement;
      while (parent && parent !== root) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
    };
    let target: HTMLElement | null;
    if (request.target === "field") {
      Object.keys(p.fieldErrors).forEach((field) => { const node = fieldElement(field); if (node) reveal(node); });
      target = fieldElement(request.field || "referenceText");
    } else if (request.target === "sync") {
      target = root.querySelector("#viral-sync-title");
    } else {
      // Only an explicit quick-flow request can collapse inputs and move result focus.
      if (!quick || !window.matchMedia("(max-width: 1023px)").matches) { lastFocusToken.current = request.token; return; }
      if (quickInputs.current) quickInputs.current.open = false;
      target = root.querySelector("#viral-result-heading");
    }
    if (!target) return;
    lastFocusToken.current = request.token;
    reveal(target);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center", behavior: "instant" });
  }, [p.focusRequest, p.fieldErrors, quick, p.viewStage]);
  return <main ref={workspace} className={styles.workspace}>
    <header className={styles.pageHeader}><div><Link href="/" className={styles.backLink}>← 首页</Link><h1>爆款复创<span className={styles.headerSubtitle}>借鉴机制，创作自己的口播</span></h1></div><div className={styles.headerActions}><span role="status" className={styles.saveState}>{({ idle: "尚未保存", saving: "保存中…", saved: "已保存", error: "保存失败", conflict: "保存冲突" })[p.saveState]}</span><details className={styles.recent}><summary>最近草稿</summary><div className={styles.recentMenu}>{p.recentDrafts.length ? p.recentDrafts.map((draft) => <button type="button" key={draft.id} onClick={() => p.onOpenDraft(draft.id)}><strong>{draft.title || "未命名复创"}</strong><span>{draft.running ? "任务仍在运行" : draft.updatedAt.replace("T", " ").slice(0, 16)}</span></button>) : <p className={styles.hint}>还没有保存的草稿</p>}</div></details><button type="button" onClick={p.onNew}>新建复创</button></div></header>
    <div className={styles.modeBar} role="group" aria-label="创作模式"><button type="button" className={quick ? styles.modeActive : styles.mode} aria-pressed={quick} onClick={() => p.onMode("quick")}>快捷复创</button><button type="button" className={!quick ? styles.modeActive : styles.mode} aria-pressed={!quick} onClick={() => p.onMode("workbench")}>原创工作台</button><p className={styles.hint}>{quick ? "一次生成，自动选角度并完成检查" : "控制角度、证据、风格和每一段表达"}</p></div>
    {(p.loading || p.statusText) && <div className={styles.status} role="status" aria-live="polite"><span className={p.locked ? styles.liveDot : styles.statusDot} aria-hidden="true"/><span>{p.loading ? "正在恢复草稿…" : p.statusText}</span>{p.locked && <button type="button" disabled={p.busy || p.draft.task?.status === "stopping"} onClick={() => p.onCommand("stop")}>{p.draft.task?.status === "stopping" ? "正在停止…" : "停止生成"}</button>}{(p.draft.task?.status === "failed" || p.draft.task?.status === "stopped") && <button type="button" disabled={p.busy} onClick={() => p.onCommand("resume")}>从此步继续</button>}</div>}
    {p.error && <div className={styles.error} role="alert"><p>{p.error}</p><div className={styles.actions}>{p.errorRecoveryLabel && p.onErrorRecovery && <button type="button" disabled={p.busy || p.locked} onClick={p.onErrorRecovery}>{p.errorRecoveryLabel}</button>}<button type="button" disabled={p.busy} onClick={p.onReload}>重新读取草稿</button></div></div>}
    <SyncChoice p={p} />
    {quick ? <div className={styles.quickGrid}><details ref={quickInputs} className={styles.inputPanel} open><summary className={styles.inputSummary}><span>本期输入</span><span className={styles.eyebrow}>{p.draft.input.platform ? VIRAL_PLATFORM_LABELS[p.draft.input.platform] : "选择平台"} · {p.draft.input.targetSeconds} 秒</span></summary><div className={styles.inputContent}><Reference p={p} /><TaskFields p={p} /><Fold title={`补充自己的素材${p.draft.input.materials.length ? ` · ${p.draft.input.materials.length} 条` : "（选填）"}`}><Materials p={p} /></Fold><Fold title={`风格与更多设置 · ${p.draft.input.style.templateName || "当前风格"}`}><StyleFields p={p} /></Fold><Command p={p} command="quick">{p.locked ? (p.statusText || "本次任务处理中") : "生成文案"}</Command><p className={styles.hint}>{copy.mode.pipeline}</p></div></details><Script p={p} /></div> : <>
      <nav className={styles.stageNav} aria-label="创作阶段">{stages.map(([stage, label], index) => <button type="button" key={stage} className={p.viewStage === stage ? styles.stageActive : styles.stage} aria-current={p.viewStage === stage ? "step" : undefined} onClick={() => p.onStage(stage)}><span>{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</nav>
      <div className={styles.workbenchGrid}>
        <aside className={styles.auxiliaryPanel} aria-label="本期辅助资料">
          <div className={styles.referencePanel}><Fold title="参考原文" open><Reference p={p} compact />{p.viewStage !== "reference" && <button type="button" onClick={() => p.onStage("reference")}>查看完整拆解报告 →</button>}</Fold></div>
          <div className={styles.evidencePanel}><div className={styles.settingSummary}>{p.draft.input.platform ? VIRAL_PLATFORM_LABELS[p.draft.input.platform] : "尚未选择平台"} · {p.draft.input.targetSeconds} 秒 · {p.draft.input.handoff.aspectRatio}</div><Fold title="本期素材" open><Materials p={p} /></Fold>{p.viewStage !== "style" && <Fold title={`本期风格 · ${p.draft.input.style.templateName || "当前风格"}`}><StyleFields p={p} /></Fold>}</div>
        </aside>
        <div className={styles.centerPanel}>
        {p.viewStage === "reference" && <section className={styles.section}><h2>参考拆解</h2><p className={styles.bodyText}>理解开头、推进和结尾的功能，再用自己的任务重建故事线。</p><Analysis p={p} /><Command p={p} command="analyze">{p.draft.analysis ? "重新拆解" : "开始拆解"}</Command><button type="button" onClick={() => p.onStage("task")}>填写自己的创作任务 →</button></section>}
        {p.viewStage === "task" && <section className={styles.section}><h2>自己的创作任务</h2><TaskFields p={p} expanded /><Command p={p} command="angles">生成新角度</Command></section>}
        {p.viewStage === "angles" && <Angles p={p} />}
        {p.viewStage === "style" && <section className={styles.section}><h2>确认个人风格</h2><StyleFields p={p} /><Command p={p} command="outline">按本期风格生成大纲</Command></section>}
        {p.viewStage === "outline" && <Outline p={p} />}
        {p.viewStage === "script" && <Script p={p} />}
        {p.viewStage === "review" && <><Review p={p} /><div className={styles.adoptionBar}><button type="button" onClick={() => p.onStage("script")}>回到口播稿</button><button type="button" className={styles.primary} disabled={p.adoptionDisabled} onClick={p.onAdopt}>{p.adoptionLabel}</button></div></>}
      </div></div>
    </>}
  </main>;
}
