import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { StudioDatabase } from '../database/client'
import { jobTable } from '../database/schema'
import { AssetService } from './assets'
import type { AIProvider } from '../providers/openai-compatible'
import { AppError, safeMessage } from '../errors'
import { captionJobInputSchema, imageJobInputSchema } from '../../src/shared/contracts'
import type { AIJob } from '../../src/shared/contracts'
import { emptyCaptions, SAMPLE_MODELS } from '../../src/lib/data'
import { characterSettingDetails, invalidRandomModelField } from '../../src/lib/random-model'
import { photographicImagePrompt } from '../../src/shared/photography'
import { PromptService } from './prompts'
import type { QualityService } from './quality'
import { guidanceText } from '../../src/shared/quality'
import type { PromptGuidance } from '../../src/shared/quality'

const SIZES: Record<string, string> = { '3:4': '768x1024', '4:5': '1024x1280', '1:1': '1024x1024', '16:9': '1536x864', '9:16': '864x1536' }

export class JobService {
  private working = false
  constructor(private database: StudioDatabase, private assets: AssetService, private provider: AIProvider, private prompts: PromptService, private quality: QualityService) {}
  recover() {
    this.prompts.recover()
    for (const job of this.database.listJobs()) {
      if (job.status === 'running') this.database.updateJob(job.id, { status: 'interrupted', error: '本地服务在请求期间重启。请先核对供应商记录，再手动创建新任务。', completedAt: Date.now() })
    }
    void this.run()
  }
  enqueue(kind: 'image' | 'caption', value: unknown): AIJob {
    const input = kind === 'image' ? imageJobInputSchema.parse(value) : captionJobInputSchema.parse(value)
    const existing = this.database.db.select().from(jobTable).where(eq(jobTable.requestId, input.requestId)).get()
    if (existing) return existing.payload
    const workspace = this.database.snapshot().state
    const providerConfig = this.provider.config()
    const requestedModel = kind === 'image' ? imageJobInputSchema.parse(input).draft.imageModel : null
    if (requestedModel && !(this.provider.imageModels?.() ?? [providerConfig.imageModel]).includes(requestedModel)) throw new AppError('IMAGE_MODEL_UNAVAILABLE', '所选图片模型不在当前服务的可用列表中，请重新选择，或在设置中测试连接刷新列表。')
    const captionInput = kind === 'caption' ? captionJobInputSchema.parse(input) : null
    const group = captionInput?.groupId ? this.database.groups().find((g) => g.id === captionInput.groupId) : null
    if (captionInput?.groupId && !group) throw new AppError('GROUP_NOT_FOUND', '请选择作品库中已有图片的作品组。', 404)
    const captionAssets = captionInput?.assetIds ?? group?.assetIds ?? []
    if (captionInput?.assetIds && (!group || captionAssets.some((id) => !group.assetIds.includes(id)) || new Set(captionAssets).size !== captionAssets.length)) throw new AppError('GROUP_ASSETS_INVALID', '请选择当前作品组内不重复的图片。')
    if (captionAssets.length > 20) throw new AppError('GROUP_TOO_LARGE', '单组文案暂支持最多 20 张图片。')
    if (input.projectId && !workspace.projects.some((p) => p.id === input.projectId)) throw new AppError('PROJECT_NOT_FOUND', '请先保存妆容项目。', 404)
    if (kind === 'image') {
      const data = imageJobInputSchema.parse(input)
      const missing = invalidRandomModelField(data.draft)
      if (missing) throw new AppError('RANDOM_MODEL_INVALID', missing.message)
      if (!data.draft.prompt.trim()) throw new AppError('PROMPT_REQUIRED', '请填写妆容描述。')
      if (data.draft.mode === 'edit' && !data.draft.referenceId) throw new AppError('REFERENCE_REQUIRED', '修图需要选择原始照片。')
    }
    if (this.database.listJobs().filter((j) => ['queued', 'running'].includes(j.status)).length >= 10) throw new AppError('QUEUE_FULL', '已有较多任务等待处理，请稍后再试。', 429)
    const job: AIJob = { id: randomUUID(), kind, projectId: input.projectId ?? null, status: 'queued', model: kind === 'image' ? requestedModel ?? providerConfig.imageModel : providerConfig.textModel, requestedCount: kind === 'image' ? imageJobInputSchema.parse(input).draft.count : new Set(captionJobInputSchema.parse(input).languages).size, completedCount: 0, resultAssetIds: [], completedLanguages: [], cancelRequested: false, error: null, createdAt: Date.now(), updatedAt: Date.now(), completedAt: null }
    job.projectId = input.projectId ?? group?.projectId ?? null
    job.groupId = kind === 'image' ? job.id : captionInput?.groupId ?? null
    const guidance = kind === 'image' ? this.quality.context(imageJobInputSchema.parse(input).draft) : undefined
    const preparedInput = { ...input, providerConfig, ...(guidance ? { guidance } : {}), ...(kind === 'caption' ? { baseline: group ? workspace.groupCaptions[group.id] ?? emptyCaptions() : workspace.captions[input.projectId!] ?? emptyCaptions(), sourceAssetIds: captionAssets } : {}) }
    this.database.sqlite.transaction(() => {
      this.database.db.insert(jobTable).values({ id: job.id, requestId: input.requestId, payload: job, input: preparedInput }).run()
      if (kind === 'image') this.prompts.record(job, imageJobInputSchema.parse(input).draft, guidance)
    })()
    this.database.audit('ai.enqueue', job.id)
    void this.run()
    return job
  }
  cancel(id: string) {
    const job = this.database.job(id)?.payload
    if (!job) throw new AppError('NOT_FOUND', '任务不存在。', 404)
    if (!['queued', 'running'].includes(job.status)) throw new AppError('JOB_FINISHED', '任务已经结束。')
    return this.database.updateJob(id, { cancelRequested: true, ...(job.status === 'queued' ? { status: 'cancelled' as const, completedAt: Date.now() } : {}) })
  }
  private async run() {
    if (this.working) return
    this.working = true
    try {
      while (true) {
        const next = this.database.listJobs().filter((j) => j.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0]
        if (!next) break
        this.database.updateJob(next.id, { status: 'running' })
        const errors: string[] = []
        try {
          this.ensureProvider(next.id)
          if (next.kind === 'image') await this.images(next.id, errors)
          else await this.captions(next.id, errors)
        } catch (error) { errors.push(safeMessage(error)); this.database.audit('ai.error', next.id, error instanceof AppError ? error.code : 'UNKNOWN') }
        const done = this.database.job(next.id)!.payload
        const status = done.cancelRequested ? 'cancelled' : done.completedCount === done.requestedCount ? 'succeeded' : done.completedCount > 0 ? 'partial' : 'failed'
        this.database.updateJob(next.id, { status, error: errors.join('；').slice(0, 1000) || null, completedAt: Date.now() })
      }
    } finally { this.working = false }
  }
  private ensureProvider(id: string) {
    const config = this.database.job(id)!.input.providerConfig
    if (JSON.stringify(config) !== JSON.stringify(this.provider.config())) throw new AppError('CONFIG_CHANGED', '服务地址或模型配置已改变，任务已停止。请核对新配置后重新创建任务。')
  }
  private async images(id: string, errors: string[]) {
    const row = this.database.job(id)!
    const input = imageJobInputSchema.parse(row.input)
    const workspace = this.database.snapshot().state
    const model = [...workspace.customModels, ...SAMPLE_MODELS].find((m) => m.id === input.draft.modelId)
    const refs = new Set<string>()
    let prompt = input.draft.prompt
    if (input.draft.mode === 'virtual') {
      prompt = `Photograph a fictional adult human subject wearing makeup. Makeup style: ${input.draft.style}. ${model?.description ?? ''}\n${prompt}`
      if (input.draft.modelId === null) prompt += `\nUser-specified fictional character settings: ${characterSettingDetails(input.draft.randomModel) || "None specified"}. Preserve these explicit settings; freely choose any unspecified details for a fictional adult and keep them consistent throughout this batch. Do not imply this is an actual professional or client.`
      if (model && !model.example) { refs.add(model.assetId); prompt += '\nThe first reference is the chosen model. Preserve facial identity as closely as possible.' }
      if (input.draft.referenceId) { refs.add(input.draft.referenceId); prompt += '\nThe makeup reference guides makeup, color and lighting; do not replace the chosen model identity with it.' }
    } else { refs.add(input.draft.referenceId!); prompt = `Edit the supplied original photo according to the request. Preserve the person and unrequested details.\n${prompt}` }
    const images = await Promise.all([...refs].map((ref) => this.assets.input(ref)))
    let anchorAssetId: string | null = null
    for (let i = 0; i < input.draft.count; i++) {
      if (this.database.job(id)!.payload.cancelRequested) break
      this.ensureProvider(id)
      let attemptStarted = false
      let producedAssetId: string | null = null
      try {
        const anchor = anchorAssetId && input.draft.mode === 'virtual' ? await this.assets.input(anchorAssetId) : null
        const seriesPrompt = input.draft.mode === 'virtual' && input.draft.count > 1 ? `${prompt}\nThis is image ${i + 1} of one coherent beauty photo series. Keep the same adult person, makeup colors, hairstyle and outfit throughout the series. ${anchor ? 'The first image reference is the first finished photo: preserve its facial identity and makeup precisely. Vary only the camera angle, framing and a subtle natural pose for this new photo.' : 'Establish the person and makeup for the whole series.'}` : prompt
        const finalPrompt = photographicImagePrompt(seriesPrompt + guidanceText(row.input.guidance as PromptGuidance | undefined), input.draft.mode)
        this.prompts.beginAttempt(id, { index: i, prompt: finalPrompt, referenceIds: anchor ? [anchorAssetId!, ...refs] : [...refs], size: SIZES[input.draft.ratio], quality: 'high', status: 'running', assetId: null, error: null, startedAt: Date.now(), completedAt: null })
        attemptStarted = true
        const result = await this.provider.image({ prompt: finalPrompt, size: SIZES[input.draft.ratio], model: row.payload.model, images: anchor ? [anchor, ...images] : images })
        const asset = await this.assets.save(result.bytes, `${input.draft.style} · ${i + 1}`, { kind: 'generated', style: input.draft.style, projectId: input.projectId, jobId: id })
        producedAssetId = asset.id
        this.prompts.finishAttempt(id, i, { status: 'succeeded', assetId: asset.id, error: null })
        if (input.projectId) this.database.mutateWorkspace((s) => ({ ...s, projects: s.projects.map((p) => p.id === input.projectId && !p.coverId ? { ...p, coverId: asset.id, updatedAt: Date.now() } : p) }))
        const current = this.database.job(id)!.payload
        this.database.updateJob(id, { completedCount: current.completedCount + 1, resultAssetIds: [...current.resultAssetIds, asset.id] })
        if (input.draft.mode === 'virtual' && input.draft.modelId === null && !anchorAssetId) {
          const modelId = randomUUID()
          this.database.mutateWorkspace((s) => s.customModels.some((m) => m.originJobId === id) ? s : { ...s, customModels: [{ id: modelId, name: `${input.draft.randomModel.occupation || '随机模特'}${input.draft.randomModel.age == null ? '' : ` · ${input.draft.randomModel.age}岁`} · ${new Intl.DateTimeFormat('zh-CN', { timeZone: s.settings.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(Date.now())}`.slice(0, 30), description: `AI 虚构成年人物。${characterSettingDetails(input.draft.randomModel) ? `用户设定：${characterSettingDetails(input.draft.randomModel)}。` : '人物设定未限定，由 AI 自由生成。'}以本组首图为人物参考，可继续创作不同妆造。首组风格：${input.draft.style}。`.slice(0, 500), assetId: asset.id, tags: ['AI 生成', '随机建档', input.draft.style], example: false, originJobId: id }, ...s.customModels] })
          const savedModel = this.database.snapshot().state.customModels.find((m) => m.originJobId === id)
          if (savedModel) this.database.updateJob(id, { resultModelId: savedModel.id })
        }
        anchorAssetId ??= asset.id
      } catch (error) {
        if (attemptStarted && !producedAssetId) this.prompts.finishAttempt(id, i, { status: 'failed', assetId: null, error: safeMessage(error) })
        errors.push(safeMessage(error))
        this.database.audit('ai.image.error', id, error instanceof AppError ? error.code : 'UNKNOWN')
        // No blind resubmission on timeout, bad credentials, or malformed outputs.
        break
      }
    }
  }
  private async captions(id: string, errors: string[]) {
    const row = this.database.job(id)!
    const input = captionJobInputSchema.parse(row.input)
    const baseline = row.input.baseline as ReturnType<typeof emptyCaptions>
    const group = input.groupId ? this.database.groups().find((g) => g.id === input.groupId) : null
    const project = this.database.snapshot().state.projects.find((p) => p.id === (group?.projectId ?? input.projectId))
    if (input.groupId ? !group : !project) throw new AppError('SOURCE_NOT_FOUND', '所选作品组或项目已经删除。')
    const key = input.groupId ?? input.projectId!
    const collection = input.groupId ? 'groupCaptions' as const : 'captions' as const
    const sourceAssetIds = (row.input.sourceAssetIds ?? []) as string[]
    const images = await Promise.all(sourceAssetIds.map((assetId) => this.assets.input(assetId, 1024)))
    const draft = group?.draft ?? project?.draft
    const languageNames = { zh: 'Simplified Chinese', en: 'English', ko: 'Korean' }
    for (const language of new Set(input.languages)) {
      if (this.database.job(id)!.payload.cancelRequested) break
      this.ensureProvider(id)
      const existing = (this.database.snapshot().state[collection][key] ?? emptyCaptions())[language]
      if (existing.locked) { errors.push(`${language} 已锁定，保留原文`); continue }
      try {
        if (group && !this.database.groups().some((g) => g.id === group.id && sourceAssetIds.every((assetId) => g.assetIds.includes(assetId)))) throw new AppError('GROUP_CHANGED', '生成期间作品组的图片已改变，请重新选择作品组。')
        const result = await this.provider.caption({ language: languageNames[language], images, prompt: JSON.stringify({ title: group?.title ?? project?.title, description: project?.description ?? '', imageCount: sourceAssetIds.length, makeupStyle: draft?.style, makeupDescription: draft?.prompt, source: group?.source === 'generated' || draft?.mode === 'virtual' ? 'AI virtual model makeup concept' : 'User photos; no claims about an actual client experience' }) })
        let applied = false
        this.database.mutateWorkspace((s) => {
          if (input.groupId ? !this.database.groups(s).some((g) => g.id === key && sourceAssetIds.every((assetId) => g.assetIds.includes(assetId))) : !s.projects.some((p) => p.id === key)) return s
          const set = s[collection][key] ?? emptyCaptions()
          if (set[language].locked || JSON.stringify(set[language]) !== JSON.stringify(baseline[language])) return s
          applied = true
          return { ...s, [collection]: { ...s[collection], [key]: { ...set, [language]: { title: result.title, body: result.body, hashtags: result.hashtags.map((s) => `#${s.replace(/^#+/, '').replace(/\s+/g, '')}`).join(' '), locked: false } } } }
        })
        if (!applied) { errors.push(`${language} 已被手动修改，保留人工版本`); continue }
        const job = this.database.job(id)!.payload
        this.database.updateJob(id, { completedCount: job.completedCount + 1, completedLanguages: [...job.completedLanguages, language] })
      } catch (error) { errors.push(safeMessage(error)); this.database.audit('ai.caption.error', id, error instanceof AppError ? error.code : 'UNKNOWN'); if (error instanceof AppError && ['PROVIDER_AUTH', 'MODEL_UNAVAILABLE', 'PROVIDER_TIMEOUT'].includes(error.code)) break }
    }
  }
}
