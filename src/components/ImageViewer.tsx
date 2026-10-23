import * as Dialog from '@radix-ui/react-dialog'
import { ImageOff, LoaderCircle, Maximize, Scan, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { useImageUrl } from '../lib/hooks'
import { constrainImageView, fitImageScale, MAX_IMAGE_SCALE, zoomImageAt } from '../lib/image-viewer'
import type { ImagePoint, ImageSize, ImageView } from '../lib/image-viewer'
import type { Asset } from '../lib/types'
import { AssetImage, IconButton } from './ui'

export default function ZoomableAssetImage({ asset }: { asset: Asset }) {
  return <Dialog.Root>
    <Dialog.Trigger asChild><button type="button" className="asset-detail-preview" aria-label={`放大查看${asset.title}`}><AssetImage asset={asset} eager /><span><ZoomIn size={15} />放大查看</span></button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="image-viewer-overlay" /><ViewerContent asset={asset} /></Dialog.Portal>
  </Dialog.Root>
}

function ViewerContent({ asset }: { asset: Asset }) {
  const { url, failed, setFailed } = useImageUrl(asset)
  const stage = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, ImagePoint>())
  const fitMode = useRef(true)
  const viewRef = useRef<ImageView>({ scale: 1, x: 0, y: 0 })
  const [view, setView] = useState(viewRef.current)
  const [image, setImage] = useState<ImageSize>({ width: 0, height: 0 })
  const [viewport, setViewport] = useState<ImageSize>({ width: 0, height: 0 })
  const [dragging, setDragging] = useState(false)
  const ready = !!(image.width && image.height && viewport.width && viewport.height && !failed)
  const pannable = ready && (image.width * view.scale > viewport.width || image.height * view.scale > viewport.height)
  const fittedScale = ready ? fitImageScale(image, viewport) : 1
  const minimumScale = Math.min(fittedScale, 0.1)

  function update(next: ImageView) { viewRef.current = next; setView(next) }
  function fit() { if (ready) { fitMode.current = true; update({ scale: fittedScale, x: 0, y: 0 }) } }
  function zoom(scale: number, point: ImagePoint = { x: 0, y: 0 }) {
    if (!ready) return
    fitMode.current = false
    update(zoomImageAt(viewRef.current, scale, point, image, viewport))
  }
  function pan(x: number, y: number) {
    if (!ready) return
    update(constrainImageView({ ...viewRef.current, x: viewRef.current.x + x, y: viewRef.current.y + y }, image, viewport))
  }
  function relative(point: ImagePoint) {
    const rect = stage.current!.getBoundingClientRect()
    return { x: point.x - rect.left - rect.width / 2, y: point.y - rect.top - rect.height / 2 }
  }

  useLayoutEffect(() => {
    const element = stage.current!
    const measure = () => { const rect = element.getBoundingClientRect(); setViewport({ width: rect.width, height: rect.height }) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (!image.width || !viewport.width || !viewport.height) return
    const next = fitMode.current ? { scale: fitImageScale(image, viewport), x: 0, y: 0 } : constrainImageView(viewRef.current, image, viewport)
    viewRef.current = next
    setView(next)
  }, [image, viewport])
  useEffect(() => {
    const element = stage.current!
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (!image.width || !viewport.width || failed) return
      fitMode.current = false
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1
      const multiplier = Math.exp(-Math.max(-1000, Math.min(1000, event.deltaY * units)) * 0.002)
      const rect = element.getBoundingClientRect()
      const next = zoomImageAt(viewRef.current, viewRef.current.scale * multiplier, { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }, image, viewport)
      viewRef.current = next
      setView(next)
    }
    // React wheel listeners are passive; the native listener keeps page zoom/scroll out of the canvas.
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [image, viewport, failed])

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!ready || event.button !== 0) return
    stage.current!.focus({ preventScroll: true })
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId)
    if (!previous || !ready) return
    const before = [...pointers.current.values()]
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const after = [...pointers.current.values()]
    if (before.length >= 2) {
      const midpoint = (points: ImagePoint[]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 })
      const distance = (points: ImagePoint[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      const oldMiddle = midpoint(before), newMiddle = midpoint(after), oldDistance = distance(before)
      if (oldDistance > 0) zoom(viewRef.current.scale * distance(after) / oldDistance, relative(oldMiddle))
      pan(newMiddle.x - oldMiddle.x, newMiddle.y - oldMiddle.y)
    } else pan(event.clientX - previous.x, event.clientY - previous.y)
  }
  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
    setDragging(pointers.current.size > 0)
  }
  function keyDown(event: KeyboardEvent) {
    if (!ready || event.altKey || event.metaKey || event.ctrlKey) return
    switch (event.key) {
      case '+': case '=': zoom(viewRef.current.scale * 1.25); break
      case '-': case '_': zoom(viewRef.current.scale / 1.25); break
      case '0': fit(); break
      case '1': zoom(1); break
      case 'ArrowLeft': pan(-60, 0); break
      case 'ArrowRight': pan(60, 0); break
      case 'ArrowUp': pan(0, -60); break
      case 'ArrowDown': pan(0, 60); break
      default: return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  return <Dialog.Content className="image-viewer" onKeyDown={keyDown} onOpenAutoFocus={(event) => { event.preventDefault(); stage.current?.focus() }}>
    <header className="image-viewer-toolbar"><div className="image-viewer-title"><Dialog.Title>{asset.title}</Dialog.Title><span>{ready ? `${image.width} × ${image.height} · 原图` : '原图查看'}</span></div>
      <div className="image-viewer-controls" role="group" aria-label="照片缩放控制">
        <IconButton label="缩小照片" disabled={!ready || view.scale <= minimumScale + 0.00001} onClick={() => zoom(viewRef.current.scale / 1.25)}><ZoomOut size={18} /></IconButton>
        <output aria-label="当前缩放比例" aria-live="polite">{ready ? `${Math.round(view.scale * 100)}%` : '—'}</output>
        <IconButton label="放大照片" disabled={!ready || view.scale >= MAX_IMAGE_SCALE} onClick={() => zoom(viewRef.current.scale * 1.25)}><ZoomIn size={18} /></IconButton>
        <button className="image-viewer-action" type="button" disabled={!ready} onClick={() => zoom(1)} title="原始尺寸（快捷键 1）"><Scan size={16} />原始尺寸</button>
        <button className="image-viewer-action" type="button" disabled={!ready} onClick={fit} title="适应窗口（快捷键 0）"><Maximize size={16} />适应窗口</button>
        <Dialog.Close asChild><IconButton label="关闭大图"><X size={21} /></IconButton></Dialog.Close>
      </div>
    </header>
    <div ref={stage} className={`image-viewer-stage ${pannable ? 'pannable' : ''} ${dragging ? 'dragging' : ''}`} role="region" aria-label="照片查看区域" aria-busy={!ready && !failed} tabIndex={0}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}
      onDoubleClick={(event) => { if (ready) { if (viewRef.current.scale > fittedScale + 0.001) fit(); else zoom(Math.max(1, fittedScale * 2), relative({ x: event.clientX, y: event.clientY })) } }}>
      {url && !failed && <img className="image-viewer-image" src={url} alt={asset.title} draggable={false} onLoad={(event) => setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} style={{ width: image.width || undefined, height: image.height || undefined, visibility: ready ? 'visible' : 'hidden', transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />}
      {failed ? <div className="image-viewer-status" role="alert"><ImageOff size={28} /><p>图片暂不可用</p><span>请关闭大图后重新打开。</span></div> : !ready && <div className="image-viewer-status" role="status"><LoaderCircle size={25} className="spin" /><p>正在读取原图…</p></div>}
    </div>
    <Dialog.Description className="image-viewer-help">滚轮／双指缩放 · 放大后拖拽移动 · 双击放大或还原<span> · ＋／－ 缩放 · 方向键移动 · Esc 返回</span></Dialog.Description>
  </Dialog.Content>
}
