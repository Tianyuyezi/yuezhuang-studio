import { create } from 'zustand'
import type { AuthSession } from '../shared/auth'

export const useAuth = create<AuthSession & {
  ready: boolean; dialog: 'login' | 'register' | null; reason: string
  open: (mode?: 'login' | 'register', reason?: string) => void
  close: () => void
}>((set) => ({
  csrf: '', user: null, workspaceKey: '', ready: false, dialog: null, reason: '',
  open: (dialog = 'login', reason = '') => set({ dialog, reason }),
  close: () => set({ dialog: null, reason: '' }),
}))
