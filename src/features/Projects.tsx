import { ArrowUpRight, Clock3, FolderOpen, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useWorkspace } from '../stores/workspace'
import { useAssets } from '../lib/hooks'
import { AssetImage, Button, ConfirmModal, EmptyState, IconButton, useNotify } from '../components/ui'

export default function Projects({ onNew }: { onNew: () => void }) {
  const store = useWorkspace()
  const assets = useAssets()
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('all')
  const [removeId, setRemoveId] = useState<string | null>(null)
  const notify = useNotify()
  const projects = store.projects.filter((p) => `${p.title}${p.artist}${p.description}`.toLowerCase().includes(query.toLowerCase()) && (mode === 'all' || mode === p.draft.mode))
  return <>
    <div className="page-heading"><div><h1>妆容项目</h1><p>管理妆容项目、参考素材与创作草稿。</p></div><Button variant="primary" onClick={onNew}><Plus size={16} />新建项目</Button></div>
    <div className="collection-toolbar"><div className="filter-pills">{[['all', '全部项目'], ['virtual', '虚拟模特'], ['edit', '真实照片']].map(([id, label]) => <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>{label}{id === 'all' && <span>{store.projects.length}</span>}</button>)}</div><div className="inline-search"><Search size={16} /><input aria-label="搜索项目" placeholder="搜索项目、化妆师…" value={query} onChange={(e) => setQuery(e.target.value)} /></div></div>
    {projects.length ? <div className="project-grid">{projects.map((project) => <article className="project-card" key={project.id}><button className="project-cover" aria-label={`打开${project.title}`} onClick={() => store.openProject(project.id)}>{project.coverId ? <AssetImage asset={assets.find((a) => a.id === project.coverId)} /> : <div className="project-art"><span>暂无封面</span><span>{project.draft.style}</span></div>}<span className="project-status"><span />创作草稿</span><span className="project-open-icon"><ArrowUpRight size={20} /></span></button><div className="project-info"><div><h3><button onClick={() => store.openProject(project.id)}>{project.title}</button></h3><IconButton label={`删除${project.title}`} onClick={() => setRemoveId(project.id)}><Trash2 size={15} /></IconButton></div><p>{project.description || `${project.draft.style} · ${project.draft.ratio} · ${project.draft.count} 张`}</p><div className="project-meta"><span>{project.artist}</span><span><Clock3 size={11} />{new Date(project.updatedAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span></div></div></article>)}<button className="project-add-card" onClick={onNew}><span><Plus size={23} /></span><strong>新建项目</strong><small>创建妆容项目</small></button></div> : <div className="large-empty"><EmptyState icon={<FolderOpen size={30} />} title={query || mode !== 'all' ? '没有找到这个项目' : '还没有妆容项目'} description={query || mode !== 'all' ? '试试其他关键词或筛选条件。' : '创建第一个妆容项目，保存模特、参考图和你的创作设定。'}><Button variant="primary" onClick={onNew}><Plus size={16} />创建第一个项目</Button></EmptyState></div>}
    {removeId && <ConfirmModal title="删除这个项目？" description="该项目的创作参数、文案与排期草稿会被删除。作品库中的图片会保留。" onClose={() => setRemoveId(null)} onConfirm={() => { store.removeProject(removeId); setRemoveId(null); notify('项目已删除') }} />}
  </>
}
