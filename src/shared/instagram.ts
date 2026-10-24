import { z } from 'zod'
import type { PublicationBranding } from './publication-branding'

export const instagramConfigSchema = z.object({
  appId: z.string().regex(/^\d{5,30}$/).or(z.literal('')).default(''),
  publicBaseUrl: z.string().max(500).default('').refine((value) => {
    if (!value) return true
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.port && !['localhost', '127.0.0.1', '::1'].includes(url.hostname) && !/^\d+\./.test(url.hostname) && !url.hostname.endsWith('.local')
    } catch { return false }
  }, '请填写可公开访问的 HTTPS 域名。'),
  apiVersion: z.string().regex(/^v\d{2}\.0$/).default('v26.0'),
})
export type InstagramConfig = z.infer<typeof instagramConfigSchema>
export interface InstagramAccount { id: string; username: string; accountType: string; connectedAt: number; refreshedAt: number; expiresAt: number | null }
export type PublicationStatus = 'preview' | 'scheduled' | 'missed' | 'preparing' | 'publishing' | 'published' | 'uncertain' | 'failed' | 'cancelled'
export interface InstagramPublication {
  id: string; requestId: string; draftId: string; accountId: string; username: string; title: string
  caption: string; assetIds: string[]; aiGenerated: boolean; fingerprint: string; status: PublicationStatus
  scheduledFor: string | null; createdAt: number; updatedAt: number; publishedAt: number | null
  containerId: string | null; children: string[]; mediaId: string | null; permalink: string | null; error: string | null
  width: number; height: number; publicUntil: number | null
  branding?: PublicationBranding
}
export interface InstagramState { config: InstagramConfig; hasAppSecret: boolean; accounts: InstagramAccount[]; publications: InstagramPublication[]; credentialStorage: 'keychain' | 'session' | 'encrypted-file' }
export const instagramPrepareSchema = z.object({ requestId: z.uuid(), draftId: z.uuid(), accountId: z.string().regex(/^\d{1,40}$/), aiGenerated: z.boolean().default(false) })
export const instagramConfirmSchema = z.object({ confirmed: z.literal(true), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), scheduledFor: z.iso.datetime({ offset: true }).optional() })
export const INSTAGRAM_STATUS: Record<PublicationStatus, string> = { preview: '待确认', scheduled: '已预约', missed: '错过时间 · 待确认', preparing: '正在准备图片', publishing: '正在提交', published: '已发布', uncertain: '结果待核实', failed: '未发布', cancelled: '已取消' }
