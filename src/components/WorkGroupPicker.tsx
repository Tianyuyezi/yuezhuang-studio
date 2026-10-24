import { ArrowLeft, ArrowRight, Check, ChevronDown, Images, Search } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Asset, WorkGroup } from '../lib/types'
import { AssetImage, Button, EmptyState, Modal } from './ui'
import ZoomableAssetImage from './ImageViewer'

export default function WorkGroupPicker({ groups, assets, selectedId, disabled, onSelect }: {
  groups: WorkGroup[]; assets: Asset[]; selectedId?: string; disabled?: boolean; onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null), [photoIndex, setPhotoIndex] = useState(0)
  const body = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { body.current?.closest('.modal-content')?.scrollTo({ top: 0 }) }, [open, previewId])
  const entries = useMemo(() => {
    const byId = new Map(assets.map((asset) => [asset.id, asset]))
    return groups.map((group) => ({ group, members: group.assetIds.map((id) => byId.get(id)).filter((asset): asset is Asset => !!asset && asset.kind !== 'example') })).filter((entry) => entry.members.length > 0)
  }, [groups, assets])
  const selected = entries.find(({ group }) => group.id === selectedId)
  const preview = entries.find(({ group }) => group.id === previewId)
  const photo = preview?.members[Math.min(photoIndex, preview.members.length - 1)]
  const search = query.trim().toLowerCase()
  const filtered = entries.filter(({ group, members }) => `${group.title} ${group.draft?.style ?? ''} ${members.map((asset) => `${asset.title} ${asset.style}`).join(' ')}`.toLowerCase().includes(search))
  const date = (value: number) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value)
  function show() { setPreviewId(null); setQuery(''); setPhotoIndex(0); setOpen(true) }
  return <>
    <button type="button" className="workflow-group-trigger" aria-label="预览并选择作品组" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={show}>
      <span className="workflow-group-trigger-photos">{selected ? selected.members.slice(0, 3).map((asset) => <AssetImage key={asset.id} asset={asset} />) : <Images size={24} />}</span>
      <span className="workflow-group-trigger-text"><strong>{selected?.group.title ?? '选择作品库中的一组图片'}</strong><small>{selected ? `${selected.members.length} 张 · 查看预览或切换作品组` : '先看图片，再选择作品组'}</small></span><ChevronDown size={16} />
    </button>
    <Modal wide open={open} onOpenChange={setOpen} title={preview ? '预览作品组' : '选择作品组'} description={preview ? '浏览组内图片，确认后再用于本轮工作流。' : '按图片辨认作品组，点击卡片查看组内全部照片。'}>
      <div ref={body}>
      {preview && photo ? <div className="work-group-picker-detail">
        <button type="button" className="back-link" onClick={() => setPreviewId(null)}><ArrowLeft size={14} />返回作品组列表</button>
        <div className="work-group-picker-detail-heading"><h3>{preview.group.title}</h3><p>{preview.members.length} 张 · {preview.group.source === 'generated' ? 'AI 生成作品' : '导入照片'} · {date(preview.group.createdAt)}</p></div>
        <div className="work-group-picker-main"><ZoomableAssetImage key={photo.id} asset={photo} /></div>
        <div className="work-group-picker-thumbs" aria-label="组内图片">{preview.members.map((asset, index) => <button key={asset.id} type="button" aria-label={`预览组内第 ${index + 1} 张`} aria-pressed={photo.id === asset.id} onClick={() => setPhotoIndex(index)}><AssetImage asset={asset} /><span>{index + 1}</span></button>)}</div>
        <div className="work-group-picker-confirm"><span>第 {Math.min(photoIndex + 1, preview.members.length)} / {preview.members.length} 张 · 可点击大图放大查看</span><Button variant="primary" disabled={disabled} onClick={() => { onSelect(preview.group.id); setOpen(false) }}>{preview.group.id === selectedId ? <><Check size={15} />继续使用这组</> : <>使用这组作品<ArrowRight size={15} /></>}</Button></div>
      </div> : <>
        <div className="work-group-picker-toolbar"><div className="inline-search"><Search size={15} /><input aria-label="搜索工作流作品组" placeholder="搜索作品组或妆容风格…" value={query} onChange={(e) => setQuery(e.target.value)} /></div><span>{filtered.length} 组作品</span></div>
        {filtered.length ? <div className="work-group-picker-grid">{filtered.map(({ group, members }) => <button type="button" key={group.id} className={`work-group-picker-card ${group.id === selectedId ? 'current' : ''}`} aria-label={`预览作品组 ${group.title}，${members.length} 张`} onClick={() => { setPreviewId(group.id); setPhotoIndex(0) }}>
          <span className={`work-group-picker-collage ${members.length === 1 ? 'single' : ''}`}>{members.slice(0, 3).map((asset) => <AssetImage key={asset.id} asset={asset} />)}<span className="work-group-picker-count">{members.length} 张</span>{group.id === selectedId && <span className="work-group-picker-current"><Check size={12} />当前使用</span>}</span>
          <span className="work-group-picker-info"><strong>{group.title}</strong><span>{group.source === 'generated' ? '同批生成 · 同一妆造' : '同批导入'}</span><time dateTime={new Date(group.createdAt).toISOString()}>{date(group.createdAt)}</time><em>查看组内图片<ArrowRight size={13} /></em></span>
        </button>)}</div> : <EmptyState icon={<Images size={28} />} title={entries.length ? '没有找到作品组' : '还没有作品组'} description={entries.length ? '试试其他关键词，或清空搜索查看全部作品。' : '生成图片或导入一组照片后，就可以在这里预览选择。'}>{query && <Button onClick={() => setQuery('')}>清空搜索</Button>}</EmptyState>}
      </>}
      </div>
    </Modal>
  </>
}
