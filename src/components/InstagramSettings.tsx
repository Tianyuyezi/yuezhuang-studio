import { useState } from 'react'
import { ExternalLink, RefreshCw, Unplug } from 'lucide-react'
import { useInstagramState } from '../lib/instagram'
import { request } from '../lib/api'
import { Button, Modal, useNotify } from './ui'
import type { InstagramConfig } from '../shared/instagram'

export default function InstagramSettings() {
  const { data, error, refresh } = useInstagramState()
  const [config, setConfig] = useState<InstagramConfig | null>(null)
  const [secret, setSecret] = useState(''), [token, setToken] = useState(''), [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(false), [disconnect, setDisconnect] = useState<string | null>(null)
  const notify = useNotify()
  async function action(task: () => Promise<unknown>, message: string) {
    setBusy(true)
    try { await task(); await refresh(); notify(message) }
    catch (e) { notify(e instanceof Error ? e.message : '操作失败', 'error') }
    finally { setBusy(false) }
  }
  const current = config ?? data?.config ?? { appId: '', publicBaseUrl: '', apiVersion: 'v26.0' }
  return <div className="instagram-settings">
    <div className="settings-section-heading"><h2>Instagram 连接</h2><p>连接专业账号后，可在快速工作流的第 4 步预览并发布。</p></div>
    {error && <p role="alert" className="field-error">{error}</p>}
    <ol className="instagram-setup-steps"><li><strong>将账号切换为专业账号</strong><p>在 Instagram 的账号类型与工具中，切换为「创作者」或「商业」账号。普通账号暂时无法使用官方接口发布。</p><a href="https://help.instagram.com/502981923235522" target="_blank" rel="noreferrer">查看官方说明 <ExternalLink size={12} /></a></li><li><strong>创建并配置 Meta 应用</strong><p>选择 Instagram API with Instagram Login，为自己的专业账号开通基本资料和内容发布权限。可先在应用后台添加自己的测试账号。</p><a href="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started/" target="_blank" rel="noreferrer">打开接入指南 <ExternalLink size={12} /></a></li><li><strong>设置图片公开访问地址</strong><p>Instagram 需要读取发布图片。将你自己的 HTTPS 域名或隧道指向本机图片服务（默认 5191 端口）；只开放发布适配图和授权回调。工作空间仍保存在本机。</p></li></ol>
    <div className="instagram-accounts">{data?.accounts.map((account) => <article key={account.id}><div><strong>@{account.username}</strong><span className="tag">{account.accountType === 'BUSINESS' ? '商业账号' : '创作者账号'}</span><p>{account.expiresAt ? `授权有效期至 ${new Date(account.expiresAt).toLocaleDateString()}` : '有效期未知，每次发布前会校验授权'}</p></div><div><Button disabled={busy} onClick={() => { void action(async () => { const value = await request<{ used: number; total: number }>(`/instagram/accounts/${account.id}/check`, { method: 'POST' }); notify(`账号可用，当前 API 发布额度 ${value.used}/${value.total}`) }, '连接检查完成') }}><RefreshCw size={14} />检查</Button><Button disabled={busy} onClick={() => setDisconnect(account.id)}><Unplug size={14} />断开</Button></div></article>)}</div>
    <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action(async () => { await request('/instagram/config', { method: 'PUT', body: JSON.stringify({ ...current, ...(secret ? { appSecret: secret } : {}) }) }); setSecret(''); setConfig(null) }, 'Instagram 连接设置已保存') }}>
      <label>公开 HTTPS 访问地址<input aria-label="Instagram HTTPS 地址" type="url" placeholder="https://你的图片服务域名" value={current.publicBaseUrl} onChange={(e) => setConfig({ ...current, publicBaseUrl: e.target.value })} /></label>
      <small>配置后还需确认该地址可从公网访问。不要将隧道指向工作台的 5188 或 5189 端口。</small>
      <details><summary>浏览器授权设置</summary><div className="form-stack"><label>Instagram App ID<input inputMode="numeric" value={current.appId} onChange={(e) => setConfig({ ...current, appId: e.target.value })} /></label><label>Instagram App Secret<input type="password" autoComplete="new-password" value={secret} placeholder={data?.hasAppSecret ? '已安全保存；留空保留' : '仅保存到系统安全存储'} onChange={(e) => setSecret(e.target.value)} /></label><label>API 版本<input pattern="v[0-9]{2}\.0" value={current.apiVersion} onChange={(e) => setConfig({ ...current, apiVersion: e.target.value })} /></label><p>在 Meta 应用中登记以下授权回调地址：</p><code className="instagram-callback">{current.publicBaseUrl ? `${current.publicBaseUrl.replace(/\/+$/, '')}/instagram/callback` : '先填写 HTTPS 访问地址'}</code></div></details>
      <Button type="submit" disabled={busy || !data}>保存连接设置</Button>
    </form>
    <div className="instagram-connect-actions"><Button variant="primary" disabled={busy || !data?.hasAppSecret || !data.config.appId || !data.config.publicBaseUrl} onClick={() => { const popup = window.open('about:blank', '_blank'); void action(async () => { try { const value = await request<{ url: string }>('/instagram/authorize', { method: 'POST' }); if (popup) popup.location.href = value.url; else throw new Error('请允许浏览器打开授权窗口后重试。') } catch (e) { popup?.close(); throw e } }, '请在新窗口中完成 Instagram 授权') }}>用 Instagram 授权连接 <ExternalLink size={14} /></Button><small>授权完成后，账号会自动显示在这里。</small></div>
    <details><summary>已有开发者访问令牌：直接连接</summary><form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action(async () => { await request('/instagram/accounts', { method: 'POST', body: JSON.stringify({ token, expiresAt: expiry ? new Date(expiry).getTime() : null }) }); setToken(''); setExpiry('') }, 'Instagram 专业账号已连接') }}><p>仅支持 Instagram Login 生成的令牌，需包含 instagram_business_basic 和 instagram_business_content_publish 权限。</p><label>访问令牌<input aria-label="Instagram 访问令牌" required type="password" autoComplete="new-password" value={token} onChange={(e) => setToken(e.target.value)} /></label><label>有效期（已知时填写）<input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label><Button type="submit" disabled={busy || !token.trim()}>验证并连接账号</Button></form></details>
    <p className="page-note">凭据{data?.credentialStorage === 'encrypted-file' ? '保存在服务器加密存储' : data?.credentialStorage === 'session' ? '仅在本次服务运行期间保留' : '保存在系统钥匙串'}，不会写入浏览器存储或资料导出。只有明确确认的帖子才会提交；电脑离线时无法定时发布。</p>
    <Modal open={!!disconnect} onOpenChange={(open) => { if (!open) setDisconnect(null) }} title="断开 Instagram 账号？" description="该账号尚未执行的预约将取消，已经发布的帖子和本地记录会保留。"><div className="modal-actions"><Button onClick={() => setDisconnect(null)}>保留连接</Button><Button variant="danger" disabled={busy} onClick={() => { if (disconnect) void action(async () => { await request(`/instagram/accounts/${disconnect}`, { method: 'DELETE' }); setDisconnect(null) }, '账号已断开') }}>确认断开</Button></div></Modal>
  </div>
}
