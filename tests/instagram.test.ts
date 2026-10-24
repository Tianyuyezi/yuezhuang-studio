import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import sharp from 'sharp'
import { createWorkspaceApp as createStudioApp } from '../server/workspace-app'
import { Keychain } from '../server/security/keychain'
import type { InstagramAPI } from '../server/providers/instagram'
import { InstagramGraphAPI } from '../server/providers/instagram'
import { initialWorkspace } from '../server/database/client'
import { AppError } from '../server/errors'
import { zonedSchedule } from '../src/lib/instagram'
import type { InstagramPublication } from '../src/shared/instagram'
import { publicationBrandingSchema } from '../src/shared/publication-branding'
import { publicationImage } from '../server/services/publication-image'

class MemoryKeys extends Keychain {
  override readonly storage = 'session' as const
  values = new Map<string, string>()
  override async get(name: string) { return this.values.get(name) ?? null }
  override async set(name: string, value: string) { this.values.set(name, value) }
  override async remove(name: string) { this.values.delete(name) }
}
class FakeInstagram implements InstagramAPI {
  creates: Record<string, string>[] = []
  publishes = 0; failPublish = false; failLink = false; statusValue = 'FINISHED'; used = 0
  async profile() { return { id: '123456789', username: 'studio_test', accountType: 'BUSINESS' } }
  async limit() { return { used: this.used, total: 100 } }
  async exchange() { return { access_token: 'OAUTH_SECRET_TOKEN_123456789', expires_in: 5184000 } }
  async refresh() { return { access_token: 'REFRESH_SECRET_TOKEN_123456', expires_in: 5184000 } }
  async create(_token: string, _version: string, _account: string, params: Record<string, string>) { this.creates.push(params); return String(9000 + this.creates.length) }
  async status() { return this.statusValue }
  async publish() { this.publishes++; if (this.failPublish) throw new AppError('INSTAGRAM_NETWORK', '模拟网络中断'); return '999999' }
  async permalink() { if (this.failLink) throw new Error('network'); return 'https://www.instagram.com/p/testpost/' }
}

