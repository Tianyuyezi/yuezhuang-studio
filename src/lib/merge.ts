import type { WorkspaceData } from '../shared/contracts'
import type { Asset } from './types'
import { groupIdOf } from './groups'
import { SAMPLE_ASSET_IDS } from '../shared/examples'

function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b) }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }

/** Preserve independent edits; a deliberate deletion wins over an outdated edit. */
export function mergeThreeWay(base: unknown, local: unknown, remote: unknown): unknown {
  if (same(local, base)) return remote
  if (same(remote, base) || same(local, remote)) return local
  if (object(local) && object(remote)) {
    const previous = object(base) ? base : {}
    return Object.fromEntries([...new Set([...Object.keys(local), ...Object.keys(remote)])].flatMap((key) => {
      const merged = mergeThreeWay(previous[key], local[key], remote[key])
      return merged === undefined ? [] : [[key, merged]]
    }))
  }
  if (Array.isArray(local) && Array.isArray(remote) && [...local, ...remote].every((v) => object(v) && typeof v.id === 'string')) {
    const before = new Map((Array.isArray(base) ? base : []).map((v) => [v.id, v]))
    const left = new Map(local.map((v) => [v.id, v]))
    const right = new Map(remote.map((v) => [v.id, v]))
    return [...new Set([...left.keys(), ...right.keys()])].flatMap((id) => {
      if (before.has(id) && (!left.has(id) || !right.has(id))) return []
      return [mergeThreeWay(before.get(id), left.get(id), right.get(id))]
    }).filter(Boolean)
  }
  return local
}

/** Remove references to records deleted by another window before saving a merge. */
export function reconcileWorkspace(state: WorkspaceData, assets: Asset[]): WorkspaceData {
  const assetIds = new Set([...assets.map((a) => a.id), ...SAMPLE_ASSET_IDS])
  const models = state.customModels.filter((m) => assetIds.has(m.assetId))
  const modelIds = new Set([...models.map((m) => m.id), 'model-01', 'model-02', 'model-03'])
  const cleanDraft = (draft: WorkspaceData['draft']) => ({ ...draft, referenceId: draft.referenceId && assetIds.has(draft.referenceId) ? draft.referenceId : null, modelId: draft.modelId && modelIds.has(draft.modelId) ? draft.modelId : null })
  const projectIds = new Set(state.projects.map((p) => p.id))
  const groupIds = new Set(assets.filter((a) => a.kind !== 'example').map(groupIdOf))
  return {
    ...state, draft: cleanDraft(state.draft), customModels: models,
    activeProjectId: state.activeProjectId && projectIds.has(state.activeProjectId) ? state.activeProjectId : null,
    projects: state.projects.map((p) => ({ ...p, draft: cleanDraft(p.draft), coverId: p.coverId && assetIds.has(p.coverId) ? p.coverId : null })),
    captions: Object.fromEntries(Object.entries(state.captions).filter(([id]) => projectIds.has(id))),
    groupCaptions: Object.fromEntries(Object.entries(state.groupCaptions).filter(([id]) => groupIds.has(id))),
    publishDrafts: state.publishDrafts.filter((p) => p.groupId ? groupIds.has(p.groupId) : !!p.projectId && projectIds.has(p.projectId)).map((p) => ({ ...p, projectId: p.projectId && projectIds.has(p.projectId) ? p.projectId : null, ...(p.assetIds ? { assetIds: p.assetIds.filter((id) => assetIds.has(id)) } : {}) })).filter((p) => !p.groupId || !!p.assetIds?.length),
    workflow: { ...state.workflow, assetIds: state.workflow.assetIds?.filter((id) => assetIds.has(id)) ?? null, publishDraftId: state.workflow.publishDraftId && state.publishDrafts.some((p) => p.id === state.workflow.publishDraftId) ? state.workflow.publishDraftId : null },
    favorites: state.favorites.filter((id) => assetIds.has(id)),
  }
}
