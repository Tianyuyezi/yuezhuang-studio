import express from 'express'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import { z, ZodError } from 'zod'
import { AuthDatabase } from './security/auth'
import type { ServerSession } from './security/auth'
import { Keychain } from './security/keychain'
import { allowedRequest, publicOrigin } from './security/request-origin'
import { createWorkspaceApp } from './workspace-app'
import type { WorkspaceAppOptions } from './workspace-app'
import { credentialsSchema } from '../src/shared/auth'
import type { AuthUser } from '../src/shared/auth'
import { settingsSchema } from '../src/shared/contracts'
import { AppError } from './errors'

export interface StudioAppOptions extends WorkspaceAppOptions { keyFactory?: (workspaceKey: string) => Keychain }
export function createStudioApp(options: StudioAppOptions) {
  const auth = new AuthDatabase(options.dataDir)
  const deployedOrigin = publicOrigin(options.publicOrigin)
  const runtimes = new Map<string, ReturnType<typeof createWorkspaceApp>>()
  let started = false, hashing = 0
  function workspace(key: string, user: AuthUser | null) {
    const existing = runtimes.get(key)
    if (existing) return existing
    const owner = user?.role === 'owner'
    const directory = owner ? options.dataDir : join(options.dataDir, user ? 'users' : 'guests', key.slice(key.indexOf('-') + 1))
    const namespace = `YueZhuangStudio.${key}`
    const keys = owner ? options.keys : options.keyFactory?.(key) ?? new Keychain(namespace, options.credentialDir)
    const instagramKeys = owner ? options.instagramKeys ?? options.keys : keys
    const runtime = createWorkspaceApp({ ...options, dataDir: directory, distDir: undefined, keys, instagramKeys, managedSession: true })
    runtimes.set(key, runtime)
    if (started) { runtime.jobs.recover(); if (user) runtime.instagram.start() }
    return runtime
  }
  // The owner keeps the original database, files, and credential namespaces in place.
  const owner = auth.owner(), legacy = workspace(`user-${owner.id}`, owner)
  for (const user of auth.users()) workspace(`user-${user.id}`, user)
  async function importGuest(guestId: string, user: AuthUser) {
    const source = workspace(`guest-${guestId}`, null), target = workspace(`user-${user.id}`, user)
    const state = source.database.snapshot().state
    for (const asset of source.database.assets()) await target.assets.save(await readFile(source.assets.file(asset.id).path), asset.title, { id: asset.id, groupId: asset.groupId, projectId: asset.projectId, kind: asset.kind === 'generated' ? 'generated' : 'imported', style: asset.style, jobId: asset.jobId })
    const append = <T extends { id: string }>(current: T[], incoming: T[]) => [...current, ...incoming.filter((item) => !current.some((saved) => saved.id === item.id))]
    target.database.mutateWorkspace((current) => ({
      ...current, draft: state.draft, workflow: state.workflow, activeProjectId: state.activeProjectId ?? current.activeProjectId,
      projects: append(current.projects, state.projects), customModels: append(current.customModels, state.customModels), publishDrafts: append(current.publishDrafts, state.publishDrafts),
      captions: { ...state.captions, ...current.captions }, groupCaptions: { ...state.groupCaptions, ...current.groupCaptions },
      favorites: [...new Set([...current.favorites, ...state.favorites])], hiddenExamples: [...new Set([...current.hiddenExamples, ...state.hiddenExamples])],
    }))
  }
  const app = express(); app.disable('x-powered-by')
  const token = (req: express.Request) => /(?:^|; )yz_auth=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]
  function setCookie(res: express.Response, value: string, registered: boolean) { res.setHeader('Set-Cookie', `yz_auth=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${(registered ? 7 : 1) * 86400}${deployedOrigin ? '; Secure' : ''}`) }
  const isApi = (req: express.Request) => req.path === '/api' || req.path.startsWith('/api/')
  app.use((req, res, next) => {
    if (!isApi(req)) { next(); return }
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    const rejected = allowedRequest(req.hostname, req.get('origin'), req.get('host'), deployedOrigin)
    if (rejected || req.get('sec-fetch-site') === 'cross-site') { next(new AppError(rejected ?? 'ORIGIN_REJECTED', '不允许从这个网站地址访问工作台。', 403)); return }
    next()
  })
  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '0.3.0', storage: 'sqlite', authentication: true }))
  app.get('/api/session', (req, res) => {
    let session = auth.session(token(req))
    if (!session) { const created = auth.createSession(null); session = created.session; setCookie(res, created.token, false) }
    res.json(auth.view(session))
  })
  app.use(express.json({ limit: '8mb' }))
  app.use((req, res, next) => {
    if (!isApi(req)) { next(); return }
    const session = auth.session(token(req))
    if (!session) { next(new AppError('SESSION_REQUIRED', '登录或体验会话已过期，请重新连接。', 401)); return }
    res.locals.auth = session
    const scope = req.get('x-yz-workspace')
    if (scope && scope !== session.workspaceKey) { next(new AppError('ACCOUNT_CHANGED', '账号已在其他窗口切换，请刷新后继续。', 409)); return }
    if (!['GET', 'HEAD'].includes(req.method)) {
      const csrf = req.get('x-yz-csrf') ?? ''
      if (!/^[a-f0-9]{64}$/.test(csrf) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))) { next(new AppError('CSRF_REJECTED', '请求校验失败，请刷新后重试。', 403)); return }
      if (!req.path.startsWith('/api/auth/') && scope !== session.workspaceKey) { next(new AppError('ACCOUNT_CHANGED', '工作空间已改变，请刷新后再保存。', 409)); return }
    }
    next()
  })
  for (const action of ['login', 'register'] as const) app.post(`/api/auth/${action}`, async (req, res) => {
    if (hashing >= 4) throw new AppError('AUTH_BUSY', '登录服务繁忙，请稍后再试。', 429)
    const value = credentialsSchema.extend({ importGuest: z.boolean().default(false) }).parse(req.body), previous = res.locals.auth as ServerSession
    hashing++
    try {
      const user = await auth[action](value.email, value.password, req.ip ?? 'local')
      workspace(`user-${user.id}`, user)
      let notice: string | undefined
      if (value.importGuest) { try { await importGuest(previous.guestId, user) } catch { notice = '账号已登录，部分体验内容未能带入；原体验草稿仍保留在游客空间。' } }
      const created = auth.createSession(user, previous.guestId, previous)
      setCookie(res, created.token, true); res.json({ ...auth.view(created.session), ...(notice ? { notice } : {}) })
    } finally { hashing-- }
  })
  app.post('/api/auth/logout', (_req, res) => {
    const previous = res.locals.auth as ServerSession
    const created = auth.createSession(null, previous.guestId, previous)
    setCookie(res, created.token, false); res.json(auth.view(created.session))
  })
  app.use((req, res, next) => {
    if (!isApi(req)) { next(); return }
    const session = res.locals.auth as ServerSession
    if (!session.user && (req.path.startsWith('/api/instagram') || req.path.startsWith('/api/provider') && req.method !== 'GET' || req.path === '/api/quality-preferences' && req.method !== 'GET')) {
      next(new AppError('AUTH_REQUIRED', '请先登录或注册，再配置服务或发布帖子。', 401)); return
    }
    const runtime = workspace(session.workspaceKey, session.user)
    if (!session.user && req.method === 'PUT' && req.path === '/api/workspace' && req.body?.state?.settings) {
      const incoming = settingsSchema.parse(req.body.state.settings)
      if (JSON.stringify(incoming) !== JSON.stringify(runtime.database.snapshot().state.settings)) { next(new AppError('AUTH_REQUIRED', '请先登录或注册，再保存工作空间配置。', 401)); return }
    }
    if (!session.user && req.method === 'POST' && req.path === '/api/assets') {
      const usage = runtime.database.sqlite.prepare('SELECT COUNT(*) count,COALESCE(SUM(size_bytes),0) bytes FROM assets WHERE deleted_at IS NULL').get() as { count: number; bytes: number }
      if (usage.count >= 40 || usage.bytes >= 200 * 1024 * 1024) { next(new AppError('GUEST_LIMIT', '本次体验的素材较多，请登录后继续保存作品。', 429)); return }
    }
    runtime.app(req, res, next)
  })
  if (options.distDir) { app.use(express.static(options.distDir, { dotfiles: 'deny' })); app.get('/{*path}', (_req, res) => res.sendFile(join(options.distDir!, 'index.html'))) }
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const validation = error instanceof ZodError
    const status = error instanceof AppError ? error.status : validation ? 400 : (error as { type?: string }).type === 'entity.too.large' ? 413 : 500
    res.status(status).json({ error: { code: error instanceof AppError ? error.code : validation ? 'VALIDATION' : 'INTERNAL_ERROR', message: error instanceof AppError ? error.message : validation ? '请填写有效邮箱和至少 8 位密码，并检查填写内容。' : '操作未完成，请稍后重试。' } })
  })
  const publicApp = express(); publicApp.disable('x-powered-by')
  publicApp.use((req, res, next) => {
    const id = /^\/instagram\/media\/([0-9a-f-]{36})\//i.exec(req.path)?.[1]
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    let target = legacy
    for (const runtime of runtimes.values()) {
      if (req.path === '/instagram/callback' && runtime.instagram.hasOAuthState(state)) { target = runtime; break }
      if (id) { try { runtime.instagram.get(id); target = runtime; break } catch { /* Signed IDs are found only in the owning workspace. */ } }
    }
    target.instagramPublicApp(req, res, next)
  })
  return {
    ...legacy, app, auth, instagramPublicApp: publicApp,
    start() { if (started) return; started = true; for (const [key, runtime] of runtimes) { runtime.jobs.recover(); if (key.startsWith('user-')) runtime.instagram.start() } },
    stopPublishing() { for (const runtime of runtimes.values()) runtime.instagram.stop() },
    close() { for (const runtime of runtimes.values()) { runtime.instagram.stop(); runtime.database.close() }; auth.close() },
  }
}
