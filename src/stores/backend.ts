import { create } from 'zustand'
import type { AIJob, ProviderStatus } from '../shared/contracts'

interface BackendState {
  status: 'connecting' | 'ready' | 'offline'
  saving: boolean
  error: string | null
  provider: ProviderStatus | null
  jobs: AIJob[]
  pendingSubmissions: number
}
export const useBackend = create<BackendState>(() => ({ status: 'connecting', saving: false, error: null, provider: null, jobs: [], pendingSubmissions: 0 }))
