import { z } from 'zod'
import { publicationBrandingSchema } from './publication-branding'

export const idSchema = z.string().regex(/^(?:[0-9a-f-]{36}|sample-0[1-6]|sample-ai-(?:0[1-9]|1[0-9]|2[0-4])-[ab]|model-0[1-3])$/i)
export const languageSchema = z.enum(['zh', 'en', 'ko'])
export const draftSchema = z.object({
  mode: z.enum(['virtual', 'edit']), prompt: z.string().max(4000), style: z.string().max(80),
  modelId: idSchema.nullable(), ratio: z.enum(['3:4', '4:5', '1:1', '16:9', '9:16']),
  count: z.union([z.literal(1), z.literal(2), z.literal(4)]), referenceId: idSchema.nullable(),
  imageModel: z.string().trim().min(1).max(100).nullable().default(null),
  randomModel: z.object({ occupation: z.string().trim().max(80).default(''), age: z.number().nullable().default(null), outfit: z.string().trim().max(200).default(''), country: z.string().trim().max(80).default(''), ethnicity: z.string().trim().max(100).default('') }).default({ occupation: '', age: null, outfit: '', country: '', ethnicity: '' }),
})
export const captionSchema = z.object({ title: z.string().max(150), body: z.string().max(5000), hashtags: z.string().max(1000), locked: z.boolean() })
export const captionSetSchema = z.object({ zh: captionSchema, en: captionSchema, ko: captionSchema })
export const settingsSchema = z.object({
  studioName: z.string().trim().min(1).max(30), artistName: z.string().trim().min(1).max(40), language: languageSchema,
  timezone: z.string().max(80).refine((value) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false } }, '无效时区'),
  publicationBranding: publicationBrandingSchema.default(() => publicationBrandingSchema.parse({})),
})
export const projectSchema = z.object({
  id: z.uuid(), title: z.string().trim().min(1).max(60), artist: z.string().max(40), description: z.string().max(500),
  draft: draftSchema, coverId: idSchema.nullable(), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
})
export const modelSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(30), description: z.string().max(500), assetId: idSchema, tags: z.array(z.string().max(50)).max(20), example: z.literal(false), originJobId: z.uuid().optional() })
export const publishDraftSchema = z.object({
  id: z.uuid(), projectId: z.uuid().nullable(), groupId: z.uuid().nullable().optional(), assetIds: z.array(idSchema).min(1).max(20).optional(), title: z.string().max(60), scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  timezone: settingsSchema.shape.timezone, language: languageSchema, caption: z.string().max(7000), createdAt: z.number().int().nonnegative(),
})
export const workflowSchema = z.object({
  step: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
  jobId: z.uuid().nullable().default(null), groupId: z.uuid().nullable().default(null),
  assetIds: z.array(idSchema).max(20).nullable().default(null), language: languageSchema.default('zh'), publishDraftId: z.uuid().nullable().default(null),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().default(null),
})
export const workspaceSchema = z.object({
  page: z.enum(['workflow', 'studio', 'projects', 'assets', 'models', 'prompts', 'copywriting', 'publishing', 'settings']),
  workflow: workflowSchema.default(() => workflowSchema.parse({})),
  draft: draftSchema, projects: z.array(projectSchema).max(5000), activeProjectId: z.uuid().nullable(),
  hiddenExamples: z.array(idSchema).max(1000), favorites: z.array(idSchema).max(20000), customModels: z.array(modelSchema).max(2000),
  captions: z.record(z.uuid(), captionSetSchema), groupCaptions: z.record(z.uuid(), captionSetSchema).default({}), publishDrafts: z.array(publishDraftSchema).max(10000), settings: settingsSchema,
})
export type WorkspaceData = z.infer<typeof workspaceSchema>
export const providerSchema = z.object({
  baseUrl: z.url().max(300).refine((value) => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash }, '请输入有效的 HTTP / HTTPS API 地址'),
  imageModel: z.string().trim().min(1).max(100), textModel: z.string().trim().min(1).max(100), allowInsecureHttp: z.boolean(),
})
export type ProviderConfig = z.infer<typeof providerSchema>
export interface ProviderStatus extends ProviderConfig { hasKey: boolean; credentialStorage: 'keychain' | 'session' | 'encrypted-file'; verifiedAt: number | null; models: string[] }
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'interrupted'
export interface AIJob {
  id: string; kind: 'image' | 'caption'; projectId: string | null; status: JobStatus; model: string;
  requestedCount: number; completedCount: number; resultAssetIds: string[]; completedLanguages: string[];
  cancelRequested: boolean; error: string | null; createdAt: number; updatedAt: number; completedAt: number | null;
  groupId?: string | null;
  resultModelId?: string;
}
export const imageJobInputSchema = z.object({ requestId: z.uuid(), projectId: z.uuid().nullable(), draft: draftSchema })
export const captionJobInputSchema = z.object({ requestId: z.uuid(), projectId: z.uuid().optional(), groupId: z.uuid().optional(), assetIds: z.array(idSchema).min(1).max(20).optional(), languages: z.array(languageSchema).min(1).max(3) }).refine((s) => !!(s.groupId || s.projectId), '请选择作品组').refine((s) => !s.assetIds || !!s.groupId, '选图文案需要作品组')
export const promptInputSchema = z.object({ action: z.enum(['random', 'polish']), draft: draftSchema, variation: z.string().max(1000).optional() })
