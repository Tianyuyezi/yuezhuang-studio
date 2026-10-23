import { Check, KeyRound, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useBackend } from '../stores/backend'
import type { ProviderConfig, ProviderStatus } from '../shared/contracts'
import { request } from '../lib/api'
import { Button, useNotify } from './ui'

export default function ProviderSettings() {
  const status = useBackend((s) => s.provider)
  const [form, setForm] = useState<ProviderConfig>({ baseUrl: 'https://api.openai.com/v1', imageModel: 'gpt-image-2', textModel: 'gpt-6.1-sol', allowInsecureHttp: false })
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const notify = useNotify()
  useEffect(() => { if (status) setForm({ baseUrl: status.baseUrl, imageModel: status.imageModel, textModel: status.textModel, allowInsecureHttp: status.allowInsecureHttp }) }, [status?.baseUrl, status?.imageModel, status?.textModel, status?.allowInsecureHttp])
  const update = (value: Partial<ProviderConfig>) => setForm((f) => ({ ...f, ...value }))
  async function save(test = false) {
    setBusy(true)
    try {
      let provider = await request<ProviderStatus>('/provider', { method: 'PUT', body: JSON.stringify({ ...form, ...(key.trim() ? { apiKey: key.trim() } : {}) }) })
      setKey('')
      useBackend.setState({ provider })
      if (test) { provider = await request<ProviderStatus>('/provider/test', { method: 'POST' }); useBackend.setState({ provider }); notify(`连接成功，读取到 ${provider.models.length} 个模型。`) }
      else notify('服务配置已保存，密钥不会返回前端。')
    } catch (error) { notify(error instanceof Error ? error.message : '配置失败', 'error') }
    finally { setBusy(false) }
  }
  const models = status?.models ?? []
  const imageModels = [...new Set([form.imageModel, ...models.filter((m) => /image/i.test(m))])]
  const textModels = [...new Set([form.textModel, ...models.filter((m) => !/image|audio|realtime|review/i.test(m))])]
  return <div className="provider-form"><div className="provider-form-title"><KeyRound size={17} /><h3>图片与文案服务</h3><span className={`tag ${status?.hasKey ? '' : 'amber'}`}>{status?.hasKey ? '已配置凭据' : '尚未配置'}</span></div><div className="form-stack"><label>API 地址<input value={form.baseUrl} type="url" onChange={(e) => update({ baseUrl: e.target.value })} placeholder="https://api.example.com/v1" /></label><label>API 密钥<input type="password" autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={status?.hasKey ? '已保存。留空保留当前密钥' : '粘贴密钥，保存到系统安全存储'} /></label><div className="form-two-col"><label>图片模型<select value={form.imageModel} onChange={(e) => update({ imageModel: e.target.value })}>{imageModels.map((m) => <option key={m}>{m}</option>)}</select></label><label>文案模型<select value={form.textModel} onChange={(e) => update({ textModel: e.target.value })}>{textModels.map((m) => <option key={m}>{m}</option>)}</select></label></div><label className="checkbox-label"><input type="checkbox" checked={form.allowInsecureHttp} onChange={(e) => update({ allowInsecureHttp: e.target.checked })} />允许已知的 HTTP 兼容服务</label>{form.baseUrl.startsWith('http:') && <p className="provider-warning">当前服务使用未加密的 HTTP，密钥、提示词与参考图会通过该连接传输。</p>}<p className="provider-storage-note">凭据保存位置：{status?.credentialStorage === 'keychain' ? 'macOS 钥匙串' : '当前服务进程（重启需重新配置）'}。不写入项目、浏览器持久存储或导出文件。</p><div className="provider-actions"><Button disabled={busy} onClick={() => { void save(false) }}><Check size={14} />保存服务配置</Button><Button variant="primary" disabled={busy} onClick={() => { void save(true) }}><RefreshCw size={14} />{busy ? '连接中…' : '测试连接'}</Button>{status?.hasKey && <Button variant="ghost" disabled={busy} onClick={async () => { setBusy(true); try { const provider = await request<ProviderStatus>('/provider/key', { method: 'DELETE' }); useBackend.setState({ provider }); notify('已移除服务密钥') } catch (error) { notify(error instanceof Error ? error.message : '移除失败', 'error') } finally { setBusy(false) } }}>移除凭据</Button>}</div>{status?.verifiedAt && <p className="provider-storage-note">最近连接验证：{new Date(status.verifiedAt).toLocaleString('zh-CN')}</p>}</div></div>
}
