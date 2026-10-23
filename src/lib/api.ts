import type { AIJob, ProviderStatus } from '../shared/contracts'
import type { WorkspaceData } from '../shared/contracts'
import type { Asset, WorkGroup } from './types'

export interface Snapshot { workspaceId: string; revision: number; state: WorkspaceData & { importedAssets: Asset[]; workGroups: WorkGroup[] } }
export class ApiError extends Error {
  code: string
  status: number
  snapshot?: Snapshot
  constructor(code: string, message: string, status: number, snapshot?: Snapshot) { super(message); this.code = code; this.status = status; this.snapshot = snapshot }
}
let csrf = ''
let connecting: Promise<void> | null = null
export async function connectSession() {
  if (!connecting) connecting = fetch('/api/session', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) }).then(async (response) => {
    if (!response.ok) throw new Error('session')
    const value = await response.json()
    csrf = value.csrf
  }).finally(() => { connecting = null })
  await connecting
}
export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!csrf) await connectSession()
  let response: Response
  try { response = await fetch('/api' + path, { ...init, credentials: 'same-origin', headers: { ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init.headers, 'X-YZ-CSRF': csrf }, signal: init.signal ?? AbortSignal.timeout(30000) }) }
  catch { throw new ApiError('NETWORK_ERROR', '本地服务暂不可用，当前修改仍保留在浏览器中。', 0) }
  let data: { error?: { code: string; message: string }; snapshot?: Snapshot }
  try { data = await response.json() } catch { throw new ApiError('SERVER_INVALID', '本地服务没有返回有效响应，请检查启动状态。', response.status) }
  if (response.status === 401 && retry) { csrf = ''; await connectSession(); return request(path, init, false) }
  if (!response.ok) throw new ApiError(data.error?.code ?? 'SERVER_ERROR', data.error?.message ?? '操作未完成，请重试。', response.status, data.snapshot)
  return data as T
}
export const api = {
  snapshot: () => request<Snapshot>('/workspace'),
  save: (revision: number, state: WorkspaceData) => request<Snapshot>('/workspace', { method: 'PUT', body: JSON.stringify({ revision, state }) }),
  assets: () => request<Asset[]>('/assets'),
  provider: () => request<ProviderStatus>('/provider'),
  jobs: () => request<AIJob[]>('/jobs'),
  image: (projectId: string | null, draft: WorkspaceData['draft']) => request<AIJob>('/jobs/images', { method: 'POST', body: JSON.stringify({ requestId: crypto.randomUUID(), projectId, draft }) }),
  captions: (groupId: string, languages: string[], assetIds?: string[]) => request<AIJob>('/jobs/captions', { method: 'POST', body: JSON.stringify({ requestId: crypto.randomUUID(), groupId, languages, ...(assetIds ? { assetIds } : {}) }) }),
}
