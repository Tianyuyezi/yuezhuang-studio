import { BookOpen, Check, Copy, Images, Plus, RefreshCw, SlidersHorizontal, Trash2, Upload, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AssetImage, Button, ConfirmModal, EmptyState, IconButton, Modal, useNotify } from '../components/ui'
import { QualityPreferencesDialog, ScoreFields, useQualityPreferences } from '../components/QualityControls'
import { useImportAssets } from '../components/useImportAssets'
import { request } from '../lib/api'
import { STYLES } from '../lib/data'
import { useWorkspace } from '../stores/workspace'
import { useBackend } from '../stores/backend'
import { EMPTY_SCORES, QUALITY_DIMENSIONS, referenceInputSchema, weightedQuality } from '../shared/quality'
import type { QualityReference, QualityReferenceInput } from '../shared/quality'
import type { PromptTemplateInput } from '../shared/prompts'

export default function QualityReferences({ search, onTemplate, initialId, onSeen }: { search: string; onTemplate: (value: PromptTemplateInput) => void; initialId: string | null; onSeen: () => void }) {
  const ready = useBackend((s) => s.status === 'ready')
  const assets = useWorkspace((s) => s.importedAssets)
  const artist = useWorkspace((s) => s.settings.artistName)
  const [items, setItems] = useState<QualityReference[]>([])
  const [selected, setSelected] = useState<QualityReference | null>(null)
  const [creating, setCreating] = useState(false)
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const preferences = useQualityPreferences()
  const notify = useNotify()
  const refresh = () => setRevision((r) => r + 1)
  useEffect(() => { if (!ready) return; let cancelled = false; setLoading(true); void request<QualityReference[]>('/quality-references').then((list) => { if (!cancelled) { setItems(list); setError('') } }).catch((e) => { if (!cancelled) setError(e.message) }).finally(() => { if (!cancelled) setLoading(false) }); return () => { cancelled = true } }, [ready, revision])
  useEffect(() => {
    if (!initialId || !ready) return
    if (initialId === 'all') { onSeen(); return }
    let cancelled = false
    void request<QualityReference>(`/quality-references/${initialId}`).then((item) => { if (!cancelled) { setSelected(item); onSeen() } }).catch((e) => { if (!cancelled) { notify(e.message, 'error'); onSeen() } })
    return () => { cancelled = true }
  }, [initialId, ready, onSeen, notify])
  const list = items.filter((r) => `${r.title} ${r.style} ${r.notes}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(b.weighted.score !== null) - Number(a.weighted.score !== null) || (b.weighted.score ?? 0) - (a.weighted.score ?? 0) || b.priority - a.priority)
  return <section className="quality-references"><div className="quality-panel-heading"><div><h2>优质参考与优化方向</h2><p>{preferences.enabled ? '已开启：优先参考认可样本，保留当前人物与妆容要求。' : '自动优化已暂停，参考与评测记录仍保留。'}</p></div><div><Button onClick={() => setPreferencesOpen(true)} disabled={!ready}><SlidersHorizontal size={14} />评测权重</Button><Button onClick={() => setCreating(true)} disabled={!ready}><Plus size={14} />添加参考组</Button><IconButton label="刷新优质参考" onClick={refresh}><RefreshCw size={14} /></IconButton></div></div>{error && <p className="prompt-inline-error" role="alert">{error}</p>}<div className="quality-reference-grid">{list.map((item) => <article className="quality-reference-card" key={item.id}><button className="quality-reference-cover" onClick={() => setSelected(item)} aria-label={`查看参考${item.title}`}><AssetImage asset={assets.find((a) => a.id === item.assetIds[0])} />{item.assetIds.length > 1 && <span>{item.assetIds.length} 张同组参考</span>}</button><div className="quality-reference-info"><div className="prompt-card-meta"><span>{item.style || '自定义方向'}</span><span>{item.approved ? '已认可方向' : '暂不用于优化'}</span></div><h3><button onClick={() => setSelected(item)}>{item.title}</button></h3><p>{item.analysis ? item.analysis.observations.makeup : '尚未反推，先分析图片中的妆容、光线与质感。'}</p><div className="quality-reference-footer"><strong>{item.weighted.score === null ? '尚未人工评分' : `${item.weighted.score.toFixed(1)} 分`}</strong><Button onClick={() => setSelected(item)}>{item.analysis ? '查看与评测' : '反推提示词'}<BookOpen size={13} /></Button></div></div></article>)}</div>{loading && !list.length && <p className="quality-explanation">正在读取优质参考…</p>}{!loading && !list.length && !error && <EmptyState icon={<Images size={26} />} title={search ? '没有匹配的参考组' : '从喜欢的作品建立审美方向'} description="导入一组同妆造参考，反推提示词，评分后优先用于后续创作。"><Button onClick={() => setCreating(true)}>添加参考组</Button></EmptyState>}{creating && <NewReference onClose={() => setCreating(false)} onCreated={(item) => { setCreating(false); setSelected(item); refresh() }} />}{selected && <ReferenceDetail key={selected.id} reference={selected} onClose={() => setSelected(null)} onUpdated={(item) => { setSelected(item); refresh() }} onRemoved={() => { setSelected(null); refresh() }} onTemplate={() => {
    if (!selected.analysis) return
    onTemplate({ title: `${selected.title} · 反推提示词`.slice(0, 80), prompt: selected.analysis.prompt, style: selected.style, mode: 'virtual', author: artist, tags: ['图片反推', '优质方向'], notes: `视觉分析反推，原始提示词未知。${selected.notes}\n避免：${selected.analysis.avoid.join('；')}`.slice(0, 1500), sourceJobId: null, sourceReferenceId: selected.id, model: selected.analysis.model }); setSelected(null)
  }} />}{preferencesOpen && <QualityPreferencesDialog onClose={() => setPreferencesOpen(false)} onSaved={() => { setPreferencesOpen(false); refresh() }} />}</section>
}

function NewReference({ onClose, onCreated }: { onClose: () => void; onCreated: (reference: QualityReference) => void }) {
  const assets = useWorkspace((s) => s.importedAssets)
  const [id] = useState(() => crypto.randomUUID())
  const [title, setTitle] = useState('')
  const [style, setStyle] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const { importFiles, importing } = useImportAssets()
  const notify = useNotify()
  return <Modal open onOpenChange={(open) => { if (!open && !busy && !importing) onClose() }} title="添加优质参考组" description="同一妆造的不同角度放在同组，每组 1–8 张。可以从作品库选择或上传。" wide><form className="form-stack" onSubmit={async (e) => { e.preventDefault(); if (!ids.length) { notify('请至少选择一张参考图', 'info'); return } setBusy(true); try { onCreated(await request<QualityReference>('/quality-references', { method: 'POST', body: JSON.stringify({ id, title, style, assetIds: ids, approved: true, priority: 3, scores: EMPTY_SCORES, notes: '' }) })) } catch (error) { notify(error instanceof Error ? error.message : '保存失败', 'error') } finally { setBusy(false) } }}><div className="form-two-col"><label>参考组名称<input required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：暖棕蜜桃与真实肤质" /></label><label>对应妆容风格<input list="quality-style-options" maxLength={80} value={style} onChange={(e) => setStyle(e.target.value)} /><datalist id="quality-style-options">{STYLES.map((value) => <option value={value} key={value} />)}</datalist></label></div><div className="quality-picker-heading"><span>已选 {ids.length} / 8 张</span><Button type="button" disabled={importing} onClick={() => fileInput.current?.click()}><Upload size={14} />{importing ? '导入中…' : '上传参考图'}</Button></div><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="上传优质参考图" onChange={async (e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (ids.length + files.length > 8) { notify('每组最多 8 张，请分组导入。', 'info'); return } const imported = await importFiles(files); setIds((old) => [...new Set([...old, ...imported.map((a) => a.id)])].slice(0, 8)) }} /><div className="quality-asset-picker">{assets.map((asset) => <button key={asset.id} type="button" className={ids.includes(asset.id) ? 'selected' : ''} aria-label={`${ids.includes(asset.id) ? '取消选择' : '选择'}${asset.title}`} onClick={() => { if (ids.includes(asset.id)) setIds(ids.filter((id) => id !== asset.id)); else if (ids.length < 8) setIds([...ids, asset.id]); else notify('每组最多 8 张', 'info') }}><AssetImage asset={asset} />{ids.includes(asset.id) && <Check size={15} />}<span>{asset.title}</span></button>)}</div><p className="quality-explanation">添加表示你认可这组的视觉方向；数字评分仍留空。反推时图片会发送至已配置的文案模型。</p><div className="modal-actions"><Button type="button" onClick={onClose} disabled={busy || importing}>取消</Button><Button type="submit" variant="primary" disabled={busy || importing || !ids.length}>保存参考组</Button></div></form></Modal>
}

function ReferenceDetail({ reference, onClose, onUpdated, onRemoved, onTemplate }: { reference: QualityReference; onClose: () => void; onUpdated: (reference: QualityReference) => void; onRemoved: () => void; onTemplate: () => void }) {
  const assets = useWorkspace((s) => s.importedAssets)
  const [value, setValue] = useState<QualityReferenceInput>(referenceInputSchema.parse(reference))
  const [busy, setBusy] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const preferences = useQualityPreferences()
  const notify = useNotify()
  const update = (partial: Partial<QualityReferenceInput>) => setValue((v) => ({ ...v, ...partial }))
  async function analyze() {
    setAnalyzing(true)
    try { const item = await request<QualityReference>(`/quality-references/${reference.id}/analyze`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(190000) }); onUpdated(item); notify('已完成视觉反推，建议分可检查后采用') } catch (error) { notify(error instanceof Error ? error.message : '反推失败，已有内容保留', 'error') } finally { setAnalyzing(false) }
  }
  return <><Modal open onOpenChange={(open) => { if (!open && !busy) onClose() }} title={reference.title} description="视觉反推会提炼妆容和摄影技法，原作者的原始提示词无法从图片确定。" wide><div className="quality-photo-strip">{reference.assetIds.map((id) => <AssetImage key={id} asset={assets.find((a) => a.id === id)} />)}</div><div className="prompt-detail-actions"><Button disabled={analyzing || busy} onClick={() => { void analyze() }}><Wand2 size={14} />{analyzing ? '分析图片中…' : reference.analysis ? '重新反推' : '从图片反推提示词'}</Button>{reference.analysis && <><Button disabled={busy || analyzing} onClick={onTemplate}><Plus size={14} />收录反推提示词</Button><Button onClick={() => { void navigator.clipboard.writeText(reference.analysis!.prompt).then(() => notify('反推提示词已复制')).catch(() => notify('请手动选择文字复制', 'error')) }}><Copy size={14} />复制</Button></>}</div><p className="quality-explanation">分析时，本组参考图会发送至已配置的文案模型。</p>{reference.analysis && <div className="quality-analysis"><h3>反推提示词 <span className="tag">视觉分析 · {reference.analysis.model}</span></h3><textarea readOnly aria-label="图片反推提示词" rows={8} value={reference.analysis.prompt} /><div className="quality-observations">{QUALITY_DIMENSIONS.map(({ key, label }) => <section key={key}><h4>{label}</h4><p>{reference.analysis!.observations[key]}</p></section>)}</div><div className="quality-ai-scores"><strong>AI 建议加权分：{weightedQuality(reference.analysis.suggestedScores, preferences.weights).score?.toFixed(1) ?? '未评'} / 100 · 待采用</strong><p>AI 建议分，尚未作为人工评价采用：{QUALITY_DIMENSIONS.map(({ key, label }) => `${label} ${reference.analysis!.suggestedScores[key] ?? '不适用'}`).join(' · ')}</p><Button type="button" disabled={busy || analyzing} onClick={() => { update({ scores: reference.analysis!.suggestedScores }); notify('建议分已填入，可调整后保存', 'info') }}>采用建议评分</Button></div>{!!reference.analysis.avoid.length && <p className="quality-explanation">避免：{reference.analysis.avoid.join('；')}</p>}</div>}<form className="form-stack quality-evaluation-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const saved = await request<QualityReference>(`/quality-references/${reference.id}`, { method: 'PUT', body: JSON.stringify({ ...value, version: reference.version }) }); setValue(referenceInputSchema.parse(saved)); onUpdated(saved); notify('参考评价与优先级已保存') } catch (error) { notify(error instanceof Error ? error.message : '保存失败', 'error') } finally { setBusy(false) } }}><ScoreFields value={value.scores} onChange={(scores) => update({ scores })} weights={preferences.weights} /><div className="form-two-col"><label>名称<input required maxLength={80} value={value.title} onChange={(e) => update({ title: e.target.value })} /></label><label>对应风格<input maxLength={80} value={value.style} onChange={(e) => update({ style: e.target.value })} /></label></div><div className="form-two-col"><label className="quality-check"><input type="checkbox" checked={value.approved} onChange={(e) => update({ approved: e.target.checked })} />认可这个方向，用于后续优化</label><label>样本优先级<select value={value.priority} onChange={(e) => update({ priority: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option value={n} key={n}>{n} · {n === 1 ? '较低' : n === 5 ? '最高' : '常规'}</option>)}</select></label></div><label>评测与改进心得<textarea rows={3} maxLength={1500} value={value.notes} onChange={(e) => update({ notes: e.target.value })} /></label><div className="modal-actions"><IconButton label="删除这组优质参考" disabled={busy || analyzing} onClick={() => setConfirm(true)}><Trash2 size={15} /></IconButton><Button type="submit" variant="primary" disabled={busy || analyzing}>{busy ? '保存中…' : '保存评价与规则'}</Button></div></form></Modal>{confirm && <ConfirmModal title="删除这组优质参考？" description="停止将这组作为优化方向，图片、已收录提示词和生成记录保留。" onClose={() => setConfirm(false)} onConfirm={() => { void request(`/quality-references/${reference.id}?version=${reference.version}`, { method: 'DELETE' }).then(onRemoved).catch((e) => notify(e.message, 'error')) }} />}</>
}
