import { ArrowUpRight, BookOpen, Bookmark, Check, Clock3, Copy, Download, FileText, Images, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AssetImage, Button, ConfirmModal, EmptyState, IconButton, Modal, useNotify } from '../components/ui'
import { request } from '../lib/api'
import { downloadFile } from '../lib/storage'
import { STYLES } from '../lib/data'
import { useWorkspace } from '../stores/workspace'
import { useBackend } from '../stores/backend'
import type { CreationDraft } from '../lib/types'
import type { PromptHistoryItem, PromptPage, PromptTemplate, PromptTemplateInput } from '../shared/prompts'
import { promptTemplateInputSchema } from '../shared/prompts'
import QualityReferences from './QualityReferences'
import { QUALITY_DIMENSIONS } from '../shared/quality'
import { ScoreFields, useQualityPreferences } from '../components/QualityControls'

type Tab = 'library' | 'favorites' | 'history' | 'references'
type Editor = { id: string; version?: number; value: PromptTemplateInput }
const STATUS: Record<string, string> = { queued: '等待生成', running: '生成中', succeeded: '已完成', partial: '部分完成', failed: '生成失败', cancelled: '已取消', interrupted: '已中断' }
const RATINGS = { unrated: '未评价', good: '效果满意', average: '效果一般', poor: '需要改进' }
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。'

