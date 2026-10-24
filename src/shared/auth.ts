import { z } from 'zod'

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
})
export interface AuthUser { id: string; email: string; role: 'owner' | 'member'; createdAt: number }
export interface AuthSession { csrf: string; user: AuthUser | null; workspaceKey: string; notice?: string }
