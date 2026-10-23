import { ArrowLeft, ArrowRight, Check, Copy, Download, ImagePlus, Images, LoaderCircle, Plus, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../stores/workspace'
import { useBackend } from '../stores/backend'
import { emptyCaptions, INITIAL_WORKFLOW, LANGUAGES } from '../lib/data'
import { captionText, dateInTimezone, publicationSnapshot, selectedWorkflowAssets } from '../lib/workflow'
import { flushWorkspace } from '../lib/sync'
import { request } from '../lib/api'
import { downloadFile } from '../lib/storage'
import type { Asset, WorkGroup } from '../lib/types'
import { AssetImage, Button, EmptyState, IconButton, useNotify } from '../components/ui'
import { useImportAssets } from '../components/useImportAssets'
import Studio from './Studio'
import Copywriting from './Copywriting'

const STEPS = [
  { title: '生成图片', description: '选择风格与参考' },
  { title: '确认作品', description: '选图、顺序与封面' },
  { title: '三语文案', description: '为整组作品写文案' },
  { title: '发布准备', description: '预览、排期与导出' },
] as const

export default function QuickWorkflow({ onSave, onOpenAsset }: { onSave: () => void; onOpenAsset: (asset: Asset) => void }) {
  const store = useWorkspace(), backend = useBackend()
  const flow = store.workflow
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const notify = useNotify()
  useEffect(() => { window.scrollTo({ top: 0 }); stepHeading.current?.focus({ preventScroll: true }) }, [flow.step])
  const group = store.workGroups.find((g) => g.id === flow.groupId)
  const selected = selectedWorkflowAssets(group, store.importedAssets, flow.assetIds)
  const job = backend.jobs.find((j) => j.id === flow.jobId)
  const generating = !!job && ['queued', 'running'].includes(job.status)
  const caption = group ? (store.groupCaptions[group.id] ?? emptyCaptions())[flow.language] : emptyCaptions()[flow.language]
  const canCaption = !!group && selected.length > 0 && !generating
  const canPublish = canCaption && !!captionText(caption).trim()
  const go = (step: 1 | 2 | 3 | 4) => store.updateWorkflow({ step, ...(step >= 3 ? { assetIds: selected.map((a) => a.id) } : {}) })

  return <>
    <div className="page-heading"><div><h1>快速工作流</h1><p>从一组妆造图片，到一条准备好的多图帖子。</p></div><Button onClick={() => store.startWorkflow()}><Plus size={15} />新一轮创作</Button></div>
    <nav className="workflow-steps" aria-label="快速工作流步骤">{STEPS.map((step, index) => {
      const number = (index + 1) as 1 | 2 | 3 | 4
      const disabled = number === 3 ? !canCaption : number === 4 ? !canPublish : false
      return <button key={step.title} type="button" aria-current={flow.step === number ? 'step' : undefined} disabled={disabled} className={`${flow.step === number ? 'current' : ''} ${flow.step > number ? 'passed' : ''}`} onClick={() => go(number)}><span className="workflow-step-number">{flow.step > number ? <Check size={17} /> : `0${number}`}</span><span><small>STEP {number}</small><strong>{step.title}</strong><em>{step.description}</em></span></button>
    })}</nav>
    <div className="workflow-stage-title"><div><span>STEP {flow.step}</span><h2 ref={stepHeading} tabIndex={-1}>{STEPS[flow.step - 1].title}</h2></div><p>{backend.saving ? '正在保存进度…' : backend.error ? '进度等待保存' : '进度自动保留，可随时继续'}</p></div>
    {flow.step === 1 && <>
      <Studio embedded onSave={onSave} onOpenAsset={onOpenAsset} onSubmitted={(submitted) => store.updateWorkflow({ ...INITIAL_WORKFLOW, step: 2, jobId: submitted.id, groupId: submitted.groupId ?? submitted.id, language: store.settings.language })} />
      <div className="workflow-footer"><span>已有作品也可以直接开始。</span><Button onClick={() => go(2)}>从作品库继续<ArrowRight size={15} /></Button></div>
    </>}
    {flow.step === 2 && <>
      <WorkflowWorks group={group} selected={selected} onOpenAsset={onOpenAsset} generating={generating} />
      {job && <div className={`workflow-job ${job.error ? 'has-error' : ''}`} role="status"><span>{generating && <LoaderCircle size={16} className="spin" />}{generating ? `正在生成 ${job.completedCount}/${job.requestedCount} 张` : job.status === 'succeeded' ? `本批 ${job.completedCount} 张图片已保存到作品库` : job.error ?? '生成任务已结束，可使用已完成的作品。'}</span>{generating && <Button variant="ghost" onClick={() => { void request(`/jobs/${job.id}/cancel`, { method: 'POST' }).catch((error) => notify(error instanceof Error ? error.message : '取消未完成', 'error')) }}>取消剩余图片</Button>}</div>}
      <div className="workflow-footer"><Button onClick={() => go(1)}><ArrowLeft size={15} />返回创作</Button><span>{selected.length ? `已选 ${selected.length} 张 · 第一张为封面` : '先选择作品组和发布图片'}</span><Button variant="primary" disabled={!canCaption} onClick={() => go(3)}>下一步：三语文案<ArrowRight size={15} /></Button></div>
    </>}
    {flow.step === 3 && <>
      {group && selected.length ? <Copywriting embedded groupId={group.id} assetIds={selected.map((a) => a.id)} /> : <EmptyState icon={<Images />} title="请重新确认作品" description="作品可能已被删除，返回上一步选择图片。" />}
      <div className="workflow-footer"><Button onClick={() => go(2)}><ArrowLeft size={15} />返回选图</Button><span>所选发布语言：{LANGUAGES.find((l) => l.id === flow.language)?.label}</span><Button variant="primary" disabled={!canPublish} onClick={() => go(4)}>下一步：发布准备<ArrowRight size={15} /></Button></div>
    </>}
    {flow.step === 4 && <>
      {group && selected.length ? <WorkflowPublish group={group} selected={selected} /> : <EmptyState icon={<Images />} title="发布图片需要重新确认" description="返回选图后继续，已写文案会保留。" />}
      <div className="workflow-footer"><Button onClick={() => go(3)} disabled={!canCaption}><ArrowLeft size={15} />返回文案</Button><Button onClick={() => store.setPage('publishing')}>查看发布排期<ArrowRight size={15} /></Button></div>
    </>}
  </>
}

function WorkflowWorks({ group, selected, onOpenAsset, generating }: { group?: WorkGroup; selected: Asset[]; onOpenAsset: (asset: Asset) => void; generating: boolean }) {
  const store = useWorkspace()
  const { importing, importFiles } = useImportAssets()
  const input = useRef<HTMLInputElement>(null)
  const members = group?.assetIds.map((id) => store.importedAssets.find((a) => a.id === id)).filter((a): a is Asset => !!a) ?? []
  const selectedIds = selected.map((a) => a.id)
  const toggle = (id: string) => store.updateWorkflow({ assetIds: selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id].slice(0, 20) })
  function move(id: string, direction: number) {
    const result = [...selectedIds], index = result.indexOf(id), target = index + direction
    if (target < 0 || target >= result.length) return
    ;[result[index], result[target]] = [result[target], result[index]]
    store.updateWorkflow({ assetIds: result })
  }
  return <>
    <div className="workflow-source"><label>作品组<select aria-label="快速工作流作品组" value={group?.id ?? ''} disabled={generating} onChange={(e) => store.updateWorkflow({ groupId: e.target.value || null, jobId: null, assetIds: null, publishDraftId: null })}><option value="">选择作品库中的一组图片</option>{store.workGroups.map((g) => <option key={g.id} value={g.id}>{g.title} · {g.assetIds.length} 张</option>)}</select></label><Button disabled={importing || generating} onClick={() => input.current?.click()}><Upload size={15} />{importing ? '正在导入…' : '导入一组照片'}</Button><input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="导入快速工作流照片" onChange={async (e) => { const result = await importFiles(e.target.files); e.target.value = ''; if (result[0]) store.startWorkflow(result[0].groupId ?? result[0].id) }} /></div>
    {members.length ? <>
      <div className="workflow-selection-heading"><p>{members.length} 张作品 · 已选 {selected.length} 张。下方按发布顺序显示，第一张为封面。</p><div><button onClick={() => store.updateWorkflow({ assetIds: members.slice(0, 20).map((a) => a.id) })}>全选</button><button onClick={() => store.updateWorkflow({ assetIds: [] })}>清空选择</button></div></div>
      <div className="workflow-photo-grid">{[...selected, ...members.filter((a) => !selectedIds.includes(a.id))].map((asset) => {
        const index = selectedIds.indexOf(asset.id)
        return <article key={asset.id} className={`workflow-photo ${index >= 0 ? 'selected' : ''}`}><button className="workflow-photo-preview" aria-label={`查看工作流图片${asset.title}`} onClick={() => onOpenAsset(asset)}><AssetImage asset={{ ...asset, src: asset.thumbnailSrc ?? asset.src }} /></button><label className="workflow-photo-select"><input type="checkbox" checked={index >= 0} onChange={() => toggle(asset.id)} aria-label={`选择发布图片${asset.title}`} /><span>{index === 0 ? '01 · 封面' : index > 0 ? String(index + 1).padStart(2, '0') : '未选择'}</span></label><div className="workflow-photo-meta"><strong>{asset.title}</strong>{index >= 0 && <div><button type="button" disabled={index === 0} onClick={() => store.updateWorkflow({ assetIds: [asset.id, ...selectedIds.filter((id) => id !== asset.id)] })}>设为封面</button><IconButton label={`前移${asset.title}`} disabled={index === 0} onClick={() => move(asset.id, -1)}><ArrowLeft size={13} /></IconButton><IconButton label={`后移${asset.title}`} disabled={index === selected.length - 1} onClick={() => move(asset.id, 1)}><ArrowRight size={13} /></IconButton></div>}</div></article>
      })}</div>
    </> : <EmptyState icon={generating ? <LoaderCircle size={28} className="spin" /> : <ImagePlus size={28} />} title={generating ? '图片正在生成中' : '选择一组作品继续'} description={generating ? '生成完成的图片会自动出现在这里，原图会保存到作品库。' : '可以使用已有作品组，或直接导入同一妆造的一组照片。'} />}
  </>
}

