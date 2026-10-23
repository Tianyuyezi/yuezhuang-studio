import { useEffect, useState } from 'react'
import { Button, Modal, useNotify } from './ui'
import { request } from '../lib/api'
import { DEFAULT_QUALITY_PREFERENCES, EMPTY_SCORES, QUALITY_DIMENSIONS, weightedQuality } from '../shared/quality'
import type { QualityPreferences, QualityScores, QualityWeights } from '../shared/quality'

export function useQualityPreferences() {
  const [preferences, setPreferences] = useState<QualityPreferences>(DEFAULT_QUALITY_PREFERENCES)
  useEffect(() => {
    let cancelled = false
    const load = () => { void request<QualityPreferences>('/quality-preferences').then((value) => { if (!cancelled) setPreferences(value) }).catch(() => {}) }
    load(); window.addEventListener('quality-preferences-changed', load)
    return () => { cancelled = true; window.removeEventListener('quality-preferences-changed', load) }
  }, [])
  return preferences
}
export function ScoreFields({ value, onChange, weights }: { value?: QualityScores; onChange: (value: QualityScores) => void; weights: QualityWeights }) {
  const scores = value ?? EMPTY_SCORES
  const result = weightedQuality(scores, weights)
  const sum = Object.values(weights).reduce((a, b) => a + b, 0)
  return <div className="quality-score-fields"><div className="quality-score-heading"><strong>加权评测</strong><span>{result.score === null ? '尚未评分' : `${result.score.toFixed(1)} / 100`} · 已评 {result.dimensions} 项</span></div><div className="quality-score-grid">{QUALITY_DIMENSIONS.map(({ key, label }) => <label key={key}>{label}<span className="quality-score-input"><input aria-label={`${label}评分`} type="number" min={0} max={5} step="any" placeholder="未评" value={scores[key] ?? ''} onChange={(e) => onChange({ ...scores, [key]: e.target.value === '' ? null : Number(e.target.value) })} /><small>/ 5 · 权重 {sum ? Math.round(weights[key] / sum * 100) : 0}%</small></span></label>)}</div><p>空白为未评／不适用，不按 0 分计算。总分按已评维度归一化；已有评分时，覆盖不足 60% 的样本不自动选入优化。</p></div>
}
export function QualityPreferencesDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<QualityPreferences | null>(null)
  const [busy, setBusy] = useState(false)
  const notify = useNotify()
  useEffect(() => { void request<QualityPreferences>('/quality-preferences').then(setValue).catch((error) => notify(error.message, 'error')) }, [])
  const total = value ? Object.values(value.weights).reduce((a, b) => a + b, 0) : 0
  return <Modal open onOpenChange={(open) => { if (!open && !busy) onClose() }} title="评测权重与优化规则" description="权重用于评分、筛选样本和确定提示词重点，图片模型保持原配置。"><form className="form-stack" onSubmit={async (e) => {
    e.preventDefault(); if (!value) return; setBusy(true)
    try { await request('/quality-preferences', { method: 'PUT', body: JSON.stringify(value) }); window.dispatchEvent(new Event('quality-preferences-changed')); onSaved(); notify('评测权重已保存，后续创作按新规则选择样本') } catch (error) { notify(error instanceof Error ? error.message : '保存失败', 'error') } finally { setBusy(false) }
  }}>{value ? <><label className="quality-check"><input type="checkbox" checked={value.enabled} onChange={(e) => setValue({ ...value, enabled: e.target.checked })} />自动参考优质样本优化提示词</label>{QUALITY_DIMENSIONS.map(({ key, label }) => <label className="quality-weight-row" key={key}><span>{label}<small>{total ? Math.round(value.weights[key] / total * 100) : 0}%</small></span><input aria-label={`${label}权重`} type="range" min={0} max={100} step={1} value={value.weights[key]} onChange={(e) => setValue({ ...value, weights: { ...value.weights, [key]: Number(e.target.value) } })} /></label>)}<div className="form-two-col"><label>已评样本最低分<input type="number" min={0} max={100} required value={value.minScore} onChange={(e) => setValue({ ...value, minScore: Number(e.target.value) })} /></label><label>每次最多参考<select value={value.maxSources} onChange={(e) => setValue({ ...value, maxSources: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} 个样本</option>)}</select></label></div><p className="quality-explanation">已认可且有足够评分的样本按加权分、风格和优先级筛选。你明确选定但尚未评分的参考仍可提供方向，不会显示虚构分数。AI 建议分需手动采用并保存。</p></> : <p>正在读取规则…</p>}<div className="modal-actions"><Button type="button" onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy || !value || total === 0}>{busy ? '保存中…' : '保存规则'}</Button></div></form></Modal>
}
