export interface ImageSize { width: number; height: number }
export interface ImageView { scale: number; x: number; y: number }
export interface ImagePoint { x: number; y: number }

export const MAX_IMAGE_SCALE = 8
export function fitImageScale(image: ImageSize, viewport: ImageSize) {
  return Math.min(Math.max(1, viewport.width - 40) / image.width, Math.max(1, viewport.height - 40) / image.height, 1)
}
export function constrainImageView(view: ImageView, image: ImageSize, viewport: ImageSize): ImageView {
  const scale = Math.max(Math.min(fitImageScale(image, viewport), 0.1), Math.min(MAX_IMAGE_SCALE, view.scale))
  const limitX = Math.max(0, (image.width * scale - viewport.width) / 2)
  const limitY = Math.max(0, (image.height * scale - viewport.height) / 2)
  return { scale, x: Math.max(-limitX, Math.min(limitX, view.x)), y: Math.max(-limitY, Math.min(limitY, view.y)) }
}
export function zoomImageAt(view: ImageView, scale: number, point: ImagePoint, image: ImageSize, viewport: ImageSize): ImageView {
  const nextScale = constrainImageView({ ...view, scale }, image, viewport).scale
  const ratio = nextScale / view.scale
  return constrainImageView({ scale: nextScale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }, image, viewport)
}
