import type { StudioDatabase } from '../database/client'
import type { AssetService } from './assets'
import type { PromptService } from './prompts'
import type { CreationDraft } from '../../src/lib/types'
import { DEFAULT_QUALITY_PREFERENCES, EMPTY_SCORES, QUALITY_DIMENSIONS, qualityPreferencesSchema, referenceAnalysisSchema, weightedQuality } from '../../src/shared/quality'
import type { GuidanceSource, PromptGuidance, QualityPreferences, QualityReference, QualityReferenceInput, ReferenceAnalysis } from '../../src/shared/quality'
import { AppError } from '../errors'

export interface AnalysisInput { title: string; style: string; images: { bytes: Buffer; mime: string }[] }
type ReferenceRow = { id: string; payload: string; version: number; created_at: number; updated_at: number }
export class QualityService {
  private busy = new Set<string>()
  constructor(private database: StudioDatabase, private assets: AssetService, private prompts: PromptService) {}
  preferences(): QualityPreferences {
    const row = this.database.sqlite.prepare('SELECT payload FROM quality_preferences WHERE id=1').get() as { payload: string } | undefined
    return row ? qualityPreferencesSchema.parse(JSON.parse(row.payload)) : structuredClone(DEFAULT_QUALITY_PREFERENCES)
  }
  savePreferences(value: QualityPreferences) {
    this.database.sqlite.prepare('INSERT INTO quality_preferences(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(value))
    return this.preferences()
  }
  private fromRow(row: ReferenceRow): QualityReference {
    const value = JSON.parse(row.payload) as QualityReferenceInput & { analysis: QualityReference['analysis'] }
    return { ...value, id: row.id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, weighted: weightedQuality(value.scores, this.preferences().weights) }
  }
  list() { return (this.database.sqlite.prepare('SELECT * FROM quality_references ORDER BY updated_at DESC,id DESC').all() as ReferenceRow[]).map((r) => this.fromRow(r)) }
  get(id: string) {
    const row = this.database.sqlite.prepare('SELECT * FROM quality_references WHERE id=?').get(id) as ReferenceRow | undefined
    if (!row) throw new AppError('REFERENCE_NOT_FOUND', '这组优质参考不存在。', 404)
    return this.fromRow(row)
  }
  private validate(value: QualityReferenceInput) {
    const available = new Set(this.database.assets().map((a) => a.id))
    if (value.assetIds.some((id) => !available.has(id))) throw new AppError('ASSET_NOT_FOUND', '部分参考图片已删除，请重新选择。')
    if (new Set(value.assetIds).size !== value.assetIds.length) throw new AppError('VALIDATION', '同一组中不能重复选择同一张参考图。')
  }
  create(id: string, value: QualityReferenceInput) {
    this.validate(value)
    const existing = this.database.sqlite.prepare('SELECT * FROM quality_references WHERE id=?').get(id) as ReferenceRow | undefined
    if (existing) {
      const old = this.fromRow(existing)
      if (JSON.stringify(old.assetIds) !== JSON.stringify(value.assetIds) || old.title !== value.title) throw new AppError('REFERENCE_CONFLICT', '这组参考已存在，请刷新后重试。', 409)
      return old
    }
    const now = Date.now()
    this.database.sqlite.prepare('INSERT INTO quality_references(id,payload,version,created_at,updated_at) VALUES (?,?,1,?,?)').run(id, JSON.stringify({ ...value, analysis: null }), now, now)
    return this.get(id)
  }
  update(id: string, version: number, value: QualityReferenceInput) {
    this.validate(value)
    const previous = this.get(id)
    // An analysis of replaced images must never be applied to the new images.
    const sameImages = JSON.stringify(value.assetIds) === JSON.stringify(previous.assetIds) && value.style === previous.style
    const payload = { ...value, scores: sameImages ? value.scores : { ...EMPTY_SCORES }, analysis: sameImages ? previous.analysis : null }
    if (!this.database.sqlite.prepare('UPDATE quality_references SET payload=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(JSON.stringify(payload), Date.now(), id, version).changes) throw new AppError('REFERENCE_CONFLICT', '参考已被其他窗口更新，请重新打开。', 409)
    return this.get(id)
  }
  remove(id: string, version: number) {
    this.get(id)
    if (!this.database.sqlite.prepare('DELETE FROM quality_references WHERE id=? AND version=?').run(id, version).changes) throw new AppError('REFERENCE_CONFLICT', '参考已更新，请刷新后重试。', 409)
    return { ok: true }
  }
  async analyze(id: string, model: string, analyzer: (input: AnalysisInput) => Promise<ReferenceAnalysis>) {
    if (this.busy.has(id)) throw new AppError('ANALYSIS_BUSY', '这组图片正在分析中，请稍候。', 429)
    const reference = this.get(id)
    this.busy.add(id)
    try {
      const images = await Promise.all(reference.assetIds.map((assetId) => this.assets.input(assetId, 1024)))
      const analysis = referenceAnalysisSchema.parse(await analyzer({ title: reference.title, style: reference.style, images }))
      if (images.length === 1) analysis.suggestedScores.consistency = null
      const { id: _id, version: _version, createdAt: _created, updatedAt: _updated, weighted: _weighted, ...payload } = reference
      payload.analysis = { ...analysis, model, analyzedAt: Date.now() }
      if (!this.database.sqlite.prepare('UPDATE quality_references SET payload=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(JSON.stringify(payload), Date.now(), id, reference.version).changes) throw new AppError('REFERENCE_CONFLICT', '分析期间参考已更改，未覆盖现有内容。请重新打开。', 409)
      this.database.audit('reference.analyze', id)
      return this.get(id)
    } finally { this.busy.delete(id) }
  }
  context(draft: CreationDraft): PromptGuidance {
    const preferences = this.preferences()
    const result: PromptGuidance = { enabled: preferences.enabled, weights: preferences.weights, sources: [] }
    if (!preferences.enabled) return result
    const candidates: GuidanceSource[] = []
    for (const reference of this.list()) {
      if (!reference.approved || !reference.analysis) continue
      if (reference.weighted.score !== null && (reference.weighted.score < preferences.minScore || reference.weighted.coverage < 0.6)) continue
      const directions = Object.fromEntries(QUALITY_DIMENSIONS.filter(({ key }) => preferences.weights[key] > 0 && (key !== 'makeup' || reference.style === draft.style) && (key !== 'consistency' || reference.analysis!.suggestedScores.consistency !== null || reference.scores.consistency !== null)).map(({ key }) => [key, reference.analysis!.observations[key]]))
      if (Object.keys(directions).length) candidates.push({ id: reference.id, kind: 'reference', title: reference.title, style: reference.style, score: reference.weighted.score, priority: reference.priority, directions })
    }
    const rows = this.database.sqlite.prepare("SELECT id FROM prompt_history WHERE json_extract(payload,'$.feedback.rating')='good' AND json_extract(payload,'$.draft.style')=? ORDER BY created_at DESC LIMIT 100").all(draft.style) as { id: string }[]
    for (const { id } of rows) {
      const item = this.prompts.historyItem(id)
      if (!item.job.resultAssetIds.length || item.draft.mode !== draft.mode) continue
      const quality = weightedQuality(item.feedback.scores, preferences.weights)
      if (quality.score !== null && (quality.score < preferences.minScore || quality.coverage < 0.6)) continue
      const marker = `妆容风格：${draft.style}。`
      const description = item.draft.prompt.includes(marker) ? item.draft.prompt.split(marker).slice(1).join(marker) : item.draft.prompt
      const key = [...QUALITY_DIMENSIONS].sort((a, b) => preferences.weights[b.key] - preferences.weights[a.key])[0].key
      candidates.push({ id, kind: 'history', title: `${draft.style} · 已认可作品`, style: draft.style, score: quality.score, priority: 3, directions: { [key]: `仅提取摄影与妆容技法，不沿用人物身份或服装。已认可描述：${description.slice(0, 1200)}。心得：${item.feedback.notes.slice(0, 400)}` } })
    }
    candidates.sort((a, b) => Number(b.style === draft.style) - Number(a.style === draft.style) || Number(b.score !== null) - Number(a.score !== null) || (b.score ?? 0) * b.priority - (a.score ?? 0) * a.priority || b.priority - a.priority)
    result.sources = candidates.slice(0, preferences.maxSources)
    return result
  }
  export() { return { preferences: this.preferences(), references: this.list() } }
}
