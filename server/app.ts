import express from 'express'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z, ZodError } from 'zod'
import { StudioDatabase } from './database/client'
import { Keychain } from './security/keychain'
import { OpenAICompatibleProvider } from './providers/openai-compatible'
import type { AIProvider } from './providers/openai-compatible'
import { AssetService } from './services/assets'
import { JobService } from './services/jobs'
import { AppError, safeMessage } from './errors'
import { providerSchema, workspaceSchema, promptInputSchema } from '../src/shared/contracts'
import { SAMPLE_MODELS } from '../src/lib/data'
import { randomStyleBrief } from '../src/lib/style-presets'
import { invalidRandomModelField } from '../src/lib/random-model'
import { PromptService } from './services/prompts'
import { promptFeedbackSchema, promptTemplateInputSchema } from '../src/shared/prompts'
import { QualityService } from './services/quality'
import { qualityPreferencesSchema, referenceInputSchema } from '../src/shared/quality'

export function createStudioApp(options: { dataDir: string; publicDir: string; distDir?: string; keys?: Keychain; ai?: AIProvider }) {
  const database = new StudioDatabase(options.dataDir)
  const keys = options.keys ?? new Keychain()
  const assets = new AssetService(database, options.publicDir)
  const provider = new OpenAICompatibleProvider(database, keys)
  const prompts = new PromptService(database)
  const quality = new QualityService(database, assets, prompts)
  const jobs = new JobService(database, assets, options.ai ?? provider, prompts, quality)
  const app = express()
  app.disable('x-powered-by')
  const sessions = new Map<string, { csrf: string; usedAt: number }>()

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const host = req.hostname
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) { next(new AppError('HOST_REJECTED', '本地服务拒绝这个主机地址。', 403)); return }
    const origin = req.get('origin')
    if (origin && !['http://127.0.0.1:5188', 'http://localhost:5188', 'http://127.0.0.1:5189', 'http://localhost:5189', `http://${req.get('host')}`].includes(origin)) { next(new AppError('ORIGIN_REJECTED', '不允许从其他网站访问本地工作台。', 403)); return }
    if (req.get('sec-fetch-site') === 'cross-site') { next(new AppError('ORIGIN_REJECTED', '不允许跨站访问本地工作台。', 403)); return }
    next()
  })
  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '0.2.0', storage: 'sqlite' }))
  app.get('/api/session', (req, res) => {
    const cookie = /(?:^|; )yz_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]
    const id = cookie && sessions.has(cookie) ? cookie : randomBytes(32).toString('hex')
    if (!sessions.has(id)) sessions.set(id, { csrf: randomBytes(32).toString('hex'), usedAt: Date.now() })
    if (sessions.size > 100) sessions.delete(sessions.keys().next().value!)
    res.setHeader('Set-Cookie', `yz_session=${id}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=604800`)
    res.json({ csrf: sessions.get(id)!.csrf })
  })
  app.use('/api', (req, _res, next) => {
    const id = /(?:^|; )yz_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]
    const session = id ? sessions.get(id) : undefined
    if (!session) { next(new AppError('SESSION_REQUIRED', '本地会话已失效，请刷新页面后重试。', 401)); return }
    session.usedAt = Date.now()
    if (!['GET', 'HEAD'].includes(req.method)) {
      const token = req.get('x-yz-csrf') ?? ''
      if (!/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(session.csrf))) { next(new AppError('CSRF_REJECTED', '请求校验失败，请刷新页面后重试。', 403)); return }
    }
    next()
  })
  app.post('/api/assets', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: '20mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError('ASSET_INVALID', '请选择 JPG、PNG 或 WebP 图片。')
    const id = req.query.id === undefined ? undefined : z.uuid().parse(req.query.id)
    const groupId = req.query.groupId === undefined ? undefined : z.uuid().parse(req.query.groupId)
    let title: string
    try { title = decodeURIComponent(req.get('x-yz-filename') ?? '未命名图片').replace(/\.[^.]+$/, '') } catch { throw new AppError('VALIDATION', '图片文件名无效。') }
    const asset = await assets.save(req.body, title, { id, groupId })
    res.status(201).json(asset)
  })
  app.use('/api', express.json({ limit: '8mb' }))
  app.get('/api/workspace', (_req, res) => res.json(database.snapshot()))
  app.put('/api/workspace', (req, res) => {
    const input = z.object({ revision: z.number().int().nonnegative(), state: workspaceSchema }).parse(req.body)
    res.json(database.saveWorkspace(input.revision, input.state))
  })
  app.get('/api/assets', (_req, res) => res.json(assets ? database.assets() : []))
  app.get('/api/assets/:id/file', async (req, res) => {
    const file = assets.file(z.uuid().parse(req.params.id))
    res.type(file.mime).send(await readFile(file.path))
  })
  app.get('/api/assets/:id/thumbnail', async (req, res) => {
    const file = assets.file(z.uuid().parse(req.params.id), true)
    res.type(file.mime).send(await readFile(file.path))
  })
  app.delete('/api/assets/:id', (req, res) => res.json(assets.remove(z.uuid().parse(req.params.id))))
  app.get('/api/provider', async (_req, res) => res.json(await provider.status()))
  app.put('/api/provider', async (req, res) => {
    const input = providerSchema.extend({ apiKey: z.string().min(10).max(512).optional() }).parse(req.body)
    res.json(await provider.configure(input, input.apiKey))
  })
  app.post('/api/provider/test', async (_req, res) => res.json(await provider.testConnection()))
  let promptBusy = false
  app.post('/api/prompts', async (req, res) => {
    const input = promptInputSchema.parse(req.body)
    const missing = invalidRandomModelField(input.draft)
    if (missing) throw new AppError('RANDOM_MODEL_INVALID', missing.message)
    if (input.action === 'polish' && !input.draft.prompt.trim()) throw new AppError('PROMPT_REQUIRED', '先填写一些想法，再使用 AI 润色。')
    if (promptBusy) throw new AppError('PROMPT_BUSY', '正在准备妆容描述，请稍后再试。', 429)
    promptBusy = true
    try {
      const state = database.snapshot().state
      const model = [...state.customModels, ...SAMPLE_MODELS].find((m) => m.id === input.draft.modelId)
      const imageId = input.draft.mode === 'edit' ? input.draft.referenceId : model && !model.example ? model.assetId : null
      const images = imageId ? [await assets.input(imageId, 1024)] : []
      const guidance = quality.context(input.draft)
      const descriptionInput = { ...input, model: model ? { name: model.name, description: model.description, tags: model.tags } : null, images, variation: input.action === 'random' ? randomStyleBrief(input.draft.style) : null, guidance }
      const result = await (options.ai?.prompt ? options.ai.prompt(descriptionInput) : provider.prompt(descriptionInput))
      database.audit('ai.prompt')
      res.json({ ...result, guidance })
    } finally { promptBusy = false }
  })
  app.delete('/api/provider/key', async (_req, res) => res.json(await provider.disconnect()))
  app.get('/api/jobs', (_req, res) => res.json(database.listJobs()))
  app.get('/api/jobs/:id', (req, res) => {
    const job = database.job(z.uuid().parse(req.params.id))
    if (!job) throw new AppError('NOT_FOUND', '生成任务不存在。', 404)
    res.json(job.payload)
  })
  app.post('/api/jobs/images', async (req, res) => { if (!options.ai && !(await provider.status()).hasKey) throw new AppError('PROVIDER_NOT_CONFIGURED', '请先在设置中保存 API 密钥。', 503); res.status(202).json(jobs.enqueue('image', req.body)) })
  app.post('/api/jobs/captions', async (req, res) => { if (!options.ai && !(await provider.status()).hasKey) throw new AppError('PROVIDER_NOT_CONFIGURED', '请先在设置中保存 API 密钥。', 503); res.status(202).json(jobs.enqueue('caption', req.body)) })
  app.post('/api/jobs/:id/cancel', (req, res) => res.json(jobs.cancel(z.uuid().parse(req.params.id))))
  const pageQuery = z.object({ q: z.string().max(200).default(''), offset: z.coerce.number().int().min(0).max(1000000).default(0), limit: z.coerce.number().int().min(1).max(100).default(40) })
  app.get('/api/quality-preferences', (_req, res) => res.json(quality.preferences()))
  app.put('/api/quality-preferences', (req, res) => res.json(quality.savePreferences(qualityPreferencesSchema.parse(req.body))))
  app.get('/api/quality-references', (_req, res) => res.json(quality.list()))
  app.get('/api/quality-references/:id', (req, res) => res.json(quality.get(z.uuid().parse(req.params.id))))
  app.post('/api/quality-references', (req, res) => { const { id, ...value } = referenceInputSchema.extend({ id: z.uuid() }).parse(req.body); res.status(201).json(quality.create(id, value)) })
  app.put('/api/quality-references/:id', (req, res) => { const { version, ...value } = referenceInputSchema.extend({ version: z.number().int().positive() }).parse(req.body); res.json(quality.update(z.uuid().parse(req.params.id), version, value)) })
  app.delete('/api/quality-references/:id', (req, res) => res.json(quality.remove(z.uuid().parse(req.params.id), z.coerce.number().int().positive().parse(req.query.version))))
  app.post('/api/quality-references/:id/analyze', async (req, res) => {
    res.json(await quality.analyze(z.uuid().parse(req.params.id), provider.config().textModel, (input) => options.ai?.analyze ? options.ai.analyze(input) : provider.analyze(input)))
  })
  app.get('/api/prompt-history', (req, res) => res.json(prompts.history(pageQuery.parse(req.query))))
  app.get('/api/prompt-history/:id', (req, res) => res.json(prompts.historyItem(z.uuid().parse(req.params.id))))
  app.put('/api/prompt-history/:id/feedback', (req, res) => res.json(prompts.feedback(z.uuid().parse(req.params.id), promptFeedbackSchema.parse(req.body))))
  app.get('/api/prompt-library', (req, res) => {
    const query = pageQuery.extend({ favorite: z.enum(['true', 'false']).default('false') }).parse(req.query)
    res.json(prompts.library({ ...query, favorite: query.favorite === 'true' }))
  })
  app.post('/api/prompt-library', (req, res) => {
    const { id, ...value } = promptTemplateInputSchema.extend({ id: z.uuid() }).parse(req.body)
    res.status(201).json(prompts.create(value, id))
  })
  app.put('/api/prompt-library/:id', (req, res) => {
    const { version, ...value } = promptTemplateInputSchema.extend({ version: z.number().int().positive() }).parse(req.body)
    res.json(prompts.update(z.uuid().parse(req.params.id), version, value))
  })
  app.put('/api/prompt-library/:id/favorite', (req, res) => res.json(prompts.favorite(z.uuid().parse(req.params.id), z.object({ favorite: z.boolean() }).parse(req.body).favorite)))
  app.delete('/api/prompt-library/:id', (req, res) => res.json(prompts.remove(z.uuid().parse(req.params.id), z.coerce.number().int().positive().parse(req.query.version))))
  app.get('/api/export', (_req, res) => {
    res.attachment(`yuezhuang-${new Date().toISOString().slice(0, 10)}.json`).json({ format: 'yuezhuang-local-export', version: 3, exportedAt: new Date().toISOString(), includesImageFiles: false, ...database.snapshot(), jobs: database.listJobs(), prompts: prompts.export(), quality: quality.export() })
  })
  app.get('/api/backup', async (_req, res) => {
    const snapshot = database.snapshot()
    const files = await assets.exportFiles()
    res.attachment(`yuezhuang-backup-${new Date().toISOString().slice(0, 10)}.json`).json({ format: 'yuezhuang-local-backup', version: 2, exportedAt: new Date().toISOString(), ...snapshot, files, jobs: database.listJobs(), prompts: prompts.export(), quality: quality.export() })
  })
  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', '接口不存在。', 404)))
  if (options.distDir) {
    app.use(express.static(options.distDir, { dotfiles: 'deny' }))
    app.get('/{*path}', (_req, res) => res.sendFile(join(options.distDir!, 'index.html')))
  }
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) { res.status(400).json({ error: { code: 'VALIDATION', message: '填写的内容格式或长度不正确，请检查后重试。' } }); return }
    if (error instanceof AppError) { res.status(error.status).json({ error: { code: error.code, message: error.message }, ...(error.code === 'VERSION_CONFLICT' ? { snapshot: database.snapshot() } : {}) }); return }
    if ((error as { type?: string }).type === 'entity.too.large') { res.status(413).json({ error: { code: 'TOO_LARGE', message: '提交内容超过大小限制。' } }); return }
    if ((error as { type?: string }).type === 'entity.parse.failed') { res.status(400).json({ error: { code: 'VALIDATION', message: '请求 JSON 格式无效。' } }); return }
    database.audit('server.error', undefined, 'INTERNAL_ERROR')
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: safeMessage(error) } })
  })
  return { app, database, provider, assets, jobs, prompts, quality }
}