export default function Prompts() {
  const store = useWorkspace()
  const ready = useBackend((s) => s.status === 'ready')
  const activeJobs = useBackend((s) => s.jobs.filter((j) => j.kind === 'image' && ['queued', 'running'].includes(j.status)).map((j) => `${j.id}:${j.completedCount}`).join(','))
  const [tab, setTab] = useState<Tab>(store.promptReferenceId ? 'references' : store.promptHistoryId ? 'history' : 'library')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [offset, setOffset] = useState(0)
  const [library, setLibrary] = useState<PromptTemplate[]>([])
  const [history, setHistory] = useState<PromptHistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<PromptTemplate | null>(null)
  const [record, setRecord] = useState<PromptHistoryItem | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [removing, setRemoving] = useState<PromptTemplate | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const notify = useNotify()
  const refresh = () => setRevision((value) => value + 1)
  const date = (time: number) => new Intl.DateTimeFormat('zh-CN', { timeZone: store.settings.timezone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(time)
  useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setOffset(0) }, 250); return () => clearTimeout(timer) }, [query])
  useEffect(() => {
    if (!ready) return
    if (tab === 'references') { setLoading(false); setError(''); return }
    let cancelled = false
    setLoading(true); setError('')
    const params = new URLSearchParams({ q: search, offset: String(offset), limit: '30', favorite: String(tab === 'favorites') })
    const load = tab === 'history' ? request<PromptPage<PromptHistoryItem>>(`/prompt-history?${params}`) : request<PromptPage<PromptTemplate>>(`/prompt-library?${params}`)
    void load.then((result) => {
      if (cancelled) return
      setTotal(result.total)
      if (offset > 0 && offset >= result.total) { setOffset(Math.max(0, Math.floor((result.total - 1) / 30) * 30)); return }
      if (tab === 'history') setHistory(result.items as PromptHistoryItem[])
      else setLibrary(result.items as PromptTemplate[])
    }).catch((e) => { if (!cancelled) setError(message(e)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tab, search, offset, revision, ready])
  useEffect(() => {
    if (!activeJobs || !ready) return
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [activeJobs, ready])
  useEffect(() => { if (ready) refresh() }, [activeJobs, ready])
  useEffect(() => {
    if (!store.promptHistoryId || !ready) return
    let cancelled = false
    setTab('history'); setOffset(0)
    void request<PromptHistoryItem>(`/prompt-history/${store.promptHistoryId}`).then((item) => { if (!cancelled) { setRecord(item); useWorkspace.setState({ promptHistoryId: null }) } }).catch((e) => { if (!cancelled) { notify(message(e), 'error'); useWorkspace.setState({ promptHistoryId: null }) } })
    return () => { cancelled = true }
  }, [store.promptHistoryId, ready, notify])
  useEffect(() => {
    if (!record || !['queued', 'running'].includes(record.job.status)) return
    let cancelled = false
    void request<PromptHistoryItem>(`/prompt-history/${record.id}`).then((item) => { if (!cancelled) setRecord(item) }).catch(() => {})
    return () => { cancelled = true }
  }, [revision, record?.id, record?.job.status])
  useEffect(() => { if (store.promptReferenceId) setTab('references') }, [store.promptReferenceId])
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); notify('提示词已复制') }
    catch { notify('复制未完成，请在详情中选择文字复制。', 'error') }
  }
  function usePrompt(prompt: string, style: string, mode: CreationDraft['mode']) {
    store.updateDraft({ prompt, style: style || store.draft.style, mode }); store.setPage('studio')
    notify('已填入工作台，请确认人物设定与参考图后生成')
  }
  function newEditor(source?: PromptHistoryItem) {
    setEditor({ id: crypto.randomUUID(), value: { title: source ? `${source.draft.style} · 创作提示词` : '', prompt: source?.draft.prompt ?? store.draft.prompt, style: source?.draft.style ?? store.draft.style, mode: source?.draft.mode ?? store.draft.mode, author: store.settings.artistName, tags: [], notes: source?.feedback.notes ?? '', sourceJobId: source?.id ?? null, model: source?.model ?? '' } })
  }
  async function favorite(template: PromptTemplate) {
    try {
      const updated = await request<PromptTemplate>(`/prompt-library/${template.id}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite: !template.favorite }) })
      setDetail((current) => current?.id === updated.id ? updated : current); refresh()
    } catch (e) { notify(message(e), 'error') }
  }
  async function importFile(file?: File) {
    if (!file) return
    try {
      if (file.size > 1024 * 1024) throw new Error('提示词文件超过 1 MB。')
      const data = JSON.parse(await file.text())
      if (data.format !== 'yuezhuang-prompt' || data.version !== 1) throw new Error('请选择悦妆师导出的提示词文件。')
      const value = promptTemplateInputSchema.parse({ ...data.prompt, sourceJobId: null, sourceReferenceId: undefined })
      setEditor({ id: crypto.randomUUID(), value })
    } catch { notify('无法读取提示词文件，请检查格式和长度。', 'error') }
  }
  function exportTemplate(template: PromptTemplate) {
    const value = promptTemplateInputSchema.parse({ ...template, sourceJobId: null, sourceReferenceId: undefined })
    downloadFile(`${template.title.replace(/[\\/:*?"<>|]/g, '-')}.json`, new Blob([JSON.stringify({ format: 'yuezhuang-prompt', version: 1, prompt: value }, null, 2)], { type: 'application/json' }))
  }
  return <>
    <div className="page-heading"><div><h1>提示词中心</h1><p>把好效果留成可复用的配方，让每一次创作都有迹可循。</p></div><div className="prompt-heading-actions"><Button disabled={!ready} onClick={() => importInput.current?.click()}><Upload size={15} />导入</Button><Button variant="primary" disabled={!ready} onClick={() => newEditor()}><Plus size={15} />新建提示词</Button></div></div>
    <input ref={importInput} type="file" accept="application/json,.json" className="sr-only" aria-label="导入提示词文件" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = '' }} />
    <div className="prompt-center-note"><BookOpen size={17} /><p>共享库收录你主动保存的提示词；每次图片生成与修图自动留下记录。<span>当前资料保存在本机。</span></p></div>
    <div className="prompt-toolbar"><div className="mode-tabs" role="tablist" aria-label="提示词分类">{([{ id: 'library', label: '共享库' }, { id: 'favorites', label: '我的收藏' }, { id: 'history', label: '生成记录' }, { id: 'references', label: '优质参考' }] as const).map((item) => <button role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'selected' : ''} key={item.id} onClick={() => { setTab(item.id); setOffset(0) }}>{item.label}</button>)}</div><div className="prompt-search"><Search size={15} /><input aria-label="搜索提示词" placeholder={tab === 'history' ? '搜索描述、风格或模型' : tab === 'references' ? '搜索参考组、风格或心得' : '搜索标题、标签、作者或描述'} value={query} onChange={(e) => setQuery(e.target.value)} /><IconButton label="刷新提示词列表" disabled={loading || !ready} onClick={refresh}><RefreshCw size={14} className={loading ? 'spin' : ''} /></IconButton></div></div>
    {tab !== 'references' && <div className="prompt-list-meta"><span>{tab === 'history' ? '图片生成与修图记录' : tab === 'favorites' ? '收藏的提示词' : '可复用的创作提示词'}</span><span>{loading ? '正在读取…' : `共 ${total} 条`}</span></div>}
    {tab === 'references' ? <QualityReferences search={search} initialId={store.promptReferenceId} onSeen={() => useWorkspace.setState({ promptReferenceId: null })} onTemplate={(value) => setEditor({ id: crypto.randomUUID(), value })} /> : error ? <div className="prompt-error" role="alert"><p>{error}</p><Button onClick={refresh}>重新加载</Button></div> : tab === 'history' ? <div className="prompt-history-list">{history.map((item) => <article className="prompt-history-card" key={item.id}><div className="prompt-history-image"><AssetImage asset={store.importedAssets.find((a) => a.id === item.job.resultAssetIds[0])} /></div><div className="prompt-history-body"><div className="prompt-card-meta"><span>{item.draft.mode === 'edit' ? '照片修图' : '虚拟模特'} · {item.draft.style}</span><time>{date(item.createdAt)}</time></div><h2><button onClick={() => setRecord(item)}>{item.draft.style} · {STATUS[item.job.status]}</button></h2><p className="prompt-excerpt">{item.draft.prompt}</p><div className="prompt-history-footer"><span>{item.model} · {item.job.completedCount}/{item.job.requestedCount} 张<span className={`prompt-rating rating-${item.feedback.rating}`}>{RATINGS[item.feedback.rating]}</span></span><Button onClick={() => setRecord(item)}>查看记录<ArrowUpRight size={13} /></Button></div></div></article>)}</div> : <div className="prompt-library-grid">{library.map((template) => <article className="prompt-card" key={template.id}><div className="prompt-card-meta"><span>{template.style || '自定义'} · {template.mode === 'edit' ? '照片修图' : '虚拟模特'}</span><IconButton label={template.favorite ? `取消收藏${template.title}` : `收藏${template.title}`} onClick={() => { void favorite(template) }}><Bookmark size={16} fill={template.favorite ? 'currentColor' : 'none'} /></IconButton></div><div className="prompt-card-body"><div><h2><button onClick={() => setDetail(template)}>{template.title}</button></h2><p className="prompt-excerpt">{template.prompt}</p></div>{template.assetIds.some((id) => store.importedAssets.some((a) => a.id === id)) && <div className="prompt-card-preview"><AssetImage asset={store.importedAssets.find((a) => template.assetIds.includes(a.id))} /></div>}</div><div className="tag-row">{template.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div><div className="prompt-card-footer"><span>{template.author}</span><div><IconButton label={`复制${template.title}`} onClick={() => { void copy(template.prompt) }}><Copy size={14} /></IconButton><Button onClick={() => usePrompt(template.prompt, template.style, template.mode)}>应用到工作台<ArrowUpRight size={13} /></Button></div></div></article>)}</div>}
    {tab !== 'references' && !loading && !error && !(tab === 'history' ? history.length : library.length) && <EmptyState icon={tab === 'history' ? <Clock3 size={26} /> : tab === 'favorites' ? <Bookmark size={26} /> : <BookOpen size={26} />} title={search ? '没有找到匹配的提示词' : tab === 'history' ? '生成之后，提示词会留在这里' : tab === 'favorites' ? '还没有收藏的提示词' : '把第一个好用的提示词留下来'} description={search ? '试试其他关键词。' : tab === 'history' ? '记录包含原描述、完整请求、参考图顺序与生成结果。' : tab === 'favorites' ? '在共享库点击书签，即可加入收藏。' : '可以手动新建，也可以从生成记录中收录满意的版本。'}><Button onClick={() => { if (tab === 'library') newEditor(); else if (tab === 'history') store.setPage('studio'); else { setTab('library'); setOffset(0) } }}>{tab === 'library' ? '新建提示词' : tab === 'history' ? '前往工作台' : '查看共享库'}</Button></EmptyState>}
    {tab !== 'references' && total > 30 && <div className="prompt-pagination"><Button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 30))}>上一页</Button><span>{Math.floor(offset / 30) + 1} / {Math.ceil(total / 30)}</span><Button disabled={offset + 30 >= total || loading} onClick={() => setOffset(offset + 30)}>下一页</Button></div>}
    {detail && <Modal open onOpenChange={(open) => { if (!open) setDetail(null) }} title={detail.title} description={`${detail.author} · ${detail.style || '自定义'} · ${detail.mode === 'edit' ? '照片修图' : '虚拟模特'}`} wide><div className="prompt-detail-tags tag-row">{detail.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}{detail.model && <span className="tag">{detail.model}</span>}</div><textarea className="prompt-readonly" readOnly aria-label="共享提示词内容" value={detail.prompt} rows={10} />{detail.notes && <div className="prompt-detail-notes"><h3>使用心得</h3><p>{detail.notes}</p></div>}{detail.sourceReferenceId && <Button variant="ghost" onClick={() => { setDetail(null); store.openPromptReferences(detail.sourceReferenceId) }}><Images size={14} />查看视觉反推来源（原始提示词未知）</Button>}{detail.sourceJobId && <Button variant="ghost" onClick={() => { setDetail(null); store.openPromptHistory(detail.sourceJobId!) }}><FileText size={14} />查看来源与生成结果</Button>}<div className="prompt-detail-actions"><Button onClick={() => { void copy(detail.prompt) }}><Copy size={14} />复制提示词</Button><Button onClick={() => exportTemplate(detail)}><Download size={14} />导出分享文件</Button><Button onClick={() => { setEditor({ id: detail.id, version: detail.version, value: promptTemplateInputSchema.parse(detail) }); setDetail(null) }}>编辑</Button><IconButton label="删除这条提示词" onClick={() => setRemoving(detail)}><Trash2 size={15} /></IconButton><Button variant="primary" onClick={() => usePrompt(detail.prompt, detail.style, detail.mode)}>应用到工作台<ArrowUpRight size={14} /></Button></div></Modal>}
    {record && <HistoryDetail key={record.id} record={record} date={date} onClose={() => setRecord(null)} onCopy={copy} onUse={() => usePrompt(record.draft.prompt, record.draft.style, record.draft.mode)} onSave={(feedback) => { newEditor({ ...record, feedback }); setRecord(null) }} onUpdate={(updated) => { setRecord(updated); refresh() }} />}
    {editor && <TemplateEditor editor={editor} onClose={() => setEditor(null)} onSaved={(saved) => { setEditor(null); setTab('library'); setOffset(0); setQuery(''); setSearch(''); setDetail(saved); refresh(); notify(editor.version ? '提示词已更新' : '已收录到本地共享库') }} />}
    {removing && <ConfirmModal title="删除这条共享提示词？" description="生成记录和原始图片会保留。" onClose={() => setRemoving(null)} onConfirm={() => { void request(`/prompt-library/${removing.id}?version=${removing.version}`, { method: 'DELETE' }).then(() => { setRemoving(null); setDetail(null); refresh(); notify('提示词已删除') }).catch((e) => notify(message(e), 'error')) }} />}
  </>
}

