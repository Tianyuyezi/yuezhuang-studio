import { ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, Download, Feather, Images, LockKeyhole, UnlockKeyhole } from 'lucide-react'
import { Instagram } from '../components/InstagramIcon'
import { useState } from 'react'
import { useWorkspace } from '../stores/workspace'
import { emptyCaptions, LANGUAGES } from '../lib/data'
import { downloadFile } from '../lib/storage'
import { AssetImage, Button, EmptyState, IconButton, Modal, useNotify } from '../components/ui'
import WorkGroupCard from '../components/WorkGroupCard'
import type { Asset, Language } from '../lib/types'
import { useBackend } from '../stores/backend'
import { generateCaptions } from '../lib/ai'
import JobPanel from '../components/JobPanel'

export default function Copywriting({ embedded = false, groupId, assetIds }: { embedded?: boolean; groupId?: string; assetIds?: string[] } = {}) {
  const store = useWorkspace()
  const backend = useBackend()
  const [localLanguage, setLanguage] = useState<Language>(store.settings.language)
  const language = embedded ? store.workflow.language : localLanguage
  const [picker, setPicker] = useState(false)
  const [previewId, setPreviewId] = useState('')
  const group = groupId ? store.workGroups.find((g) => g.id === groupId) : store.workGroups.find((g) => g.id === store.copyGroupId) ?? store.workGroups[0]
  const members = (assetIds ?? group?.assetIds)?.map((id) => store.importedAssets.find((a) => a.id === id && group?.assetIds.includes(id))).filter((a): a is Asset => !!a) ?? []
  const previewIndex = Math.max(0, members.findIndex((a) => a.id === previewId))
  const previewAsset = members[previewIndex]
  const captions = group ? store.groupCaptions[group.id] ?? emptyCaptions() : emptyCaptions()
  const caption = captions[language]
  const finalCaption = [caption.title, caption.body, caption.hashtags].filter(Boolean).join('\n\n')
  const busy = backend.pendingSubmissions > 0 || backend.jobs.some((job) => job.kind === 'caption' && job.groupId === group?.id && ['queued', 'running'].includes(job.status))
  const notify = useNotify()
  const edit = (value: Partial<typeof caption>) => { if (group) store.updateGroupCaption(group.id, language, value) }
  async function generate(all: boolean) {
    if (!group) return
    const languages = all ? (['zh', 'en', 'ko'] as const).filter((l) => !captions[l].locked) : caption.locked ? [] : [language]
    if (!languages.length) { notify('需要生成的语言已锁定，请先解锁。', 'info'); return }
    try { await generateCaptions(group.id, [...languages], assetIds); notify('整组文案任务已提交，锁定的语言会保留。') }
    catch (error) { notify(error instanceof Error ? error.message : '提交失败', 'error') }
  }
  async function copy() {
    if (!finalCaption) { notify('先生成或填写文案。', 'info'); return }
    try { await navigator.clipboard.writeText(finalCaption); notify('整组文案已复制') }
    catch { notify('请手动选择文字复制。', 'error') }
  }
  return <>
    {!embedded && <div className="page-heading"><div><h1>三语文案</h1><p>从作品库选择一组图片，为同一妆造准备一套中英韩文案。</p></div><Button onClick={() => setPicker(true)}><Images size={15} />从作品库选择</Button></div>}
    {!group ? <EmptyState icon={<Feather size={28} />} title="先选择一组作品" description="同批图片共用一套文案，适合发布为一条多图帖子。"><Button variant="primary" onClick={() => store.setPage('assets')}>前往作品库</Button></EmptyState> : <>
      {embedded ? <div className="copy-project-bar"><strong>{group.title}</strong><span>{members.length} 张已选图片 · 一套共用文案</span></div> : <div className="copy-project-bar"><label>当前作品组<select aria-label="选择文案作品组" value={group.id} onChange={(e) => { store.openGroupCaptions(e.target.value); setPreviewId('') }}>{store.workGroups.map((g) => <option key={g.id} value={g.id}>{g.title} · {g.assetIds.length} 张</option>)}</select></label><Button variant="ghost" onClick={() => store.setPage('assets')}><ArrowLeft size={14} />返回作品库</Button></div>}
      <div className="copy-group-strip"><div className="copy-group-photos">{members.map((asset, index) => <button key={asset.id} className={previewIndex === index ? 'selected' : ''} aria-label={`预览组内第 ${index + 1} 张图片`} aria-pressed={previewIndex === index} onClick={() => setPreviewId(asset.id)}><AssetImage asset={{ ...asset, src: asset.thumbnailSrc ?? asset.src }} /></button>)}</div><div><strong>{members.length} 张图片 · 一套共用文案</strong><p>{group.source === 'generated' ? '同一人物、同一妆造，以不同画面呈现。' : '本组导入照片共用一套发布文案。'}</p></div></div>
      <div className="copy-layout"><section className="copy-editor"><div className="language-tabs" role="tablist" aria-label="文案语言">{LANGUAGES.map((lang) => <button key={lang.id} role="tab" aria-selected={language === lang.id} className={language === lang.id ? 'active' : ''} onClick={() => embedded ? store.updateWorkflow({ language: lang.id }) : setLanguage(lang.id)}><span>{lang.short}</span>{lang.label}{captions[lang.id].locked && <LockKeyhole size={12} />}</button>)}</div><div className="copy-editor-body"><div className="copy-tools"><span>编辑整组{LANGUAGES.find((l) => l.id === language)?.label}文案</span><button className={caption.locked ? 'locked' : ''} onClick={() => edit({ locked: !caption.locked })}>{caption.locked ? <LockKeyhole size={13} /> : <UnlockKeyhole size={13} />}{caption.locked ? '已锁定' : '锁定版本'}</button></div><label>标题<input aria-label="文案标题" maxLength={150} placeholder="为这一组妆造起一个标题" value={caption.title} onChange={(e) => edit({ title: e.target.value })} /></label><label>正文<textarea aria-label="文案正文" rows={9} maxLength={5000} placeholder="描述这一组图片共同的妆造、灵感与细节…" value={caption.body} onChange={(e) => edit({ body: e.target.value })} /></label><label>话题标签<textarea aria-label="文案话题标签" rows={2} maxLength={1000} placeholder="#妆容灵感 #妆造作品" value={caption.hashtags} onChange={(e) => edit({ hashtags: e.target.value })} /></label><div className="copy-counter"><span><Check size={12} />{backend.saving ? '正在保存到本机…' : backend.error ? '等待保存，请查看连接提示' : '已保存到本机'}</span><span>{finalCaption.length} 字符</span></div><div className="copy-action-row"><Button variant="primary" disabled={busy || backend.status !== 'ready'} onClick={() => { void generate(true) }}>{busy ? '生成中…' : '生成整组三语文案'}</Button><Button disabled={busy || caption.locked || backend.status !== 'ready'} onClick={() => { void generate(false) }}>重新生成当前语言</Button></div><p className="page-note">生成时会将这一组图片与妆造描述发送至已配置的文案服务。锁定版本和生成期间的人工修改会保留。</p><JobPanel kind="caption" groupId={group.id} /></div></section>
      <aside className="copy-preview"><div className="preview-section-title"><Instagram size={16} /><span>多图帖子预览</span><span className="tag">仅供预览</span></div><div className="instagram-preview"><div className="instagram-user"><span className="profile-avatar">悦</span><span>{store.settings.studioName}<small>{members.length} 张图片 · 同一条帖子</small></span><span>•••</span></div><div className="instagram-image"><AssetImage asset={previewAsset} /><span>{previewAsset?.kind === 'generated' ? 'AI 生成作品' : '本地作品预览'} · {previewIndex + 1}/{members.length}</span>{members.length > 1 && <div className="carousel-controls"><IconButton label="预览上一张" onClick={() => setPreviewId(members[(previewIndex + members.length - 1) % members.length].id)}><ChevronLeft size={17} /></IconButton><IconButton label="预览下一张" onClick={() => setPreviewId(members[(previewIndex + 1) % members.length].id)}><ChevronRight size={17} /></IconButton></div>}</div><div className="instagram-caption"><strong>{store.settings.studioName}</strong><p>{finalCaption || '整组共用的文案会显示在这里。'}</p></div></div><div className="preview-actions"><Button onClick={() => { void copy() }}><Copy size={15} />复制整组文案</Button><IconButton label="导出整组三语文案" onClick={() => { const text = LANGUAGES.map((lang) => `${lang.label}\n${[captions[lang.id].title, captions[lang.id].body, captions[lang.id].hashtags].filter(Boolean).join('\n\n')}`).join('\n\n---\n\n'); downloadFile(`${group.title}-三语文案.txt`, new Blob([text], { type: 'text/plain;charset=utf-8' })) }}><Download size={17} /></IconButton></div><p className="page-note">预览仅用于检查图片与文案，不会实际发布。</p></aside></div>
    </>}
    <Modal open={picker} onOpenChange={setPicker} title="从作品库选择" description="选择同一批图片，整组共用一套三语文案。" wide>{store.workGroups.length ? <div className="work-group-grid picker-groups">{store.workGroups.map((g) => <WorkGroupCard key={g.id} group={g} assets={store.importedAssets} onSelect={() => { store.openGroupCaptions(g.id); setPreviewId(''); setPicker(false) }} />)}</div> : <EmptyState icon={<Images />} title="作品库中还没有作品组" description="先生成或导入一组照片。"><Button onClick={() => { setPicker(false); store.setPage('assets') }}>前往作品库</Button></EmptyState>}</Modal>
  </>
}