function WorkflowPublish({ group, selected }: { group: WorkGroup; selected: Asset[] }) {
  const store = useWorkspace(), backend = useBackend(), notify = useNotify()
  const [busy, setBusy] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const flow = store.workflow
  const caption = (store.groupCaptions[group.id] ?? emptyCaptions())[flow.language]
  const text = captionText(caption)
  const existing = store.publishDrafts.find((p) => p.id === flow.publishDraftId)
  const scheduledAt = flow.scheduledAt ?? existing?.scheduledAt ?? `${dateInTimezone(store.settings.timezone)}T18:00`
  const matches = existing && existing.caption === text && existing.language === flow.language && existing.scheduledAt === scheduledAt && JSON.stringify(existing.assetIds) === JSON.stringify(selected.map((a) => a.id))
  async function save() {
    const draft = publicationSnapshot(group, selected, caption, flow.language, scheduledAt, store.settings.timezone, existing?.id)
    draft.createdAt = existing?.createdAt ?? draft.createdAt
    store.addPublishDraft(draft)
    store.updateWorkflow({ publishDraftId: draft.id, scheduledAt })
    await flushWorkspace()
    return draft
  }
  async function submit(download = false) {
    setBusy(true)
    try {
      const draft = await save()
      if (download) {
        const response = await fetch(`/api/publish-drafts/${draft.id}/package`, { signal: AbortSignal.timeout(60000) })
        if (!response.ok) { const value = await response.json(); throw new Error(value.error?.message ?? '发布素材包导出失败') }
        downloadFile(`${group.title}-发布素材.zip`, await response.blob())
      }
      notify(download ? '发布素材包已导出，包含原图和文案。' : '发布草稿已保存，可在发布排期中查看。')
    } catch (error) { notify(error instanceof Error ? error.message : '操作未完成', 'error') }
    finally { setBusy(false) }
  }
  const preview = selected[Math.min(previewIndex, selected.length - 1)]
  return <div className="workflow-publish-layout"><section className="workflow-publish-preview"><div className="workflow-publish-cover"><AssetImage asset={preview} /><span>{Math.min(previewIndex + 1, selected.length)} / {selected.length}</span></div><div className="workflow-publish-thumbs">{selected.map((asset, index) => <button key={asset.id} aria-label={`发布预览第${index + 1}张`} aria-pressed={index === previewIndex} onClick={() => setPreviewIndex(index)}><AssetImage asset={{ ...asset, src: asset.thumbnailSrc ?? asset.src }} /></button>)}</div><strong>{store.settings.studioName}</strong><p>{text || '请返回上一步填写文案。'}</p></section>
    <section className="workflow-publish-settings"><h3>确认这条多图帖子</h3><p>{selected.length} 张图片 · 第一张为封面 · {group.title}</p><label>发布语言<select aria-label="快速工作流发布语言" value={flow.language} onChange={(e) => store.updateWorkflow({ language: e.target.value as typeof flow.language })}>{LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label><label>计划发布时间<input aria-label="快速工作流计划发布时间" type="datetime-local" value={scheduledAt} onChange={(e) => { if (e.target.value) store.updateWorkflow({ scheduledAt: e.target.value }) }} /></label><small>时区：{store.settings.timezone}</small><div className="workflow-publish-status"><span className="tag amber">Instagram 尚未连接</span><p>当前可保存本地排期草稿，并导出按发布顺序排列的原图、文案和排期信息。连接账号前不会实际发布。</p></div><Button variant="primary" disabled={busy || !text.trim() || backend.status !== 'ready'} onClick={() => { void submit() }}>{busy ? '正在保存…' : matches ? '更新发布草稿' : '保存发布草稿'}<Check size={15} /></Button><Button disabled={busy || !text.trim() || backend.status !== 'ready'} onClick={() => { void submit(true) }}><Download size={15} />导出发布素材包</Button><Button variant="ghost" disabled={!text.trim()} onClick={async () => { try { await navigator.clipboard.writeText(text); notify('发布文案已复制') } catch { notify('请手动选择文案复制', 'info') } }}><Copy size={15} />复制当前语言文案</Button>{matches && <p className="workflow-saved"><Check size={14} />{backend.saving ? '正在保存到本机…' : backend.error ? '草稿仍在本机，等待同步' : '已保存到本机发布排期'}</p>}</section>
  </div>
}
