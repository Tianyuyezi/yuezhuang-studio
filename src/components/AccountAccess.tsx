import { useEffect, useState } from 'react'
import { LogIn, LogOut, UserRound } from 'lucide-react'
import { useAuth } from '../stores/auth'
import { useBackend } from '../stores/backend'
import { useWorkspace } from '../stores/workspace'
import { changeAuthSession, request } from '../lib/api'
import { flushWorkspace } from '../lib/sync'
import type { AuthSession } from '../shared/auth'
import { Button, Modal, useNotify } from './ui'

export function LoginRequired({ reason = '登录后即可保存个人配置、连接 Instagram 并发布帖子。' }: { reason?: string }) {
  const auth = useAuth()
  return <div className="login-required"><UserRound size={24} strokeWidth={1.4} /><h2>登录后继续</h2><p>{reason}</p><div><Button variant="primary" onClick={() => auth.open('login', reason)}><LogIn size={15} />登录</Button><Button onClick={() => auth.open('register', reason)}>注册账号</Button></div><small>游客可以继续浏览示例、编辑创作与体验工作流。</small></div>
}

export function AccountControls() {
  const auth = useAuth(), notify = useNotify()
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false)
  async function logout() {
    setBusy(true)
    try {
      await flushWorkspace()
      const session = await request<AuthSession>('/auth/logout', { method: 'POST' })
      changeAuthSession(session); setOpen(false); notify('已退出账号，返回游客体验')
    } catch (error) { notify(error instanceof Error ? error.message : '退出未完成', 'error') }
    finally { setBusy(false) }
  }
  return <><div className="account-controls">{auth.user ? <button type="button" className="account-identity" aria-label="管理当前账号" onClick={() => setOpen(true)}><UserRound size={15} /><span>{auth.user.email}</span></button> : <><span className="guest-label">游客体验</span><Button variant="ghost" onClick={() => auth.open('login')}>登录</Button><Button onClick={() => auth.open('register')}>注册</Button></>}</div>
    <Modal open={open} onOpenChange={setOpen} title="当前账号" description="项目、人员信息和服务连接分别保存在各自账号中。"><div className="account-panel"><strong>{auth.user?.email}</strong><span className="tag">{auth.user?.role === 'owner' ? '默认工作空间' : '个人工作空间'}</span><Button onClick={() => { setOpen(false); useWorkspace.getState().setPage('settings') }}>工作空间设置</Button><Button disabled={busy} onClick={() => { void logout() }}><LogOut size={15} />{busy ? '正在退出…' : '退出并返回游客体验'}</Button></div></Modal>
  </>
}

export function AuthDialog() {
  const auth = useAuth(), backend = useBackend()
  const workspace = useWorkspace(), notify = useNotify()
  const hasGuestContent = !auth.user && !!(workspace.importedAssets.length || workspace.projects.length || workspace.draft.prompt.trim())
  const [importGuest, setImportGuest] = useState(true)
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const register = auth.dialog === 'register'
  useEffect(() => { setPassword(''); setConfirmation(''); setError(''); if (!auth.dialog) setEmail('') }, [auth.dialog])
  return <Modal open={!!auth.dialog} onOpenChange={(open) => { if (!open && !busy) auth.close() }} title={register ? '注册悦妆师账号' : '登录悦妆师'} description={auth.reason || '无需登录即可体验。登录后进入自己的工作空间，保存配置并发布内容。'}>
    <form className="form-stack auth-form" onSubmit={async (event) => {
      event.preventDefault(); setError('')
      if (register && password !== confirmation) { setError('两次输入的密码不一致。'); return }
      setBusy(true)
      try {
        await flushWorkspace()
        const session = await request<AuthSession>(register ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify({ email, password, importGuest: hasGuestContent && importGuest }) })
        changeAuthSession(session); auth.close(); setPassword(''); setConfirmation('')
        if (session.notice) notify(session.notice, 'info')
      } catch (failure) { setError(failure instanceof Error ? failure.message : '操作未完成，请重试。') }
      finally { setBusy(false) }
    }}>
      <label>邮箱<input aria-label="账号邮箱" type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" disabled={busy} /></label>
      <label>密码<input aria-label="账号密码" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" disabled={busy} /></label>
      {register && <label>确认密码<input aria-label="确认账号密码" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} /></label>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {hasGuestContent && <label className="checkbox-label"><input type="checkbox" checked={importGuest} onChange={(event) => setImportGuest(event.target.checked)} disabled={busy} />将本次体验的作品与草稿带入账号</label>}
      <Button type="submit" variant="primary" disabled={busy || backend.status !== 'ready'}>{busy ? '正在处理…' : register ? '注册并登录' : '登录'}</Button>
      <div className="auth-form-switch"><button type="button" disabled={busy} onClick={() => auth.open(register ? 'login' : 'register', auth.reason)}>{register ? '已有账号，去登录' : '注册一个新账号'}</button><button type="button" disabled={busy} onClick={auth.close}>继续游客体验</button></div>
      <small>注册后拥有独立工作空间。你的服务密钥和 Instagram 连接不会与其他账号共用。</small>
    </form>
  </Modal>
}
