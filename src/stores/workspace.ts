import { create } from 'zustand'
import { emptyCaptions, INITIAL_DRAFT, INITIAL_WORKFLOW } from '../lib/data'
import { captionText, selectedWorkflowAssets } from '../lib/workflow'
import type { Asset, Caption, CaptionSet, CreationDraft, Language, ModelProfile, PageId, Project, PublishDraft, Settings, WorkGroup, WorkflowState } from '../lib/types'

interface Workspace {
  page: PageId
  workflow: WorkflowState
  updateWorkflow: (data: Partial<WorkflowState>) => void
  startWorkflow: (groupId?: string) => void
  draft: CreationDraft
  projects: Project[]
  activeProjectId: string | null
  importedAssets: Asset[]
  hiddenExamples: string[]
  favorites: string[]
  customModels: ModelProfile[]
  captions: Record<string, CaptionSet>
  workGroups: WorkGroup[]
  groupCaptions: Record<string, CaptionSet>
  copyGroupId: string | null
  promptHistoryId: string | null
  openPromptHistory: (id: string) => void
  promptReferenceId: string | null
  openPromptReferences: (id?: string) => void
  publishDrafts: PublishDraft[]
  settings: Settings
  setPage: (page: PageId) => void
  updateDraft: (data: Partial<CreationDraft>) => void
  resetDraft: () => void
  saveProject: (title: string, artist?: string, description?: string) => string
  openProject: (id: string) => void
  removeProject: (id: string) => void
  addAsset: (asset: Asset) => void
  removeAsset: (id: string) => void
  toggleFavorite: (id: string) => void
  addModel: (profile: ModelProfile) => void
  removeModel: (id: string) => void
  updateCaption: (projectId: string, language: Language, value: Partial<Caption>) => void
  openGroupCaptions: (groupId: string) => void
  openGroupPublishing: (groupId: string, language: Language, assetIds?: string[]) => void
  updateGroupCaption: (groupId: string, language: Language, value: Partial<Caption>) => void
  useExampleCaptions: (projectId: string, example: CaptionSet) => void
  addPublishDraft: (draft: PublishDraft) => void
  removePublishDraft: (id: string) => void
  updateSettings: (settings: Partial<Settings>) => void
}

