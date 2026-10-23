import { ArrowDownToLine, ArrowUpRight, BookOpen, CalendarDays, ChevronDown, ChevronRight, CircleHelp, Command, Feather, FolderOpen, Images, LayoutGrid, Menu, Search, Settings2, UsersRound, Image, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useWorkspace } from '../stores/workspace'
import { useBackend } from '../stores/backend'
import { useAssets, useModels } from '../lib/hooks'
import type { PageId } from '../lib/types'
import { AssetImage, Button, IconButton, Modal } from './ui'

const NAV: { id: PageId; label: string; icon: typeof Image }[] = [
  { id: 'studio', label: '图片工作台', icon: Image },
  { id: 'projects', label: '妆容项目', icon: FolderOpen },
  { id: 'assets', label: '作品库', icon: Images },
  { id: 'models', label: '虚拟模特', icon: UsersRound },
  { id: 'prompts', label: '提示词中心', icon: BookOpen },
  { id: 'copywriting', label: '三语文案', icon: Feather },
  { id: 'publishing', label: '发布排期', icon: CalendarDays },
]

export default function Shell({ children, onNewProject }: { children: ReactNode; onNewProject: () => void }) {
  const store = useWorkspace()
  const backend = useBackend()
  const [searchOpen, setSearchOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [query, setQuery] = useState('')
  const assets = useAssets()
  const models = useModels()
  const current = NAV.find((n) => n.id === store.page)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen((open) => !open) } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
  const navigate = (page: PageId) => { store.setPage(page); setMobileOpen(false); window.scrollTo({ top: 0 }) }
  const matchingProjects = store.projects.filter((p) => !query || p.title.toLowerCase().includes(query.toLowerCase()))
  const matchingAssets = assets.filter((a) => query && `${a.title}${a.style}`.toLowerCase().includes(query.toLowerCase()))
  const matchingModels = models.filter((m) => query && `${m.name}${m.tags.join('')}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="app-shell">
    {mobileOpen && <button aria-label="关闭导航" className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <a className="brand" href="#studio" onClick={(e) => { e.preventDefault(); navigate('studio') }}><span className="brand-name">悦妆师<small>影像与内容工作室</small></span></a>
      <button className="workspace-switch" onClick={() => navigate('settings')}><span className="workspace-avatar"><LayoutGrid size={17} /></span><span>{store.settings.studioName}<small>本地工作空间</small></span><ChevronDown size={14} /></button>
      <span className="nav-heading">工作室</span>
      <nav aria-label="工作台导航">{NAV.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${store.page === id ? 'active' : ''}`} onClick={() => navigate(id)} aria-current={store.page === id ? 'page' : undefined}><Icon size={19} strokeWidth={1.6} /><span>{label}</span>{id === 'projects' && store.projects.length > 0 && <span className="nav-count">{store.projects.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="workspace-note"><span>工作室资料</span><p>{store.projects.length} 个项目 · {store.importedAssets.length} 张素材</p></div><button className={`nav-item ${store.page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18} /><span>设置与连接</span></button><button className="nav-item muted" onClick={() => setHelpOpen(true)}><CircleHelp size={18} /><span>使用指南</span><ArrowUpRight size={14} /></button><div className="sidebar-version"><span className="status-dot" />本地工作台 <span>预览</span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><IconButton label="展开导航" className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></IconButton><span className="breadcrumb-root">工作空间</span><ChevronRight size={13} /><span>{current?.label ?? '设置与连接'}</span></div><div className="topbar-actions"><button className="global-search" onClick={() => setSearchOpen(true)}><Search size={15} /><span>搜索项目或素材</span><kbd><Command size={10} /> K</kbd></button><span className="prototype-label">本地测试</span><button className="profile-avatar" onClick={() => navigate('settings')} aria-label="工作室设置">悦</button></div></header><main className="main-content" key={store.page}>{children}</main><footer className="app-footer"><span>悦妆师工作台</span><span><span className="status-dot" />{backend.status !== 'ready' ? '等待本地服务' : backend.saving ? '正在保存…' : backend.error ? '部分修改等待保存' : '资料已保存到本机'}<span className="footer-separator">/</span>{backend.provider?.hasKey ? 'AI 已配置 · 发布待接入' : 'AI 服务待配置'}</span></footer></div>
    <Modal open={searchOpen} onOpenChange={setSearchOpen} title="搜索工作空间" description="搜索项目、素材名称或妆容风格。"><div className="search-dialog-input"><Search size={19} /><input autoFocus placeholder="输入关键词…" value={query} onChange={(e) => setQuery(e.target.value)} /><IconButton label="清除搜索" onClick={() => setQuery('')}><X size={15} /></IconButton></div><div className="search-results">{matchingProjects.map((p) => <button key={p.id} onClick={() => { store.openProject(p.id); setSearchOpen(false) }}><FolderOpen size={18} /><span>{p.title}<small>妆容项目</small></span><ChevronRight size={15} /></button>)}{matchingAssets.slice(0, 5).map((a) => <button key={a.id} onClick={() => { store.updateDraft({ referenceId: a.id }); navigate('studio'); setSearchOpen(false) }}><AssetImage asset={a} /><span>{a.title}<small>用作创作参考 · {a.style}</small></span><ChevronRight size={15} /></button>)}{matchingModels.map((m) => <button key={m.id} onClick={() => { store.updateDraft({ modelId: m.id }); navigate('studio'); setSearchOpen(false) }}><UsersRound size={18} /><span>{m.name}<small>模特参考档案</small></span><ChevronRight size={15} /></button>)}{!matchingProjects.length && !matchingAssets.length && !matchingModels.length && <div className="search-no-results">{query ? '没有找到匹配的内容，试试其他关键词。' : '从新建第一个妆容项目开始吧。'}</div>}</div><Button className="full-width" onClick={() => { setSearchOpen(false); onNewProject() }}>新建妆容项目<ArrowUpRight size={16} /></Button></Modal>
    <Modal open={helpOpen} onOpenChange={setHelpOpen} title="工作台使用说明" description="项目、图片、文案与发布排期的基本操作。"><div className="help-steps">{[['01', '选择模特与妆容', '在创作台选择参考模特、妆容风格与画幅，写下你的创作想法。'], ['02', '整理成妆容项目', '保存项目，导入参考图。草稿保存到本机数据库，图片原图保存在本机。'], ['03', '编辑三语文案', '为项目分别填写中文、英文和韩文文案，锁定满意的版本。'], ['04', '准备好，再发布', '排期目前仅保存草稿；AI 生成可在设置中配置；Instagram 正式授权稍后接入。']].map(([n, title, body]) => <div key={n}><span>{n}</span><section><h3>{title}</h3><p>{body}</p></section></div>)}</div><div className="info-note"><BookOpen size={17} /><span>照片示例来自 Unsplash，不是 AI 生成结果。项目与素材已连接本地数据库，可在设置中导出完整备份。</span></div><Button className="full-width" onClick={() => { setHelpOpen(false); navigate('settings') }}><ArrowDownToLine size={16} />查看草稿导出</Button></Modal>
  </div>
}
