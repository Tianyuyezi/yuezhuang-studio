import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { AIJob, ProviderConfig, WorkspaceData } from '../../src/shared/contracts'
import type { Asset } from '../../src/lib/types'

export const workspaceTable = sqliteTable('workspace_state', {
  id: integer('id').primaryKey(), revision: integer('revision').notNull(),
  payload: text('payload', { mode: 'json' }).$type<WorkspaceData>().notNull(), updatedAt: integer('updated_at').notNull(),
})
export const assetTable = sqliteTable('assets', {
  id: text('id').primaryKey(), metadata: text('metadata', { mode: 'json' }).$type<Asset>().notNull(),
  originalPath: text('original_path').notNull(), thumbnailPath: text('thumbnail_path').notNull(),
  mimeType: text('mime_type').notNull(), sha256: text('sha256').notNull(), sizeBytes: integer('size_bytes').notNull(), deletedAt: integer('deleted_at'),
})
export const jobTable = sqliteTable('ai_jobs', {
  id: text('id').primaryKey(), requestId: text('request_id').unique().notNull(),
  payload: text('payload', { mode: 'json' }).$type<AIJob>().notNull(),
  input: text('input', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
})
export const providerTable = sqliteTable('provider_config', {
  id: integer('id').primaryKey(), payload: text('payload', { mode: 'json' }).$type<ProviderConfig>().notNull(),
  models: text('models', { mode: 'json' }).$type<string[]>().notNull(), verifiedAt: integer('verified_at'),
})
export const projectArchiveTable = sqliteTable('project_archive', {
  id: text('id').primaryKey(), payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(), deletedAt: integer('deleted_at').notNull(),
})
export const auditTable = sqliteTable('audit_events', {
  id: text('id').primaryKey(), operation: text('operation').notNull(), entityId: text('entity_id'), code: text('code'), createdAt: integer('created_at').notNull(),
})
