import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { OverlayOptions } from 'sharp'
import type { PublicationBranding } from '../../src/shared/publication-branding'

const fontfile = fileURLToPath(new URL('../fonts/NotoSansKR.ttf', import.meta.url))
process.env.FONTCONFIG_FILE ??= fileURLToPath(new URL('../fonts/fonts.conf', import.meta.url))
const escapeMarkup = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)

export async function publicationWatermark(width: number, height: number, branding: PublicationBranding): Promise<OverlayOptions[]> {
  if (!branding.watermarkEnabled) return []
  const stripHeight = 170, margin = 44
  const background = Buffer.from(`<svg width="${width}" height="${stripHeight}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14110f" stop-opacity="0"/><stop offset="1" stop-color="#14110f" stop-opacity=".72"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#shade)"/></svg>`)
  const line = async (text: string, size: number, maxHeight: number) => sharp({ text: {
    text: `<span foreground="#ffffff">${escapeMarkup(text)}</span>`, font: `Noto Sans KR ${size}`, fontfile,
    width: width - margin * 2, height: maxHeight, rgba: true,
  } }).png().toBuffer({ resolveWithObject: true })
  const korean = await line(branding.watermarkKorean, 28, 34)
  const english = await line(branding.watermarkEnglish, 22, 27)
  return [
    { input: background, left: 0, top: height - stripHeight },
    { input: korean.data, left: margin, top: height - 112 },
    { input: english.data, left: margin, top: height - 32 - english.info.height },
  ]
}

// Only publishing derivatives use this pipeline. Creation results and originals remain untouched.
export async function publicationImage(path: string, width: number, height: number, watermark: OverlayOptions[]) {
  return sharp(path).rotate().resize(width, height, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' }).toColourspace('srgb').composite(watermark).jpeg({ quality: 94 }).toBuffer()
}
