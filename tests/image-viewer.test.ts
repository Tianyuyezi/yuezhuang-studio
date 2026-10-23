import { describe, expect, it } from 'vitest'
import { constrainImageView, fitImageScale, zoomImageAt } from '../src/lib/image-viewer'

describe('original photo inspection geometry', () => {
  it('fits portrait and landscape photos without stretching or enlarging small originals', () => {
    const viewport = { width: 1000, height: 700 }
    expect(fitImageScale({ width: 1086, height: 1448 }, viewport) * 1448).toBeCloseTo(660)
    expect(fitImageScale({ width: 2000, height: 1000 }, viewport) * 2000).toBeCloseTo(960)
    expect(fitImageScale({ width: 100, height: 150 }, viewport)).toBe(1)
  })
  it('keeps the photo detail under the cursor fixed while zooming', () => {
    const image = { width: 2000, height: 2000 }, viewport = { width: 800, height: 600 }
    const view = { scale: 0.6, x: 40, y: -30 }, point = { x: 60, y: -40 }
    const next = zoomImageAt(view, 2, point, image, viewport)
    expect((point.x - next.x) / next.scale).toBeCloseTo((point.x - view.x) / view.scale)
    expect((point.y - next.y) / next.scale).toBeCloseTo((point.y - view.y) / view.scale)
  })
  it('limits panning at photo edges, recenters a fitted photo and bounds zoom to 800%', () => {
    const image = { width: 1000, height: 1500 }, viewport = { width: 800, height: 600 }
    expect(constrainImageView({ scale: 1, x: 10000, y: -10000 }, image, viewport)).toEqual({ scale: 1, x: 100, y: -450 })
    const fitted = constrainImageView({ scale: fitImageScale(image, viewport), x: 100, y: -450 }, image, viewport)
    expect(fitted.x).toBeCloseTo(0)
    expect(fitted.y).toBeCloseTo(0)
    expect(constrainImageView({ scale: 100, x: 0, y: 0 }, image, viewport).scale).toBe(8)
    const hugeImage = { width: 8000, height: 7500 }
    expect(constrainImageView({ scale: 0, x: 0, y: 0 }, hugeImage, viewport).scale).toBe(fitImageScale(hugeImage, viewport))
  })
})
