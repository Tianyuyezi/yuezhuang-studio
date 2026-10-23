import { describe, expect, it } from 'vitest'
import { initialWorkspace } from '../server/database/client'
import { invalidRandomModelField, characterPromptPrefix } from '../src/lib/random-model'
import { randomStyleBrief, STYLE_CATEGORIES, STYLES } from '../src/lib/style-presets'
import { STYLE_PROMPTS } from '../src/lib/data'

describe('casting requirements and style-based description context', () => {
  const profile = { occupation: '设计师', age: 35, outfit: '黑色套装', country: '中国', ethnicity: '多元混合背景面孔' }
  it('allows empty character fields and validates age only when supplied for random models', () => {
    const draft = initialWorkspace().draft
    expect(invalidRandomModelField(draft)).toBeNull()
    expect(invalidRandomModelField({ ...draft, randomModel: profile })).toBeNull()
    expect(invalidRandomModelField({ ...draft, randomModel: { ...profile, age: 17 } })?.field).toBe('random-model-age')
    expect(invalidRandomModelField({ ...draft, randomModel: { ...profile, country: '', ethnicity: '', age: null } })).toBeNull()
    expect(invalidRandomModelField({ ...draft, modelId: 'model-01' })).toBeNull()
    expect(invalidRandomModelField({ ...draft, mode: 'edit' })).toBeNull()
  })
  it('includes all casting constraints in the generated description opening', () => {
    const text = characterPromptPrefix({ ...initialWorkspace().draft, style: '美拉德', randomModel: profile })
    for (const value of ['设计师', '35', '黑色套装', '中国', '多元混合背景面孔', '美拉德']) expect(text).toContain(value)
  })
  it('omits unspecified character traits without printing empty ages or placeholder values', () => {
    const draft = initialWorkspace().draft
    const blank = characterPromptPrefix(draft)
    expect(blank).toContain('成年人物')
    expect(blank).not.toMatch(/null|undefined|年龄|身穿/)
    const partial = characterPromptPrefix({ ...draft, randomModel: { occupation: '律师', age: null, outfit: '' } })
    expect(partial).toContain('身份为律师')
    expect(partial).not.toMatch(/null|undefined|年龄|身穿|国家／地区/)
  })
  it('offers 24 styles with a compatible palette and distinct photographic dimensions', () => {
    expect(STYLES).toHaveLength(24)
    expect(STYLE_CATEGORIES).toHaveLength(4)
    const brief = randomStyleBrief('港风红唇')
    expect(brief.style).toBe('港风红唇')
    expect(brief.makeup).toContain('红唇')
    expect(brief.palette).toMatch(/红/)
    expect(brief.lighting).toBeTruthy()
    expect(brief.framing).toBeTruthy()
  })
  it('keeps all style examples photographic, including creative and metallic makeup', () => {
    for (const style of STYLES) {
      expect(STYLE_PROMPTS[style]).toContain(style === '新娘柔光' ? '新娘' : style === '创意彩妆' ? '创意妆容' : style)
      expect(STYLE_PROMPTS[style]).toContain('真实人像照片')
      expect(STYLE_PROMPTS[style]).toContain('避免磨皮蜡感')
      expect(STYLE_PROMPTS[style].length).toBeLessThan(2000)
    }
  })
})
