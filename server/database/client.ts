import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq, isNull } from 'drizzle-orm'
import { mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as schema from './schema'
import { draftSchema, settingsSchema, workspaceSchema } from '../../src/shared/contracts'
import type { WorkspaceData, AIJob } from '../../src/shared/contracts'
import { INITIAL_DRAFT, INITIAL_WORKFLOW } from '../../src/lib/data'
import { SAMPLE_ASSET_IDS } from '../../src/shared/examples'
import { AppError } from '../errors'
import { buildWorkGroups } from '../../src/lib/groups'

export function initialWorkspace(): WorkspaceData {
  return { page: 'studio', workflow: { ...INITIAL_WORKFLOW }, draft: draftSchema.parse(INITIAL_DRAFT), projects: [], activeProjectId: null, hiddenExamples: [], favorites: [], customModels: [], captions: {}, groupCaptions: {}, publishDrafts: [], settings: settingsSchema.parse({ studioName: '悦妆工作室', artistName: '工作室主理人', language: 'zh', timezone: 'Asia/Shanghai' }) }
}

export class StudioDatabase {
  sqlite: Database.Database
  db: ReturnType<typeof drizzle<typeof schema>>
  constructor(public dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 })
    this.sqlite = new Database(join(dataDir, 'studio.sqlite'))
    chmodSync(join(dataDir, 'studio.sqlite'), 0o600)
    this.sqlite.pragma('foreign_keys = ON')
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('busy_timeout = 5000')
    this.db = drizzle(this.sqlite, { schema })
    this.migrate()
  }
  migrate() {
    const version = this.sqlite.pragma('user_version', { simple: true }) as number
    if (version > 5) throw new AppError('DATABASE_VERSION', '数据库版本较新，请使用匹配的应用版本。', 500)
    if (version === 0) this.sqlite.transaction(() => {
      this.sqlite.exec(`
        CREATE TABLE workspace_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), updated_at INTEGER NOT NULL);
        CREATE TABLE assets (id TEXT PRIMARY KEY, metadata TEXT NOT NULL CHECK(json_valid(metadata)), original_path TEXT NOT NULL, thumbnail_path TEXT NOT NULL, mime_type TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, deleted_at INTEGER);
        CREATE TABLE ai_jobs (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL CHECK(json_valid(payload)), input TEXT NOT NULL CHECK(json_valid(input)));
        CREATE TABLE provider_config (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL CHECK(json_valid(payload)), models TEXT NOT NULL, verified_at INTEGER);
        CREATE TABLE project_archive (id TEXT PRIMARY KEY, payload TEXT NOT NULL, deleted_at INTEGER NOT NULL);
        CREATE TABLE audit_events (id TEXT PRIMARY KEY, operation TEXT NOT NULL, entity_id TEXT, code TEXT, created_at INTEGER NOT NULL);
        PRAGMA user_version = 1;
      `)
    })()
    this.sqlite.exec('CREATE TABLE IF NOT EXISTS app_meta (id INTEGER PRIMARY KEY CHECK(id=1), instance_id TEXT NOT NULL)')
    if (!this.sqlite.prepare('SELECT instance_id FROM app_meta WHERE id=1').get()) this.sqlite.prepare('INSERT INTO app_meta (id,instance_id) VALUES (1,?)').run(randomUUID())
    if (!this.db.select().from(schema.workspaceTable).get()) this.db.insert(schema.workspaceTable).values({ id: 1, revision: 0, payload: initialWorkspace(), updatedAt: Date.now() }).run()
    if (!this.db.select().from(schema.providerTable).get()) this.db.insert(schema.providerTable).values({ id: 1, payload: { baseUrl: 'https://api.openai.com/v1', imageModel: 'gpt-image-2', textModel: 'gpt-6.1-sol', allowInsecureHttp: false }, models: [], verifiedAt: null }).run()
    if (version < 2) this.db.transaction(() => {
      const row = this.db.select().from(schema.workspaceTable).get()!
      const state = workspaceSchema.parse(row.payload)
      const groups = this.groups(state)
      for (const project of state.projects) {
        const set = state.captions[project.id]
        const group = groups.find((g) => g.assetIds.includes(project.coverId ?? '')) ?? groups.filter((g) => g.projectId === project.id).at(-1)
        if (set && group && !state.groupCaptions[group.id]) state.groupCaptions[group.id] = structuredClone(set)
      }
      this.db.update(schema.workspaceTable).set({ payload: state, revision: row.revision + (version === 1 ? 1 : 0) }).where(eq(schema.workspaceTable.id, 1)).run()
      this.sqlite.pragma('user_version = 2')
    })
    if (version < 3) this.sqlite.transaction(() => {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS prompt_history (id TEXT PRIMARY KEY REFERENCES ai_jobs(id), payload TEXT NOT NULL CHECK(json_valid(payload)), created_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS prompt_history_created ON prompt_history(created_at DESC,id DESC);
        CREATE TABLE IF NOT EXISTS prompt_library (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)), favorite INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      `)
      const insert = this.sqlite.prepare('INSERT INTO prompt_history(id,payload,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING')
      for (const row of this.db.select().from(schema.jobTable).all()) {
        const draft = draftSchema.safeParse(row.input.draft)
        if (row.payload.kind !== 'image' || !draft.success) continue
        insert.run(row.id, JSON.stringify({ id: row.id, draft: draft.data, model: row.payload.model, createdAt: row.payload.createdAt, legacy: true, attempts: [], feedback: { rating: 'unrated', notes: '' } }), row.payload.createdAt)
      }
      this.sqlite.pragma('user_version = 3')
    })()
    if (version < 4) this.sqlite.transaction(() => {
      this.sqlite.exec(`CREATE TABLE IF NOT EXISTS quality_references (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)), version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS quality_preferences (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL CHECK(json_valid(payload)));`)
      this.sqlite.pragma('user_version = 4')
    })()
    if (version < 5) this.sqlite.transaction(() => {
      this.sqlite.exec(`CREATE TABLE IF NOT EXISTS instagram_config (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL CHECK(json_valid(payload)));
        INSERT OR IGNORE INTO instagram_config VALUES (1,'{"appId":"","publicBaseUrl":"","apiVersion":"v26.0"}');
        CREATE TABLE IF NOT EXISTS instagram_accounts (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)));
        CREATE TABLE IF NOT EXISTS instagram_publications (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), updated_at INTEGER NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS instagram_snapshot_once ON instagram_publications(fingerprint) WHERE status NOT IN ('failed','cancelled');
        CREATE INDEX IF NOT EXISTS instagram_publication_status ON instagram_publications(status,updated_at);`)
      this.sqlite.pragma('user_version = 5')
    })()
  }
  snapshot() {
    const row = this.db.select().from(schema.workspaceTable).where(eq(schema.workspaceTable.id, 1)).get()!
    const instance = this.sqlite.prepare('SELECT instance_id FROM app_meta WHERE id=1').get() as { instance_id: string }
    const payload = workspaceSchema.parse(row.payload)
    return { workspaceId: instance.instance_id, revision: row.revision, state: { ...payload, importedAssets: this.assets(), workGroups: this.groups(payload) } }
  }
  groups(state?: WorkspaceData) {
    const workspace = state ?? workspaceSchema.parse(this.db.select().from(schema.workspaceTable).get()!.payload)
    const contexts = new Map(this.db.select().from(schema.jobTable).all().flatMap((r) => {
      const parsed = draftSchema.safeParse(r.input.draft)
      return parsed.success && r.payload.kind === 'image' ? [[r.id, parsed.data] as const] : []
    }))
    return buildWorkGroups(this.assets(), workspace.projects, contexts)
  }
  assets() { return this.db.select().from(schema.assetTable).where(isNull(schema.assetTable.deletedAt)).all().map((row) => row.metadata) }
  saveWorkspace(expectedRevision: number, input: WorkspaceData) {
    const parsed = workspaceSchema.parse(input)
    return this.db.transaction(() => {
      const current = this.snapshot()
      if (current.revision !== expectedRevision) throw new AppError('VERSION_CONFLICT', '资料已在另一窗口或任务中更新，请合并后重试。', 409)
      // A still-open older client must not erase the newly configured contact profiles.
      if (!input.settings.publicationBranding) parsed.settings.publicationBranding = current.state.settings.publicationBranding
      // Old browser windows may omit group captions during a rolling frontend update.
      const groups = new Set(this.groups(parsed).map((g) => g.id))
      parsed.groupCaptions = Object.fromEntries(Object.entries({ ...current.state.groupCaptions, ...parsed.groupCaptions }).filter(([id]) => groups.has(id)))
      this.validateReferences(parsed)
      for (const removed of current.state.projects.filter((p) => !parsed.projects.some((item) => item.id === p.id))) {
        this.db.insert(schema.projectArchiveTable).values({ id: removed.id, payload: { project: removed, captions: current.state.captions[removed.id] }, deletedAt: Date.now() }).onConflictDoNothing().run()
      }
      this.db.update(schema.workspaceTable).set({ revision: current.revision + 1, payload: parsed, updatedAt: Date.now() }).where(eq(schema.workspaceTable.id, 1)).run()
      return this.snapshot()
    })
  }
  mutateWorkspace(fn: (state: WorkspaceData) => WorkspaceData) {
    return this.db.transaction(() => {
      const current = this.snapshot()
      return this.saveWorkspace(current.revision, fn(workspaceSchema.parse(current.state)))
    })
  }
  validateReferences(state: WorkspaceData) {
    const projectIds = new Set(state.projects.map((p) => p.id))
    if (projectIds.size !== state.projects.length) throw new AppError('VALIDATION', '项目 ID 重复。')
    if (new Set(state.publishDrafts.map((p) => p.id)).size !== state.publishDrafts.length) throw new AppError('VALIDATION', '发布草稿 ID 重复。')
    if (state.activeProjectId && !projectIds.has(state.activeProjectId)) throw new AppError('VALIDATION', '当前项目不存在。')
    if (Object.keys(state.captions).some((id) => !projectIds.has(id)) || state.publishDrafts.some((p) => p.projectId !== null && !projectIds.has(p.projectId))) throw new AppError('VALIDATION', '文案或排期关联的项目不存在。')
    const groupIds = new Set(this.groups(state).map((g) => g.id))
    if (Object.keys(state.groupCaptions).some((id) => !groupIds.has(id))) throw new AppError('GROUP_NOT_FOUND', '作品组不存在。')
    for (const plan of state.publishDrafts) {
      const group = plan.groupId ? this.groups(state).find((g) => g.id === plan.groupId) : null
      if (group && plan.projectId && group.projectId !== plan.projectId) throw new AppError('PUBLISH_ASSETS_INVALID', '作品组与发布项目不匹配。')
      if (!plan.projectId && !group) throw new AppError('GROUP_NOT_FOUND', '发布草稿需要关联作品组或项目。')
      if (plan.groupId && (!group || plan.assetIds?.some((id) => !group.assetIds.includes(id)) || !plan.assetIds?.length || new Set(plan.assetIds).size !== plan.assetIds.length)) throw new AppError('PUBLISH_ASSETS_INVALID', '发布图片需要来自同一个作品组，且不能重复。')
    }
    const assetIds = new Set([...this.assets().map((a) => a.id), ...SAMPLE_ASSET_IDS])
    const references = [...state.customModels.map((m) => m.assetId), ...state.projects.flatMap((p) => [p.coverId, p.draft.referenceId]), state.draft.referenceId].filter(Boolean)
    if (references.some((id) => !assetIds.has(id!))) throw new AppError('ASSET_NOT_FOUND', '部分参考图片尚未上传或已经删除，请重新选择。')
  }
  listJobs() { return this.db.select().from(schema.jobTable).all().map((r) => r.payload).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100) }
  job(id: string) { return this.db.select().from(schema.jobTable).where(eq(schema.jobTable.id, id)).get() }
  updateJob(id: string, data: Partial<AIJob>) {
    const current = this.job(id)
    if (!current) throw new AppError('NOT_FOUND', '生成任务不存在。', 404)
    const payload = { ...current.payload, ...data, updatedAt: Date.now() }
    this.db.update(schema.jobTable).set({ payload }).where(eq(schema.jobTable.id, id)).run()
    return payload
  }
  audit(operation: string, entityId?: string, code?: string) { this.db.insert(schema.auditTable).values({ id: randomUUID(), operation, entityId, code, createdAt: Date.now() }).run() }
  close() { this.sqlite.close() }
}
