import { Clock3, LoaderCircle, X } from 'lucide-react'
import { useWorkspace } from '../stores/workspace'
import { useState } from 'react'
import { useBackend } from '../stores/backend'
import { request } from '../lib/api'
import { IconButton, useNotify } from './ui'
import type { AIJob } from '../shared/contracts'

const LABELS = { queued: '等待处理', running: '生成中', succeeded: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消后续生成', interrupted: '处理中断，请先核对供应商' }
export default function JobPanel({ kind, projectId, groupId }: { kind: 'image' | 'caption'; projectId?: string | null; groupId?: string }) {
  const allJobs = useBackend((s) => s.jobs)
  const [expanded, setExpanded] = useState(false)
  const notify = useNotify()
  const jobs = allJobs.filter((j) => j.kind === kind && (!projectId || j.projectId === projectId) && (!groupId || j.groupId === groupId)).slice(0, expanded ? 20 : 3)
  if (!jobs.length) return null
  async function cancel(job: AIJob) {
    try { await request(`/jobs/${job.id}/cancel`, { method: 'POST' }); notify('已取消尚未开始的图片；当前请求返回后会停止后续生成。', 'info') }
    catch (error) { notify(error instanceof Error ? error.message : '操作未完成', 'error') }
  }
  return <section className="job-panel"><div className="job-panel-heading"><h3><Clock3 size={14} />{kind === 'image' ? '图片任务' : '文案任务'}</h3><button onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '查看记录'}</button></div>{jobs.map((job) => <article className={`job-item job-${job.status}`} key={job.id}><div>{['running', 'queued'].includes(job.status) && <LoaderCircle className="spin" size={13} />}<strong>{LABELS[job.status]}</strong><span>{job.completedCount}/{job.requestedCount} {kind === 'image' ? '张' : '种语言'}</span>{['running', 'queued'].includes(job.status) && !job.cancelRequested && <IconButton label="取消后续任务" onClick={() => { void cancel(job) }}><X size={14} /></IconButton>}</div>{kind === 'image' && <button className="job-prompt-link" onClick={() => useWorkspace.getState().openPromptHistory(job.id)}>查看提示词</button>}<small>{job.model} · {new Date(job.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small>{job.error && <p>{job.error}</p>}</article>)}</section>
}