function TemplateEditor({ editor, onClose, onSaved }: { editor: Editor; onClose: () => void; onSaved: (value: PromptTemplate) => void }) {
  const [value, setValue] = useState(editor.value)
  const [tags, setTags] = useState(editor.value.tags.join('、'))
  const [busy, setBusy] = useState(false)
  const notify = useNotify()
  const update = (partial: Partial<PromptTemplateInput>) => setValue((v) => ({ ...v, ...partial }))
  return <Modal open onOpenChange={(open) => { if (!open && !busy) onClose() }} title={editor.version ? '编辑提示词' : '收录提示词'} description="保存可复用的描述，并记录适合的风格、标签和使用心得。" wide><form className="form-stack" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true)
    try {
      const parsed = promptTemplateInputSchema.safeParse({ ...value, tags: [...new Set(tags.split(/[、,，\n]/).map((t) => t.trim()).filter(Boolean))] })
      if (!parsed.success) throw new Error('请检查内容长度；最多 12 个标签，每个不超过 30 字。')
      const saved = await request<PromptTemplate>(editor.version ? `/prompt-library/${editor.id}` : '/prompt-library', { method: editor.version ? 'PUT' : 'POST', body: JSON.stringify({ ...parsed.data, ...(editor.version ? { version: editor.version } : { id: editor.id }) }) })
      onSaved(saved)
    } catch (error) { notify(message(error), 'error') } finally { setBusy(false) }
  }}><label>标题<input required maxLength={80} value={value.title} onChange={(e) => update({ title: e.target.value })} placeholder="例如：自然窗光下的真实职业人像" autoFocus /></label><div className="form-two-col"><label>妆容风格<input list="prompt-style-options" maxLength={80} value={value.style} onChange={(e) => update({ style: e.target.value })} /><datalist id="prompt-style-options">{STYLES.map((style) => <option value={style} key={style} />)}</datalist></label><label>创作模式<select value={value.mode} onChange={(e) => update({ mode: e.target.value as CreationDraft['mode'] })}><option value="virtual">虚拟模特</option><option value="edit">照片修图</option></select></label></div><label>提示词<textarea required rows={8} maxLength={4000} value={value.prompt} onChange={(e) => update({ prompt: e.target.value })} placeholder="记录具体的人物、妆容、光线、材质和构图要求…" /></label><div className="form-two-col"><label>整理人<input required maxLength={40} value={value.author} onChange={(e) => update({ author: e.target.value })} /></label><label>标签<input maxLength={360} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用逗号分隔，如：写实、窗光、职业人像" /></label></div><label>使用心得<textarea rows={3} maxLength={1500} value={value.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="哪种场景有效？哪些词需要避免？是否需要参考图？" /></label><div className="modal-actions"><Button type="button" onClick={onClose} disabled={busy}>取消</Button><Button variant="primary" type="submit" disabled={busy}><Check size={15} />{busy ? '保存中…' : '保存到共享库'}</Button></div></form></Modal>
}

