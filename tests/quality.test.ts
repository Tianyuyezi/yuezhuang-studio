import { describe, expect, it } from 'vitest'
import { DEFAULT_WEIGHTS, EMPTY_SCORES, guidanceText, qualityWeightsSchema, weightedQuality } from '../src/shared/quality'

describe('weighted quality evaluation', () => {
  it('normalizes weights and distinguishes unscored from a real zero', () => {
    expect(weightedQuality(EMPTY_SCORES, DEFAULT_WEIGHTS).score).toBeNull()
    const scores = { ...EMPTY_SCORES, realism: 5, makeup: 0 }
    const first = weightedQuality(scores, DEFAULT_WEIGHTS)
    const scaled = weightedQuality(scores, { realism: 70, makeup: 50, lighting: 40, composition: 20, consistency: 20 })
    expect(first.score).toBe(58.3)
    expect(first.coverage).toBe(0.6)
    expect(first).toEqual(scaled)
  })
  it('excludes zero-weight or not-applicable dimensions without inflating coverage', () => {
    const weights = { realism: 70, makeup: 30, lighting: 0, composition: 0, consistency: 0 }
    expect(weightedQuality({ ...EMPTY_SCORES, realism: 4, lighting: 0 }, weights)).toEqual({ score: 80, coverage: 0.7, dimensions: 1 })
    expect(qualityWeightsSchema.safeParse({ realism: 0, makeup: 0, lighting: 0, composition: 0, consistency: 0 }).success).toBe(false)
  })
  it('does not add disabled guidance and omits dimensions with no emphasis', () => {
    const guidance = { enabled: true, weights: { realism: 100, makeup: 0, lighting: 0, composition: 0, consistency: 0 }, sources: [{ id: 'reference', kind: 'reference' as const, title: 'Approved example', style: '', score: null, priority: 3, directions: { realism: '自然毛孔', makeup: 'SHOULD_NOT_BE_ADDED' } }] }
    expect(guidanceText({ ...guidance, enabled: false })).toBe('')
    expect(guidanceText(guidance)).toContain('自然毛孔')
    expect(guidanceText(guidance)).not.toContain('SHOULD_NOT_BE_ADDED')
    expect(guidanceText(guidance)).toContain('Preserve all explicit user requirements')
  })
})