describe('Instagram publishing: isolated local service, mocked Meta API only', () => {
  let dir: string, runtime: ReturnType<typeof createStudioApp>, server: Server, publicServer: Server, base: string, mediaBase: string, cookie: string, csrf: string, fake: FakeInstagram, keys: MemoryKeys
  const token = 'INSTAGRAM_SECRET_TOKEN_123456'
  async function call(path: string, init: RequestInit = {}) { return fetch(base + '/api' + path, { ...init, headers: { Cookie: cookie, 'X-YZ-CSRF': csrf, ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init.headers } }) }
  async function post(path: string, input: unknown = {}) { return call(path, { method: 'POST', body: JSON.stringify(input) }) }
  async function draft(count = 2, caption = '写实妆造\n\n#Makeup') {
    const groupId = randomUUID(), ids: string[] = []
    for (let i = 0; i < count; i++) { const asset = await runtime.assets.save(await sharp({ create: { width: 400, height: 700, channels: 3, background: i ? '#123456' : '#bca987' } }).png().toBuffer(), `图片 ${i}`, { groupId, kind: 'generated' }); ids.push(asset.id) }
    const state = initialWorkspace(), id = randomUUID()
    state.publishDrafts = [{ id, projectId: null, groupId, assetIds: ids, title: '测试妆造', caption, language: 'zh', scheduledAt: '2026-11-01T18:00', timezone: 'Asia/Shanghai', createdAt: Date.now() }]
    runtime.database.saveWorkspace(runtime.database.snapshot().revision, state)
    return { id, ids }
  }
  async function prepare(id: string, requestId = randomUUID()) { const response = await post('/instagram/publications/prepare', { requestId, draftId: id, accountId: '123456789' }); expect(response.status).toBe(201); return response.json() as Promise<InstagramPublication> }
  async function wait(id: string) { for (let i = 0; i < 150; i++) { const item = runtime.instagram.get(id); if (!['preparing', 'publishing'].includes(item.status)) return item; await new Promise((r) => setTimeout(r, 10)) }; throw new Error('publishing stuck') }
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yz-instagram-test-')); keys = new MemoryKeys(); fake = new FakeInstagram()
    runtime = createStudioApp({ dataDir: dir, publicDir: resolve('public'), keys, instagramAPI: fake, instagramPollMs: 1 })
    server = runtime.app.listen(0, '127.0.0.1'); publicServer = runtime.instagramPublicApp.listen(0, '127.0.0.1')
    await Promise.all([new Promise<void>((r) => server.once('listening', r)), new Promise<void>((r) => publicServer.once('listening', r))])
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; mediaBase = `http://127.0.0.1:${(publicServer.address() as { port: number }).port}`
    const session = await fetch(base + '/api/session'); cookie = session.headers.get('set-cookie')!.split(';')[0]; csrf = (await session.json()).csrf
    await runtime.instagram.configure({ appId: '1234567', publicBaseUrl: 'https://media.example.com', apiVersion: 'v25.0' }, '0123456789abcdef0123456789abcdef')
    await runtime.instagram.connect(token)
  })
  afterEach(async () => { vi.restoreAllMocks(); runtime.instagram.stop(); await Promise.all([new Promise<void>((r) => server.close(() => r())), new Promise<void>((r) => publicServer.close(() => r()))]); runtime.database.close(); await rm(dir, { recursive: true, force: true }) })
  it('keeps tokens and app secrets out of state, SQLite payloads and exports; requires CSRF', async () => {
    const state = await (await call('/instagram')).json()
    expect(state.accounts[0].username).toBe('studio_test'); expect(state.hasAppSecret).toBe(true)
    for (const path of ['/instagram', '/export', '/backup']) { const text = await (await call(path)).text(); expect(text).not.toContain(token); expect(text).not.toContain('0123456789abcdef0123456789abcdef') }
    const rows = runtime.database.sqlite.prepare('SELECT payload FROM instagram_accounts UNION ALL SELECT payload FROM instagram_config').all()
    expect(JSON.stringify(rows)).not.toContain(token)
    expect((await fetch(base + '/api/instagram/accounts', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })).status).toBe(403)
    expect((await fetch(mediaBase + '/api/workspace')).status).toBe(404)
  })
  it('accepts OAuth state once, rejects unknown/cancelled/config-invalidated state', async () => {
    const auth = await runtime.instagram.authorize(), state = new URL(auth.url).searchParams.get('state')!
    expect(new URL(auth.url).searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_content_publish')
    expect((await fetch(`${mediaBase}/instagram/callback?state=${state}&code=CODE`)).status).toBe(200)
    expect((await fetch(`${mediaBase}/instagram/callback?state=${state}&code=CODE`)).status).toBe(400)
    expect((await fetch(`${mediaBase}/instagram/callback?state=${'a'.repeat(64)}&code=CODE`)).status).toBe(400)
    const denied = new URL((await runtime.instagram.authorize()).url).searchParams.get('state')!
    expect((await fetch(`${mediaBase}/instagram/callback?state=${denied}&error=access_denied`)).status).toBe(400)
    const expired = new URL((await runtime.instagram.authorize()).url).searchParams.get('state')!
    await runtime.instagram.configure(runtime.instagram.config())
    await expect(runtime.instagram.callback(expired, 'CODE', false)).rejects.toMatchObject({ code: 'INSTAGRAM_STATE' })
  })
  it('creates immutable JPEG previews with complete uncropped frames before any Meta write', async () => {
    const { id, ids } = await draft(), item = await prepare(id)
    const original = await readFile(runtime.assets.file(ids[0]).path)
    const image = await (await call(`/instagram/publications/${item.id}/images/0`)).arrayBuffer()
    const meta = await sharp(Buffer.from(image)).metadata()
    expect(meta.format).toBe('jpeg'); expect(meta.width).toBe(1080); expect(meta.height).toBe(1350)
    expect(await readFile(runtime.assets.file(ids[0]).path)).toEqual(original)
    expect(fake.creates).toHaveLength(0); expect(fake.publishes).toBe(0)
    expect((await fetch(`${mediaBase}/instagram/media/${item.id}/0/${'a'.repeat(64)}.jpg`)).status).toBe(404)
    runtime.assets.remove(ids[0]); expect((await call(`/instagram/publications/${item.id}/images/0`)).status).toBe(200)
  })
  it('publishes children in cover order, labels only parent, and prevents repeat submission', async () => {
    const { id } = await draft(), item = await prepare(id)
    const confirm = { confirmed: true, fingerprint: item.fingerprint }
    expect((await post(`/instagram/publications/${item.id}/confirm`, { ...confirm, fingerprint: '0'.repeat(64) })).status).toBe(409)
    await Promise.all([post(`/instagram/publications/${item.id}/confirm`, confirm), post(`/instagram/publications/${item.id}/confirm`, confirm)])
    const result = await wait(item.id)
    expect(result.status).toBe('published'); expect(result.permalink).toContain('/p/testpost/')
    expect(fake.creates).toHaveLength(3); expect(fake.creates[0].is_carousel_item).toBe('true'); expect(fake.creates[0].is_ai_generated).toBeUndefined()
    expect(fake.creates[2]).toMatchObject({ media_type: 'CAROUSEL', children: '9001,9002', caption: item.caption, is_ai_generated: 'true' })
    expect(fake.creates[0].image_url).toContain(`/${item.id}/0/`); expect(fake.creates[1].image_url).toContain(`/${item.id}/1/`)
    expect(fake.publishes).toBe(1)
    await post(`/instagram/publications/${item.id}/confirm`, confirm); expect(fake.publishes).toBe(1)
    const url = new URL(fake.creates[0].image_url)
    expect((await fetch(mediaBase + url.pathname)).status).toBe(200)
    expect((await fetch(mediaBase + url.pathname.replace(/.$/, 'z'))).status).toBe(404)
    const stored = runtime.instagram.get(item.id); stored.publicUntil = Date.now() - 1
    runtime.database.sqlite.prepare('UPDATE instagram_publications SET payload=? WHERE id=?').run(JSON.stringify(stored), item.id)
    expect((await fetch(mediaBase + url.pathname)).status).toBe(404)
  })
  it('keeps effect images clean and brands every final image with immutable contacts after hashtags', async () => {
    const { id, ids } = await draft()
    const originals = await Promise.all(ids.map((assetId) => readFile(runtime.assets.file(assetId).path)))
    const branding = publicationBrandingSchema.parse({ artist: { name: '测试化妆师', wechat: 'artist_test', phone: '+86 00000000000' }, publisher: { name: '测试发布人', whatsapp: '+82 0000000000' } })
    runtime.database.mutateWorkspace((state) => ({ ...state, settings: { ...state.settings, publicationBranding: branding } }))
    const item = await prepare(id)
    expect(item.caption).toContain('#Makeup\n\n化妆师: 测试化妆师')
    expect(item.caption.endsWith('WhatsApp: +82 0000000000')).toBe(true)
    expect(item.branding).toEqual(branding)
    for (const [index, assetId] of ids.entries()) {
      const clean = await publicationImage(runtime.assets.file(assetId).path, item.width, item.height, [])
      const branded = Buffer.from(await (await call(`/instagram/publications/${item.id}/images/${index}`)).arrayBuffer())
      expect(branded).not.toEqual(clean)
      const patch = { left: 180, top: item.height - 150, width: 720, height: 150 }
      const markedStats = await sharp(await sharp(branded).extract(patch).toBuffer()).stats(), cleanStats = await sharp(await sharp(clean).extract(patch).toBuffer()).stats()
      expect(markedStats.channels[0].stdev).toBeGreaterThan(cleanStats.channels[0].stdev + 5)
      expect(await readFile(runtime.assets.file(assetId).path)).toEqual(originals[index])
      expect(Buffer.from(await (await call(`/assets/${assetId}/file`)).arrayBuffer())).toEqual(originals[index])
    }
    expect(runtime.database.snapshot().state.publishDrafts[0].caption).toBe('写实妆造\n\n#Makeup')
    const later = { ...branding, artist: { ...branding.artist, wechat: 'changed_test' }, watermarkEnglish: 'Updated Shanghai Makeup Artist' }
    runtime.database.mutateWorkspace((state) => ({ ...state, settings: { ...state.settings, publicationBranding: later } }))
    const updated = await prepare(id)
    expect(updated.fingerprint).not.toBe(item.fingerprint)
    expect(updated.caption).toContain('changed_test')
    expect(runtime.instagram.get(item.id).caption).toBe(item.caption)
    expect(runtime.instagram.get(item.id).branding).toEqual(branding)
    expect(fake.creates).toHaveLength(0)
    expect(fake.publishes).toBe(0)
  })
  it('respects disabled final watermarks and counts contact details toward the caption limit', async () => {
    const { id, ids } = await draft(1)
    runtime.database.mutateWorkspace((state) => ({ ...state, settings: { ...state.settings, publicationBranding: publicationBrandingSchema.parse({ watermarkEnabled: false }) } }))
    const item = await prepare(id)
    expect(await runtime.instagram.image(item.id, 0)).toEqual(await publicationImage(runtime.assets.file(ids[0]).path, item.width, item.height, []))
    runtime.database.mutateWorkspace((state) => ({ ...state, publishDrafts: state.publishDrafts.map((draft) => ({ ...draft, caption: 'a'.repeat(2190) })), settings: { ...state.settings, publicationBranding: publicationBrandingSchema.parse({ artist: { wechat: 'contact_that_exceeds_the_limit' } }) } }))
    const rejected = await post('/instagram/publications/prepare', { requestId: randomUUID(), draftId: id, accountId: '123456789' })
    expect(rejected.status).toBe(400)
    expect((await rejected.json()).error.message).toContain('底部联系信息')
    expect(fake.creates).toHaveLength(0)
  })
  it('persists optional profiles and protects their settings from an older open workspace', async () => {
    const current = runtime.database.snapshot()
    const publicationBranding = publicationBrandingSchema.parse({ artist: { name: 'Mina', wechat: 'mina_test' }, publisher: { phone: '+86 00000000000' } })
    const saved = await call('/workspace', { method: 'PUT', body: JSON.stringify({ revision: current.revision, state: { ...current.state, settings: { ...current.state.settings, publicationBranding } } }) })
    expect(saved.status).toBe(200)
    const result = await saved.json()
    expect(result.state.settings.publicationBranding).toEqual(publicationBranding)
    const { publicationBranding: _branding, ...legacySettings } = result.state.settings
    const legacy = await call('/workspace', { method: 'PUT', body: JSON.stringify({ revision: result.revision, state: { ...result.state, settings: { ...legacySettings, studioName: '另一个窗口' } } }) })
    expect(legacy.status).toBe(200)
    expect((await legacy.json()).state.settings.publicationBranding).toEqual(publicationBranding)
    expect((await (await call('/export')).json()).state.settings.publicationBranding).toEqual(publicationBranding)
  })
  it('uses single-image publishing without a carousel and keeps success if permalink lookup fails', async () => {
    fake.failLink = true
    const { id } = await draft(1), item = await prepare(id)
    runtime.instagram.confirm(item.id, item.fingerprint)
    expect((await wait(item.id)).status).toBe('published'); expect(fake.creates).toHaveLength(1); expect(fake.creates[0]).toMatchObject({ caption: item.caption, is_ai_generated: 'true' })
  })
  it('leaves ambiguous publish results unresolved until readback, never retries publish', async () => {
    fake.failPublish = true
    const { id } = await draft(), item = await prepare(id)
    runtime.instagram.confirm(item.id, item.fingerprint)
    expect((await wait(item.id)).status).toBe('uncertain')
    runtime.instagram.confirm(item.id, item.fingerprint); expect(fake.publishes).toBe(1)
    await runtime.instagram.reconcile(item.id); expect(runtime.instagram.get(item.id).status).toBe('uncertain')
    fake.statusValue = 'PUBLISHED'
    expect((await runtime.instagram.reconcile(item.id)).status).toBe('published'); expect(fake.publishes).toBe(1)
  })
  it('fails safely before publish when media processing or quota checks fail', async () => {
    fake.statusValue = 'ERROR'
    const { id } = await draft(), first = await prepare(id)
    runtime.instagram.confirm(first.id, first.fingerprint)
    expect((await wait(first.id)).status).toBe('failed'); expect(fake.publishes).toBe(0)
    fake.used = 100
    const second = await prepare(id); runtime.instagram.confirm(second.id, second.fingerprint)
    expect((await wait(second.id)).status).toBe('failed'); expect(fake.creates).toHaveLength(1)
  })
  it('deduplicates concurrent preview preparation and request retries', async () => {
    const { id } = await draft(), requestId = randomUUID()
    const [a, b] = await Promise.all([prepare(id, requestId), prepare(id, requestId)])
    expect(a.id).toBe(b.id); expect((await prepare(id)).id).toBe(a.id)
    expect(runtime.instagram.publications()).toHaveLength(1)
  })
  it('validates captions, public HTTPS URL and explicit confirmation', async () => {
    const { id } = await draft(1, 'a'.repeat(2201))
    expect((await post('/instagram/publications/prepare', { requestId: randomUUID(), draftId: id, accountId: '123456789' })).status).toBe(400)
    expect((await call('/instagram/config', { method: 'PUT', body: JSON.stringify({ publicBaseUrl: 'http://127.0.0.1:5189' }) })).status).toBe(400)
    const valid = await draft(), item = await prepare(valid.id)
    expect((await post(`/instagram/publications/${item.id}/confirm`, { fingerprint: item.fingerprint })).status).toBe(400)
    expect((await post(`/instagram/publications/${item.id}/confirm`, { fingerprint: item.fingerprint, confirmed: true, scheduledFor: new Date(Date.now() - 1000).toISOString() })).status).toBe(400)
  })
  it('only arms explicitly confirmed schedules, cancels on disconnect, and marks offline times missed', async () => {
    const { id } = await draft(), item = await prepare(id)
    expect(runtime.instagram.confirm(item.id, item.fingerprint, new Date(Date.now() + 120000).toISOString()).status).toBe('scheduled'); expect(fake.publishes).toBe(0)
    await runtime.instagram.disconnect('123456789')
    expect(runtime.instagram.get(item.id).status).toBe('cancelled')
    await runtime.instagram.connect(token)
    const another = await prepare(id); runtime.instagram.confirm(another.id, another.fingerprint, new Date(Date.now() + 120000).toISOString())
    const stored = runtime.instagram.get(another.id); stored.scheduledFor = new Date(Date.now() - 1000).toISOString()
    runtime.database.sqlite.prepare('UPDATE instagram_publications SET payload=? WHERE id=?').run(JSON.stringify(stored), stored.id)
    runtime.instagram.start(); expect(runtime.instagram.get(stored.id).status).toBe('missed'); expect(fake.publishes).toBe(0)
  })
  it('runs a due authorized schedule once and recovers interrupted submissions without writing', async () => {
    const { id } = await draft(), item = await prepare(id)
    runtime.instagram.confirm(item.id, item.fingerprint, new Date(Date.now() + 120000).toISOString())
    const stored = runtime.instagram.get(item.id); stored.scheduledFor = new Date(Date.now() - 1000).toISOString()
    runtime.database.sqlite.prepare('UPDATE instagram_publications SET payload=? WHERE id=?').run(JSON.stringify(stored), stored.id)
    runtime.instagram.tick(); runtime.instagram.tick()
    expect((await wait(item.id)).status).toBe('published'); expect(fake.publishes).toBe(1)
    const value = runtime.instagram.get(item.id); value.status = 'publishing'
    runtime.database.sqlite.prepare('UPDATE instagram_publications SET payload=?,status=? WHERE id=?').run(JSON.stringify(value), value.status, value.id)
    runtime.instagram.start(); expect(runtime.instagram.get(item.id).status).toBe('uncertain'); expect(fake.publishes).toBe(1)
  })
})

