import type { AIJob, ProviderStatus } from '../shared/contracts'
import type { WorkspaceData } from '../shared/contracts'
import type { Asset, WorkGroup } from './types'
import type { AuthSession } from '../shared/auth'
import { useAuth } from '../stores/auth'

export interface Snapshot { workspaceId: string; revision: number; state: WorkspaceData & { importedAssets: Asset[]; workGroups: WorkGroup[] } }
export class ApiError extends Error {
  code: string
  status: number
  snapshot?: Snapshot
  constructor(code: string, message: string, status: number, snapshot?: Snapshot) { super(message); this.code = code; this.status = status; this.snapshot = snapshot }
}
let csrf = ''
let connecting: Promise<void> | null = null
export function acceptSession(session: AuthSession) { csrf = session.csrf; useAuth.setState({ ...session, ready: true }) }
const accountChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('yuezhuang-auth-changed') : null
if (accountChannel) accountChannel.onmessage = () => { void connectSession().catch(() => {}) }
export function changeAuthSession(session: AuthSession) { acceptSession(session); accountChannel?.postMessage('changed') }
export async function connectSession() {
  if (!connecting) connecting = fetch('/api/session', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) }).then(async (response) => {
    if (!response.ok) throw new Error('session')
    const value = await response.json()
    acceptSession(value)
  }).finally(() => { connecting = null })
  await connecting
}
export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!csrf) await connectSession()
  const identity = useAuth.getState().workspaceKey
  const response = await requestResponse(path, init, retry)
  const value = await response.json() as T
  if (identity !== useAuth.getState().workspaceKey) throw new ApiError('ACCOUNT_CHANGED', '账号已切换，请在当前工作空间重新操作。', 409)
  return value
}
export async function requestResponse(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  if (!csrf) await connectSession()
  const scope = useAuth.getState().workspaceKey
  let response: Response
  try { response = await fetch('/api' + path, { ...init, credentials: 'same-origin', headers: { ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init.headers, 'X-YZ-CSRF': csrf, 'X-YZ-Workspace': scope }, signal: init.signal ?? AbortSignal.timeout(30000) }) }
  catch { throw new ApiError('NETWORK_ERROR', '本地服务暂不可用，当前修改仍保留在浏览器中。', 0) }
  if (useAuth.getState().workspaceKey !== scope) throw new ApiError('ACCOUNT_CHANGED', '账号已切换，请在当前账号中重新操作。', 409)
  if (response.ok) return response
  let data: { error?: { code: string; message: string }; snapshot?: Snapshot }
  try { data = await response.json() } catch { throw new ApiError('SERVER_INVALID', '本地服务没有返回有效响应，请检查启动状态。', response.status) }
  if (retry && (data.error?.code === 'SESSION_REQUIRED' || data.error?.code === 'CSRF_REJECTED')) {
    csrf = ''; await connectSession()
    if (scope !== useAuth.getState().workspaceKey) throw new ApiError('ACCOUNT_CHANGED', '会话已改变，请在当前工作空间重新操作。', 409)
    return requestResponse(path, init, false)
  }
  if (data.error?.code === 'AUTH_REQUIRED') useAuth.getState().open('login', data.error.message)
  if (data.error?.code === 'ACCOUNT_CHANGED') { await connectSession(); window.dispatchEvent(new Event('workspace-account-changed')) }
  throw new ApiError(data.error?.code ?? 'SERVER_ERROR', data.error?.message ?? '操作未完成，请重试。', response.status, data.snapshot)
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
