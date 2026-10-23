import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mergeThreeWay, reconcileWorkspace } from '../src/lib/merge'
import { initialWorkspace } from '../server/database/client'
import { emptyCaptions } from '../src/lib/data'

describe('workspace conflict recovery', () => {
  it('keeps a local manual edit alongside a newly generated remote language', () => {
    const base = { zh: { body: '原文', locked: false }, en: { body: '', locked: false } }
    const local = { ...base, zh: { body: '人工文案', locked: true } }
    const remote = { ...base, en: { body: 'Generated', locked: false } }
    expect(mergeThreeWay(base, local, remote)).toEqual({ zh: local.zh, en: remote.en })
  })
  it('keeps independently added projects from both windows', () => {
    const base = [{ id: 'old', title: '原项目' }]
    const local = [...base, { id: 'local', title: '本机新增' }]
    const remote = [...base, { id: 'remote', title: '另一窗口新增' }]
    expect(mergeThreeWay(base, local, remote)).toEqual([...local, remote[1]])
  })
  it('does not resurrect a deleted project when an older window edited it', () => {
    expect(mergeThreeWay([{ id: 'old', title: '原项目' }], [{ id: 'old', title: '旧窗口改名' }], [])).toEqual([])
  })
  it('removes orphan captions and plans after a project was deleted remotely', () => {
    const id = randomUUID()
    const state = { ...initialWorkspace(), activeProjectId: id, captions: { [id]: emptyCaptions() }, publishDrafts: [{ id: randomUUID(), projectId: id, title: '排期', scheduledAt: '2026-10-22T18:00', timezone: 'Asia/Shanghai', language: 'zh' as const, caption: '', createdAt: Date.now() }] }
    const recovered = reconcileWorkspace(state, [])
    expect(recovered.activeProjectId).toBeNull()
    expect(recovered.captions).toEqual({})
    expect(recovered.publishDrafts).toEqual([])
  })
  it('cleans deleted photo and model references but retains bundled examples', () => {
    const id = randomUUID(); const modelId = randomUUID()
    const state = { ...initialWorkspace(), draft: { ...initialWorkspace().draft, referenceId: id, modelId }, favorites: [id, 'sample-01'], customModels: [{ id: modelId, name: '模特', description: '', assetId: id, tags: [], example: false as const }] }
    const recovered = reconcileWorkspace(state, [])
    expect(recovered.draft.referenceId).toBeNull()
    expect(recovered.draft.modelId).toBeNull()
    expect(recovered.customModels).toEqual([])
    expect(recovered.favorites).toEqual(['sample-01'])
  })
})
