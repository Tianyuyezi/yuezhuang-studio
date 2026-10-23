import { useEffect, useState } from 'react'
import { STYLE_CATEGORIES } from '../lib/style-presets'
import { useWorkspace } from '../stores/workspace'

export default function StylePicker() {
  const style = useWorkspace((s) => s.draft.style)
  const update = useWorkspace((s) => s.updateDraft)
  const [category, setCategory] = useState(STYLE_CATEGORIES.findIndex((c) => c.styles.includes(style)))
  useEffect(() => { const index = STYLE_CATEGORIES.findIndex((c) => c.styles.includes(style)); if (index >= 0) setCategory(index) }, [style])
  const selected = STYLE_CATEGORIES[category] ?? STYLE_CATEGORIES[0]
  return <div className="style-picker"><div className="style-category-tabs" role="tablist" aria-label="妆容风格分类">{STYLE_CATEGORIES.map((c, index) => <button key={c.label} role="tab" aria-selected={c === selected} className={c === selected ? 'active' : ''} onClick={() => setCategory(index)}>{c.label}</button>)}</div><div className="style-options">{selected.styles.map((value) => <button key={value} className={style === value ? 'selected' : ''} aria-pressed={style === value} onClick={() => update({ style: value })}>{value}{style === value && <span />}</button>)}</div></div>
}
