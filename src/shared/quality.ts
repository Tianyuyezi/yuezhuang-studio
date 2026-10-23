import { z } from 'zod'

export const QUALITY_DIMENSIONS = [
  { key: 'realism', label: '照片真实感' }, { key: 'makeup', label: '妆容表现' },
  { key: 'lighting', label: '光线与肤质' }, { key: 'composition', label: '构图与色彩' },
  { key: 'consistency', label: '组图一致性' },
] as const
export type QualityDimension = typeof QUALITY_DIMENSIONS[number]['key']
const score = z.number().min(0).max(5).nullable()
export const qualityScoresSchema = z.object({ realism: score, makeup: score, lighting: score, composition: score, consistency: score })
export type QualityScores = z.infer<typeof qualityScoresSchema>
export const EMPTY_SCORES: QualityScores = { realism: null, makeup: null, lighting: null, composition: null, consistency: null }
export const DEFAULT_WEIGHTS = { realism: 35, makeup: 25, lighting: 20, composition: 10, consistency: 10 }
const weight = z.number().min(0).max(100)
export const qualityWeightsSchema = z.object({ realism: weight, makeup: weight, lighting: weight, composition: weight, consistency: weight }).refine((value) => Object.values(value).some((v) => v > 0), '至少一个维度的权重需要大于 0。')
export type QualityWeights = z.infer<typeof qualityWeightsSchema>
export const qualityPreferencesSchema = z.object({ enabled: z.boolean(), weights: qualityWeightsSchema, minScore: z.number().min(0).max(100), maxSources: z.number().int().min(1).max(5) })
export type QualityPreferences = z.infer<typeof qualityPreferencesSchema>
export const DEFAULT_QUALITY_PREFERENCES: QualityPreferences = { enabled: true, weights: DEFAULT_WEIGHTS, minScore: 70, maxSources: 3 }
export function weightedQuality(scores: QualityScores | undefined, weights: QualityWeights) {
  let sum = 0, available = 0, total = 0, dimensions = 0
  for (const { key } of QUALITY_DIMENSIONS) {
    total += weights[key]
    const value = scores?.[key]
    if (value == null || weights[key] <= 0) continue
    sum += value * weights[key]; available += weights[key]; dimensions++
  }
  return { score: available ? Math.round(sum / available * 200) / 10 : null, coverage: total ? available / total : 0, dimensions }
}
const observation = z.string().trim().min(1).max(700)
export const referenceAnalysisSchema = z.object({
  prompt: z.string().trim().min(1).max(2500),
  observations: z.object({ realism: observation, makeup: observation, lighting: observation, composition: observation, consistency: observation }),
  avoid: z.array(z.string().min(1).max(200)).max(8), suggestedScores: qualityScoresSchema,
})
export type ReferenceAnalysis = z.infer<typeof referenceAnalysisSchema>
export const referenceInputSchema = z.object({
  title: z.string().trim().min(1).max(80), style: z.string().trim().max(80), assetIds: z.array(z.uuid()).min(1).max(8),
  approved: z.boolean(), priority: z.number().int().min(1).max(5), scores: qualityScoresSchema, notes: z.string().max(1500),
})
export type QualityReferenceInput = z.infer<typeof referenceInputSchema>
export interface QualityReference extends QualityReferenceInput {
  id: string; version: number; createdAt: number; updatedAt: number;
  analysis: (ReferenceAnalysis & { model: string; analyzedAt: number }) | null;
  weighted: ReturnType<typeof weightedQuality>
}
export interface GuidanceSource {
  id: string; kind: 'reference' | 'history'; title: string; style: string; score: number | null;
  priority: number; directions: Partial<Record<QualityDimension, string>>
}
export interface PromptGuidance { enabled: boolean; weights: QualityWeights; sources: GuidanceSource[] }
export function guidanceText(guidance?: PromptGuidance) {
  if (!guidance?.enabled || !guidance.sources.length) return ''
  const ordered = [...QUALITY_DIMENSIONS].filter(({ key }) => guidance.weights[key] > 0).sort((a, b) => guidance.weights[b.key] - guidance.weights[a.key])
  const descriptions = guidance.sources.map((source, i) => `Preferred example ${i + 1} (${source.title}):\n${ordered.filter(({ key }) => source.directions[key]).map(({ key, label }) => `${label}: ${source.directions[key]}`).join('\n')}`).join('\n')
  return `\n\nPreferred visual techniques selected from user-approved examples:\nEmphasis order: ${ordered.map(({ label }) => label).join(' > ')}.\n${descriptions}\nBorrow compatible photographic and makeup techniques only. Preserve all explicit user requirements, chosen adult identity, skin tone, clothing and makeup style; never copy the example person's identity or unrequested outfit, accessories or background. Ignore source screenshot UI, carousel counters, arrows, borders and watermarks. Produce a single photograph unless the user explicitly asks for a collage. Conflicting user requirements take precedence. These are application selection priorities, not model training or special token weights. For edits, stay within the requested edit scope.`
}
