import { useState } from 'react'
import { LoaderCircle, Shuffle, Undo2, Wand2 } from 'lucide-react'
import { useWorkspace } from '../stores/workspace'
import { useBackend } from '../stores/backend'
import { request } from '../lib/api'
import { draftSchema } from '../shared/contracts'
import { flushWorkspace } from '../lib/sync'
import { invalidRandomModelField } from '../lib/random-model'
import { SAMPLE_MODELS } from '../lib/data'
import { Button, Modal, useNotify } from './ui'
import { useQualityPreferences } from './QualityControls'
import type { PromptGuidance } from '../shared/quality'

export default function PromptAssistant() {
  const store = useWorkspace()
  const ready = useBackend((s) => s.status === 'ready')
  const [busy, setBusy] = useState<'random' | 'polish' | null>(null)
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null)
  const [proposal, setProposal] = useState<string | null>(null)
  const notify = useNotify()
  const qualityPreferences = useQualityPreferences()
  const model = [...store.customModels, ...SAMPLE_MODELS].find((m) => m.id === store.draft.modelId)
  async function assist(action: 'random' | 'polish') {
    const draft = draftSchema.parse(useWorkspace.getState().draft)
    const missing = invalidRandomModelField(draft)
    if (missing) { notify(missing.message, 'info'); document.getElementById(missing.field)?.focus(); return }
    if (action === 'polish' && !draft.prompt.trim()) { notify('先写下一些想法，再使用 AI 润色。', 'info'); return }
    const original = JSON.stringify(draft)
    setBusy(action)
    try {
      await flushWorkspace()
      const result = await request<{ prompt: string; guidance?: PromptGuidance }>('/prompts', { method: 'POST', body: JSON.stringify({ action, draft }), signal: AbortSignal.timeout(190000) })
      if (JSON.stringify(draftSchema.parse(useWorkspace.getState().draft)) !== original) { setProposal(result.prompt); return }
      useWorkspace.getState().updateDraft({ prompt: result.prompt })
      setUndo({ before: draft.prompt, after: result.prompt })
      notify(`${action === 'random' ? '已结合人物与风格生成新描述' : '妆容描述已润色'}${result.guidance?.sources.length ? `，参考了 ${result.guidance.sources.length} 个优质样本` : ''}`)
    } catch (error) { notify(error instanceof Error ? error.message : '描述生成失败，原文已保留', 'error') }
    finally { setBusy(null) }
  }
  return <>
    <div className="quality-workbench-hint"><span>{qualityPreferences.enabled ? '优质样本优化已启用' : '优质样本优化已暂停'}</span><button onClick={() => store.openPromptReferences()}>管理样本与权重 ↗</button></div>
    <div className="prompt-assist-actions"><Button disabled={!!busy || !ready} onClick={() => { void assist('random') }}>{busy === 'random' ? <LoaderCircle size={13} className="spin" /> : <Shuffle size={13} />}{busy === 'random' ? '准备新灵感…' : '按风格随机描述'}</Button><Button disabled={!!busy || !ready || !store.draft.prompt.trim()} onClick={() => { void assist('polish') }}>{busy === 'polish' ? <LoaderCircle size={13} className="spin" /> : <Wand2 size={13} />}{busy === 'polish' ? '润色中…' : 'AI 润色'}</Button></div>
    <div className="prompt-assist-note"><span>{store.draft.mode === 'edit' ? '结合原始照片，保留未要求修改的细节' : model ? `结合 ${model.name} 的人物设定${!model.example ? '与参考图' : ''}` : '随机创作成年虚拟模特与妆造描述'}</span>{undo && store.draft.prompt === undo.after && <button onClick={() => { store.updateDraft({ prompt: undo.before }); setUndo(null) }}><Undo2 size={11} />撤回</button>}</div>
    <Modal open={proposal !== null} onOpenChange={(open) => { if (!open) setProposal(null) }} title="新的妆容描述" description="等待期间你修改了创作内容，AI 结果已保留在这里，请选择是否采用。"><textarea aria-label="待采用的AI描述" rows={8} maxLength={2000} value={proposal ?? ''} onChange={(e) => setProposal(e.target.value)} /><div className="modal-actions"><Button onClick={() => setProposal(null)}>保留当前描述</Button><Button variant="primary" onClick={() => { if (!proposal) return; setUndo({ before: store.draft.prompt, after: proposal }); store.updateDraft({ prompt: proposal }); setProposal(null) }}>采用这段描述</Button></div></Modal>
  </>
}
