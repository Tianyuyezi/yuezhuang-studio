import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Info, Plus, Trash2 } from 'lucide-react'
import { Instagram } from '../components/InstagramIcon'
import { useState } from 'react'
import InstagramSettings from '../components/InstagramSettings'
import { useAuth } from '../stores/auth'
import { LoginRequired } from '../components/AccountAccess'
import { PublicationRecord } from '../components/InstagramPublish'
import { useInstagramState } from '../lib/instagram'
import { publicationBrandingSchema, publicationCaption } from '../shared/publication-branding'
import { INSTAGRAM_STATUS } from '../shared/instagram'
import { useWorkspace } from '../stores/workspace'
import { emptyCaptions, LANGUAGES } from '../lib/data'
import type { Language } from '../lib/types'
import { AssetImage, Button, ConfirmModal, IconButton, Modal, useNotify } from '../components/ui'

function localDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }

export default function Publishing({ onNewProject }: { onNewProject: () => void }) {
  const store = useWorkspace()
  const user = useAuth((state) => state.user)
  const instagram = useInstagramState()
  const [tab, setTab] = useState('calendar')
  const [month, setMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(localDate(new Date()))
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState(store.activeProjectId ?? store.projects[0]?.id ?? '')
  const [time, setTime] = useState('18:00')
  const [language, setLanguage] = useState<Language>(store.settings.language)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const notify = useNotify()
  const year = month.getFullYear(), monthIndex = month.getMonth()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => new Date(year, monthIndex, i - offset + 1))
  const dayDrafts = store.publishDrafts.filter((d) => d.scheduledAt.startsWith(selectedDate))
  const create = () => { if (!store.projects.length) { onNewProject(); return } if (!projectId) setProjectId(store.projects[0].id); setOpen(true) }
  const project = store.projects.find((p) => p.id === projectId)
  const caption = (store.captions[projectId] ?? emptyCaptions())[language]
  return <>
    <div className="page-heading"><div><h1>发布与排期</h1><p>选择作品发布到 Instagram，查看排期和发布结果。</p></div><div className="publishing-heading-actions"><Button onClick={create}><CalendarDays size={16} />新建排期草稿</Button><Button variant="primary" onClick={() => { const group = store.workGroups.find((item) => item.id === store.copyGroupId) ?? store.workGroups.find((item) => item.id === store.workflow.groupId) ?? store.workGroups[0]; if (group) store.startWorkflow(group.id); else store.setPage('assets') }}><Plus size={16} />新建发布</Button></div></div>
    <div className="collection-toolbar"><div className="filter-pills"><button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}><CalendarDays size={15} />内容日历</button><button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}><Instagram size={15} />Instagram 账号</button></div><span className="tag">{instagram.data?.accounts.length ? `${instagram.data.accounts.length} 个 Instagram 账号` : 'Instagram 待连接'}</span></div>
    {tab === 'calendar' ? <><div className="info-note publishing-note"><Info size={17} /><span>点击右上方“新建发布”选择图片；也可以从作品库进入三语文案，再点击“下一步：预览并发布”。已确认的预约与发布结果见下方。</span></div><div className="calendar-layout"><section className="calendar-panel"><div className="calendar-heading"><div><h2>{year} 年 {monthIndex + 1} 月</h2><span>{store.settings.timezone}</span></div><div><Button variant="ghost" onClick={() => { const today = new Date(); setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(localDate(today)) }}>今天</Button><IconButton label="上个月" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}><ChevronLeft size={17} /></IconButton><IconButton label="下个月" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}><ChevronRight size={17} /></IconButton></div></div><div className="calendar-week">{['一', '二', '三', '四', '五', '六', '日'].map((d) => <span key={d}>{d}</span>)}</div><div className="calendar-grid">{cells.map((date) => { const day = localDate(date); const drafts = store.publishDrafts.filter((d) => d.scheduledAt.startsWith(day)); return <button key={day} aria-label={`${day}${drafts.length ? `，${drafts.length} 个草稿` : ''}`} className={`${date.getMonth() !== monthIndex ? 'other-month' : ''} ${day === selectedDate ? 'selected' : ''} ${day === localDate(new Date()) ? 'is-today' : ''}`} onClick={() => setSelectedDate(day)}><span>{date.getDate()}</span>{drafts.length > 0 && <small><span />{drafts.length} 个草稿</small>}</button> })}</div></section><aside className="day-plan"><div className="day-plan-heading"><span className="eyebrow">当日排期</span><h2>{Number(selectedDate.slice(5, 7))} 月 {Number(selectedDate.slice(8, 10))} 日</h2><p>{dayDrafts.length ? `${dayDrafts.length} 份创作草稿` : '当日没有排期草稿。'}</p></div>{dayDrafts.length ? <div className="day-drafts">{dayDrafts.map((d) => <article key={d.id}><div><span><Clock3 size={13} />{d.scheduledAt.slice(11)} · {LANGUAGES.find((l) => l.id === d.language)?.label}</span><IconButton label={`删除排期${d.title}`} onClick={() => setRemoveId(d.id)}><Trash2 size={14} /></IconButton></div><h3>{d.title}</h3><p>{d.caption.trim() ? publicationCaption(d.caption, d.language, publicationBrandingSchema.parse(store.settings.publicationBranding ?? {})) : '尚未填写发布文案'}</p>{d.assetIds?.length && <div className="publication-card-images">{d.assetIds.map((id) => <AssetImage key={id} asset={store.importedAssets.find((a) => a.id === id)} />)}</div>}{d.groupId && <Button variant="ghost" onClick={() => { store.startWorkflow(d.groupId!); store.updateWorkflow({ step: 4, assetIds: d.assetIds ?? null, language: d.language, publishDraftId: d.id, scheduledAt: d.scheduledAt }) }}>继续快速工作流</Button>}<span className="tag">{(() => { const record = instagram.data?.publications.find((p) => p.draftId === d.id); return record ? INSTAGRAM_STATUS[record.status] : '草稿 · 未提交' })()}</span></article>)}</div> : <div className="day-plan-empty"><CalendarDays size={35} strokeWidth={1} /><p>还没有安排内容</p><small>选择日期后添加项目。</small></div>}<Button className="full-width" onClick={create}><Plus size={15} />添加排期草稿</Button></aside></div><div className="schedule-bottom"><span><Clock3 size={17} /></span><p>已确认的定时发布会在电脑开机、应用运行且图片地址可访问时执行。<br /><small>错过的排期会等待你的确认，不会集中补发。</small></p></div></> : <section className="settings-panel">{user ? <InstagramSettings /> : <LoginRequired reason="登录后可连接自己的 Instagram 专业账号。" />}</section>}
    <section className="instagram-history"><h2>Instagram 发布记录</h2><p>显示最近 100 条，历史记录保存在本机数据库和资料导出中。</p>{instagram.error && <p role="alert">{instagram.error}</p>}{instagram.data?.publications.length ? instagram.data.publications.map((item) => <PublicationRecord key={item.id} item={item} refresh={instagram.refresh} />) : <p>尚无发布记录。在快速工作流第 4 步检查图片并确认后，会显示在这里。</p>}</section>
    <Modal open={open} onOpenChange={setOpen} title="为作品安排一个时间" description="保存为排期草稿，不会提交到 Instagram。"><form className="form-stack" onSubmit={(e) => { e.preventDefault(); if (!project) return; store.addPublishDraft({ id: crypto.randomUUID(), projectId: project.id, title: project.title, scheduledAt: `${selectedDate}T${time}`, timezone: store.settings.timezone, language, caption: [caption.title, caption.body, caption.hashtags].filter(Boolean).join('\n\n'), createdAt: Date.now() }); setOpen(false); notify('排期草稿已保存，尚未提交发布') }}><label>妆容项目<select required value={projectId} onChange={(e) => setProjectId(e.target.value)}>{store.projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label><div className="form-two-col"><label>参考日期<input required type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} /></label><label>参考时间<input required type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label></div><label>文案语言<select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>{LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label><div className="caption-snapshot"><span>文案快照</span><p>{[caption.title, caption.body].filter(Boolean).join('\n\n') || '该语言尚未填写文案，可以先保留排期草稿。'}</p></div><div className="info-note"><Info size={15} /><span>参考时区：{store.settings.timezone}。这份草稿尚未启用自动发布，请到快速工作流中确认图片、账号与时间。</span></div><div className="modal-actions"><Button type="button" onClick={() => setOpen(false)}>取消</Button><Button variant="primary" type="submit">保存排期草稿</Button></div></form></Modal>
    {removeId && <ConfirmModal title="删除排期草稿？" description="该草稿会从内容日历中移除，妆容项目和文案会保留。" onClose={() => setRemoveId(null)} onConfirm={() => { store.removePublishDraft(removeId); setRemoveId(null); notify('排期草稿已删除') }} />}
  </>
}
