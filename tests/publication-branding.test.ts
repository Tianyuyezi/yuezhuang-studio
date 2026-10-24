import { describe, expect, it } from 'vitest'
import { publicationBrandingSchema, publicationCaption } from '../src/shared/publication-branding'
import { publicationWatermark } from '../server/services/publication-image'

describe('publishing identity and contacts', () => {
  const branding = publicationBrandingSchema.parse({ artist: { name: 'Mina', wechat: 'mina_test', phone: '+86 00000000000' }, publisher: { name: 'Studio', whatsapp: '+82 0000000000', contactInfo: 'Shanghai · By appointment' } })
  it('puts optional profiles after the complete caption and hashtags in each language, exactly once', () => {
    for (const [language, label] of [['zh', '化妆师'], ['en', 'Makeup artist'], ['ko', '메이크업 아티스트']] as const) {
      const text = publicationCaption('Portrait\n\n#Makeup', language, branding)
      expect(text.startsWith(`Portrait\n\n#Makeup\n\n${label}: Mina`)).toBe(true)
      expect(text.endsWith('Shanghai · By appointment')).toBe(true)
      expect(text).not.toContain('Email:')
      expect(publicationCaption(text, language, branding)).toBe(text)
    }
    expect(publicationCaption('Portrait\n\n#Makeup', 'en', publicationBrandingSchema.parse({}))).toBe('Portrait\n\n#Makeup')
  })
  it('renders custom labels as plain text, including markup characters and long Korean labels', async () => {
    const watermark = await publicationWatermark(1080, 566, { ...branding, watermarkEnglish: 'Shanghai <Artist> & "Studio"', watermarkKorean: '상하이 출장 메이크업 아티스트 '.repeat(3).trim() })
    expect(watermark).toHaveLength(3)
    expect(watermark.every((layer) => layer.top! >= 0)).toBe(true)
  })
})
