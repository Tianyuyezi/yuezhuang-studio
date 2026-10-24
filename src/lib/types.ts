import type { PublicationBranding } from '../shared/publication-branding'

export type PageId = 'workflow' | 'studio' | 'projects' | 'assets' | 'models' | 'prompts' | 'copywriting' | 'publishing' | 'settings'
export type Language = 'zh' | 'en' | 'ko'
export type CreationMode = 'virtual' | 'edit'

export interface Asset {
  id: string
  title: string
  src?: string
  style: string
  kind: 'example' | 'imported' | 'generated'
  createdAt: number
  width?: number
  height?: number
  thumbnailSrc?: string
  projectId?: string | null
  jobId?: string
  groupId?: string
  exampleOrigin?: 'photography' | 'generated'
  examplePrompt?: string
}

export interface WorkGroup {
  id: string
  title: string
  assetIds: string[]
  projectId: string | null
  draft: CreationDraft | null
  source: 'generated' | 'imported'
  createdAt: number
}

export interface ModelProfile {
  id: string
  name: string
  description: string
  assetId: string
  tags: string[]
  example: boolean
  originJobId?: string
}

export interface CreationDraft {
  mode: CreationMode
  prompt: string
  style: string
  modelId: string | null
  ratio: string
  count: number
  referenceId: string | null
  imageModel?: string | null
  randomModel?: { occupation: string; age: number | null; outfit: string; country?: string; ethnicity?: string }
}

export interface Project {
  id: string
  title: string
  artist: string
  description: string
  draft: CreationDraft
  coverId: string | null
  createdAt: number
  updatedAt: number
}

export interface Caption {
  title: string
  body: string
  hashtags: string
  locked: boolean
}
export type CaptionSet = Record<Language, Caption>

export interface PublishDraft {
  id: string
  projectId: string | null
  groupId?: string | null
  assetIds?: string[]
  title: string
  scheduledAt: string
  timezone: string
  language: Language
  caption: string
  createdAt: number
}

export interface WorkflowState {
  step: 1 | 2 | 3 | 4
  jobId: string | null
  groupId: string | null
  assetIds: string[] | null
  language: Language
  publishDraftId: string | null
  scheduledAt: string | null
}

export interface Settings {
  studioName: string
  artistName: string
  language: Language
  timezone: string
  publicationBranding?: PublicationBranding
}
