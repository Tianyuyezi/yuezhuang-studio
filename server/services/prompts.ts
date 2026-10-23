import { randomUUID } from 'node:crypto'
import type { StudioDatabase } from '../database/client'
import type { AIJob } from '../../src/shared/contracts'
import type { CreationDraft } from '../../src/lib/types'
import type { PromptAttempt, PromptHistoryItem, PromptPage, PromptRecord, PromptTemplate, PromptTemplateInput } from '../../src/shared/prompts'
import { AppError } from '../errors'
import type { PromptGuidance } from '../../src/shared/quality'

export class PromptService {
  constructor(private database: StudioDatabase) {}
  record(job: AIJob, draft: CreationDraft, guidance?: PromptGuidance) {
    const value: PromptRecord = { id: job.id, draft: structuredClone(draft), model: job.model, createdAt: job.createdAt, legacy: false, attempts: [], feedback: { rating: 'unrated', notes: '' } }
    if (guidance) value.guidance = structuredClone(guidance)
    this.database.sqlite.prepare('INSERT INTO prompt_history (id,payload,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').run(job.id, JSON.stringify(value), job.createdAt)
  }
  historyItem(id: string): PromptHistoryItem {
    const row = this.database.sqlite.prepare('SELECT h.payload AS record,j.payload AS job FROM prompt_history h JOIN ai_jobs j ON j.id=h.id WHERE h.id=?').get(id) as { record: string; job: string } | undefined
    if (!row) throw new AppError('PROMPT_RECORD_NOT_FOUND', '这条生成记录不存在。', 404)
    return { ...JSON.parse(row.record), job: JSON.parse(row.job) }
  }
  private change(id: string, fn: (record: PromptRecord) => PromptRecord) {
    this.database.sqlite.transaction(() => {
      const { job: _job, ...record } = this.historyItem(id)
      this.database.sqlite.prepare('UPDATE prompt_history SET payload=? WHERE id=?').run(JSON.stringify(fn(record)), id)
    })()
  }
  beginAttempt(id: string, attempt: PromptAttempt) { this.change(id, (record) => ({ ...record, attempts: [...record.attempts, attempt] })) }
  finishAttempt(id: string, index: number, result: Pick<PromptAttempt, 'status' | 'assetId' | 'error'>) {
    this.change(id, (record) => ({ ...record, attempts: record.attempts.map((a) => a.index === index ? { ...a, ...result, completedAt: Date.now() } : a) }))
  }
  recover() {
    const records = this.database.sqlite.prepare("SELECT id FROM prompt_history WHERE EXISTS (SELECT 1 FROM json_each(payload,'$.attempts') WHERE json_extract(value,'$.status')='running')").all() as { id: string }[]
    for (const { id } of records) this.change(id, (record) => ({ ...record, attempts: record.attempts.map((a) => a.status === 'running' ? { ...a, status: 'interrupted', error: '服务在请求期间重启，请先核对供应商记录。', completedAt: Date.now() } : a) }))
  }
  history(query: { q: string; offset: number; limit: number }): PromptPage<PromptHistoryItem> {
    const where = "WHERE (?='' OR json_extract(h.payload,'$.draft.prompt') LIKE ? OR json_extract(h.payload,'$.draft.style') LIKE ? OR json_extract(h.payload,'$.model') LIKE ?)"
    const search = [query.q, ...Array(3).fill(`%${query.q}%`)]
    const total = (this.database.sqlite.prepare(`SELECT count(*) AS n FROM prompt_history h ${where}`).get(...search) as { n: number }).n
    const rows = this.database.sqlite.prepare(`SELECT h.payload AS record,j.payload AS job FROM prompt_history h JOIN ai_jobs j ON j.id=h.id ${where} ORDER BY h.created_at DESC,h.id DESC LIMIT ? OFFSET ?`).all(...search, query.limit, query.offset) as { record: string; job: string }[]
    return { items: rows.map((r) => ({ ...JSON.parse(r.record), job: JSON.parse(r.job) })), total }
  }
  feedback(id: string, value: PromptRecord['feedback']) { this.change(id, (r) => ({ ...r, feedback: value })); return this.historyItem(id) }
  library(query: { q: string; favorite: boolean; offset: number; limit: number }): PromptPage<PromptTemplate> {
    const where = "WHERE (?=0 OR favorite=1) AND (?='' OR json_extract(payload,'$.title') LIKE ? OR json_extract(payload,'$.prompt') LIKE ? OR json_extract(payload,'$.tags') LIKE ? OR json_extract(payload,'$.style') LIKE ? OR json_extract(payload,'$.author') LIKE ?)"
    const params = [Number(query.favorite), query.q, ...Array(5).fill(`%${query.q}%`)]
    const total = (this.database.sqlite.prepare(`SELECT count(*) AS n FROM prompt_library ${where}`).get(...params) as { n: number }).n
    const rows = this.database.sqlite.prepare(`SELECT * FROM prompt_library ${where} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params, query.limit, query.offset) as LibraryRow[]
    return { items: rows.map((r) => this.template(r)), total }
  }
  private template(row: LibraryRow): PromptTemplate {
    const value = JSON.parse(row.payload) as PromptTemplateInput
    let assetIds = value.sourceJobId ? this.database.job(value.sourceJobId)?.payload.resultAssetIds ?? [] : []
    if (value.sourceReferenceId) {
      const reference = this.database.sqlite.prepare('SELECT payload FROM quality_references WHERE id=?').get(value.sourceReferenceId) as { payload: string } | undefined
      if (reference) assetIds = [...new Set([...assetIds, ...JSON.parse(reference.payload).assetIds])]
    }
    return { ...value, id: row.id, version: row.version, favorite: !!row.favorite, createdAt: row.created_at, updatedAt: row.updated_at, assetIds }
  }
  get(id: string) {
    const row = this.database.sqlite.prepare('SELECT * FROM prompt_library WHERE id=?').get(id) as LibraryRow | undefined
    if (!row) throw new AppError('PROMPT_NOT_FOUND', '提示词已删除，请刷新列表。', 404)
    return this.template(row)
  }
  create(value: PromptTemplateInput, id: string = randomUUID()) {
    if (value.sourceJobId) this.historyItem(value.sourceJobId)
    const existing = this.database.sqlite.prepare('SELECT * FROM prompt_library WHERE id=?').get(id) as LibraryRow | undefined
    if (existing) {
      if (existing.payload !== JSON.stringify(value)) throw new AppError('PROMPT_CONFLICT', '这条提示词已经存在，请刷新后重试。', 409)
      return this.template(existing)
    }
    const now = Date.now()
    this.database.sqlite.prepare('INSERT INTO prompt_library(id,payload,favorite,version,created_at,updated_at) VALUES (?,?,0,1,?,?)').run(id, JSON.stringify(value), now, now)
    return this.get(id)
  }
  update(id: string, version: number, value: PromptTemplateInput) {
    if (value.sourceJobId) this.historyItem(value.sourceJobId)
    const result = this.database.sqlite.prepare('UPDATE prompt_library SET payload=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(JSON.stringify(value), Date.now(), id, version)
    if (!result.changes) { this.get(id); throw new AppError('PROMPT_CONFLICT', '提示词已在其他窗口修改，请重新打开后再编辑。', 409) }
    return this.get(id)
  }
  favorite(id: string, favorite: boolean) { this.get(id); this.database.sqlite.prepare('UPDATE prompt_library SET favorite=? WHERE id=?').run(Number(favorite), id); return this.get(id) }
  remove(id: string, version: number) {
    this.get(id)
    if (!this.database.sqlite.prepare('DELETE FROM prompt_library WHERE id=? AND version=?').run(id, version).changes) throw new AppError('PROMPT_CONFLICT', '提示词已更新，请刷新后重试。', 409)
    return { ok: true }
  }
  export() {
    const history = this.database.sqlite.prepare('SELECT h.payload AS record,j.payload AS job FROM prompt_history h JOIN ai_jobs j ON j.id=h.id ORDER BY h.created_at').all() as { record: string; job: string }[]
    const library = this.database.sqlite.prepare('SELECT * FROM prompt_library ORDER BY created_at').all() as LibraryRow[]
    return { history: history.map((r) => ({ ...JSON.parse(r.record), job: JSON.parse(r.job) }) as PromptHistoryItem), library: library.map((r) => this.template(r)) }
  }
}
interface LibraryRow { id: string; payload: string; favorite: number; version: number; created_at: number; updated_at: number }
