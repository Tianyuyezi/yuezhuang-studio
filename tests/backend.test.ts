import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStudioApp } from '../server/app'
import { Keychain } from '../server/security/keychain'
import type { AIProvider } from '../server/providers/openai-compatible'
import { initialWorkspace } from '../server/database/client'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import sharp from 'sharp'
import type { Server } from 'node:http'
import type { AIJob } from '../src/shared/contracts'
import { jobTable } from '../server/database/schema'
import { AppError } from '../server/errors'
import { DEFAULT_QUALITY_PREFERENCES, EMPTY_SCORES } from '../src/shared/quality'
import type { ReferenceAnalysis } from '../src/shared/quality'
import type { DescriptionInput } from '../server/providers/openai-compatible'

class MemoryKeys extends Keychain {
  override readonly storage = 'session' as const
  private value: string | null = null
  override async get() { return this.value }
  override async set(_url: string, key: string) { this.value = key }
  override async remove() { this.value = null }
}
class FakeAI implements AIProvider {
  calls = 0
  analysisCalls = 0
  analysisDelay = 0
  descriptionInput: DescriptionInput | null = null
  failAt = 0
  delay = 0
  references = 0
  referenceCounts: number[] = []
  captionReferences: number[] = []
  imagePrompts: string[] = []
  selectedImageModels: (string | undefined)[] = []
  onCaption: (() => void) | null = null
  onImage: ((prompt: string) => void) | null = null
  constructor(private imageBytes: Buffer) {}
  config() { return { baseUrl: 'https://test.invalid/v1', imageModel: 'test-image', textModel: 'test-text', allowInsecureHttp: false } }
  imageModels() { return ['test-image', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] }
  async image(input: { prompt: string; model?: string; images: unknown[] }) {
    this.calls++; this.references = input.images.length
    this.imagePrompts.push(input.prompt)
    this.selectedImageModels.push(input.model)
    this.onImage?.(input.prompt)
    this.referenceCounts.push(input.images.length)
    if (this.delay) await new Promise((resolve) => setTimeout(resolve, this.delay))
    if (this.calls === this.failAt) throw new AppError('TEST_PROVIDER_ERROR', '模拟测试供应商失败')
    return { bytes: this.imageBytes }
  }
  async analyze(): Promise<ReferenceAnalysis> {
    this.analysisCalls++
    if (this.analysisDelay) await new Promise((r) => setTimeout(r, this.analysisDelay))
    return { prompt: '虚构成年人物的写实美妆摄影，保留妆容与皮肤纹理。', observations: { realism: '真实皮肤与唇纹', makeup: '明确的眼线与腮红', lighting: '有方向的柔和光线', composition: '头肩构图', consistency: '同妆造保持一致' }, avoid: ['截图控件'], suggestedScores: { realism: 4, makeup: 4.5, lighting: 4, composition: 4, consistency: 5 } }
  }
  async prompt(input: DescriptionInput) { this.descriptionInput = input; return { prompt: '已按优质方向整理的成年人物妆容描述。' } }
  async caption(input: { language: string; images?: unknown[] }) { this.captionReferences.push(input.images?.length ?? 0); this.onCaption?.(); return { title: input.language, body: 'AI virtual makeup concept.', hashtags: ['Makeup'] } }
}

