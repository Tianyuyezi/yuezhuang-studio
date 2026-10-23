import * as Dialog from '@radix-ui/react-dialog'
import { Check, ImageOff, LoaderCircle, X } from 'lucide-react'
import { createContext, useContext, useEffect, useId, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useImageUrl } from '../lib/hooks'
import type { Asset } from '../lib/types'

export function Button({ children, variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{children}</button>
}

export function IconButton({ children, label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className={`icon-button ${className}`} type="button" aria-label={label} title={label} {...props}>{children}</button>
}

export function Modal({ open, onOpenChange, title, description, children, wide = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean
}) {
  const descriptionId = useId()
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal><Dialog.Overlay className="modal-overlay" />
      <Dialog.Content className={`modal-content ${wide ? 'modal-wide' : ''}`} aria-describedby={description ? descriptionId : undefined}>
        <div className="modal-heading"><div><Dialog.Title>{title}</Dialog.Title>{description && <Dialog.Description id={descriptionId}>{description}</Dialog.Description>}</div>
          <Dialog.Close asChild><IconButton label="关闭对话框"><X size={19} /></IconButton></Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

export function AssetImage({ asset, className = '', alt, eager = false }: { asset?: Asset; className?: string; alt?: string; eager?: boolean }) {
  const { url, failed, setFailed } = useImageUrl(asset)
  if (!asset || failed) return <div className={`image-placeholder ${className}`}><ImageOff size={25} /><span>{asset ? '图片暂不可用' : '添加作品封面'}</span></div>
  if (!url) return <div className={`image-placeholder ${className}`}><LoaderCircle className="spin" size={22} /></div>
  return <img src={url} alt={alt ?? asset.title} className={className} loading={eager ? 'eager' : 'lazy'} onError={() => setFailed(true)} />
}

export function EmptyState({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{children}</div>
}

export function ConfirmModal({ title, description, onConfirm, onClose }: { title: string; description: string; onConfirm: () => void; onClose: () => void }) {
  return <Modal open onOpenChange={(open) => { if (!open) onClose() }} title={title} description={description}>
    <div className="modal-actions"><Button onClick={onClose}>保留</Button><Button variant="danger" onClick={onConfirm}>确认删除</Button></div>
  </Modal>
}

type Notify = (message: string, kind?: 'success' | 'info' | 'error') => void
const ToastContext = createContext<Notify>(() => {})
export const useNotify = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: string; id: number } | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const error = () => setToast({ message: '本地存储空间不足，当前修改可能无法保存。请导出草稿。', kind: 'error', id: Date.now() })
    window.addEventListener('workspace-storage-error', error)
    return () => window.removeEventListener('workspace-storage-error', error)
  }, [])
  return <ToastContext.Provider value={(message, kind = 'success') => setToast({ message, kind, id: Date.now() })}>
    {children}
    {toast && <div className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}><span className="toast-indicator"><Check size={15} /></span>{toast.message}<IconButton label="关闭提示" onClick={() => setToast(null)}><X size={15} /></IconButton></div>}
  </ToastContext.Provider>
}
