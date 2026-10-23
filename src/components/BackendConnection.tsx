import { useEffect } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useBackend } from '../stores/backend'
import { api } from '../lib/api'
import { flushWorkspace, initializeBackend, refreshWorkspace } from '../lib/sync'
import { Button } from './ui'

export function BackendConnection() {
  const backend = useBackend()
  useEffect(() => {
    void initializeBackend()
    let stopped = false
    let polling = false
    let tick = 0
    const poll = async () => {
      if (polling || stopped) return
      polling = true
      try {
        if (useBackend.getState().status !== 'ready') await initializeBackend()
        else {
          if (useBackend.getState().error) await flushWorkspace()
          const jobs = await api.jobs()
          if (!stopped) useBackend.setState({ jobs })
          if (++tick % 4 === 0) { const provider = await api.provider(); if (!stopped) useBackend.setState({ provider }) }
          await refreshWorkspace()
        }
      } catch (error) { if (!stopped) useBackend.setState({ error: error instanceof Error ? error.message : '本地服务连接中断。' }) }
      finally { polling = false }
    }
    const timer = setInterval(() => { void poll() }, 2500)
    const onOnline = () => { void poll() }
    window.addEventListener('online', onOnline)
    void poll()
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('online', onOnline) }
  }, [])
  if (backend.status === 'ready' && !backend.error) return null
  return <div className={`backend-banner ${backend.status === 'ready' ? 'backend-warning' : ''}`} role="status"><AlertCircle size={15} /><span>{backend.error ?? '正在连接本机数据库与素材服务…'}</span><Button variant="ghost" onClick={() => { void initializeBackend(); void refreshWorkspace() }}><RefreshCw size={13} />重试连接</Button></div>
}