describe('local backend integration (isolated test database; no live requests)', () => {
  let directory: string
  let server: Server
  let runtime: ReturnType<typeof createStudioApp>
  let fake: FakeAI
  let bytes: Buffer
  let base: string
  let cookie: string
  let csrf: string
  async function call(path: string, init: RequestInit = {}) {
    return fetch(base + path, { ...init, headers: { Cookie: cookie, 'X-YZ-CSRF': csrf, ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init.headers } })
  }
  async function waitJob(id: string) {
    for (let i = 0; i < 200; i++) {
      const job = await (await call(`/api/jobs/${id}`)).json() as AIJob
      if (!['queued', 'running'].includes(job.status)) return job
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('test job did not complete')
  }
  async function upload() {
    const response = await call('/api/assets', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-YZ-Filename': encodeURIComponent('测试照片.jpg') }, body: new Uint8Array(bytes) })
    expect(response.status).toBe(201)
    return response.json()
  }
  async function reference(title = '写实优质参考', scores = { ...EMPTY_SCORES }) {
    const asset = await upload()
    const input = { id: randomUUID(), title, style: '韩系清透', assetIds: [asset.id], approved: true, priority: 3, scores, notes: '用户选定方向' }
    const response = await call('/api/quality-references', { method: 'POST', body: JSON.stringify(input) })
    expect(response.status).toBe(201)
    return response.json()
  }
  async function analyzeReference(id: string) {
    const response = await call(`/api/quality-references/${id}/analyze`, { method: 'POST', body: '{}' })
    expect(response.status).toBe(200)
    return response.json()
  }
  async function project() {
    const snapshot = runtime.database.snapshot()
    const id = randomUUID()
    const value = { id, title: '测试项目', artist: '测试化妆师', description: '', draft: initialWorkspace().draft, coverId: null, createdAt: Date.now(), updatedAt: Date.now() }
    const response = await call('/api/workspace', { method: 'PUT', body: JSON.stringify({ revision: snapshot.revision, state: { ...snapshot.state, projects: [value], activeProjectId: id } }) })
    expect(response.status).toBe(200)
    return id
  }
  async function imageBatch(projectId: string | null = null, count = 2, random = false) {
    const response = await call('/api/jobs/images', { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), projectId, draft: { ...initialWorkspace().draft, modelId: random ? null : 'model-01', prompt: '同一人物同一妆造', count, randomModel: { occupation: '设计师', age: 28, outfit: '灰色西装与白衬衫', country: '法国', ethnicity: '东亚面孔' } } }) })
    expect(response.status).toBe(202)
    return waitJob((await response.json()).id)
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'yuezhuang-test-'))
    bytes = await sharp({ create: { width: 40, height: 60, channels: 3, background: '#b99f84' } }).jpeg().toBuffer()
    fake = new FakeAI(bytes)
    runtime = createStudioApp({ dataDir: directory, publicDir: resolve('public'), keys: new MemoryKeys(), ai: fake })
    await new Promise<void>((resolve) => { server = runtime.app.listen(0, '127.0.0.1', () => resolve()) })
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const response = await fetch(base + '/api/session')
    cookie = response.headers.get('set-cookie')!.split(';')[0]
    csrf = (await response.json()).csrf
  })
  afterEach(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); runtime.database.close(); await rm(directory, { recursive: true, force: true }) })

  it('persists workspace, rejects stale saves and archives deleted projects', async () => {
    const id = await project()
    const old = initialWorkspace()
    expect((await call('/api/workspace', { method: 'PUT', body: JSON.stringify({ revision: 0, state: old }) })).status).toBe(409)
    expect(runtime.database.snapshot().state.projects[0].id).toBe(id)
    const current = runtime.database.snapshot()
    await call('/api/workspace', { method: 'PUT', body: JSON.stringify({ revision: current.revision, state: old }) })
    expect(runtime.database.sqlite.prepare('SELECT count(*) as n FROM project_archive').get()).toEqual({ n: 1 })
    const { StudioDatabase } = await import('../server/database/client')
    const reopened = new StudioDatabase(directory)
    expect(reopened.snapshot().revision).toBe(2)
    expect(reopened.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    reopened.close()
  })
  it('blocks cross-site requests, missing sessions, bad CSRF and invalid references', async () => {
    expect((await fetch(base + '/api/workspace')).status).toBe(401)
    expect((await call('/api/workspace', { headers: { Origin: 'https://untrusted.invalid' } })).status).toBe(403)
    expect((await call('/api/workspace', { method: 'PUT', headers: { 'X-YZ-CSRF': 'x' }, body: '{}' })).status).toBe(403)
    const state = { ...initialWorkspace(), draft: { ...initialWorkspace().draft, referenceId: randomUUID() } }
    expect((await call('/api/workspace', { method: 'PUT', body: JSON.stringify({ revision: 0, state }) })).status).toBe(400)
  })
  it('validates decoded images, saves original and thumbnail, and exports checksummed bytes', async () => {
    expect((await call('/api/assets', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: 'corrupt bytes' })).status).toBe(400)
    const asset = await upload()
    const original = await call(asset.src)
    expect(Buffer.from(await original.arrayBuffer())).toEqual(bytes)
    const thumbnail = await call(asset.thumbnailSrc)
    expect((await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata()).format).toBe('jpeg')
    const backup = await (await call('/api/backup')).json()
    expect(backup.files).toHaveLength(1)
    expect(createHash('sha256').update(Buffer.from(backup.files[0].data, 'base64')).digest('hex')).toBe(backup.files[0].sha256)
    expect((await readFile(join(directory, 'studio.sqlite'))).includes(Buffer.from('apiKey'))).toBe(false)
  })
  it('uploads a legacy asset idempotently and preserves valid references', async () => {
    const id = randomUUID()
    const send = () => call(`/api/assets?id=${id}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(bytes) })
    expect((await send()).status).toBe(201)
    expect((await send()).status).toBe(201)
    expect(runtime.database.assets()).toHaveLength(1)
    const state = { ...initialWorkspace(), draft: { ...initialWorkspace().draft, referenceId: id } }
    expect((await call('/api/workspace', { method: 'PUT', body: JSON.stringify({ revision: 0, state }) })).status).toBe(200)
  })
  it('retains completed images on partial failure and deduplicates repeated requests', async () => {
    fake.failAt = 2
    const projectId = await project()
    const payload = { requestId: randomUUID(), projectId, draft: { ...initialWorkspace().draft, modelId: 'model-01', prompt: '测试', count: 4 } }
    const job = await (await call('/api/jobs/images', { method: 'POST', body: JSON.stringify(payload) })).json()
    const done = await waitJob(job.id)
    expect(done.status).toBe('partial')
    expect(done.completedCount).toBe(1)
    expect(runtime.database.assets()).toHaveLength(1)
    expect(runtime.database.snapshot().state.projects.find((p) => p.id === projectId)!.coverId).toBe(done.resultAssetIds[0])
    const duplicate = await (await call('/api/jobs/images', { method: 'POST', body: JSON.stringify(payload) })).json()
    expect(duplicate.id).toBe(done.id)
    expect(fake.calls).toBe(2)
  })
  it('passes selected original to the edit provider and cancels remaining images', async () => {
    fake.delay = 100
    const asset = await upload()
    const payload = { requestId: randomUUID(), projectId: null, draft: { ...initialWorkspace().draft, mode: 'edit', prompt: '调整光线', referenceId: asset.id, count: 4 } }
    const job = await (await call('/api/jobs/images', { method: 'POST', body: JSON.stringify(payload) })).json()
    for (let i = 0; i < 100 && fake.calls === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    expect((await call(`/api/jobs/${job.id}/cancel`, { method: 'POST' })).status).toBe(200)
    const done = await waitJob(job.id)
    expect(done.status).toBe('cancelled')
    expect(done.completedCount).toBe(1)
    expect(fake.calls).toBe(1)
    expect(fake.references).toBe(1)
    expect(fake.imagePrompts[0]).toContain('Photorealistic portrait')
    expect(fake.imagePrompts[0]).toContain('only within the requested edit scope')
    expect(fake.imagePrompts[0]).toContain('调整光线')
  })
  it('keeps the selected model for a whole batch and records it despite later draft changes', async () => {
    const id = await project()
    const draft = { ...initialWorkspace().draft, imageModel: 'gpt-image-2.5-flare', prompt: '同一人物同一妆造', count: 2 as const }
    const snapshot = runtime.database.snapshot()
    expect((await call('/api/workspace', { method: 'PUT', body: JSON.stringify({ revision: snapshot.revision, state: { ...snapshot.state, draft, projects: snapshot.state.projects.map((p) => ({ ...p, draft })) } }) })).status).toBe(200)
    expect((await (await call('/api/workspace')).json()).state.projects[0].draft.imageModel).toBe('gpt-image-2.5-flare')
    fake.onImage = () => runtime.database.mutateWorkspace((s) => ({ ...s, draft: { ...s.draft, imageModel: 'gpt-image-2.5-sunburst' } }))
    const response = await call('/api/jobs/images', { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), projectId: id, draft }) })
    expect(response.status).toBe(202)
    const done = await waitJob((await response.json()).id)
    expect(done.status).toBe('succeeded')
    expect(done.model).toBe('gpt-image-2.5-flare')
    expect(fake.selectedImageModels).toEqual(['gpt-image-2.5-flare', 'gpt-image-2.5-flare'])
    const record = await (await call(`/api/prompt-history/${done.id}`)).json()
    expect(record.model).toBe('gpt-image-2.5-flare')
    expect(record.draft.imageModel).toBe('gpt-image-2.5-flare')
    expect(runtime.database.groups().find((group) => group.id === done.id)?.draft?.imageModel).toBe('gpt-image-2.5-flare')
    expect(fake.config().imageModel).toBe('test-image')
    expect((await (await call('/api/provider')).json()).imageModel).toBe('gpt-image-2')
  })
  it('passes the selected model and original photo when editing', async () => {
    const asset = await upload()
    const response = await call('/api/jobs/images', { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), projectId: null, draft: { ...initialWorkspace().draft, mode: 'edit', referenceId: asset.id, prompt: '柔和面部光线', count: 1, imageModel: 'gpt-image-2.5-sunburst' } }) })
    expect(response.status).toBe(202)
    const done = await waitJob((await response.json()).id)
    expect(done.status).toBe('succeeded')
    expect(done.model).toBe('gpt-image-2.5-sunburst')
    expect(fake.selectedImageModels).toEqual(['gpt-image-2.5-sunburst'])
    expect(fake.referenceCounts).toEqual([1])
  })
  it('uses the configured default for older drafts with no image-model field', async () => {
    const { imageModel: _imageModel, ...draft } = initialWorkspace().draft
    const response = await call('/api/jobs/images', { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), projectId: null, draft: { ...draft, prompt: '旧项目描述', count: 1 } }) })
    const done = await waitJob((await response.json()).id)
    expect(done.status).toBe('succeeded')
    expect(done.model).toBe('test-image')
    expect(fake.selectedImageModels).toEqual(['test-image'])
    expect((await (await call(`/api/prompt-history/${done.id}`)).json()).model).toBe('test-image')
  })
  it('rejects unavailable image choices before enqueuing or sending paid requests', async () => {
    for (const imageModel of ['gpt-image-2.5-retired', 'test-text']) {
      const response = await call('/api/jobs/images', { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), projectId: null, draft: { ...initialWorkspace().draft, prompt: '测试', imageModel, count: 1 } }) })
      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('IMAGE_MODEL_UNAVAILABLE')
    }
    expect(fake.calls).toBe(0)
    expect(runtime.database.listJobs()).toHaveLength(0)
    expect(runtime.prompts.history({ q: '', offset: 0, limit: 30 }).items).toHaveLength(0)
  })
  it('preserves locked captions and changes made during generation', async () => {
    const id = await project()
    const { emptyCaptions } = await import('../src/lib/data')
    const captions = emptyCaptions(); captions.zh = { title: '人工中文', body: '保留', hashtags: '', locked: true }
    runtime.database.mutateWorkspace((s) => ({ ...s, captions: { [id]: captions } }))
    const first = await (await call('/api/jobs/captions', { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), projectId: id, languages: ['zh', 'en', 'ko'] }) })).json()
    expect((await waitJob(first.id)).completedCount).toBe(2)
    expect(runtime.database.snapshot().state.captions[id].zh.title).toBe('人工中文')
    fake.onCaption = () => runtime.database.mutateWorkspace((s) => ({ ...s, captions: { ...s.captions, [id]: { ...s.captions[id], en: { ...s.captions[id].en, body: '请求期间人工修改' } } } }))
    const second = await (await call('/api/jobs/captions', { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), projectId: id, languages: ['en'] }) })).json()
    expect((await waitJob(second.id)).status).toBe('failed')
    expect(runtime.database.snapshot().state.captions[id].en.body).toBe('请求期间人工修改')
  })
  it('recovers in-flight jobs as interrupted without resubmitting', () => {
    const job: AIJob = { id: randomUUID(), kind: 'image', projectId: null, status: 'running', model: 'test-image', requestedCount: 1, completedCount: 0, resultAssetIds: [], completedLanguages: [], cancelRequested: false, error: null, createdAt: Date.now(), updatedAt: Date.now(), completedAt: null }
    runtime.database.db.insert(jobTable).values({ id: job.id, requestId: randomUUID(), payload: job, input: {} }).run()
    runtime.jobs.recover()
    expect(runtime.database.job(job.id)!.payload.status).toBe('interrupted')
    expect(fake.calls).toBe(0)
  })
  it('soft deletes images and removes their model and project associations', async () => {
    const asset = await upload()
    const id = await project()
    const modelId = randomUUID()
    runtime.database.mutateWorkspace((s) => ({ ...s, draft: { ...s.draft, referenceId: asset.id, modelId }, customModels: [{ id: modelId, name: '本地模特', description: '', assetId: asset.id, tags: [], example: false }], projects: s.projects.map((p) => ({ ...p, coverId: asset.id, draft: { ...p.draft, referenceId: asset.id, modelId } })) }))
    expect((await call(`/api/assets/${asset.id}`, { method: 'DELETE' })).status).toBe(200)
    const state = runtime.database.snapshot().state
    expect(state.importedAssets).toHaveLength(0)
    expect(state.customModels).toHaveLength(0)
    expect(state.projects.find((p) => p.id === id)!.coverId).toBeNull()
    expect(state.draft.modelId).toBeNull()
    expect((await call(asset.src)).status).toBe(404)
  })
  it('groups by generation batch and anchors later photos to the first finished person', async () => {
    const id = await project()
    const first = await imageBatch(id, 2)
    const second = await imageBatch(id, 1)
    expect(first.status).toBe('succeeded')
    const groups = runtime.database.snapshot().state.workGroups
    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.id === first.id)!.assetIds).toEqual(first.resultAssetIds)
    expect(groups.find((g) => g.id === second.id)!.assetIds).toHaveLength(1)
    expect(fake.referenceCounts).toEqual([0, 1, 0])
  })
  it('sends all group photos for one shared caption and preserves the locked language', async () => {
    const first = await imageBatch(null, 2)
    const second = await imageBatch(null, 1)
    const { emptyCaptions } = await import('../src/lib/data')
    const captions = emptyCaptions(); captions.zh = { title: '人工整组文案', body: '不覆盖', hashtags: '', locked: true }
    runtime.database.mutateWorkspace((s) => ({ ...s, groupCaptions: { [first.id]: captions } }))
    const job = await (await call('/api/jobs/captions', { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), groupId: first.id, languages: ['zh', 'en', 'ko'] }) })).json()
    const done = await waitJob(job.id)
    expect(done.completedCount).toBe(2)
    expect(done.groupId).toBe(first.id)
    expect(fake.captionReferences).toEqual([2, 2])
    expect(runtime.database.snapshot().state.groupCaptions[first.id].zh.body).toBe('不覆盖')
    expect(runtime.database.snapshot().state.groupCaptions[second.id]).toBeUndefined()
  })
  it('groups a multi-file import and supports captions without a project', async () => {
    const groupId = randomUUID()
    for (let i = 0; i < 2; i++) expect((await call(`/api/assets?groupId=${groupId}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(bytes) })).status).toBe(201)
    const group = runtime.database.snapshot().state.workGroups[0]
    expect(group.projectId).toBeNull()
    expect(group.assetIds).toHaveLength(2)
    const job = await (await call('/api/jobs/captions', { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), groupId, languages: ['zh'] }) })).json()
    expect((await waitJob(job.id)).status).toBe('succeeded')
    expect(fake.captionReferences).toEqual([2])
    expect((await call('/api/jobs/captions', { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), groupId: randomUUID(), languages: ['zh'] }) })).status).toBe(404)
  })
  it('automatically saves just one model per successful random batch', async () => {
    const done = await imageBatch(null, 2, true)
    const models = runtime.database.snapshot().state.customModels
    expect(models).toHaveLength(1)
    expect(models[0].originJobId).toBe(done.id)
    expect(models[0].assetId).toBe(done.resultAssetIds[0])
    expect(models[0].description).toContain('28')
    expect(models[0].description).toContain('设计师')
    expect(done.resultModelId).toBe(models[0].id)
  })
  it('generates with blank or partial character settings and rejects only an invalid supplied age', async () => {
    const draft = { ...initialWorkspace().draft, prompt: '自然的人像照片', count: 1 }
    const send = (randomModel: unknown) => call('/api/jobs/images', { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), projectId: null, draft: { ...draft, randomModel } }) })
    const invalid = await send({ age: 17 })
    expect(invalid.status).toBe(400)
    expect((await invalid.json()).error.code).toBe('RANDOM_MODEL_INVALID')
    expect(fake.calls).toBe(0)
    for (const settings of [{}, { occupation: '律师', outfit: '灰色西装' }]) {
      const response = await send(settings)
      expect(response.status).toBe(202)
      const done = await waitJob((await response.json()).id)
      expect(done.status).toBe('succeeded')
      const model = runtime.database.snapshot().state.customModels.find((m) => m.originJobId === done.id)!
      expect(model.name).toContain('occupation' in settings ? '律师' : '随机模特')
      expect(`${model.name} ${model.description} ${fake.imagePrompts.at(-1)}`).not.toMatch(/null|undefined|年龄岁/)
      expect(fake.imagePrompts.at(-1)).toContain('fictional adult')
    }
    expect(fake.imagePrompts.at(-1)).toContain('灰色西装')
    expect(runtime.database.snapshot().state.customModels).toHaveLength(2)
  })
  it('migrates project captions once onto the cover artwork group without deleting old text', async () => {
    const id = await project(); const batch = await imageBatch(id, 1)
    const { emptyCaptions } = await import('../src/lib/data')
    const captions = emptyCaptions(); captions.zh.body = '旧项目文案'
    const legacy = { ...runtime.database.snapshot().state, captions: { [id]: captions } } as Record<string, unknown>
    delete legacy.groupCaptions
    runtime.database.sqlite.prepare('UPDATE workspace_state SET payload=? WHERE id=1').run(JSON.stringify(legacy))
    runtime.database.sqlite.pragma('user_version = 1')
    const { StudioDatabase } = await import('../server/database/client')
    const migrated = new StudioDatabase(directory)
    expect(migrated.snapshot().state.groupCaptions[batch.id].zh.body).toBe('旧项目文案')
    expect(migrated.snapshot().state.captions[id].zh.body).toBe('旧项目文案')
    expect(migrated.sqlite.pragma('user_version', { simple: true })).toBe(4)
    migrated.close()
  })
  it('drops the caption of a group only when its last photo is deleted', async () => {
    const done = await imageBatch(null, 2)
    const { emptyCaptions } = await import('../src/lib/data')
    runtime.database.mutateWorkspace((s) => ({ ...s, groupCaptions: { [done.id]: emptyCaptions() } }))
    await call(`/api/assets/${done.resultAssetIds[0]}`, { method: 'DELETE' })
    expect(runtime.database.snapshot().state.groupCaptions[done.id]).toBeDefined()
    await call(`/api/assets/${done.resultAssetIds[1]}`, { method: 'DELETE' })
    expect(runtime.database.snapshot().state.groupCaptions[done.id]).toBeUndefined()
    expect(runtime.database.snapshot().state.workGroups).toHaveLength(0)
  })
  it('enforces photographed human texture for manual descriptions and every photo in a batch', async () => {
    const done = await imageBatch(null, 2, true)
    expect(done.status).toBe('succeeded')
    expect(fake.imagePrompts).toHaveLength(2)
    for (const prompt of fake.imagePrompts) {
      expect(prompt).toContain('Photorealistic portrait')
      expect(prompt).toContain('subtle pores')
      expect(prompt).toContain('realistic fabric')
      expect(prompt).toContain('年龄28岁')
      expect(prompt).toContain('灰色西装与白衬衫')
      expect(prompt).toContain('同一人物同一妆造')
    }
    expect(fake.imagePrompts[1]).toContain('preserve its facial identity and makeup precisely')
  })
  it('persists exact prompts before sending each request and links results and ordered references', async () => {
    fake.onImage = (prompt) => {
      const page = runtime.prompts.history({ q: '', offset: 0, limit: 30 })
      expect(page.items[0].attempts.at(-1)?.prompt).toBe(prompt)
      expect(page.items[0].attempts.at(-1)?.status).toBe('running')
    }
    const done = await imageBatch(null, 2)
    const item = await (await call(`/api/prompt-history/${done.id}`)).json()
    expect(item.legacy).toBe(false)
    expect(item.draft.prompt).toBe('同一人物同一妆造')
    expect(item.attempts.map((a: { prompt: string }) => a.prompt)).toEqual(fake.imagePrompts)
    expect(item.attempts.map((a: { assetId: string }) => a.assetId)).toEqual(done.resultAssetIds)
    expect(item.attempts[1].referenceIds).toEqual([done.resultAssetIds[0]])
    expect(item.attempts.every((a: { status: string }) => a.status === 'succeeded')).toBe(true)
    await call(`/api/assets/${done.resultAssetIds[0]}`, { method: 'DELETE' })
    expect((await (await call(`/api/prompt-history/${done.id}`)).json()).attempts[0].prompt).toBe(fake.imagePrompts[0])
  })
  it('retains failed requests, feedback and interruptions without retrying the image', async () => {
    fake.failAt = 2
    const done = await imageBatch(null, 4)
    const item = runtime.prompts.historyItem(done.id)
    expect(item.job.status).toBe('partial')
    expect(item.attempts.map((a) => a.status)).toEqual(['succeeded', 'failed'])
    expect(item.attempts[1].prompt).toBe(fake.imagePrompts[1])
    expect(fake.calls).toBe(2)
    const feedback = { rating: 'poor', notes: '皮肤太平滑，下次减少高光词。' }
    expect((await call(`/api/prompt-history/${done.id}/feedback`, { method: 'PUT', body: JSON.stringify(feedback) })).status).toBe(200)
    runtime.database.updateJob(done.id, { status: 'running' })
    runtime.database.sqlite.prepare("UPDATE prompt_history SET payload=json_set(payload,'$.attempts[1].status','running') WHERE id=?").run(done.id)
    runtime.jobs.recover()
    const recovered = runtime.prompts.historyItem(done.id)
    expect(recovered.job.status).toBe('interrupted')
    expect(recovered.attempts[1].status).toBe('interrupted')
    expect(recovered.feedback).toEqual(feedback)
    expect(fake.calls).toBe(2)
  })
  it('stores the reusable library, supports favorites, searches, and rejects conflicting edits', async () => {
    const source = await imageBatch(null, 1)
    const value = { id: randomUUID(), title: '自然窗光职业人像', prompt: '保留真实皮肤与唇纹，柔和单侧窗光。', style: '港风红唇', mode: 'virtual', author: '化妆师 A', tags: ['写实', '职业人像'], notes: '光泽保持克制', sourceJobId: source.id, model: 'test-image' }
    const response = await call('/api/prompt-library', { method: 'POST', body: JSON.stringify(value) })
    expect(response.status).toBe(201)
    const template = await response.json()
    expect(template.assetIds).toEqual(source.resultAssetIds)
    expect((await call('/api/prompt-library', { method: 'POST', body: JSON.stringify(value) })).status).toBe(201)
    expect((await (await call('/api/prompt-library?q=职业人像')).json()).total).toBe(1)
    expect((await (await call('/api/prompt-library?q=不存在')).json()).total).toBe(0)
    await call(`/api/prompt-library/${template.id}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite: true }) })
    expect((await (await call('/api/prompt-library?favorite=true')).json()).total).toBe(1)
    const edit = { ...value, version: template.version, title: '优化后的自然人像' }
    const updated = await (await call(`/api/prompt-library/${template.id}`, { method: 'PUT', body: JSON.stringify(edit) })).json()
    expect(updated.version).toBe(2)
    expect(updated.favorite).toBe(true)
    expect((await call(`/api/prompt-library/${template.id}`, { method: 'PUT', body: JSON.stringify(edit) })).status).toBe(409)
    expect((await call(`/api/prompt-library/${template.id}?version=1`, { method: 'DELETE' })).status).toBe(409)
    const backup = await (await call('/api/backup')).json()
    expect(backup.prompts.history[0].attempts[0].prompt).toBe(fake.imagePrompts[0])
    expect(backup.prompts.library[0].favorite).toBe(true)
    expect(JSON.stringify(backup.prompts)).not.toContain('apiKey')
    expect((await call(`/api/prompt-library/${template.id}?version=2`, { method: 'DELETE' })).status).toBe(200)
    expect(runtime.prompts.historyItem(source.id).attempts).toHaveLength(1)
  })
  it('backfills old image jobs with source descriptions without inventing exact requests', async () => {
    const done = await imageBatch(null, 1)
    runtime.database.sqlite.exec('DROP TABLE prompt_history; DROP TABLE prompt_library; PRAGMA user_version=2')
    const { StudioDatabase } = await import('../server/database/client')
    const migrated = new StudioDatabase(directory)
    const { PromptService } = await import('../server/services/prompts')
    const prompts = new PromptService(migrated)
    const item = prompts.historyItem(done.id)
    expect(item.legacy).toBe(true)
    expect(item.draft.prompt).toBe('同一人物同一妆造')
    expect(item.attempts).toEqual([])
    expect(prompts.history({ q: '同一人物', offset: 0, limit: 1 }).total).toBe(1)
    migrated.close()
  })
  it('keeps a cancelled queued generation in prompt history without sending its request', async () => {
    fake.delay = 80
    const submit = () => call('/api/jobs/images', { method: 'POST', body: JSON.stringify({ requestId: randomUUID(), projectId: null, draft: { ...initialWorkspace().draft, modelId: 'model-01', count: 1, prompt: '保留取消前填写的描述' } }) })
    const first = await (await submit()).json()
    const second = await (await submit()).json()
    expect((await call(`/api/jobs/${second.id}/cancel`, { method: 'POST' })).status).toBe(200)
    await waitJob(first.id)
    await waitJob(second.id)
    const record = runtime.prompts.historyItem(second.id)
    expect(record.job.status).toBe('cancelled')
    expect(record.draft.prompt).toBe('保留取消前填写的描述')
    expect(record.attempts).toEqual([])
    expect(fake.calls).toBe(1)
  })
  it('paginates and exports prompt history beyond the recent 100-job window', async () => {
    for (let i = 0; i < 105; i++) {
      const id = randomUUID()
      const job: AIJob = { id, kind: 'image', projectId: null, status: 'cancelled', model: 'test-image', requestedCount: 1, completedCount: 0, resultAssetIds: [], completedLanguages: [], cancelRequested: true, error: null, createdAt: i, updatedAt: i, completedAt: i }
      runtime.database.db.insert(jobTable).values({ id, requestId: randomUUID(), payload: job, input: {} }).run()
      runtime.prompts.record(job, { ...initialWorkspace().draft, prompt: `分页记录 ${i}` })
    }
    expect(runtime.database.listJobs()).toHaveLength(100)
    const first = await (await call('/api/prompt-history?limit=30')).json()
    const last = await (await call('/api/prompt-history?limit=30&offset=90')).json()
    expect(first.total).toBe(105)
    expect(first.items).toHaveLength(30)
    expect(last.items).toHaveLength(15)
    expect(last.items.at(-1).draft.prompt).toBe('分页记录 0')
    const exported = await (await call('/api/export')).json()
    expect(exported.prompts.history).toHaveLength(105)
  })
  it('reverse-analyzes references without silently adopting AI scores and preserves their library provenance', async () => {
    const source = await reference()
    const analyzed = await analyzeReference(source.id)
    expect(analyzed.analysis.prompt).toContain('美妆摄影')
    expect(analyzed.scores).toEqual(EMPTY_SCORES)
    expect(analyzed.weighted.score).toBeNull()
    expect(analyzed.analysis.suggestedScores.realism).toBe(4)
    expect(analyzed.analysis.suggestedScores.consistency).toBeNull()
    expect(fake.analysisCalls).toBe(1)
    const template = await (await call('/api/prompt-library', { method: 'POST', body: JSON.stringify({ id: randomUUID(), title: '视觉反推提示词', prompt: analyzed.analysis.prompt, style: analyzed.style, mode: 'virtual', author: '测试化妆师', tags: ['图片反推'], notes: '原始提示词未知', sourceJobId: null, sourceReferenceId: source.id, model: 'test-text' }) })).json()
    expect(template.assetIds).toEqual(source.assetIds)
    expect(template.sourceReferenceId).toBe(source.id)
    const backup = await (await call('/api/backup')).json()
    expect(backup.quality.references[0].analysis.prompt).toBe(analyzed.analysis.prompt)
    expect(backup.quality.preferences.weights.realism).toBe(35)
  })
  it('reranks by user weights and snapshots selected directions for both descriptions and final images', async () => {
    const a = await reference('照片感优先样本', { realism: 5, makeup: 1, lighting: 5, composition: 5, consistency: null })
    const b = await reference('妆容优先样本', { realism: 1, makeup: 5, lighting: 5, composition: 5, consistency: null })
    await analyzeReference(a.id); await analyzeReference(b.id)
    const prefs = { ...DEFAULT_QUALITY_PREFERENCES, maxSources: 1, minScore: 0, weights: { realism: 100, makeup: 0, lighting: 0, composition: 0, consistency: 0 } }
    expect((await call('/api/quality-preferences', { method: 'PUT', body: JSON.stringify(prefs) })).status).toBe(200)
    expect(runtime.quality.context(initialWorkspace().draft).sources[0].id).toBe(a.id)
    const description = await (await call('/api/prompts', { method: 'POST', body: JSON.stringify({ action: 'random', draft: initialWorkspace().draft }) })).json()
    expect(description.guidance.sources[0].id).toBe(a.id)
    expect(fake.descriptionInput?.guidance?.sources[0].id).toBe(a.id)
    const done = await imageBatch(null, 1)
    expect(runtime.prompts.historyItem(done.id).guidance?.sources[0].id).toBe(a.id)
    expect(fake.imagePrompts[0]).toContain('照片感优先样本')
    prefs.weights = { realism: 0, makeup: 100, lighting: 0, composition: 0, consistency: 0 }
    await call('/api/quality-preferences', { method: 'PUT', body: JSON.stringify(prefs) })
    expect(runtime.quality.context(initialWorkspace().draft).sources[0].id).toBe(b.id)
    expect(runtime.prompts.historyItem(done.id).guidance?.sources[0].id).toBe(a.id)
  })
  it('excludes low or insufficiently rated directions and supports disabling optimization', async () => {
    const low = await reference('低分方向', { realism: 1, makeup: 1, lighting: 1, composition: 1, consistency: null })
    await analyzeReference(low.id)
    const partial = await reference('仅评一个维度', { ...EMPTY_SCORES, realism: 5 })
    await analyzeReference(partial.id)
    expect(runtime.quality.context(initialWorkspace().draft).sources).toEqual([])
    const approved = await reference('明确认可但未评分')
    const analyzed = await analyzeReference(approved.id)
    expect(runtime.quality.context(initialWorkspace().draft).sources[0].score).toBeNull()
    await call('/api/quality-preferences', { method: 'PUT', body: JSON.stringify({ ...DEFAULT_QUALITY_PREFERENCES, weights: { realism: 0, makeup: 0, lighting: 0, composition: 0, consistency: 100 } }) })
    expect(runtime.quality.context(initialWorkspace().draft).sources).toEqual([])
    await call('/api/quality-preferences', { method: 'PUT', body: JSON.stringify(DEFAULT_QUALITY_PREFERENCES) })
    await call(`/api/quality-references/${approved.id}`, { method: 'PUT', body: JSON.stringify({ ...analyzed, approved: false }) })
    expect(runtime.quality.context(initialWorkspace().draft).sources).toEqual([])
    await call('/api/quality-preferences', { method: 'PUT', body: JSON.stringify({ ...DEFAULT_QUALITY_PREFERENCES, enabled: false }) })
    const done = await imageBatch(null, 1)
    expect(runtime.prompts.historyItem(done.id).guidance?.enabled).toBe(false)
    expect(fake.imagePrompts[0]).not.toContain('Preferred visual techniques')
  })
  it('does not overwrite reference edits when an analysis finishes late and prevents duplicate calls', async () => {
    const source = await reference()
    fake.analysisDelay = 80
    const pending = call(`/api/quality-references/${source.id}/analyze`, { method: 'POST', body: '{}' })
    for (let i = 0; i < 100 && fake.analysisCalls === 0; i++) await new Promise((r) => setTimeout(r, 5))
    expect((await call(`/api/quality-references/${source.id}/analyze`, { method: 'POST', body: '{}' })).status).toBe(429)
    await call(`/api/quality-references/${source.id}`, { method: 'PUT', body: JSON.stringify({ ...source, notes: '保留新的人工心得' }) })
    expect((await pending).status).toBe(409)
    const current = runtime.quality.get(source.id)
    expect(current.notes).toBe('保留新的人工心得')
    expect(current.analysis).toBeNull()
    expect(fake.analysisCalls).toBe(1)
  })
  it('rejects zero total weights, invalid scores and repeated reference images without changing saved settings', async () => {
    const source = await reference()
    expect((await call('/api/quality-preferences', { method: 'PUT', body: JSON.stringify({ ...DEFAULT_QUALITY_PREFERENCES, weights: { realism: 0, makeup: 0, lighting: 0, composition: 0, consistency: 0 } }) })).status).toBe(400)
    expect(runtime.quality.preferences()).toEqual(DEFAULT_QUALITY_PREFERENCES)
    expect((await call(`/api/quality-references/${source.id}`, { method: 'PUT', body: JSON.stringify({ ...source, scores: { ...EMPTY_SCORES, realism: 6 } }) })).status).toBe(400)
    expect((await call('/api/quality-references', { method: 'POST', body: JSON.stringify({ ...source, id: randomUUID(), assetIds: [source.assetIds[0], source.assetIds[0]] }) })).status).toBe(400)
    expect(runtime.quality.get(source.id).scores).toEqual(EMPTY_SCORES)
  })
  it('invalidates old analysis and scores when reference images or the target style change', async () => {
    const source = await reference('待更换的方向', { realism: 5, makeup: 5, lighting: 5, composition: 5, consistency: null })
    const analyzed = await analyzeReference(source.id)
    const response = await call(`/api/quality-references/${source.id}`, { method: 'PUT', body: JSON.stringify({ ...analyzed, style: '舞台晚宴' }) })
    expect(response.status).toBe(200)
    const updated = await response.json()
    expect(updated.analysis).toBeNull()
    expect(updated.scores).toEqual(EMPTY_SCORES)
    expect(runtime.quality.context({ ...initialWorkspace().draft, style: '舞台晚宴' }).sources).toEqual([])
  })
})
