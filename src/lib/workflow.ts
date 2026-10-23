import type { Asset, Caption, Language, PublishDraft, WorkGroup } from './types'

export function selectedWorkflowAssets(group: WorkGroup | undefined, assets: Asset[], selection: string[] | null): Asset[] {
  if (!group) return []
  return [...new Set(selection ?? group.assetIds.slice(0, 20))].filter((id) => group.assetIds.includes(id)).map((id) => assets.find((a) => a.id === id && a.kind !== 'example')).filter((a): a is Asset => !!a)
}
export function captionText(caption: Caption) { return [caption.title, caption.body, caption.hashtags].filter((value) => value.trim()).join('\n\n') }
export function publicationSnapshot(group: WorkGroup, assets: Asset[], caption: Caption, language: Language, scheduledAt: string, timezone: string, id: string = crypto.randomUUID()): PublishDraft {
  if (!assets.length || assets.length > 20 || assets.some((a) => !group.assetIds.includes(a.id)) || new Set(assets.map((a) => a.id)).size !== assets.length) throw new Error('请先确认本作品组内的发布图片。')
  if (!captionText(caption).trim()) throw new Error('请先生成或填写当前语言的文案。')
  return { id, projectId: group.projectId, groupId: group.id, assetIds: assets.map((a) => a.id), title: group.title.slice(0, 60), language, caption: captionText(caption), scheduledAt, timezone, createdAt: Date.now() }
}
export function dateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const part = (name: string) => parts.find((p) => p.type === name)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