function HistoryDetail({ record, date, onClose, onCopy, onUse, onSave, onUpdate }: { record: PromptHistoryItem; date: (time: number) => string; onClose: () => void; onCopy: (text: string) => Promise<void>; onUse: () => void; onSave: (feedback: PromptHistoryItem['feedback']) => void; onUpdate: (record: PromptHistoryItem) => void }) {
  const assets = useWorkspace((s) => s.importedAssets)
  const preferences = useQualityPreferences()
  const [view, setView] = useState<'original' | 'actual'>('original')
  const [index, setIndex] = useState(0)
  const [feedback, setFeedback] = useState(record.feedback)
  const [busy, setBusy] = useState(false)
  const notify = useNotify()
  const attempt = record.attempts[index]
  const image = assets.find((a) => a.id === (attempt?.assetId ?? record.job.resultAssetIds[index]))
  return <Modal open onOpenChange={(open) => { if (!open) onClose() }} title={`${record.draft.style} · 生成记录`} description={`${date(record.createdAt)} · ${record.model} · ${STATUS[record.job.status]}`} wide>{!!record.guidance?.sources.length && <div className="quality-guidance-trace"><strong>本次采用的优化方向</strong><p>{record.guidance.sources.map((source) => `${source.title}（${source.score === null ? '用户认可，未评分' : `${source.score.toFixed(1)} 分`}）`).join('；')}</p><p>当时权重：{QUALITY_DIMENSIONS.map(({ key, label }) => `${label} ${Math.round(record.guidance!.weights[key] / Object.values(record.guidance!.weights).reduce((a, b) => a + b, 0) * 100)}%`).join(' · ')}</p><small>权重、来源与提炼技法已随本次请求保存，后续修改不会改写这份快照。</small></div>}<div className="prompt-record-layout"><div className="prompt-record-result">{image ? <AssetImage asset={image} /> : <div className="image-placeholder"><FileText size={24} /><span>暂无结果图片</span></div>}<p>{image ? image.title : '当前没有可查看的结果图片'}</p>{record.job.resultAssetIds.length > 1 && <div className="prompt-result-thumbs">{record.job.resultAssetIds.map((id, i) => <button key={id} className={i === index ? 'selected' : ''} aria-label={`查看第${i + 1}张结果`} onClick={() => setIndex(i)}><AssetImage asset={assets.find((a) => a.id === id)} /></button>)}</div>}</div><div className="prompt-record-content"><div className="mode-tabs" role="tablist" aria-label="提示词内容类型"><button role="tab" aria-selected={view === 'original'} className={view === 'original' ? 'selected' : ''} onClick={() => setView('original')}>创作描述</button><button role="tab" aria-selected={view === 'actual'} className={view === 'actual' ? 'selected' : ''} onClick={() => setView('actual')}>实际发送提示词</button></div>{view === 'original' ? <textarea readOnly rows={10} aria-label="原始创作描述" className="prompt-readonly" value={record.draft.prompt} /> : record.legacy ? <div className="prompt-detail-notes">这是一条旧任务，保留了创作描述，未记录当时发送的完整提示词。之后的新任务会逐张保存完整请求。</div> : record.attempts.length ? <><label className="prompt-attempt-label">图片请求<select aria-label="选择图片请求" value={Math.min(index, record.attempts.length - 1)} onChange={(e) => setIndex(Number(e.target.value))}>{record.attempts.map((a, i) => <option key={a.index} value={i}>第 {a.index + 1} 张 · {a.status === 'succeeded' ? '已完成' : a.status === 'running' ? '生成中' : a.status === 'interrupted' ? '已中断' : '失败'}</option>)}</select></label><textarea readOnly rows={10} aria-label="实际发送的完整提示词" className="prompt-readonly prompt-actual" value={attempt?.prompt ?? ''} /><p className="prompt-request-meta">{attempt?.size} · {attempt?.quality === 'high' ? '高质量' : ''} · {attempt?.referenceIds.length ?? 0} 张参考图</p>{!!attempt?.referenceIds.length && <div className="prompt-reference-list">{attempt.referenceIds.map((id, i) => <span key={`${id}-${i}`}>参考 {i + 1}：{assets.find((a) => a.id === id)?.title ?? (id.startsWith('sample-') ? '内置参考图' : '已移除的参考图')}</span>)}</div>}{attempt?.error && <p className="prompt-inline-error">{attempt.error}</p>}</> : <div className="prompt-detail-notes">尚未向图片服务发送请求，创作描述已经保存。</div>}<div className="prompt-detail-actions"><Button disabled={view === 'actual' && (!attempt || record.legacy)} onClick={() => { void onCopy(view === 'actual' ? attempt?.prompt ?? '' : record.draft.prompt) }}><Copy size={14} />{view === 'actual' ? '复制完整提示词' : '复制描述'}</Button><Button onClick={onUse}>复用描述<ArrowUpRight size={14} /></Button></div></div></div>{record.job.error && (view === 'original' || record.job.error !== attempt?.error) && <p className="prompt-inline-error">{record.job.error}</p>}<form className="prompt-feedback" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { onUpdate(await request<PromptHistoryItem>(`/prompt-history/${record.id}/feedback`, { method: 'PUT', body: JSON.stringify(feedback) })); notify('效果评价已保存') } catch (error) { notify(message(error), 'error') } finally { setBusy(false) } }}><div><h3>这次效果怎么样？</h3><p>接口成功只是完成生成，你的评价才决定提示词是否值得保留。</p></div><label>效果评价<select value={feedback.rating} onChange={(e) => setFeedback((f) => ({ ...f, rating: e.target.value as typeof f.rating }))}>{Object.entries(RATINGS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><div className="prompt-feedback-weighted"><ScoreFields value={feedback.scores} onChange={(scores) => setFeedback((f) => ({ ...f, scores }))} weights={preferences.weights} /><p className="quality-explanation">标记为「效果满意」后，符合分数与覆盖要求的记录会成为后续优化候选。</p></div><label className="prompt-feedback-notes">观察与改进<textarea rows={2} maxLength={1500} placeholder="例如：皮肤更自然，但头发仍太规整，下次减少精修词…" value={feedback.notes} onChange={(e) => setFeedback((f) => ({ ...f, notes: e.target.value }))} /></label><div className="prompt-detail-actions"><Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存评价'}</Button><Button type="button" variant="primary" disabled={busy} onClick={() => onSave(feedback)}><Plus size={14} />收录到共享库</Button></div></form></Modal>
}
