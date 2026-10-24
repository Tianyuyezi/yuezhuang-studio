import { useState } from 'react'
import { Check } from 'lucide-react'
import { useWorkspace } from '../stores/workspace'
import { flushWorkspace } from '../lib/sync'
import { publicationBrandingSchema, publicationContactFooter } from '../shared/publication-branding'
import type { ProfessionalProfile } from '../shared/publication-branding'
import { Button, useNotify } from './ui'

export default function PublicationBrandingSettings() {
  const store = useWorkspace(), notify = useNotify()
  const [value, setValue] = useState(() => {
    const current = publicationBrandingSchema.parse(store.settings.publicationBranding ?? {})
    if (!store.settings.publicationBranding && store.settings.artistName !== '工作室主理人') current.artist.name = store.settings.artistName
    return current
  })
  const [busy, setBusy] = useState(false)
  const updateProfile = (role: 'artist' | 'publisher', field: keyof ProfessionalProfile, text: string) => setValue((previous) => ({ ...previous, [role]: { ...previous[role], [field]: text } }))
  const footer = publicationContactFooter(value, store.settings.language)
  return <section className="settings-panel publication-branding-settings">
    <div className="settings-section-heading"><h2>化妆师与发布人</h2><p>联系方式会自动放在发布文案的最末尾，位于话题标签之后。未填写的项目不会显示。</p></div>
    <form className="form-stack" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true)
      try {
        const parsed = publicationBrandingSchema.parse(value)
        store.updateSettings({ publicationBranding: parsed, artistName: parsed.artist.name || '工作室主理人' })
        await flushWorkspace(); setValue(parsed); notify('化妆师、发布人与发布标识已保存到本机')
      } catch (error) { notify(error instanceof Error ? error.message : '保存未完成', 'error') }
      finally { setBusy(false) }
    }}>
      <div className="professional-profiles">{(['artist', 'publisher'] as const).map((role) => {
        const label = role === 'artist' ? '化妆师' : '发布人'
        return <fieldset key={role}><legend>{label}</legend><div className="form-stack">
          <label>姓名<input aria-label={`${label}姓名`} maxLength={40} autoComplete="off" placeholder="选填" value={value[role].name} onChange={(e) => updateProfile(role, 'name', e.target.value)} /></label>
          <div className="form-two-col"><label>微信<input aria-label={`${label}微信`} maxLength={80} autoComplete="off" placeholder="微信号" value={value[role].wechat} onChange={(e) => updateProfile(role, 'wechat', e.target.value)} /></label><label>电话<input aria-label={`${label}电话`} type="tel" maxLength={80} autoComplete="off" placeholder="含国家或地区区号" value={value[role].phone} onChange={(e) => updateProfile(role, 'phone', e.target.value)} /></label></div>
          <label>WhatsApp<input aria-label={`${label}WhatsApp`} type="tel" maxLength={80} autoComplete="off" placeholder="例如 +86…" value={value[role].whatsapp} onChange={(e) => updateProfile(role, 'whatsapp', e.target.value)} /></label>
          <label>邮箱<input aria-label={`${label}邮箱`} type="email" maxLength={120} autoComplete="off" placeholder="选填" value={value[role].email} onChange={(e) => updateProfile(role, 'email', e.target.value)} /></label>
          <label>其他联系信息<textarea aria-label={`${label}其他联系信息`} maxLength={300} rows={2} placeholder="服务范围、预约方式或其他联系方式（选填）" value={value[role].contactInfo} onChange={(e) => updateProfile(role, 'contactInfo', e.target.value)} /></label>
        </div></fieldset>
      })}</div>
      <div className="publication-watermark-settings"><h3>最终发布图片的双语标识</h3><p>创作效果图、作品库与原图导出不加水印。只有最终发布用的图片副本会添加下方标识，发布确认页可查看最终效果。</p>
        <label className="checkbox-label"><input type="checkbox" checked={value.watermarkEnabled} onChange={(e) => setValue({ ...value, watermarkEnabled: e.target.checked })} />发布图片添加英文和韩文标识</label>
        <div className="form-two-col"><label>英文标识<input aria-label="发布图片英文标识" required maxLength={80} value={value.watermarkEnglish} onChange={(e) => setValue({ ...value, watermarkEnglish: e.target.value })} /></label><label>韩文标识<input aria-label="发布图片韩文标识" required maxLength={60} value={value.watermarkKorean} onChange={(e) => setValue({ ...value, watermarkKorean: e.target.value })} /></label></div>
      </div>
      <div className="publication-contact-example"><h3>文案底部联系信息预览</h3>{footer ? <p>{footer}</p> : <p>填写后会显示在这里。联系方式均为选填。</p>}<small>称呼随发布语言切换为中文、英文或韩文，姓名和联系方式保持原样。</small></div>
      <div className="settings-form-footer"><Button type="submit" variant="primary" disabled={busy}><Check size={15} />{busy ? '正在保存…' : '保存人员与发布信息'}</Button></div>
    </form>
  </section>
}
