import { lazy, Suspense, useEffect, useState } from 'react'
import Shell from './components/Shell'
import ProjectDialog from './components/ProjectDialog'
import { ToastProvider } from './components/ui'
import { useWorkspace } from './stores/workspace'
import Studio from './features/Studio'
import Projects from './features/Projects'
import Assets from './features/Assets'
import Models from './features/Models'
import Copywriting from './features/Copywriting'
import Publishing from './features/Publishing'
import Settings from './features/Settings'
import type { Asset } from './lib/types'
import { BackendConnection } from './components/BackendConnection'

const Prompts = lazy(() => import('./features/Prompts'))
const QuickWorkflow = lazy(() => import('./features/QuickWorkflow'))
const AssetDetail = lazy(() => import('./components/AssetDetail'))

function WorkspaceApp() {
  const page = useWorkspace((s) => s.page)
  const [projectDialog, setProjectDialog] = useState<'new' | 'save' | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  useEffect(() => { window.scrollTo({ top: 0 }) }, [page])
  const newProject = () => setProjectDialog('new')
  return <Shell onNewProject={newProject}>
    <BackendConnection />
    {page === 'workflow' && <Suspense fallback={<p className="quality-explanation">正在打开快速工作流…</p>}><QuickWorkflow onSave={() => setProjectDialog('save')} onOpenAsset={setSelectedAsset} /></Suspense>}
    {page === 'studio' && <Studio onSave={() => setProjectDialog('save')} onOpenAsset={setSelectedAsset} />}
    {page === 'projects' && <Projects onNew={newProject} />}
    {page === 'assets' && <Assets onOpenAsset={setSelectedAsset} />}
    {page === 'models' && <Models />}
    {page === 'prompts' && <Suspense fallback={<p className="quality-explanation">正在打开提示词中心…</p>}><Prompts /></Suspense>}
    {page === 'copywriting' && <Copywriting />}
    {page === 'publishing' && <Publishing onNewProject={newProject} />}
    {page === 'settings' && <Settings />}
    {projectDialog && <ProjectDialog isNew={projectDialog === 'new'} onClose={() => setProjectDialog(null)} />}
    {selectedAsset && <Suspense fallback={null}><AssetDetail asset={selectedAsset} onClose={() => setSelectedAsset(null)} /></Suspense>}
  </Shell>
}

export default function App() { return <ToastProvider><WorkspaceApp /></ToastProvider> }
