import { ArrowRight, ArrowUpRight, Check, ChevronDown, Columns2, FolderPlus, Heart, ImagePlus, Images, Info, LayoutGrid, Plus, RotateCcw, SlidersHorizontal, Shuffle, Upload, UserRound, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useBackend } from '../stores/backend'
import { generateImages } from '../lib/ai'
import { availableImageModels, imageModelLabel } from '../shared/image-models'
import JobPanel from '../components/JobPanel'
import StylePicker from '../components/StylePicker'
import RandomModelFields from '../components/RandomModelFields'
import { invalidRandomModelField } from '../lib/random-model'
import PromptAssistant from '../components/PromptAssistant'
import { useWorkspace } from '../stores/workspace'
import { SAMPLE_ASSETS, STYLES, STYLE_PROMPTS } from '../lib/data'
import { useAssets, useModels } from '../lib/hooks'
import type { Asset } from '../lib/types'
import type { AIJob } from '../shared/contracts'
import AssetCard from '../components/AssetCard'
import { AssetImage, Button, EmptyState, IconButton, Modal, useNotify } from '../components/ui'
import { useImportAssets } from '../components/useImportAssets'

export default function Studio({ onSave, onOpenAsset, embedded = false, onSubmitted }: { onSave: () => void; onOpenAsset: (asset: Asset) => void; embedded?: boolean; onSubmitted?: (job: AIJob) => void }) {
  const store = useWorkspace()
  const { draft } = store
  const backend = useBackend()
  const activeJob = backend.jobs.find((job) => job.kind === 'image' && job.projectId === store.activeProjectId && ['queued', 'running'].includes(job.status))
  const busy = backend.pendingSubmissions > 0 || !!activeJob
  const imageModels = availableImageModels(backend.provider?.imageModel ?? '', backend.provider?.models ?? [])
  const effectiveImageModel = draft.imageModel || backend.provider?.imageModel
  const unavailableImageModel = !!draft.imageModel && !!backend.provider && !imageModels.includes(draft.imageModel)
  const assets = useAssets()
  const models = useModels()
  const selectedModel = models.find((m) => m.id === draft.modelId)
  const modelAsset = [...store.importedAssets, ...SAMPLE_ASSETS].find((a) => a.id === selectedModel?.assetId)
  const reference = assets.find((a) => a.id === draft.referenceId)
  const currentProject = store.projects.find((p) => p.id === store.activeProjectId)
  const [modelOpen, setModelOpen] = useState(false)
  const [galleryTab, setGalleryTab] = useState<'examples' | 'mine' | 'favorites'>('examples')
  const [columns, setColumns] = useState(3)
  const [filter, setFilter] = useState('当前风格')
  const [advanced, setAdvanced] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [referencePicker, setReferencePicker] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const notify = useNotify()
  const { importing, importFiles } = useImportAssets()
  const update = store.updateDraft
  const galleryStyle = filter === '当前风格' ? draft.style : filter
  const displayed = assets.filter((a) => (galleryTab === 'examples' ? a.kind === 'example' : galleryTab === 'mine' ? a.kind !== 'example' : store.favorites.includes(a.id)) && (galleryStyle === '全部风格' || a.style === galleryStyle))
  const useReference = (asset: Asset) => { update({ referenceId: asset.id }); notify('已添加创作参考图') }
  const upload = async (files: FileList | null) => { const result = await importFiles(files); if (result[0]) update({ referenceId: result[0].id }) }
  return <>
    {!embedded && <div className="page-heading"><div><h1>图片工作台</h1><p>{currentProject ? currentProject.title : '选择模特与妆容，开始一次图片创作。'}</p></div><Button onClick={onSave}><FolderPlus size={16} />{currentProject ? '保存项目' : '保存为项目'}</Button></div>}
    <div className="workbench-heading"><div className="mode-tabs" role="tablist" aria-label="创作模式"><button role="tab" aria-selected={draft.mode === 'virtual'} className={draft.mode === 'virtual' ? 'selected' : ''} onClick={() => update({ mode: 'virtual' })}>虚拟模特</button><button role="tab" aria-selected={draft.mode === 'edit'} className={draft.mode === 'edit' ? 'selected' : ''} onClick={() => update({ mode: 'edit' })}>照片修图</button></div><span className="auto-save"><span className="status-dot" />参数自动保留</span></div>
    <div className="studio-grid"><section className="creation-panel"><div className="panel-title"><span>创作设置</span><IconButton label="重置创作参数" onClick={() => { store.resetDraft(); notify('已重置为初始创作参数', 'info') }}><RotateCcw size={14} /></IconButton></div><div className="creation-fields">
      {draft.mode === 'virtual' && <div className="field-group"><div className="field-label"><span className="plain-field-label">模特</span><button onClick={() => store.setPage('models')}>管理模特<ArrowUpRight size={12} /></button></div><button className="model-selector" onClick={() => setModelOpen(true)}>{selectedModel ? <AssetImage asset={modelAsset} /> : <span className="random-model-icon"><Shuffle size={21} /></span>}<span><strong>{selectedModel?.name ?? '随机模特'}</strong><small>{selectedModel ? `${selectedModel.example ? '模特参考示例' : '我的模特档案'} · ${selectedModel.tags.join(' / ')}` : '不指定人物 · 生成后自动存入模特库'}</small></span><ChevronDown size={16} /></button></div>}
      <RandomModelFields />
      <div className="field-group"><div className="field-label"><span className="plain-field-label">{draft.mode === 'virtual' ? '参考图片' : '原始照片'}</span><span className="optional">{draft.mode === 'virtual' ? '可选' : '必选'}</span></div>{reference ? <div className="reference-preview"><AssetImage asset={reference} /><div><strong>{reference.title}</strong><small>{reference.kind === 'example' ? '摄影参考示例' : '本地参考图片'}</small><button onClick={() => fileInput.current?.click()}>更换图片</button></div><IconButton label="移除参考图" onClick={() => update({ referenceId: null })}><X size={14} /></IconButton></div> : <div className={`upload-area ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files) }}><button onClick={() => fileInput.current?.click()} disabled={importing}><span className="upload-icon"><ImagePlus size={21} strokeWidth={1.5} /></span><strong>{importing ? '正在导入…' : '点击上传，或将图片拖到这里'}</strong><small>JPG、PNG、WebP · 最大 20 MB</small></button><button className="choose-library" onClick={() => setReferencePicker(true)}>从作品库选择<ArrowRight size={12} /></button></div>}<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="上传创作参考图" onChange={(e) => { void upload(e.target.files); e.target.value = '' }} /></div>
      <div className="field-group"><div className="field-label"><span className="plain-field-label">妆容风格</span></div><StylePicker /></div>
      <div className="field-group"><div className="field-label"><label htmlFor="creation-prompt">{draft.mode === 'virtual' ? '妆容描述' : '修改说明'}</label><button onClick={() => { update({ prompt: STYLE_PROMPTS[draft.style] }); notify('已填入风格模板，可继续自由修改', 'info') }}>风格示例</button></div><div className="prompt-input"><textarea id="creation-prompt" maxLength={4000} rows={5} placeholder={draft.mode === 'virtual' ? '描述需要的妆容和画面。\n例如：通透水光底妆，杏粉色眼影，窗边自然光，奶油色背景。' : '例如：保留人物和原有妆容，柔和面部光线，将背景调整为纯米色，保留肌肤纹理。'} value={draft.prompt} onChange={(e) => update({ prompt: e.target.value })} /><div><span>妆容、发型、光线与背景</span><span>{draft.prompt.length}/4000</span></div></div><p className="photography-note">真实人像摄影 · 默认保留肌肤与衣料质感</p><PromptAssistant /></div>
      <div className="field-group image-model-field">
        <label className="simple-label" htmlFor="image-model">图片模型</label>
        <select id="image-model" value={draft.imageModel ?? ''} disabled={busy || backend.status !== 'ready'} aria-describedby="image-model-note" aria-invalid={unavailableImageModel || undefined} onChange={(e) => update({ imageModel: e.target.value || null })}>
          <option value="">使用默认{backend.provider ? ` · ${imageModelLabel(backend.provider.imageModel)}` : ''}</option>
          {unavailableImageModel && <option value={draft.imageModel!} disabled>{imageModelLabel(draft.imageModel!)}（当前不可用）</option>}
          {imageModels.map((model) => <option key={model} value={model}>{imageModelLabel(model)}</option>)}
        </select>
        <p id="image-model-note" className={unavailableImageModel ? 'image-model-note unavailable' : 'image-model-note'}>{unavailableImageModel ? '此模型在当前服务中不可用，请重新选择或在设置中测试连接。' : '同批图片使用同一模型，选择随项目保存。'}</p>
      </div>
      <div className="parameter-row"><div className="field-group"><label className="simple-label" htmlFor="aspect-ratio">图片比例</label><select id="aspect-ratio" value={draft.ratio} onChange={(e) => update({ ratio: e.target.value })}><option value="3:4">▯　3:4 竖版</option><option value="4:5">▯　4:5 社交</option><option value="1:1">□　1:1 方图</option><option value="16:9">▭　16:9 横版</option><option value="9:16">▯　9:16 全屏</option></select></div><div className="field-group"><span className="simple-label">生成数量</span><div className="count-options" role="group" aria-label="生成数量">{[1, 2, 4].map((count) => <button key={count} aria-pressed={draft.count === count} className={draft.count === count ? 'selected' : ''} onClick={() => update({ count })}>{count}<span>张</span></button>)}</div></div></div>
      <button className="advanced-toggle" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}><SlidersHorizontal size={13} />创作说明<ChevronDown size={13} className={advanced ? 'rotated' : ''} /></button>{advanced && <div className="advanced-note">自建模特档案会使用参考图辅助保持人物特征，一致性取决于图片服务。示例档案只提供人物描述。生成结果自动保存到作品库。</div>}
    </div><div className="creation-submit"><Button variant="primary" className="generate-button" disabled={busy || backend.status !== 'ready' || unavailableImageModel} onClick={async () => { const missing = invalidRandomModelField(draft); if (missing) { notify(missing.message, 'info'); document.getElementById(missing.field)?.focus(); return } if (!draft.prompt.trim()) { notify('请填写妆容描述，或点击「风格示例」。', 'info'); document.getElementById('creation-prompt')?.focus(); return } if (draft.mode === 'edit' && !reference) { notify('请先导入需要编辑的原始照片。', 'info'); return } try { const job = await generateImages(); onSubmitted?.(job); setGalleryTab('mine'); notify('图片任务已提交，可在下方查看实际进度。') } catch (error) { notify(error instanceof Error ? error.message : '提交失败', 'error') } }}>{busy ? `处理中 ${activeJob?.completedCount ?? 0}/${activeJob?.requestedCount ?? draft.count}` : draft.mode === 'virtual' ? '生成图片' : '开始修图'}<ArrowRight size={16} /></Button><span><Info size={11} />{backend.provider?.hasKey && effectiveImageModel ? `${imageModelLabel(activeJob?.model ?? effectiveImageModel)} · ${activeJob?.requestedCount ?? draft.count} 张` : '请先在设置中配置图片服务'}</span>{(draft.referenceId || selectedModel && !selectedModel.example) && <p className="provider-transfer-note">生成时，所选参考图会发送到已配置的图片服务。</p>}</div></section>
      <section className="studio-gallery"><div className="gallery-heading"><div><h2>参考图片<span>{displayed.length.toString().padStart(2, '0')}</span></h2><p>选择图片查看详情，或用作本次创作参考。</p></div><button className="text-link" onClick={() => store.setPage('assets')}>打开作品库<ArrowUpRight size={14} /></button></div><div className="gallery-toolbar"><div className="gallery-tabs" role="tablist" aria-label="作品分类">{[{ id: 'examples' as const, label: '参考示例' }, { id: 'mine' as const, label: '我的素材' }, { id: 'favorites' as const, label: '已收藏' }].map((tab) => <button key={tab.id} role="tab" aria-selected={galleryTab === tab.id} className={galleryTab === tab.id ? 'active' : ''} onClick={() => setGalleryTab(tab.id)}>{tab.id === 'favorites' && <Heart size={12} />}{tab.label}</button>)}</div><div className="gallery-view"><select aria-label="筛选作品风格" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="当前风格">当前风格 · {draft.style}</option><option>全部风格</option>{STYLES.map((s) => <option key={s}>{s}</option>)}<option>未分类</option></select><IconButton label="三列展示" className={columns === 3 ? 'view-active' : ''} onClick={() => setColumns(3)}><LayoutGrid size={15} /></IconButton><IconButton label="两列展示" className={columns === 2 ? 'view-active' : ''} onClick={() => setColumns(2)}><Columns2 size={15} /></IconButton></div></div>
        {displayed.length ? <div className={`asset-grid studio-assets columns-${columns}`}>{displayed.map((asset) => <AssetCard key={asset.id} asset={asset} onOpen={onOpenAsset} onUse={useReference} />)}</div> : <EmptyState icon={galleryTab === 'favorites' ? <Heart size={26} /> : <Images size={26} />} title={galleryTab === 'favorites' ? '还没有收藏的图片' : '没有找到图片'} description={filter !== '全部风格' ? '这个风格下还没有素材，试试其他分类。' : galleryTab === 'mine' ? '导入第一张参考图，开始整理你的创作素材。' : '点击作品上的爱心，建立你自己的灵感收藏。'}><Button onClick={() => galleryTab === 'mine' ? fileInput.current?.click() : setGalleryTab('examples')}>{galleryTab === 'mine' ? <Upload size={15} /> : <ArrowRight size={15} />}{galleryTab === 'mine' ? '导入图片' : '查看参考示例'}</Button></EmptyState>}
        <JobPanel kind="image" projectId={store.activeProjectId} /><div className="gallery-footnote"><Info size={13} /><span>摄影参考与 AI 风格参考均已标注。选择风格可查看对应示例，点击图片可放大检查。</span></div>      </section></div>
    <Modal open={modelOpen} onOpenChange={setModelOpen} title="选择模特" description="示例档案提供人物描述；自建档案会把参考图传给图片服务。"><div className="model-picker"><button className={draft.modelId === null ? 'selected' : ''} onClick={() => { update({ modelId: null }); setModelOpen(false) }}><span className="random-model-icon"><Shuffle size={22} /></span><span><strong>随机模特</strong><small>不指定人物，成功后自动建立模特档案</small></span>{draft.modelId === null && <Check size={18} />}</button>{models.map((model) => <button key={model.id} className={draft.modelId === model.id ? 'selected' : ''} onClick={() => { update({ modelId: model.id }); setModelOpen(false) }}><AssetImage asset={[...store.importedAssets, ...SAMPLE_ASSETS].find((a) => a.id === model.assetId)} /><span><strong>{model.name}</strong><small>{model.tags.join(' · ')}{model.example ? ' · 参考示例' : ''}</small></span>{draft.modelId === model.id ? <Check size={18} /> : <UserRound size={17} />}</button>)}</div><Button className="full-width" onClick={() => { setModelOpen(false); store.setPage('models') }}><Plus size={15} />新建模特档案</Button></Modal>
    <Modal open={referencePicker} onOpenChange={setReferencePicker} title="选择创作参考图" description="从参考示例或已保存的本地素材中选择。" wide><div className="reference-picker">{assets.map((a) => <button key={a.id} onClick={() => { useReference(a); setReferencePicker(false) }}><AssetImage asset={a} /><span>{a.title}</span></button>)}</div>{!assets.length && <EmptyState icon={<Images />} title="还没有素材" description="先导入一张照片，再把它加入创作。" />}</Modal>

  </>
}
