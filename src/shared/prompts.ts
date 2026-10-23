import { z } from 'zod'
import type { AIJob } from './contracts'
import type { CreationDraft } from '../lib/types'
import { qualityScoresSchema } from './quality'
import type { PromptGuidance } from './quality'

export const promptFeedbackSchema = z.object({ rating: z.enum(['unrated', 'good', 'average', 'poor']), notes: z.string().max(1500), scores: qualityScoresSchema.optional() })
export const promptTemplateInputSchema = z.object({
  title: z.string().trim().min(1).max(80), prompt: z.string().trim().min(1).max(4000),
  style: z.string().trim().max(80), mode: z.enum(['virtual', 'edit']),
  author: z.string().trim().min(1).max(40), tags: z.array(z.string().trim().min(1).max(30)).max(12),
  notes: z.string().max(1500), sourceJobId: z.uuid().nullable().default(null), model: z.string().max(100).default(''),
  sourceReferenceId: z.uuid().optional(),
})
export type PromptTemplateInput = z.infer<typeof promptTemplateInputSchema>
export interface PromptTemplate extends PromptTemplateInput {
  id: string; version: number; favorite: boolean; createdAt: number; updatedAt: number; assetIds: string[]
}
export interface PromptAttempt {
  index: number; prompt: string; referenceIds: string[]; size: string; quality: 'high';
  status: 'running' | 'succeeded' | 'failed' | 'interrupted';
  assetId: string | null; error: string | null; startedAt: number; completedAt: number | null
}
export interface PromptRecord {
  id: string; draft: CreationDraft; model: string; createdAt: number; legacy: boolean;
  attempts: PromptAttempt[]; feedback: z.infer<typeof promptFeedbackSchema>
  guidance?: PromptGuidance
}
export interface PromptHistoryItem extends PromptRecord { job: AIJob }
export interface PromptPage<T> { items: T[]; total: number }
