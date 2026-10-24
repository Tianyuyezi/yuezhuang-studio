import { AppError } from '../errors'
import type { InstagramConfig } from '../../src/shared/instagram'

export interface InstagramProfile { id: string; username: string; accountType: string }
export interface InstagramToken { access_token: string; expires_in: number }
export interface InstagramAPI {
  profile(token: string, version: string): Promise<InstagramProfile>
  limit(token: string, version: string, accountId: string): Promise<{ used: number; total: number }>
  exchange(code: string, config: InstagramConfig, secret: string): Promise<InstagramToken>
  refresh(token: string): Promise<InstagramToken>
  create(token: string, version: string, accountId: string, params: Record<string, string>): Promise<string>
  status(token: string, version: string, containerId: string): Promise<string>
  publish(token: string, version: string, accountId: string, containerId: string): Promise<string>
  permalink(token: string, version: string, mediaId: string): Promise<string | null>
}

// Fixed Meta hosts: credentials cannot be redirected to a configurable API server.
export class InstagramGraphAPI implements InstagramAPI {
  private async json(url: string | URL, init: RequestInit = {}): Promise<Record<string, any>> {
    let response: Response
    try { response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(25000) }) }
    catch { throw new AppError('INSTAGRAM_NETWORK', '无法连接 Instagram。请检查网络后回查发布状态。', 502) }
    let data: Record<string, any>
    try { data = await response.json() } catch { throw new AppError('INSTAGRAM_RESPONSE', 'Instagram 返回了无法识别的结果，请回查状态。', 502) }
    if (!response.ok || data.error) {
      const code = Number(data.error?.code)
      // Never expose upstream messages, request URLs, authorization codes or tokens.
      if (code === 190 || response.status === 401) throw new AppError('INSTAGRAM_AUTH', 'Instagram 授权已失效，请重新连接账号。', 401)
      if ([10, 200].includes(code) || response.status === 403) throw new AppError('INSTAGRAM_PERMISSION', '账号尚未授予发布权限，请检查专业账号和应用权限后重新授权。', 403)
      if ([4, 17, 32, 613].includes(code) || response.status === 429) throw new AppError('INSTAGRAM_LIMIT', 'Instagram 暂时限制了请求，请稍后再试。', 429)
      throw new AppError('INSTAGRAM_REJECTED', 'Instagram 未接受请求，请检查应用授权、图片公开地址及发布额度。', 502)
    }
    return data
  }
  private graph(token: string, version: string, path: string, params: Record<string, string>, method = 'GET') {
    const url = new URL(`https://graph.instagram.com/${version}/${path}`)
    if (method === 'GET') url.search = new URLSearchParams(params).toString()
    return this.json(url, { method, headers: { Authorization: `Bearer ${token}` }, ...(method === 'POST' ? { body: new URLSearchParams(params) } : {}) })
  }
  private id(value: unknown) {
    const id = String(value ?? '')
    if (!/^\d{1,40}$/.test(id)) throw new AppError('INSTAGRAM_RESPONSE', 'Instagram 没有返回有效的记录编号。', 502)
    return id
  }
  async profile(token: string, version: string) {
    const response = await this.graph(token, version, 'me', { fields: 'user_id,username,account_type' })
    const data = response.data?.[0] ?? response
    const accountType = typeof data.account_type === 'string' ? data.account_type.toUpperCase() : ''
    if (!['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'].includes(accountType)) throw new AppError('INSTAGRAM_PROFESSIONAL', '请先将 Instagram 切换为商业或创作者账号。')
    if (typeof data.username !== 'string' || !/^[A-Za-z0-9._]{1,60}$/.test(data.username)) throw new AppError('INSTAGRAM_RESPONSE', '无法读取 Instagram 用户名。', 502)
    return { id: this.id(data.user_id ?? data.id), username: data.username, accountType }
  }
  async limit(token: string, version: string, id: string) {
    const data = await this.graph(token, version, `${id}/content_publishing_limit`, { fields: 'config,quota_usage' })
    const value = data.data?.[0]
    if (!value || typeof value.quota_usage !== 'number' || typeof value.config?.quota_total !== 'number') throw new AppError('INSTAGRAM_RESPONSE', '无法确认 Instagram 发布额度。', 502)
    return { used: value.quota_usage, total: value.config.quota_total }
  }
  async exchange(code: string, config: InstagramConfig, secret: string) {
    const body = new FormData()
    for (const [key, value] of Object.entries({ client_id: config.appId, client_secret: secret, grant_type: 'authorization_code', redirect_uri: `${config.publicBaseUrl}/instagram/callback`, code })) body.append(key, value)
    const response = await this.json('https://api.instagram.com/oauth/access_token', { method: 'POST', body })
    const short = response.data?.[0] ?? response
    if (typeof short.access_token !== 'string') throw new AppError('INSTAGRAM_RESPONSE', 'Instagram 授权交换失败，请重新连接。', 502)
    const url = new URL('https://graph.instagram.com/access_token')
    url.search = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: secret, access_token: short.access_token }).toString()
    return this.token(await this.json(url))
  }
  private token(data: Record<string, any>): InstagramToken {
    if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new AppError('INSTAGRAM_RESPONSE', 'Instagram 没有返回有效的授权期限。', 502)
    return { access_token: data.access_token, expires_in: data.expires_in }
  }
  async refresh(token: string) {
    const url = new URL('https://graph.instagram.com/refresh_access_token')
    url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token }).toString()
    return this.token(await this.json(url))
  }
  async create(token: string, version: string, accountId: string, params: Record<string, string>) { return this.id((await this.graph(token, version, `${accountId}/media`, params, 'POST')).id) }
  async status(token: string, version: string, containerId: string) { return String((await this.graph(token, version, containerId, { fields: 'status_code' })).status_code) }
  async publish(token: string, version: string, accountId: string, containerId: string) { return this.id((await this.graph(token, version, `${accountId}/media_publish`, { creation_id: containerId }, 'POST')).id) }
  async permalink(token: string, version: string, mediaId: string) {
    const data = await this.graph(token, version, mediaId, { fields: 'permalink' })
    if (typeof data.permalink !== 'string') return null
    try { const url = new URL(data.permalink); return url.protocol === 'https:' && ['www.instagram.com', 'instagram.com'].includes(url.hostname) ? url.href : null } catch { return null }
  }
}
