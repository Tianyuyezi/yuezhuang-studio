import { useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import type { PublishDraft } from '../lib/types'
import { useWorkspace } from '../stores/workspace'
import { useInstagramState, zonedSchedule } from '../lib/instagram'
import { request } from '../lib/api'
import { publicationBrandingSchema, publicationContactFooter } from '../shared/publication-branding'
import { INSTAGRAM_STATUS } from '../shared/instagram'
import type { InstagramPublication } from '../shared/instagram'
import { Button, Modal, useNotify } from './ui'
import { useAuth } from '../stores/auth'
import { LoginRequired } from './AccountAccess'

export function PublicationRecord({ item, refresh }: { item: InstagramPublication; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), notify = useNotify()
  async function act(path: string) { setBusy(true); try { await request(`/instagram/publications/${item.id}/${path}`, { method: 'POST' }); await refresh() } catch (e) { notify(e instanceof Error ? e.message : '操作未完成', 'error') } finally { setBusy(false) } }
  return <article className="instagram-publication-record"><div><strong>@{item.username}</strong><span className={`tag ${['failed', 'uncertain', 'missed'].includes(item.status) ? 'amber' : ''}`}>{INSTAGRAM_STATUS[item.status]}</span></div><p>{item.title} · {item.assetIds.length} 张{item.scheduledFor ? ` · ${new Date(item.scheduledFor).toLocaleString()}` : ''}</p>{item.error && <p role="status">{item.error}</p>}{item.permalink && <a href={item.permalink} target="_blank" rel="noreferrer">在 Instagram 查看 <ExternalLink size={13} /></a>}{['uncertain', 'published'].includes(item.status) && <Button disabled={busy} onClick={() => { void act('check') }}><RefreshCw size={13} />回查状态</Button>}{['scheduled', 'preview', 'missed'].includes(item.status) && <Button disabled={busy} onClick={() => { void act('cancel') }}>取消{item.status === 'scheduled' ? '预约' : '这次准备'}</Button>}</article>
}

export default function InstagramPublish({ save, scheduledAt, timezone, draftId }: { save: () => Promise<PublishDraft>; scheduledAt: string; timezone: string; draftId?: string }) {
  const user = useAuth((state) => state.user)
  const { data, error, refresh } = useInstagramState(), notify = useNotify(), store = useWorkspace()
  const [accountId, setAccountId] = useState(''), [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<InstagramPublication | null>(null), [timing, setTiming] = useState('now'), [aiGenerated, setAiGenerated] = useState(false)
  const [loaded, setLoaded] = useState<number[]>([]), [imageError, setImageError] = useState(false)
  const selectedAccount = data?.accounts.find((a) => a.id === accountId) ?? data?.accounts[0]
  const branding = publicationBrandingSchema.parse(store.settings.publicationBranding ?? {})
  const hasContacts = !!publicationContactFooter(branding, store.workflow.language)
  const records = data?.publications.filter((p) => p.draftId === draftId) ?? []
  async function prepare() {
    if (!selectedAccount) return
    setBusy(true)
    try {
      const draft = await save()
      const item = await request<InstagramPublication>('/instagram/publications/prepare', { method: 'POST', body: JSON.stringify({ requestId: crypto.randomUUID(), draftId: draft.id, accountId: selectedAccount.id, aiGenerated }), signal: AbortSignal.timeout(120000) })
      if (['preview', 'missed'].includes(item.status)) { setLoaded([]); setImageError(false); setPreview(item) }
      else notify(`这条内容${INSTAGRAM_STATUS[item.status]}，请查看发布记录。`, 'info')
      await refresh()
    } catch (e) { notify(e instanceof Error ? e.message : '准备发布失败', 'error') }
    finally { setBusy(false) }
  }
  async function confirm() {
    if (!preview) return
    setBusy(true)
    try {
      const when = timing === 'schedule' ? zonedSchedule(scheduledAt, timezone) : undefined
      await request(`/instagram/publications/${preview.id}/confirm`, { method: 'POST', body: JSON.stringify({ confirmed: true, fingerprint: preview.fingerprint, ...(when ? { scheduledFor: when } : {}) }) })
      setPreview(null); await refresh(); notify(when ? '预约已启用，请保持电脑和图片服务在线。' : '正在提交到 Instagram，请等待发布结果。')
    } catch (e) { notify(e instanceof Error ? e.message : '提交失败，请回查状态', 'error'); await refresh() }
    finally { setBusy(false) }
  }
  if (!user) return <LoginRequired reason="发布帖子与连接 Instagram 需要登录。游客可以先完成作品与文案的准备。" />
  return <div className="instagram-publish-controls"><h3>发布到 Instagram</h3><div className="publication-branding-summary"><p>{branding.watermarkEnabled ? '最终发布图片将添加英韩双语标识，创作效果原图不加水印。' : '最终发布图片不添加标识。'}</p><p>{hasContacts ? '文案末尾将附上已保存的化妆师与发布人联系信息。' : '尚未填写联系信息，可到工作空间设置中配置。'}</p><Button variant="ghost" onClick={() => store.setPage('settings')}>配置人员与发布信息</Button></div>{error && <p role="alert">{error}</p>}{data?.accounts.length ? <><label>发布账号<select aria-label="Instagram 发布账号" value={selectedAccount?.id ?? ''} onChange={(e) => setAccountId(e.target.value)}>{data.accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={aiGenerated} onChange={(e) => setAiGenerated(e.target.checked)} />标记为 AI 生成内容</label><small>工作台生成的图片会自动启用 AI 标记。</small><Button variant="primary" disabled={busy || !data.config.publicBaseUrl} onClick={() => { void prepare() }}>{busy ? '正在准备…' : '检查图片并预览发布'}</Button>{!data.config.publicBaseUrl && <p>还需配置图片公开访问地址。</p>}</> : <p>先将 Instagram 切换为创作者或商业账号，再在连接设置中授权。</p>}<Button variant="ghost" onClick={() => store.setPage('settings')}>{data?.accounts.length ? '管理 Instagram 连接' : '前往 Instagram 连接设置'}</Button>{records.slice(0, 5).map((item) => <PublicationRecord key={item.id} item={item} refresh={refresh} />)}
    <Modal wide open={!!preview} onOpenChange={(open) => { if (!open && !busy) setPreview(null) }} title="确认发布到 Instagram" description="下方为实际提交的适配图和文案。确认后将发布到所选账号。">{preview && <div className="instagram-confirm"><strong>发布账号：@{preview.username}</strong><p>{preview.assetIds.length} 张 · 第一张为封面 · {preview.width} × {preview.height} · JPEG</p><p>为保留完整画面，超出比例的图片会添加白边；所有图片采用同一比例。{preview.branding?.watermarkEnabled ? '下方已显示最终发布的英韩双语标识。' : '本次图片不加标识。'}作品库原图不受影响。</p><div className="instagram-confirm-images">{preview.assetIds.map((_id, index) => <figure key={index}><img onLoad={() => setLoaded((items) => items.includes(index) ? items : [...items, index])} onError={() => setImageError(true)} src={`/api/instagram/publications/${preview.id}/images/${index}`} alt={`实际发布图片 ${index + 1}${index === 0 ? '，封面' : ''}`} /><figcaption>{index === 0 ? '01 · 封面' : String(index + 1).padStart(2, '0')}</figcaption></figure>)}</div><p className="instagram-confirm-caption">{preview.caption}</p><span className="tag">{preview.aiGenerated ? '包含 AI 生成内容标记' : '未标记 AI 生成'}</span><label>发布方式<select value={timing} onChange={(e) => setTiming(e.target.value)}><option value="now">立即发布</option><option value="schedule">定时发布</option></select></label>{timing === 'schedule' && <p>{scheduledAt.replace('T', ' ')} · {timezone}<br />到时需保持电脑、应用和图片访问服务运行。错过的预约会等待重新确认。</p>}{imageError && <p role="alert">发布预览图未能完整加载，请返回后重新准备。</p>}<div className="modal-actions"><Button disabled={busy} onClick={() => setPreview(null)}>返回修改</Button><Button variant="primary" disabled={busy || imageError || loaded.length !== preview.assetIds.length} onClick={() => { void confirm() }}>{busy ? '提交中…' : timing === 'schedule' ? '确认并启用预约' : '确认发布到 Instagram'}</Button></div></div>}</Modal>
  </div>
}