export const useWorkspace = create<Workspace>()((set, get) => ({
  page: 'studio', workflow: { ...INITIAL_WORKFLOW }, draft: { ...INITIAL_DRAFT }, projects: [], activeProjectId: null,
  updateWorkflow: (data) => set((state) => ({ workflow: { ...state.workflow, ...data } })),
  startWorkflow: (groupId) => set((state) => ({ page: 'workflow', workflow: { ...INITIAL_WORKFLOW, language: state.settings.language, ...(groupId ? { step: 2 as const, groupId } : {}) } })),
  importedAssets: [], hiddenExamples: [], favorites: [], customModels: [], captions: {}, workGroups: [], groupCaptions: {}, copyGroupId: null, publishDrafts: [],
  settings: { studioName: '悦妆工作室', artistName: '工作室主理人', language: 'zh', timezone: 'Asia/Shanghai' },
  promptHistoryId: null,
  promptReferenceId: null,
  openPromptHistory: (promptHistoryId) => set({ promptHistoryId, promptReferenceId: null, page: 'prompts' }),
  openPromptReferences: (id) => set({ promptReferenceId: id ?? 'all', promptHistoryId: null, page: 'prompts' }),
  setPage: (page) => set({ page }),
  updateDraft: (data) => set((state) => ({ draft: { ...state.draft, ...data } })),
  resetDraft: () => set({ draft: { ...INITIAL_DRAFT }, activeProjectId: null }),
  saveProject: (title, artist, description) => {
    const { activeProjectId, projects, draft, settings } = get()
    const existing = projects.find((p) => p.id === activeProjectId)
    const id = existing?.id ?? crypto.randomUUID()
    const project: Project = {
      id, title: title.trim() || '未命名妆容创作', artist: artist?.trim() || existing?.artist || settings.artistName,
      description: description ?? existing?.description ?? '', draft: { ...draft }, coverId: draft.referenceId ?? existing?.coverId ?? null,
      createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
    }
    set({ projects: [project, ...projects.filter((p) => p.id !== id)], activeProjectId: id })
    return id
  },
  openProject: (id) => {
    const project = get().projects.find((p) => p.id === id)
    if (project) set({ activeProjectId: id, draft: { ...project.draft }, page: 'studio' })
  },
  removeProject: (id) => set((state) => ({
    projects: state.projects.filter((p) => p.id !== id),
    activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
    draft: state.activeProjectId === id ? { ...INITIAL_DRAFT } : state.draft,
    captions: Object.fromEntries(Object.entries(state.captions).filter(([key]) => key !== id)),
    publishDrafts: state.publishDrafts.filter((p) => p.projectId !== id),
  })),
  addAsset: (asset) => set((state) => ({ importedAssets: [asset, ...state.importedAssets] })),
  removeAsset: (id) => set((state) => ({
    importedAssets: state.importedAssets.filter((a) => a.id !== id),
    hiddenExamples: id.startsWith('sample-') ? [...state.hiddenExamples, id] : state.hiddenExamples,
    favorites: state.favorites.filter((a) => a !== id),
    draft: { ...state.draft, referenceId: state.draft.referenceId === id ? null : state.draft.referenceId, modelId: state.customModels.some((m) => m.assetId === id && m.id === state.draft.modelId) ? null : state.draft.modelId },
    customModels: state.customModels.filter((m) => m.assetId !== id),
    projects: state.projects.map((p) => ({ ...p, coverId: p.coverId === id ? null : p.coverId, draft: { ...p.draft, referenceId: p.draft.referenceId === id ? null : p.draft.referenceId, modelId: state.customModels.some((m) => m.assetId === id && m.id === p.draft.modelId) ? null : p.draft.modelId } })),
  })),
  toggleFavorite: (id) => set((state) => ({ favorites: state.favorites.includes(id) ? state.favorites.filter((a) => a !== id) : [...state.favorites, id] })),
  addModel: (profile) => set((state) => ({ customModels: [profile, ...state.customModels] })),
  removeModel: (id) => set((state) => ({ customModels: state.customModels.filter((m) => m.id !== id), draft: state.draft.modelId === id ? { ...state.draft, modelId: 'model-01' } : state.draft, projects: state.projects.map((p) => p.draft.modelId === id ? { ...p, draft: { ...p.draft, modelId: 'model-01' } } : p) })),
  updateCaption: (projectId, language, value) => set((state) => {
    const captions = state.captions[projectId] ?? emptyCaptions()
    return { captions: { ...state.captions, [projectId]: { ...captions, [language]: { ...captions[language], ...value } } } }
  }),
  openGroupCaptions: (copyGroupId) => set({ copyGroupId, page: 'copywriting' }),
  openGroupPublishing: (groupId, language, assetIds) => set((state) => {
    const group = state.workGroups.find((item) => item.id === groupId)
    if (!group) return {}
    const sameGroup = state.workflow.groupId === groupId
    const previousSelection = sameGroup ? state.workflow.assetIds : null
    const selection = selectedWorkflowAssets(group, state.importedAssets, assetIds ?? previousSelection ?? group.assetIds).map((asset) => asset.id)
    const sameSelection = sameGroup && JSON.stringify(selection) === JSON.stringify(selectedWorkflowAssets(group, state.importedAssets, previousSelection).map((asset) => asset.id))
    const caption = (state.groupCaptions[groupId] ?? emptyCaptions())[language]
    const step = !selection.length || selection.length > 20 ? 2 : captionText(caption).trim() ? 4 : 3
    return {
      page: 'workflow', copyGroupId: groupId,
      workflow: { ...(sameSelection ? state.workflow : INITIAL_WORKFLOW), groupId, language, assetIds: selection.length > 20 ? [] : selection, step },
    }
  }),
  updateGroupCaption: (groupId, language, value) => set((state) => {
    const captions = state.groupCaptions[groupId] ?? emptyCaptions()
    return { groupCaptions: { ...state.groupCaptions, [groupId]: { ...captions, [language]: { ...captions[language], ...value } } } }
  }),
  useExampleCaptions: (projectId, example) => set((state) => {
    const previous = state.captions[projectId] ?? emptyCaptions()
    const captions = Object.fromEntries((['zh', 'en', 'ko'] as const).map((lang) => [lang, previous[lang].locked ? previous[lang] : { ...example[lang] }])) as unknown as CaptionSet
    return { captions: { ...state.captions, [projectId]: captions } }
  }),
  addPublishDraft: (draft) => set((state) => ({ publishDrafts: [draft, ...state.publishDrafts.filter((p) => p.id !== draft.id)] })),
  removePublishDraft: (id) => set((state) => ({ publishDrafts: state.publishDrafts.filter((d) => d.id !== id) })),
  updateSettings: (settings) => set((state) => ({ settings: { ...state.settings, ...settings } })),
}))

export function clearWorkspace() {
  const page = useWorkspace.getState().page
  useWorkspace.setState({ page, workflow: { ...INITIAL_WORKFLOW }, draft: { ...INITIAL_DRAFT }, projects: [], activeProjectId: null, importedAssets: [], hiddenExamples: [], favorites: [], customModels: [], captions: {}, workGroups: [], groupCaptions: {}, copyGroupId: null, promptHistoryId: null, promptReferenceId: null, publishDrafts: [], settings: { studioName: '悦妆工作室', artistName: '工作室主理人', language: 'zh', timezone: 'Asia/Shanghai' } })
}