describe('Instagram official wire contracts and timezones', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('uses fixed HTTPS Graph hosts, bearer headers, and parent parameters without leaking errors', async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { requests.push({ url: String(url), init }); return Response.json({ id: '777' }) }))
    const api = new InstagramGraphAPI()
    await api.create('secret-token', 'v25.0', '123', { children: '111,222', media_type: 'CAROUSEL', is_ai_generated: 'true' })
    expect(requests[0].url).toBe('https://graph.instagram.com/v25.0/123/media'); expect(requests[0].init?.headers).toEqual({ Authorization: 'Bearer secret-token' })
    expect(String(requests[0].init?.body)).toContain('children=111%2C222'); expect(requests[0].init?.redirect).toBe('error')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 190, message: 'secret-token' } }, { status: 400 })))
    await expect(api.profile('secret-token', 'v25.0')).rejects.toMatchObject({ code: 'INSTAGRAM_AUTH', message: 'Instagram 授权已失效，请重新连接账号。' })
    vi.unstubAllGlobals()
  })
  it('rejects personal accounts and supports the current nested OAuth token response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ user_id: '123', username: 'test', account_type: 'PERSONAL' })))
    const api = new InstagramGraphAPI()
    await expect(api.profile('secret-token', 'v25.0')).rejects.toMatchObject({ code: 'INSTAGRAM_PROFESSIONAL' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ user_id: '123', username: 'test', account_type: 'Media_Creator' }] })))
    expect(await api.profile('secret-token', 'v26.0')).toMatchObject({ id: '123', accountType: 'MEDIA_CREATOR' })
    let count = 0
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(++count === 1 ? { data: [{ access_token: 'SHORT' }] } : { access_token: 'LONG', expires_in: 5184000 })))
    expect(await api.exchange('code', { appId: '123456', publicBaseUrl: 'https://media.example.com', apiVersion: 'v25.0' }, 'secret')).toEqual({ access_token: 'LONG', expires_in: 5184000 })
    vi.unstubAllGlobals()
  })
  it('converts the chosen workspace timezone and rejects nonexistent or ambiguous DST times', () => {
    expect(zonedSchedule('2026-11-01T18:00', 'Asia/Shanghai')).toBe('2026-11-01T10:00:00.000Z')
    expect(() => zonedSchedule('2026-03-08T02:30', 'America/New_York')).toThrow('夏令时')
    expect(() => zonedSchedule('2026-11-01T01:30', 'America/New_York')).toThrow('夏令时')
  })
})
