import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { emptyCaptions } from '../src/lib/data'
import type { Asset, WorkGroup } from '../src/lib/types'
import { workflowSchema } from '../src/shared/contracts'
import { useWorkspace } from '../src/stores/workspace'

const first: Asset = { id: randomUUID(), title: '正面', style: '韩系清透', kind: 'generated', createdAt: 1 }
const second: Asset = { ...first, id: randomUUID(), title: '侧面' }
const group: WorkGroup = { id: randomUUID(), title: '同一妆造', assetIds: [first.id, second.id], source: 'generated', projectId: null, draft: null, createdAt: 1 }
const captions = { ...emptyCaptions(), ko: { title: '한국어', body: '韩文文案内容', hashtags: '#makeup', locked: true } }

beforeEach(() => {
  useWorkspace.setState(useWorkspace.getInitialState(), true)
  useWorkspace.setState({ importedAssets: [first, second], workGroups: [group], groupCaptions: { [group.id]: captions } })
})
afterEach(() => useWorkspace.setState(useWorkspace.getInitialState(), true))

describe('library to captions to publication navigation', () => {
  it('opens the selected library group without changing its saved captions', () => {
    useWorkspace.getState().openGroupCaptions(group.id)
    expect(useWorkspace.getState()).toMatchObject({ page: 'copywriting', copyGroupId: group.id, groupCaptions: { [group.id]: captions } })
  })

  it('carries the caption language and exact visible images into publication, clearing another group’s draft', () => {
    useWorkspace.getState().updateWorkflow({ groupId: randomUUID(), publishDraftId: randomUUID(), scheduledAt: '2026-11-01T18:00', language: 'en' })
    useWorkspace.getState().openGroupPublishing(group.id, 'ko', [second.id, first.id])
    expect(useWorkspace.getState()).toMatchObject({ page: 'workflow', copyGroupId: group.id, workflow: { step: 4, groupId: group.id, language: 'ko', assetIds: [second.id, first.id], publishDraftId: null, scheduledAt: null }, groupCaptions: { [group.id]: captions } })
    expect(useWorkspace.getState().publishDrafts).toEqual([])
  })

  it('resumes the same selection and cover order with its existing draft and schedule', () => {
    const draftId = randomUUID()
    useWorkspace.getState().updateWorkflow({ groupId: group.id, assetIds: [second.id, first.id], publishDraftId: draftId, scheduledAt: '2026-11-01T18:00' })
    useWorkspace.getState().openGroupPublishing(group.id, 'ko')
    expect(useWorkspace.getState().workflow).toMatchObject({ step: 4, assetIds: [second.id, first.id], publishDraftId: draftId, scheduledAt: '2026-11-01T18:00', language: 'ko' })
  })

  it('requires the chosen language’s caption and excludes foreign or deleted pictures', () => {
    useWorkspace.getState().openGroupPublishing(group.id, 'en', [second.id, 'sample-01', randomUUID(), second.id])
    expect(useWorkspace.getState().workflow).toMatchObject({ step: 3, language: 'en', assetIds: [second.id] })
    useWorkspace.setState({ importedAssets: [] })
    useWorkspace.getState().openGroupPublishing(group.id, 'ko')
    expect(useWorkspace.getState().workflow).toMatchObject({ step: 2, assetIds: [] })
  })

  it('asks for explicit selection for oversized groups and keeps the workflow saveable', () => {
    const assets = Array.from({ length: 21 }, () => ({ ...first, id: randomUUID() }))
    useWorkspace.setState({ importedAssets: assets, workGroups: [{ ...group, assetIds: assets.map((asset) => asset.id) }] })
    useWorkspace.getState().openGroupPublishing(group.id, 'ko', assets.map((asset) => asset.id))
    expect(useWorkspace.getState().workflow).toMatchObject({ step: 2, groupId: group.id, assetIds: [] })
    expect(workflowSchema.safeParse(useWorkspace.getState().workflow).success).toBe(true)
  })
})
