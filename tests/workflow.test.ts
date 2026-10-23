import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { captionText, publicationSnapshot, selectedWorkflowAssets } from '../src/lib/workflow'
import type { Asset, WorkGroup } from '../src/lib/types'
import { SAMPLE_ASSETS, STYLES } from '../src/lib/data'
import { initialWorkspace } from '../server/database/client'
import { workspaceSchema } from '../src/shared/contracts'

describe('four-step creative workflow and bundled references', () => {
  const a: Asset = { id: randomUUID(), title: '第一张', style: '韩系清透', kind: 'generated', createdAt: 1 }
  const b: Asset = { ...a, id: randomUUID(), title: '第二张' }
  const group: WorkGroup = { id: randomUUID(), title: '同组妆造', assetIds: [a.id, b.id], source: 'generated', projectId: null, draft: null, createdAt: 1 }
  it('defaults to the whole group, preserves cover order and respects deselection and deleted images', () => {
    expect(selectedWorkflowAssets(group, [a, b], null)).toEqual([a, b])
    expect(selectedWorkflowAssets(group, [a, b], [b.id, a.id, b.id, 'sample-01'])).toEqual([b, a])
    expect(selectedWorkflowAssets(group, [a, b], [])).toEqual([])
    expect(selectedWorkflowAssets(group, [b], [a.id, b.id])).toEqual([b])
  })
  it('snapshots selected pictures and caption into a publish draft without requiring a project', () => {
    const caption = { title: '清透妆造', body: '保留真实肤质。', hashtags: '#清透妆', locked: false }
    const draft = publicationSnapshot(group, [b, a], caption, 'zh', '2026-11-01T18:00', 'Asia/Shanghai')
    expect(draft).toMatchObject({ groupId: group.id, projectId: null, assetIds: [b.id, a.id], caption: captionText(caption), language: 'zh' })
    caption.body = '后续编辑'
    expect(draft.caption).toContain('保留真实肤质。')
    expect(() => publicationSnapshot(group, [], caption, 'zh', '2026-11-01T18:00', 'Asia/Shanghai')).toThrow()
  })
  it('accepts old workspaces and preserves the resumable workflow state', () => {
    const { workflow: _workflow, ...legacy } = initialWorkspace()
    expect(workspaceSchema.parse(legacy).workflow.step).toBe(1)
    const state = workspaceSchema.parse({ ...legacy, page: 'workflow', workflow: { step: 4, groupId: group.id, assetIds: [b.id], language: 'en', scheduledAt: '2026-11-01T18:00' } })
    expect(workspaceSchema.parse(JSON.parse(JSON.stringify(state))).workflow).toEqual(state.workflow)
  })
  it('ships two new real image files and recorded prompts per style, with two or three total references', async () => {
    const generated = SAMPLE_ASSETS.filter((a) => a.exampleOrigin === 'generated')
    expect(generated).toHaveLength(48)
    expect(new Set(SAMPLE_ASSETS.map((a) => a.id)).size).toBe(SAMPLE_ASSETS.length)
    for (const style of STYLES) {
      expect(generated.filter((a) => a.style === style)).toHaveLength(2)
      expect(SAMPLE_ASSETS.filter((a) => a.style === style).length).toBeGreaterThanOrEqual(2)
      expect(SAMPLE_ASSETS.filter((a) => a.style === style).length).toBeLessThanOrEqual(3)
    }
    for (const asset of generated) {
      expect((await stat(join(resolve('public'), asset.src!))).size).toBeGreaterThan(10000)
      expect((await stat(join(resolve('public'), asset.thumbnailSrc!))).size).toBeGreaterThan(1000)
      const record = JSON.parse(await readFile(`public/images/examples/prompts/${asset.id}.json`, 'utf8'))
      expect(record.style).toBe(asset.style)
      expect(record.prompt).toContain('photorealistic')
    }
  })
})
