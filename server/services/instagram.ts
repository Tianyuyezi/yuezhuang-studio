import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { AppError, safeMessage } from '../errors'
import type { StudioDatabase } from '../database/client'
import type { Keychain } from '../security/keychain'
import type { AssetService } from './assets'
import { InstagramGraphAPI } from '../providers/instagram'
import type { InstagramAPI } from '../providers/instagram'
import { instagramConfigSchema } from '../../src/shared/instagram'
import type { InstagramAccount, InstagramConfig, InstagramPublication, InstagramState } from '../../src/shared/instagram'
import { publicationBrandingSchema, publicationCaption } from '../../src/shared/publication-branding'
import { publicationImage, publicationWatermark } from './publication-image'

const SECRET = 'instagram://app-secret', MEDIA_KEY = 'instagram://media-signing-key'
const credential = (id: string) => `instagram://account/${id}`
const ACTIVE = ['preparing', 'publishing', 'uncertain']
const hour = 3600000
export class InstagramService {
  private pendingOAuth = new Map<string, { expires: number; config: InstagramConfig }>()
  hasOAuthState(state: string) { return this.pendingOAuth.has(state) }
  private timer: ReturnType<typeof setInterval> | null = null
  private running = new Set<string>()
  private stopping = false
  constructor(private database: StudioDatabase, private assets: AssetService, private keys: Keychain, private api: InstagramAPI = new InstagramGraphAPI(), private pollMs = 60000) {}
  config(): InstagramConfig { return instagramConfigSchema.parse(JSON.parse((this.database.sqlite.prepare('SELECT payload FROM instagram_config WHERE id=1').get() as { payload: string }).payload)) }
  accounts(): InstagramAccount[] { return (this.database.sqlite.prepare('SELECT payload FROM instagram_accounts ORDER BY id').all() as { payload: string }[]).map((row) => JSON.parse(row.payload)) }
  publications(): InstagramPublication[] { return (this.database.sqlite.prepare('SELECT payload FROM instagram_publications ORDER BY updated_at DESC ').all() as { payload: string }[]).map((row) => JSON.parse(row.payload)) }
  get(id: string): InstagramPublication {
    const row = this.database.sqlite.prepare('SELECT payload FROM instagram_publications WHERE id=?').get(id) as { payload: string } | undefined
    if (!row) throw new AppError('NOT_FOUND', '发布记录不存在。', 404)
    return JSON.parse(row.payload)
  }
  private put(value: InstagramPublication) { value.updatedAt = Date.now(); this.database.sqlite.prepare('UPDATE instagram_publications SET payload=?,status=?,updated_at=? WHERE id=?').run(JSON.stringify(value), value.status, value.updatedAt, value.id); return value }
  private account(value: InstagramAccount) { this.database.sqlite.prepare('INSERT INTO instagram_accounts(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(value.id, JSON.stringify(value)); return value }
  async state(): Promise<InstagramState> { return { config: this.config(), hasAppSecret: !!await this.keys.get(SECRET), accounts: this.accounts(), publications: this.publications().slice(0, 100), credentialStorage: this.keys.storage } }
  async configure(config: InstagramConfig, secret?: string) {
    if (secret) await this.keys.set(SECRET, secret)
    this.database.sqlite.prepare('UPDATE instagram_config SET payload=? WHERE id=1').run(JSON.stringify({ ...config, publicBaseUrl: config.publicBaseUrl.replace(/\/+$/, '') }))
    this.pendingOAuth.clear()
    this.database.audit('instagram.configure')
    return this.state()
  }
  async connect(token: string, expiresAt: number | null = null) {
    const profile = await this.api.profile(token, this.config().apiVersion)
    await this.api.limit(token, this.config().apiVersion, profile.id)
    await this.keys.set(credential(profile.id), token)
    const existing = this.accounts().find((a) => a.id === profile.id)
    const account = this.account({ ...profile, connectedAt: existing?.connectedAt ?? Date.now(), refreshedAt: Date.now(), expiresAt })
    this.database.audit('instagram.connect', profile.id)
    return account
  }
  async disconnect(id: string) {
    if (this.publications().some((p) => p.accountId === id && ACTIVE.includes(p.status))) throw new AppError('INSTAGRAM_BUSY', '请先核实正在提交或结果待核实的帖子，再断开账号。', 409)
    await this.keys.remove(credential(id))
    for (const item of this.publications().filter((p) => p.accountId === id && p.status === 'scheduled')) this.put({ ...item, status: 'cancelled', error: '账号已断开，预约已取消。' })
    this.database.sqlite.prepare('DELETE FROM instagram_accounts WHERE id=?').run(id)
    this.database.audit('instagram.disconnect', id)
    return this.state()
  }
  private async token(id: string) {
    let account = this.accounts().find((a) => a.id === id)
    let token = await this.keys.get(credential(id))
    if (!account || !token || (account.expiresAt !== null && account.expiresAt <= Date.now())) throw new AppError('INSTAGRAM_AUTH', '请重新连接 Instagram 专业账号。', 401)
    if (account.expiresAt && account.expiresAt < Date.now() + 7 * 24 * hour && account.refreshedAt < Date.now() - 24 * hour) {
      const result = await this.api.refresh(token)
      await this.keys.set(credential(id), result.access_token)
      token = result.access_token
      account = this.account({ ...account, expiresAt: Date.now() + result.expires_in * 1000, refreshedAt: Date.now() })
    }
    return token
  }
  async check(id: string) { const token = await this.token(id); const profile = await this.api.profile(token, this.config().apiVersion); if (profile.id !== id) throw new AppError('INSTAGRAM_AUTH', '授权账号不匹配，请重新连接。'); return this.api.limit(token, this.config().apiVersion, id) }
  async authorize() {
    const config = this.config()
    if (!config.appId || !config.publicBaseUrl || !await this.keys.get(SECRET)) throw new AppError('INSTAGRAM_CONFIG', '请先保存 Instagram App ID、App Secret 和 HTTPS 访问地址。')
    for (const [key, entry] of this.pendingOAuth) if (entry.expires < Date.now()) this.pendingOAuth.delete(key)
    if (this.pendingOAuth.size > 20) throw new AppError('INSTAGRAM_BUSY', '请先完成已打开的授权窗口。', 429)
    const state = randomBytes(32).toString('hex')
    this.pendingOAuth.set(state, { config, expires: Date.now() + 10 * 60000 })
    const url = new URL('https://www.instagram.com/oauth/authorize')
    url.search = new URLSearchParams({ client_id: config.appId, redirect_uri: `${config.publicBaseUrl}/instagram/callback`, response_type: 'code', scope: 'instagram_business_basic,instagram_business_content_publish', state, enable_fb_login: '0', force_authentication: '1' }).toString()
    return { url: url.href }
  }
  async callback(state: string, code: string, denied: boolean) {
    const pending = this.pendingOAuth.get(state)
    this.pendingOAuth.delete(state)
    if (!pending || pending.expires < Date.now()) throw new AppError('INSTAGRAM_STATE', '授权已过期或已使用，请回工作台重新连接。')
    if (denied) throw new AppError('INSTAGRAM_DENIED', '已取消授权，工作台没有连接该账号。')
    const secret = await this.keys.get(SECRET)
    if (!secret) throw new AppError('INSTAGRAM_CONFIG', '请重新保存应用凭据后连接。')
    const result = await this.api.exchange(code, pending.config, secret)
    return this.connect(result.access_token, Date.now() + result.expires_in * 1000)
  }
  private directory(id: string) { return join(this.database.dataDir, 'instagram', id) }
  async image(id: string, index: number) { const item = this.get(id); if (!Number.isInteger(index) || index < 0 || index >= item.assetIds.length) throw new AppError('NOT_FOUND', '图片不存在。', 404); return readFile(join(this.directory(id), `${index}.jpg`)) }
  private async signingKey() { let key = await this.keys.get(MEDIA_KEY); if (!key) { key = randomBytes(32).toString('hex'); await this.keys.set(MEDIA_KEY, key) }; return key }
  private async signature(item: InstagramPublication, index: number) { return createHmac('sha256', await this.signingKey()).update(`${item.id}/${index}/${item.publicUntil}`).digest('hex') }
  async publicImage(id: string, index: number, signature: string) {
    const item = this.get(id)
    if (!item.publicUntil || item.publicUntil < Date.now() || !/^[a-f0-9]{64}$/.test(signature)) throw new AppError('NOT_FOUND', '图片访问已失效。', 404)
    const expected = await this.signature(item, index)
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new AppError('NOT_FOUND', '图片访问已失效。', 404)
    return this.image(id, index)
  }
  async prepare(input: { requestId: string; draftId: string; accountId: string; aiGenerated: boolean }) {
    const sameRequest = this.database.sqlite.prepare('SELECT payload FROM instagram_publications WHERE request_id=?').get(input.requestId) as { payload: string } | undefined
    if (sameRequest) return JSON.parse(sameRequest.payload) as InstagramPublication
    if (!this.config().publicBaseUrl) throw new AppError('INSTAGRAM_MEDIA_URL', '请在连接设置中配置图片的公开 HTTPS 访问地址。')
    const account = this.accounts().find((a) => a.id === input.accountId)
    if (!account) throw new AppError('INSTAGRAM_AUTH', '请先连接 Instagram 专业账号。')
    const workspace = this.database.snapshot().state
    const draft = workspace.publishDrafts.find((d) => d.id === input.draftId)
    const group = this.database.groups().find((g) => g.id === draft?.groupId)
    if (!draft || !group || !draft.assetIds?.length || draft.assetIds.length > 20 || new Set(draft.assetIds).size !== draft.assetIds.length || draft.assetIds.some((id) => !group.assetIds.includes(id))) throw new AppError('INSTAGRAM_ASSETS', '请在快速工作流中选择同组的 1–20 张作品。')
    const branding = publicationBrandingSchema.parse(workspace.settings.publicationBranding ?? {})
    const caption = publicationCaption(draft.caption, draft.language, branding)
    if (!draft.caption.trim() || [...caption].length > 2200 || (caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0) > 30 || (caption.match(/@[a-zA-Z0-9._]+/g)?.length ?? 0) > 20) throw new AppError('INSTAGRAM_CAPTION', 'Instagram 文案（含底部联系信息）需为 1–2200 字符，最多 30 个话题和 20 个 @ 提及。')
    const aiGenerated = input.aiGenerated || this.database.assets().some((a) => draft.assetIds!.includes(a.id) && a.kind === 'generated')
    const fingerprint = createHash('sha256').update(JSON.stringify([account.id, draft.id, draft.assetIds, caption, aiGenerated, { version: 1, enabled: branding.watermarkEnabled, english: branding.watermarkEnglish, korean: branding.watermarkKorean }])).digest('hex')
    const duplicate = this.database.sqlite.prepare("SELECT payload FROM instagram_publications WHERE fingerprint=? AND status NOT IN ('failed','cancelled')").get(fingerprint) as { payload: string } | undefined
    if (duplicate) return JSON.parse(duplicate.payload) as InstagramPublication
    const id = randomUUID()
    const first = await sharp(this.assets.file(draft.assetIds[0]).path).rotate().metadata()
    const ratio = Math.min(1.91, Math.max(.8, (first.autoOrient?.width ?? first.width!) / (first.autoOrient?.height ?? first.height!)))
    const width = 1080, height = Math.ceil(width / ratio)
    await mkdir(this.directory(id), { recursive: true, mode: 0o700 })
    const watermark = await publicationWatermark(width, height, branding)
    for (const [index, assetId] of draft.assetIds.entries()) {
      const bytes = await publicationImage(this.assets.file(assetId).path, width, height, watermark)
      if (bytes.length > 8 * 1024 * 1024) throw new AppError('INSTAGRAM_IMAGE_SIZE', '适配后的图片超过 8 MB。')
      await writeFile(join(this.directory(id), `${index}.jpg`), bytes, { mode: 0o600 })
    }
    const item: InstagramPublication = { id, ...input, username: account.username, title: draft.title, caption, branding, assetIds: [...draft.assetIds], aiGenerated, fingerprint, width, height, status: 'preview', scheduledFor: null, createdAt: Date.now(), updatedAt: Date.now(), publishedAt: null, containerId: null, children: [], mediaId: null, permalink: null, error: null, publicUntil: null }
    // Concurrent preparation of identical snapshots returns the single winning record.
    try { this.database.sqlite.prepare('INSERT INTO instagram_publications(id,request_id,fingerprint,status,payload,updated_at) VALUES (?,?,?,?,?,?)').run(id, input.requestId, fingerprint, item.status, JSON.stringify(item), item.updatedAt) }
    catch (error) { const winner = this.database.sqlite.prepare("SELECT payload FROM instagram_publications WHERE request_id=? OR (fingerprint=? AND status NOT IN ('failed','cancelled'))").get(input.requestId, fingerprint) as { payload: string } | undefined; if (winner) return JSON.parse(winner.payload) as InstagramPublication; throw error }
    return item
  }
  confirm(id: string, fingerprint: string, scheduledFor?: string) {
    if (this.stopping) throw new AppError('INSTAGRAM_OFFLINE', 'Instagram 图片服务未运行，请检查本地图片服务端口后重启。', 503)
    const item = this.get(id)
    if (item.fingerprint !== fingerprint) throw new AppError('INSTAGRAM_PREVIEW', '发布预览已变动，请重新检查。', 409)
    if (['preparing', 'publishing', 'published', 'uncertain', 'scheduled'].includes(item.status)) return item
    if (!['preview', 'missed'].includes(item.status)) throw new AppError('INSTAGRAM_PREVIEW', '请重新准备发布预览。', 409)
    if (this.publications().some((p) => p.id !== id && p.accountId === item.accountId && ACTIVE.includes(p.status))) throw new AppError('INSTAGRAM_BUSY', '该账号还有正在提交或结果待核实的帖子，请先核实状态。', 409)
    if (scheduledFor) {
      const time = Date.parse(scheduledFor)
      if (time < Date.now() + 60000 || time > Date.now() + 30 * 24 * hour) throw new AppError('INSTAGRAM_SCHEDULE', '请选择 1 分钟后、30 天内的发布时间。')
      return this.put({ ...item, status: 'scheduled', scheduledFor, error: null })
    }
    const next = this.put({ ...item, status: 'preparing', scheduledFor: null, error: null })
    this.launch(id)
    return next
  }
  cancel(id: string) {
    const item = this.get(id)
    if (!['preview', 'scheduled', 'missed'].includes(item.status)) throw new AppError('INSTAGRAM_BUSY', '已经提交的帖子不能在这里取消，请先回查状态。', 409)
    return this.put({ ...item, status: 'cancelled' })
  }
  private launch(id: string) { if (this.running.has(id) || this.stopping) return; this.running.add(id); void this.run(id).finally(() => this.running.delete(id)) }
  private async waitReady(token: string, container: string, version: string) {
    for (let i = 0; i < 6; i++) {
      const status = await this.api.status(token, version, container)
      if (status === 'FINISHED') return
      if (status !== 'IN_PROGRESS') throw new AppError('INSTAGRAM_PROCESSING', 'Instagram 无法处理这组图片，请检查图片访问地址后重新准备。')
      if (i < 5) await new Promise((resolve) => setTimeout(resolve, this.pollMs))
      if (this.stopping) throw new AppError('INSTAGRAM_STOPPED', '本地服务已停止，尚未提交发布。')
    }
    throw new AppError('INSTAGRAM_PROCESSING', 'Instagram 图片处理超时，尚未提交发布。')
  }
  private async run(id: string) {
    let item = this.get(id)
    try {
      const token = await this.token(item.accountId), config = this.config()
      if (!config.publicBaseUrl) throw new AppError('INSTAGRAM_MEDIA_URL', '图片公开访问地址尚未配置。')
      const limit = await this.api.limit(token, config.apiVersion, item.accountId)
      if (limit.used >= limit.total) throw new AppError('INSTAGRAM_LIMIT', '该账号的 API 发布额度已用完。')
      item = this.put({ ...item, publicUntil: Date.now() + 24 * hour })
      for (let i = 0; i < item.assetIds.length; i++) {
        const imageUrl = `${config.publicBaseUrl}/instagram/media/${item.id}/${i}/${await this.signature(item, i)}.jpg`
        const child = await this.api.create(token, config.apiVersion, item.accountId, { image_url: imageUrl, ...(item.assetIds.length > 1 ? { is_carousel_item: 'true' } : { caption: item.caption, ...(item.aiGenerated ? { is_ai_generated: 'true' } : {}) }) })
        item.children.push(child); this.put(item)
        await this.waitReady(token, child, config.apiVersion)
      }
      item.containerId = item.assetIds.length === 1 ? item.children[0] : await this.api.create(token, config.apiVersion, item.accountId, { media_type: 'CAROUSEL', children: item.children.join(','), caption: item.caption, ...(item.aiGenerated ? { is_ai_generated: 'true' } : {}) })
      this.put(item)
      if (item.assetIds.length > 1) await this.waitReady(token, item.containerId, config.apiVersion)
      if (this.stopping) throw new AppError('INSTAGRAM_STOPPED', '本地服务已停止，尚未提交发布。')
      // Persist before the side effect. An ambiguous response is never automatically retried.
      item = this.put({ ...item, status: 'publishing' })
      const mediaId = await this.api.publish(token, config.apiVersion, item.accountId, item.containerId!)
      item = this.put({ ...item, mediaId, status: 'published', publishedAt: Date.now(), error: null })
      try { item.permalink = await this.api.permalink(token, config.apiVersion, mediaId); this.put(item) } catch { /* The publish result stays successful if permalink lookup fails. */ }
      this.database.audit('instagram.published', id)
    } catch (error) {
      if (this.stopping) return
      this.put({ ...item, status: item.status === 'publishing' ? 'uncertain' : 'failed', error: safeMessage(error) })
      this.database.audit('instagram.failed', id, error instanceof AppError ? error.code : 'INTERNAL_ERROR')
    }
  }
  async reconcile(id: string) {
    let item = this.get(id)
    const token = await this.token(item.accountId), version = this.config().apiVersion
    if (this.running.has(id)) return item
    if (item.status === 'published' && item.mediaId) { item.permalink = await this.api.permalink(token, version, item.mediaId); return this.put(item) }
    if (item.status !== 'uncertain' || !item.containerId) return item
    const status = await this.api.status(token, version, item.containerId)
    if (status === 'PUBLISHED') return this.put({ ...item, status: 'published', publishedAt: item.publishedAt ?? Date.now(), error: 'Instagram 已确认发布。可在账号中查看帖子。' })
    if (['ERROR', 'EXPIRED'].includes(status)) return this.put({ ...item, status: 'failed', error: 'Instagram 已确认该容器未能发布，可以重新准备。' })
    return this.put({ ...item, error: 'Instagram 尚未确认最终结果，请稍后再次回查；请勿重复发布。' })
  }
  tick() {
    if (this.stopping) return
    const now = Date.now()
    for (const item of this.publications().filter((p) => p.status === 'scheduled' && Date.parse(p.scheduledFor!) <= now)) {
      if (now - Date.parse(item.scheduledFor!) > 90000) { this.put({ ...item, status: 'missed', error: '电脑休眠或服务离线，错过的预约需要重新确认。' }); continue }
      if (this.publications().some((p) => p.id !== item.id && p.accountId === item.accountId && ACTIVE.includes(p.status))) continue
      this.put({ ...item, status: 'preparing' }); this.launch(item.id)
    }
  }
  start() {
    if (this.timer || this.stopping) return
    for (const item of this.publications()) {
      if (item.status === 'publishing') this.put({ ...item, status: 'uncertain', error: '提交期间服务中断，请回查 Instagram 状态。' })
      if (item.status === 'preparing') this.put({ ...item, status: 'failed', error: '准备期间服务中断，尚未提交发布。' })
      if (item.status === 'scheduled' && Date.parse(item.scheduledFor!) <= Date.now()) this.put({ ...item, status: 'missed', error: '离线期间错过预约，请重新确认。' })
    }
    this.timer = setInterval(() => this.tick(), 15000); this.timer.unref()
  }
  stop() { this.stopping = true; if (this.timer) clearInterval(this.timer) }
}
