import express from 'express'
import { z } from 'zod'
import { instagramConfigSchema, instagramPrepareSchema, instagramConfirmSchema } from '../src/shared/instagram'
import type { InstagramService } from './services/instagram'
import { AppError } from './errors'

export function instagramRoutes(app: express.Express, service: InstagramService) {
  app.get('/api/instagram', async (_req, res) => res.json(await service.state()))
  app.put('/api/instagram/config', async (req, res) => { const { appSecret, ...config } = instagramConfigSchema.extend({ appSecret: z.string().regex(/^[a-fA-F0-9]{32}$/).optional() }).parse(req.body); res.json(await service.configure(config, appSecret)) })
  app.post('/api/instagram/accounts', async (req, res) => {
    const value = z.object({ token: z.string().regex(/^[A-Za-z0-9._~+/=-]{10,8192}$/), expiresAt: z.number().min(Date.now()).max(Date.now() + 61 * 86400000).nullable().default(null) }).parse(req.body)
    res.status(201).json(await service.connect(value.token, value.expiresAt))
  })
  const accountId = z.string().regex(/^\d{1,40}$/)
  app.post('/api/instagram/accounts/:id/check', async (req, res) => res.json(await service.check(accountId.parse(req.params.id))))
  app.delete('/api/instagram/accounts/:id', async (req, res) => res.json(await service.disconnect(accountId.parse(req.params.id))))
  app.post('/api/instagram/authorize', async (_req, res) => res.json(await service.authorize()))
  app.post('/api/instagram/publications/prepare', async (req, res) => res.status(201).json(await service.prepare(instagramPrepareSchema.parse(req.body))))
  app.get('/api/instagram/publications/:id', (req, res) => res.json(service.get(z.uuid().parse(req.params.id))))
  app.get('/api/instagram/publications/:id/images/:index', async (req, res) => res.type('image/jpeg').send(await service.image(z.uuid().parse(req.params.id), z.coerce.number().int().min(0).max(19).parse(req.params.index))))
  app.post('/api/instagram/publications/:id/confirm', (req, res) => { const value = instagramConfirmSchema.parse(req.body); res.status(202).json(service.confirm(z.uuid().parse(req.params.id), value.fingerprint, value.scheduledFor)) })
  app.post('/api/instagram/publications/:id/cancel', (req, res) => res.json(service.cancel(z.uuid().parse(req.params.id))))
  app.post('/api/instagram/publications/:id/check', async (req, res) => res.json(await service.reconcile(z.uuid().parse(req.params.id))))
}

// A separate listener exposes only expiring publication images and the OAuth callback.
// A tunnel must target this port, never the authenticated workspace API.
export function instagramPublicApp(service: InstagramService) {
  const app = express()
  app.disable('x-powered-by')
  app.use((_req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" }); next() })
  app.get('/instagram/media/:id/:index/:signature.jpg', async (req, res) => res.type('image/jpeg').send(await service.publicImage(z.uuid().parse(req.params.id), z.coerce.number().int().min(0).max(19).parse(req.params.index), z.string().regex(/^[a-f0-9]{64}$/).parse(req.params.signature))))
  app.get('/instagram/callback', async (req, res) => {
    const value = z.object({ state: z.string().regex(/^[a-f0-9]{64}$/), code: z.string().min(1).max(4096).optional(), error: z.string().max(200).optional() }).parse(req.query)
    await service.callback(value.state, value.code ?? '', !!value.error || !value.code)
    res.type('html').send('<!doctype html><html lang="zh"><meta charset="utf-8"><title>Instagram 已连接</title><body><h1>Instagram 已连接</h1><p>请返回悦妆师工作台，账号会自动显示。可以关闭此窗口。</p></body></html>')
  })
  app.use((_req, res) => res.status(404).send('Not found'))
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error instanceof AppError ? error.status : 400).type('text').send(error instanceof AppError ? error.message : '请求无效，请回悦妆师工作台重新操作。') })
  return app
}
