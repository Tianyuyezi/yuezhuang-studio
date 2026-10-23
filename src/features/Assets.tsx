import { ArrowLeft, Feather, Heart, Images, Search, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useWorkspace } from '../stores/workspace'
import { useAssets } from '../lib/hooks'
import { STYLES } from '../lib/data'
import type { Asset } from '../lib/types'
import AssetCard from '../components/AssetCard'
import WorkGroupCard from '../components/WorkGroupCard'
import { Button, EmptyState, useNotify } from '../components/ui'
import { useImportAssets } from '../components/useImportAssets'

export default function Assets({ onOpenAsset }: { onOpenAsset: (asset: Asset) => void }) {
  const store = useWorkspace()
  const assets = useAssets()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('groups')
  const [style, setStyle] = useState('全部风格')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const { importing, importFiles } = useImportAssets()
  const notify = useNotify()
  const group = store.workGroups.find((g) => g.id === selectedId)
  const matches = (a: Asset) => `${a.title}${a.style}`.toLowerCase().includes(query.toLowerCase()) && (style === '全部风格' || a.style === style)
  const filtered = assets.filter((a) => matches(a) && (group ? group.assetIds.includes(a.id) : tab === 'all' || tab === 'favorites' && store.favorites.includes(a.id) || tab === 'imported' && a.kind !== 'example' || tab === 'example' && a.kind === 'example'))
  const groups = store.workGroups.filter((g) => `${g.title} ${g.draft?.style ?? ''}`.toLowerCase().includes(query.toLowerCase()) && (style === '全部风格' || g.assetIds.some((id) => assets.some((a) => a.id === id && a.style === style))))
  const useReference = (asset: Asset) => { store.updateDraft({ referenceId: asset.id }); store.setPage('studio'); notify('已添加到创作台参考图') }
  return <>
    {group && <button className="back-link" onClick={() => setSelectedId(null)}><ArrowLeft size={14} />返回作品组</button>}
    <div className="page-heading"><div><h1>{group?.title ?? '作品库'}</h1><p>{group ? `${group.assetIds.length} 张图片，共用一套中英韩文案。` : '同批图片归为一组，整理妆造与发布文案。'}</p></div>{group ? <Button variant="primary" onClick={() => store.openGroupCaptions(group.id)}><Feather size={16} />为整组写文案</Button> : <Button variant="primary" disabled={importing} onClick={() => input.current?.click()}><Upload size={16} />{importing ? '导入中…' : '导入图片'}</Button>}<input className="sr-only" ref={input} aria-label="导入作品图片" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => { void importFiles(e.target.files); e.target.value = '' }} /></div>
    {!group && <div className="library-summary"><div><span className="summary-icon"><Images size={21} /></span><span><strong>{store.workGroups.length}</strong>组作品 · {store.importedAssets.length} 张图片</span></div><div><span className="summary-icon blush"><Heart size={21} /></span><span><strong>{store.favorites.length}</strong>张收藏图片</span></div><p>同批生成或导入的图片自动成组。<br /><span>从作品组进入三语文案，为一条多图帖子准备内容。</span></p></div>}
    <div className="collection-toolbar">{!group && <div className="filter-pills">{[['groups', '作品组'], ['all', '全部素材'], ['imported', '我的素材'], ['example', '参考示例'], ['favorites', '已收藏']].map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>}<div className="collection-filters"><select aria-label="作品库风格筛选" value={style} onChange={(e) => setStyle(e.target.value)}><option>全部风格</option>{STYLES.map((s) => <option key={s}>{s}</option>)}<option>未分类</option></select><div className="inline-search"><Search size={15} /><input aria-label="搜索作品" placeholder={tab === 'groups' ? '搜索作品组…' : '搜索作品…'} value={query} onChange={(e) => setQuery(e.target.value)} /></div></div></div>
    {!group && tab === 'groups' ? groups.length ? <div className="work-group-grid">{groups.map((g) => <WorkGroupCard key={g.id} group={g} assets={assets} onOpen={() => { setSelectedId(g.id); setQuery(''); setStyle('全部风格') }} />)}</div> : <EmptyState icon={<Images size={28} />} title="还没有符合条件的作品组" description="生成一批图片，或一次导入同一妆造的照片，即可开始整理。"><Button onClick={() => input.current?.click()}><Upload size={15} />导入图片</Button></EmptyState> : filtered.length ? <div className="asset-grid library-grid">{filtered.map((a) => <AssetCard key={a.id} asset={a} onOpen={onOpenAsset} onUse={useReference} />)}</div> : <EmptyState icon={<Images size={28} />} title="没有找到素材" description="调整筛选条件，或导入你自己的图片。"><Button onClick={() => input.current?.click()}><Upload size={15} />导入图片</Button></EmptyState>}
    <p className="page-note">参考示例为摄影图片，不归入作品组。生成图片会标注为 AI 作品。</p>
  </>
}
