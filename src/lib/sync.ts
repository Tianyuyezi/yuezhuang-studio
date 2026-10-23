import { useWorkspace } from '../stores/workspace'
import { useBackend } from '../stores/backend'
import { workspaceSchema } from '../shared/contracts'
import type { WorkspaceData } from '../shared/contracts'
import { api, ApiError, connectSession, request } from './api'
import type { Snapshot } from './api'
import { getLegacyImageBlob } from './storage'
import type { Asset } from './types'
import { mergeThreeWay, reconcileWorkspace } from './merge'

let baseline: WorkspaceData | null = null
let revision = 0
let workspaceId = ''
let applying = false
let saving: Promise<void> | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let initialized: Promise<void> | null = null

function data(): WorkspaceData { return workspaceSchema.parse({ ...useWorkspace.getState(), page: baseline?.page ?? useWorkspace.getState().page }) }
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b) }

function checkpoint() {
  if (!baseline || !workspaceId) return
  try { localStorage.setItem('yuezhuang-server-checkpoint-v1', JSON.stringify({ workspaceId, state: baseline })) }
  catch { window.dispatchEvent(new CustomEvent('workspace-storage-error')) }
}

function apply(snapshot: Snapshot, state?: WorkspaceData) {
  applying = true
  // Navigation belongs to this window; background tasks must not move the page.
  try { useWorkspace.setState({ ...(state ?? snapshot.state), page: useWorkspace.getState().page, importedAssets: snapshot.state.importedAssets, workGroups: snapshot.state.workGroups }) }
  finally { applying = false }
}

export async function flushWorkspace() {
  if (timer) clearTimeout(timer)
  if (!baseline || useBackend.getState().status !== 'ready') throw new ApiError('BACKEND_OFFLINE', '本地服务尚未就绪，请稍后重试。', 503)
  if (saving) { await saving; if (same(data(), baseline)) return }
  saving = (async () => {
    useBackend.setState({ saving: true })
    try {
      for (let retries = 0; retries < 5; retries++) {
        const sent = data()
        if (same(sent, baseline)) break
        let snapshot: Snapshot
        try { snapshot = await api.save(revision, sent) }
        catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'VERSION_CONFLICT' || !error.snapshot) throw error
          snapshot = error.snapshot
          const merged = reconcileWorkspace(workspaceSchema.parse(mergeThreeWay(baseline, data(), snapshot.state)), snapshot.state.importedAssets)
          baseline = workspaceSchema.parse(snapshot.state); revision = snapshot.revision; apply(snapshot, merged)
          checkpoint()
          continue
        }
        baseline = workspaceSchema.parse(snapshot.state); revision = snapshot.revision
        checkpoint()
        const current = data()
        apply(snapshot, same(current, sent) ? baseline : workspaceSchema.parse(mergeThreeWay(sent, current, baseline)))
      }
      if (!same(data(), baseline)) throw new ApiError('SYNC_BUSY', '资料持续更新中，请稍后重试保存。', 409)
      useBackend.setState({ error: null })
    } catch (error) {
      useBackend.setState({ error: error instanceof Error ? error.message : '本地保存未完成。' })
      throw error
    } finally { useBackend.setState({ saving: false }) }
  })().finally(() => { saving = null })
  await saving
}

export async function refreshWorkspace() {
  if (!baseline || useBackend.getState().status !== 'ready') return
  if (saving) return
  const snapshot = await api.snapshot()
  if (snapshot.revision === revision) {
    applying = true
    useWorkspace.setState({ importedAssets: snapshot.state.importedAssets, workGroups: snapshot.state.workGroups })
    applying = false
    return
  }
  const merged = reconcileWorkspace(workspaceSchema.parse(mergeThreeWay(baseline, data(), snapshot.state)), snapshot.state.importedAssets)
  baseline = workspaceSchema.parse(snapshot.state); revision = snapshot.revision; apply(snapshot, merged)
  checkpoint()
  if (!same(merged, baseline)) void flushWorkspace().catch(() => {})
}

export function initializeBackend() {
  if (initialized) return initialized
  initialized = (async () => {
    useBackend.setState({ status: 'connecting', error: null })
    await connectSession()
    const snapshot = await api.snapshot()
    let local = data()
    let merged = snapshot.state as WorkspaceData
    workspaceId = snapshot.workspaceId
    let previous: { workspaceId: string; state: WorkspaceData } | null = null
    try { const saved = JSON.parse(localStorage.getItem('yuezhuang-server-checkpoint-v1') ?? 'null'); if (saved?.workspaceId && workspaceSchema.safeParse(saved.state).success) previous = saved } catch { /* Preserve the primary draft even if the optional checkpoint is corrupt. */ }
    const hasLocalData = local.projects.length || local.customModels.length || local.draft.prompt || local.favorites.length || useWorkspace.getState().importedAssets.length || local.settings.studioName !== '悦妆工作室' || local.settings.artistName !== '工作室主理人'
    if (previous?.workspaceId !== snapshot.workspaceId && hasLocalData) {
      const assets: Asset[] = []
      for (const asset of useWorkspace.getState().importedAssets) {
        const existing = snapshot.state.importedAssets.find((a) => a.id === asset.id)
        if (existing) { assets.push(existing); continue }
        const blob = await getLegacyImageBlob(asset.id)
        if (!blob) throw new ApiError('MIGRATION_IMAGE_MISSING', `旧素材「${asset.title}」的文件缺失，原草稿已保留。请重新导入图片。`, 409)
        assets.push(await request<Asset>(`/assets?id=${asset.id}`, { method: 'POST', headers: { 'Content-Type': blob.type, 'X-YZ-Filename': encodeURIComponent(`${asset.title}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`) }, body: blob }))
      }
      local = data()
      // First connection imports this browser's existing projects without discarding server projects.
      const projects = [...snapshot.state.projects.filter((p) => !local.projects.some((l) => l.id === p.id)), ...local.projects]
      const models = [...snapshot.state.customModels.filter((p) => !local.customModels.some((l) => l.id === p.id)), ...local.customModels]
      const draftPlans = [...snapshot.state.publishDrafts.filter((p) => !local.publishDrafts.some((l) => l.id === p.id)), ...local.publishDrafts]
      const saved = await api.save(snapshot.revision, { ...local, projects, customModels: models, publishDrafts: draftPlans, captions: { ...snapshot.state.captions, ...local.captions }, groupCaptions: { ...snapshot.state.groupCaptions, ...local.groupCaptions }, favorites: [...new Set([...snapshot.state.favorites, ...local.favorites])] })
      merged = workspaceSchema.parse(saved.state); revision = saved.revision; baseline = merged; apply(saved, merged)
    } else {
      merged = previous?.workspaceId === snapshot.workspaceId ? reconcileWorkspace(workspaceSchema.parse(mergeThreeWay(previous.state, local, snapshot.state)), snapshot.state.importedAssets) : workspaceSchema.parse(snapshot.state)
      revision = snapshot.revision; baseline = workspaceSchema.parse(snapshot.state); apply(snapshot, merged)
    }
    checkpoint()
    const provider = await api.provider()
    useBackend.setState({ status: 'ready', provider, error: null })
    if (!same(data(), baseline)) await flushWorkspace()
  })().catch((error) => {
    useBackend.setState({ status: 'offline', error: error instanceof Error ? error.message : '无法连接本地服务。' })
    initialized = null
  })
  return initialized
}

useWorkspace.subscribe(() => {
  if (applying || useBackend.getState().status !== 'ready' || !baseline) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void flushWorkspace().catch(() => {}) }, 350)
})
