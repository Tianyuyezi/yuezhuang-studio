import { api } from './api'
import { flushWorkspace } from './sync'
import { useWorkspace } from '../stores/workspace'
import { useBackend } from '../stores/backend'
import type { Language } from './types'
import { draftSchema } from '../shared/contracts'

export async function generateImages() {
  useBackend.setState((s) => ({ pendingSubmissions: s.pendingSubmissions + 1 }))
  try {
    await flushWorkspace()
    const { activeProjectId, draft } = useWorkspace.getState()
    const job = await api.image(activeProjectId, draftSchema.parse(draft))
    useBackend.setState((s) => ({ jobs: [job, ...s.jobs.filter((j) => j.id !== job.id)] }))
    return job
  } finally { useBackend.setState((s) => ({ pendingSubmissions: s.pendingSubmissions - 1 })) }
}
export async function generateCaptions(groupId: string, languages: Language[]) {
  useBackend.setState((s) => ({ pendingSubmissions: s.pendingSubmissions + 1 }))
  try {
    await flushWorkspace()
    const job = await api.captions(groupId, languages)
    useBackend.setState((s) => ({ jobs: [job, ...s.jobs.filter((j) => j.id !== job.id)] }))
    return job
  } finally { useBackend.setState((s) => ({ pendingSubmissions: s.pendingSubmissions - 1 })) }
}
