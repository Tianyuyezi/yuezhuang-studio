import { BookOpen, Download, Feather, Heart, ImagePlus, Trash2 } from 'lucide-react'
import { groupIdOf } from '../lib/groups'
import { useState } from 'react'
import { useWorkspace } from '../stores/workspace'
import { deleteImageBlob, downloadFile, getImageBlob } from '../lib/storage'
import type { Asset } from '../lib/types'
import { Button, ConfirmModal, Modal, useNotify } from './ui'
import ZoomableAssetImage from './ImageViewer'

export default function AssetDetail({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const store = useWorkspace()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const notify = useNotify()
  const useReference = () => {
    store.updateDraft({ referenceId: asset.id })
    store.setPage('studio')
    onClose()
    notify('已添加到创作台参考图')
  }
  const writeGroup = () => { store.openGroupCaptions(groupIdOf(asset)); onClose() }
  async function download() {
    setBusy(true)
    try {
      const blob = asset.src ? await fetch(asset.src).then((r) => { if (!r.ok) throw new Error(); return r.blob() }) : await getImageBlob(asset.id)
      if (!blob) throw new Error()
      const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
      downloadFile(`${asset.title}.${ext}`, blob)
    } catch { notify('图片暂时无法下载，请重试。', 'error') }
    finally { setBusy(false) }
  }
  async function remove() {
    try {
      if (asset.kind !== 'example') await deleteImageBlob(asset.id)
      store.removeAsset(asset.id)
      onClose()
      notify(asset.kind === 'example' ? '已隐藏这张示例图片' : '已删除本地图片')
    } catch { notify('删除失败，请稍后重试。', 'error') }
  }
  return <>
    <Modal open onOpenChange={(open) => { if (!open) onClose() }} title="作品详情" description={asset.kind === 'example' ? '此图为 Unsplash 摄影参考示例，不是本次 AI 生成结果。' : '图片原图与缩略图已保存在本机。'} wide>
      <div className="asset-detail"><ZoomableAssetImage asset={asset} /><div className="asset-detail-info"><h2>{asset.title}</h2><span className="tag">{asset.style}</span><dl><dt>素材来源</dt><dd>{asset.kind === 'example' ? '摄影参考 · 界面示例' : asset.kind === 'generated' ? 'AI 生成作品' : '用户导入'}</dd><dt>图片尺寸</dt><dd>{asset.width ? `${asset.width} × ${asset.height}` : '参考预览图'}</dd><dt>使用说明</dt><dd>{asset.kind === 'example' ? '用于体验选图与参考流程。' : '发布前请确认素材使用及肖像授权。'}</dd></dl>{asset.kind !== 'example' && <Button variant="primary" onClick={writeGroup}><Feather size={16} />为所在作品组写文案</Button>}{asset.jobId && <Button onClick={() => { store.openPromptHistory(asset.jobId!); onClose() }}><BookOpen size={16} />查看生成提示词</Button>}<Button onClick={useReference}><ImagePlus size={16} />用作创作参考</Button><Button onClick={() => store.toggleFavorite(asset.id)}><Heart size={16} fill={store.favorites.includes(asset.id) ? 'currentColor' : 'none'} />{store.favorites.includes(asset.id) ? '已收藏' : '收藏作品'}</Button><Button onClick={download} disabled={busy}><Download size={16} />{busy ? '正在准备…' : '下载图片'}</Button><button className="text-danger" onClick={() => setConfirm(true)}><Trash2 size={14} />{asset.kind === 'example' ? '隐藏此示例' : '删除素材'}</button></div></div>
    </Modal>
    {confirm && <ConfirmModal title={asset.kind === 'example' ? '隐藏这张示例？' : '删除这张素材？'} description="关联的项目参考图和封面将一并移除。此操作无法撤销。" onClose={() => setConfirm(false)} onConfirm={remove} />}
  </>
}
