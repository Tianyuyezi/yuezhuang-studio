import { z } from 'zod'
import type { Language } from '../lib/types'

const singleLine = (max: number) => z.string().trim().max(max).refine((value) => !/[\r\n\x00-\x1f]/.test(value), '请填写单行文字。').default('')
export const professionalProfileSchema = z.object({
  name: singleLine(40), phone: singleLine(80), wechat: singleLine(80), whatsapp: singleLine(80),
  email: singleLine(120), contactInfo: z.string().trim().max(300).default(''),
})
export const publicationBrandingSchema = z.object({
  artist: professionalProfileSchema.default(() => professionalProfileSchema.parse({})),
  publisher: professionalProfileSchema.default(() => professionalProfileSchema.parse({})),
  watermarkEnabled: z.boolean().default(true),
  watermarkEnglish: singleLine(80).pipe(z.string().min(1)).default('Shanghai At-Home Makeup Artist'),
  watermarkKorean: singleLine(60).pipe(z.string().min(1)).default('상하이 출장 메이크업 아티스트'),
})
export type ProfessionalProfile = z.infer<typeof professionalProfileSchema>
export type PublicationBranding = z.infer<typeof publicationBrandingSchema>

export function publicationContactFooter(branding: PublicationBranding, language: Language) {
  const labels = {
    zh: { artist: '化妆师', publisher: '发布人', phone: '电话', email: '邮箱', wechat: '微信' },
    en: { artist: 'Makeup artist', publisher: 'Publisher', phone: 'Phone', email: 'Email', wechat: 'WeChat' },
    ko: { artist: '메이크업 아티스트', publisher: '게시자', phone: '전화', email: '이메일', wechat: '위챗' },
  }[language]
  return (['artist', 'publisher'] as const).flatMap((role) => {
    const profile = branding[role]
    if (!Object.values(profile).some((value) => value.trim())) return []
    return [[
      `${labels[role]}${profile.name ? `: ${profile.name}` : ''}`,
      profile.phone && `${labels.phone}: ${profile.phone}`,
      profile.wechat && `${labels.wechat}: ${profile.wechat}`,
      profile.whatsapp && `WhatsApp: ${profile.whatsapp}`,
      profile.email && `${labels.email}: ${profile.email}`,
      profile.contactInfo,
    ].filter(Boolean).join('\n')]
  }).join('\n\n')
}

export function publicationCaption(caption: string, language: Language, branding: PublicationBranding) {
  const text = caption.trim(), footer = publicationContactFooter(branding, language)
  if (!footer || text === footer || text.endsWith(`\n\n${footer}`)) return text
  return [text, footer].filter(Boolean).join('\n\n')
}
