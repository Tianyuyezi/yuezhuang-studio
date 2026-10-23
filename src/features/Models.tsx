import { ArrowUpRight, Check, Plus, Trash2, Upload, UsersRound } from 'lucide-react'
import { useRef, useState } from 'react'
import { useWorkspace } from '../stores/workspace'
import { useModels } from '../lib/hooks'
import { SAMPLE_ASSETS } from '../lib/data'
import { AssetImage, Button, ConfirmModal, IconButton, Modal, useNotify } from '../components/ui'
import { useImportAssets } from '../components/useImportAssets'

export default function Models() {
  const store = useWorkspace()
  const models = useModels()
  const allAssets = [...store.importedAssets, ...SAMPLE_ASSETS]
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [assetId, setAssetId] = useState('')
  const [removeId, setRemoveId] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const { importFiles, importing } = useImportAssets()
  const notify = useNotify()
  return <>
    <div className="page-heading"><div><h1>虚拟模特</h1><p>保存人物参考图与设定，供不同项目重复使用。</p></div><Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} />新建模特档案</Button></div>
    <div className="model-intro"><span className="model-intro-icon"><UsersRound size={27} strokeWidth={1.4} /></span><div><h3>模特参考档案</h3><p>保存模特参考图与人物设定，供后续系列创作重复使用。人物一致性的实际效果，将在接入图片模型后验证。</p></div><span className="tag">参考档案</span></div>
    <div className="model-grid">{models.map((model) => <article className="model-card" key={model.id}><div className="model-picture"><AssetImage asset={allAssets.find((a) => a.id === model.assetId)} /><span className="image-badge">{model.example ? '摄影参考示例' : '我的模特档案'}</span>{!model.example && <IconButton label={`删除模特${model.name}`} className="model-delete" onClick={() => setRemoveId(model.id)}><Trash2 size={15} /></IconButton>}</div><div className="model-info"><h2>{model.name}</h2><p>{model.description}</p><div className="tag-row">{model.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div><Button className="full-width" variant={store.draft.modelId === model.id ? 'primary' : 'secondary'} onClick={() => { store.updateDraft({ modelId: model.id }); store.setPage('studio'); notify(`已选择 ${model.name}，已加入当前创作`) }}>{store.draft.modelId === model.id ? <Check size={15} /> : <ArrowUpRight size={15} />}{store.draft.modelId === model.id ? '已选定 · 前往创作' : '使用这位模特'}</Button></div></article>)}<button className="model-add-card" onClick={() => setOpen(true)}><span><Plus size={25} /></span><h3>新建模特档案</h3><p>从一张参考图开始，<br />建立你的专属模特档案。</p><span className="text-link">创建模特档案<ArrowUpRight size={14} /></span></button></div>
    <Modal open={open} onOpenChange={setOpen} title="新建模特档案" description="上传一张参考图，记录名字与人物特点。当前仅创建档案，不会生成图片。"><form className="form-stack" onSubmit={(e) => { e.preventDefault(); if (!assetId) { notify('请先选择一张模特参考图。', 'info'); return } store.addModel({ id: crypto.randomUUID(), name: name.trim(), description: description.trim() || '尚未填写人物设定。', assetId, tags: ['自定义', '参考档案'], example: false }); setOpen(false); setName(''); setDescription(''); setAssetId(''); notify('模特档案已创建') }}><label>模特名字<input autoFocus required maxLength={30} value={name} onChange={(e) => setName(e.target.value)} placeholder="给你的模特起一个名字" /></label><label>人物设定<textarea maxLength={500} rows={3} placeholder="例如：自然眉形、深色长发、温柔气质，适合日常与新娘妆容…" value={description} onChange={(e) => setDescription(e.target.value)} /></label><span className="simple-label">模特参考图</span><div className="model-reference-options">{store.importedAssets.map((a) => <button type="button" aria-label={`选择${a.title}`} className={assetId === a.id ? 'selected' : ''} key={a.id} onClick={() => setAssetId(a.id)}><AssetImage asset={a} />{assetId === a.id && <Check size={15} />}</button>)}<button type="button" className="model-upload" disabled={importing} onClick={() => input.current?.click()}><Upload size={20} /><span>{importing ? '导入中' : '上传图片'}</span></button></div><input ref={input} className="sr-only" type="file" aria-label="上传模特参考图" accept="image/jpeg,image/png,image/webp" onChange={async (e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; const result = await importFiles(files); if (result[0]) setAssetId(result[0].id) }} /><div className="modal-actions"><Button type="button" onClick={() => setOpen(false)}>取消</Button><Button variant="primary" type="submit" disabled={importing}><Plus size={16} />创建档案</Button></div></form></Modal>
    {removeId && <ConfirmModal title="删除模特档案？" description="这份人物设定会被删除，原始参考图保留在作品库中。" onClose={() => setRemoveId(null)} onConfirm={() => { store.removeModel(removeId); setRemoveId(null); notify('模特档案已删除') }} />}
  </>
}
