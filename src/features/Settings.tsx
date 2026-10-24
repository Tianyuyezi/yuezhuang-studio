import { ArrowDownToLine, Check, Database, HardDrive, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import InstagramSettings from '../components/InstagramSettings'
import PublicationBrandingSettings from '../components/PublicationBrandingSettings'
import ProviderSettings from '../components/ProviderSettings'
import { useWorkspace } from '../stores/workspace'
import { useBackend } from '../stores/backend'
import { LANGUAGES } from '../lib/data'
import type { Settings as SettingsType } from '../lib/types'
import { downloadFile } from '../lib/storage'
import { flushWorkspace } from '../lib/sync'
import { Button, useNotify } from '../components/ui'
import { requestResponse } from '../lib/api'
import { useAuth } from '../stores/auth'

export default function Settings() {
  const store = useWorkspace()
  const backend = useBackend()
  const [settings, setSettings] = useState<SettingsType>({ ...store.settings })
  const [exporting, setExporting] = useState(false)
  const notify = useNotify()
  const update = (value: Partial<SettingsType>) => setSettings((s) => ({ ...s, ...value }))
  async function exportData(backup: boolean) {
    const identity = useAuth.getState().workspaceKey
    setExporting(true)
    try {
      await flushWorkspace()
      const response = await requestResponse(backup ? '/backup' : '/export')
      if (!response.ok) throw new Error('导出未完成，请检查本地服务。')
      const blob = await response.blob()
      if (identity !== useAuth.getState().workspaceKey) return
      downloadFile(`悦妆师-${backup ? '完整备份' : '资料导出'}-${new Date().toISOString().slice(0, 10)}.json`, blob)
      notify(backup ? '完整备份已导出，包含图片文件。' : '资料已导出，原始图片需另行备份。')
    } catch (error) { notify(error instanceof Error ? error.message : '导出失败', 'error') }
    finally { setExporting(false) }
  }
  return <>
    <div className="page-heading"><div><h1>设置与连接</h1><p>管理工作室信息、默认偏好与服务连接。</p></div><span className="tag">本地测试版 · v0.2</span></div>
    <div className="settings-layout">
      <section className="settings-panel">
        <div className="settings-section-heading"><h2>工作空间</h2><p>你的工作室名称与默认创作偏好。</p></div>
        <form className="form-stack" onSubmit={async (e) => { e.preventDefault(); store.updateSettings({ studioName: settings.studioName, language: settings.language, timezone: settings.timezone }); try { await flushWorkspace(); notify('工作空间设置已保存到本机') } catch (error) { notify(error instanceof Error ? error.message : '保存失败', 'error') } }}>
          <label>工作室名称<input required maxLength={30} value={settings.studioName} onChange={(e) => update({ studioName: e.target.value })} /></label>
          <div className="form-two-col"><label>默认文案语言<select value={settings.language} onChange={(e) => update({ language: e.target.value as SettingsType['language'] })}>{LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label><label>默认排期时区<select value={settings.timezone} onChange={(e) => update({ timezone: e.target.value })}>{['Asia/Shanghai', 'Asia/Seoul', 'Asia/Tokyo', 'Europe/Paris', 'America/Los_Angeles', 'America/New_York', 'UTC'].map((tz) => <option key={tz}>{tz}</option>)}</select></label></div>
          <div className="settings-form-footer"><Button type="submit" variant="primary"><Check size={15} />保存偏好</Button></div>
        </form>
      </section>
      <aside className="settings-side"><div className="privacy-card"><ShieldCheck size={28} strokeWidth={1.3} /><h3>本地数据</h3><p>项目与文案保存到本机 SQLite，图片原图与缩略图保存在本机文件目录。生成和文案功能会将所选图片发送至已配置的服务。确认发布后，适配图和文案将发送至 Instagram。</p><span><span className="status-dot" />{backend.status === 'ready' ? '本地数据库已连接' : '等待本地服务'}</span></div><div className="settings-stats"><span><Database size={16} />本地项目<strong>{store.projects.length}</strong></span><span><HardDrive size={16} />本地素材<strong>{store.importedAssets.length}</strong></span></div></aside>
    </div>
    <PublicationBrandingSettings />
    <section className="settings-panel integration-panel">
      <div className="settings-section-heading"><h2>服务连接</h2><p>图片生成、参考图编辑与中英韩文案使用同一个兼容服务，可分别选择模型。</p></div>
      <ProviderSettings />
      <InstagramSettings />
    </section>
    <section className="settings-panel export-panel"><div><h2>导出工作室资料</h2><p>导出项目、文案、模特档案、排期、任务记录、提示词库、生成提示词和素材清单。</p><small>不包含图片文件与任何密钥。</small></div><Button disabled={exporting || backend.status !== 'ready'} onClick={() => { void exportData(false) }}><ArrowDownToLine size={16} />导出资料</Button></section>
    <section className="settings-panel export-panel"><div><h2>完整资料备份</h2><p>导出全部工作空间资料及有效图片文件，包含 SHA-256 校验值。</p><small>不包含 API 密钥。图片较多时文件可能较大，请妥善保存。</small></div><Button disabled={exporting || backend.status !== 'ready'} onClick={() => { void exportData(true) }}><ArrowDownToLine size={16} />{exporting ? '准备导出…' : '导出完整备份'}</Button></section>
    <p className="page-note">数据库与图片保存在 macOS 应用数据目录。浏览器仍保留草稿副本，连接异常时请先保留页面数据。</p>
  </>
}
