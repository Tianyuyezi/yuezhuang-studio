import { clearWorkspace, useWorkspace } from '../stores/workspace'
import { useBackend } from '../stores/backend'
import { useAuth } from '../stores/auth'
import { workspaceSchema } from '../shared/contracts'
import type { WorkspaceData } from '../shared/contracts'
import { api, ApiError, connectSession } from './api'
import type { Snapshot } from './api'
import { mergeThreeWay, reconcileWorkspace } from './merge'

let baseline: WorkspaceData | null = null
let revision = 0, epoch = 0
let workspaceId = '', scope = ''
let applying = false
let saving: Promise<void> | null = null, initialized: Promise<void> | null = null
let timer: ReturnType<typeof setTimeout> | undefined
const cacheKey = (key: string) => `yuezhuang-account-workspace-v1:${key}`
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function data(): WorkspaceData { return workspaceSchema.parse({ ...useWorkspace.getState(), page: baseline?.page ?? useWorkspace.getState().page }) }
function current(run: number) { if (run !== epoch || scope !== useAuth.getState().workspaceKey) throw new ApiError('ACCOUNT_CHANGED', '账号已切换，旧页面的修改不会写入当前工作空间。', 409) }
function checkpoint() {
  if (!baseline || !workspaceId || scope !== useAuth.getState().workspaceKey) return
  try { localStorage.setItem(cacheKey(scope), JSON.stringify({ workspaceId, baseline, state: data() })) }
  catch { window.dispatchEvent(new CustomEvent('workspace-storage-error')) }
}
function apply(snapshot: Snapshot, state: WorkspaceData) {
  applying = true
  try { useWorkspace.setState({ ...state, page: useWorkspace.getState().page, importedAssets: snapshot.state.importedAssets, workGroups: snapshot.state.workGroups }) }
  finally { applying = false }
}
export async function flushWorkspace() {
  if (timer) clearTimeout(timer)
  if (!baseline || useBackend.getState().status !== 'ready') throw new ApiError('BACKEND_OFFLINE', '工作空间尚未就绪，请稍后再试。', 503)
  const run = epoch
  current(run)
  if (saving) { await saving; current(run); if (same(data(), baseline)) return }
  const task = (async () => {
    useBackend.setState({ saving: true })
    try {
      for (let retries = 0; retries < 5; retries++) {
        current(run)
        const sent = data()
        if (same(sent, baseline)) break
        let snapshot: Snapshot
        try { snapshot = await api.save(revision, sent) }
        catch (error) {
          current(run)
          if (!(error instanceof ApiError) || error.code !== 'VERSION_CONFLICT' || !error.snapshot) throw error
          snapshot = error.snapshot
          const merged = reconcileWorkspace(workspaceSchema.parse(mergeThreeWay(baseline, data(), snapshot.state)), snapshot.state.importedAssets)
          baseline = workspaceSchema.parse(snapshot.state); revision = snapshot.revision; apply(snapshot, merged); checkpoint(); continue
        }
        current(run)
        const latest = data()
        baseline = workspaceSchema.parse(snapshot.state); revision = snapshot.revision
        apply(snapshot, same(latest, sent) ? baseline : workspaceSchema.parse(mergeThreeWay(sent, latest, baseline)))
        checkpoint()
      }
      if (!same(data(), baseline)) throw new ApiError('SYNC_BUSY', '资料持续更新中，请稍后重试保存。', 409)
      useBackend.setState({ error: null })
    } catch (error) {
      if (run === epoch) useBackend.setState({ error: error instanceof Error ? error.message : '保存未完成。' })
      throw error
    } finally { if (run === epoch) useBackend.setState({ saving: false }) }
  })().finally(() => { if (run === epoch) saving = null })
  saving = task
  await task
}
export async function refreshWorkspace() {
  if (!baseline || useBackend.getState().status !== 'ready' || saving) return
  const run = epoch, snapshot = await api.snapshot()
  current(run)
  if (snapshot.revision === revision) {
    applying = true; useWorkspace.setState({ importedAssets: snapshot.state.importedAssets, workGroups: snapshot.state.workGroups }); applying = false; return
  }
  const merged = reconcileWorkspace(workspaceSchema.parse(mergeThreeWay(baseline, data(), snapshot.state)), snapshot.state.importedAssets)
  baseline = workspaceSchema.parse(snapshot.state); revision = snapshot.revision; apply(snapshot, merged); checkpoint()
  if (!same(merged, baseline)) void flushWorkspace().catch(() => {})
}
export function initializeBackend(): Promise<void> {
  if (initialized) return initialized
  const run = epoch
  initialized = (async () => {
    useBackend.setState({ status: 'connecting', error: null })
    await connectSession()
    if (run !== epoch) return
    scope = useAuth.getState().workspaceKey
    if (!scope) throw new ApiError('AUTH_SETUP', '账号服务尚未就绪，请等待项目重新连接。', 503)
    const snapshot = await api.snapshot(); current(run)
    workspaceId = snapshot.workspaceId
    // Legacy anonymous caches belonged to the owner. Never import them into a visitor or another account.
    localStorage.removeItem('yuezhuang-workspace-v1'); localStorage.removeItem('yuezhuang-server-checkpoint-v1')
    let merged = workspaceSchema.parse(snapshot.state)
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey(scope)) ?? 'null')
      if (cached?.workspaceId === workspaceId && workspaceSchema.safeParse(cached.baseline).success && workspaceSchema.safeParse(cached.state).success) merged = reconcileWorkspace(workspaceSchema.parse(mergeThreeWay(cached.baseline, cached.state, snapshot.state)), snapshot.state.importedAssets)
    } catch { /* The server remains authoritative if the optional local checkpoint is invalid. */ }
    baseline = workspaceSchema.parse(snapshot.state); revision = snapshot.revision; apply(snapshot, merged); checkpoint()
    const provider = await api.provider(); current(run)
    useBackend.setState({ status: 'ready', provider, error: null })
    if (!same(data(), baseline)) await flushWorkspace()
  })().catch((error) => {
    if (run !== epoch) return
    useBackend.setState({ status: 'offline', error: error instanceof Error ? error.message : '无法连接工作空间。' }); initialized = null
  })
  return initialized
}
function changeWorkspace() {
  const oldScope = scope
  epoch++; if (timer) clearTimeout(timer)
  if (oldScope.startsWith('user-')) localStorage.removeItem(cacheKey(oldScope))
  baseline = null; revision = 0; workspaceId = ''; scope = ''; saving = null; initialized = null
  useBackend.setState({ status: 'connecting', saving: false, error: null, provider: null, jobs: [], pendingSubmissions: 0 })
  applying = true; clearWorkspace(); applying = false
  void initializeBackend()
}
useAuth.subscribe((state, previous) => { if (previous.workspaceKey && state.workspaceKey !== previous.workspaceKey) changeWorkspace() })
window.addEventListener('workspace-account-changed', changeWorkspace)
useWorkspace.subscribe(() => {
  if (applying || useBackend.getState().status !== 'ready' || !baseline || scope !== useAuth.getState().workspaceKey) return
  checkpoint()
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void flushWorkspace().catch(() => {}) }, 350)
})
