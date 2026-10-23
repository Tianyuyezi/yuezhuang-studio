import { useState } from 'react'
import { FolderPlus } from 'lucide-react'
import { useWorkspace } from '../stores/workspace'
import { Button, Modal, useNotify } from './ui'

export default function ProjectDialog({ onClose, isNew = false }: { onClose: () => void; isNew?: boolean }) {
  const store = useWorkspace()
  const current = isNew ? undefined : store.projects.find((p) => p.id === store.activeProjectId)
  const [title, setTitle] = useState(current?.title ?? '')
  const [artist, setArtist] = useState(current?.artist ?? store.settings.artistName)
  const [description, setDescription] = useState(current?.description ?? '')
  const notify = useNotify()
  return <Modal open onOpenChange={(open) => { if (!open) onClose() }} title={isNew ? '新建妆容项目' : '保存创作项目'} description="将创作参数整理成项目，下一次打开时继续。">
    <form onSubmit={(e) => { e.preventDefault(); if (isNew) store.resetDraft(); store.saveProject(title, artist, description); store.setPage('studio'); notify('项目已保存到本地'); onClose() }} className="form-stack">
      <label>项目名称<span className="required">*</span><input autoFocus required maxLength={60} placeholder="例如：秋日柔光 · 新娘妆容系列" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>化妆师<input maxLength={40} value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="化妆师或工作室名称" /></label>
      <label>项目备注<textarea rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="填写项目说明…" /></label>
      <div className="modal-actions"><Button type="button" onClick={onClose}>取消</Button><Button variant="primary" type="submit"><FolderPlus size={16} />{isNew ? '创建项目' : '保存项目'}</Button></div>
    </form>
  </Modal>
}
