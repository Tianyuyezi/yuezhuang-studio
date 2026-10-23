import type { Asset, CreationDraft, Project, WorkGroup } from './types'

export function groupIdOf(asset: Asset) { return asset.groupId ?? asset.jobId ?? asset.id }

export function buildWorkGroups(assets: Asset[], projects: Project[], contexts = new Map<string, CreationDraft>()): WorkGroup[] {
  const batches = new Map<string, Asset[]>()
  for (const asset of assets.filter((a) => a.kind !== 'example')) {
    const id = groupIdOf(asset)
    batches.set(id, [...(batches.get(id) ?? []), asset])
  }
  return [...batches].map(([id, members]) => {
    members.sort((a, b) => a.createdAt - b.createdAt)
    const first = members[0]
    const project = projects.find((p) => p.id === first.projectId)
    const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(first.createdAt)
    return { id, title: `${first.kind === 'generated' ? first.style : first.title} · ${date}`, assetIds: members.map((a) => a.id), projectId: project?.id ?? null, draft: contexts.get(id) ?? project?.draft ?? null, source: first.kind === 'generated' ? 'generated' as const : 'imported' as const, createdAt: first.createdAt }
  }).sort((a, b) => b.createdAt - a.createdAt)
}
