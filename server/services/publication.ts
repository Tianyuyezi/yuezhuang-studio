import { readFile } from 'node:fs/promises'
import type { StudioDatabase } from '../database/client'
import type { AssetService } from './assets'
import { AppError } from '../errors'

function crc32(bytes: Buffer) {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
// JPEG/PNG files are already compressed. A stored ZIP preserves original bytes.
export function publicationZip(files: { name: string; bytes: Buffer }[]) {
  const local: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name), checksum = crc32(file.bytes)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(33, 12)
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(file.bytes.length, 18); header.writeUInt32LE(file.bytes.length, 22); header.writeUInt16LE(name.length, 26)
    local.push(header, name, file.bytes)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x0800, 8); directory.writeUInt16LE(33, 14)
    directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(file.bytes.length, 20); directory.writeUInt32LE(file.bytes.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42)
    central.push(directory, name)
    offset += header.length + name.length + file.bytes.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

export async function publicationPackage(database: StudioDatabase, assets: AssetService, id: string) {
  const draft = database.snapshot().state.publishDrafts.find((p) => p.id === id)
  if (!draft) throw new AppError('NOT_FOUND', '发布草稿不存在或已经删除。', 404)
  const group = database.groups().find((g) => g.id === draft.groupId)
  if (!group || !draft.assetIds?.length || draft.assetIds.some((assetId) => !group.assetIds.includes(assetId))) throw new AppError('PUBLISH_ASSETS_INVALID', '请先在快速工作流中确认这份草稿的发布图片。')
  const files: { name: string; bytes: Buffer }[] = []
  let size = 0
  for (const [index, assetId] of draft.assetIds.entries()) {
    const original = assets.file(assetId)
    const bytes = await readFile(original.path)
    size += bytes.length
    if (size > 100 * 1024 * 1024) throw new AppError('PACKAGE_TOO_LARGE', '发布包超过 100 MB，请减少选图后再导出。')
    const ext = original.mime.includes('png') ? 'png' : original.mime.includes('webp') ? 'webp' : 'jpg'
    files.push({ name: `${String(index + 1).padStart(2, '0')}-${index === 0 ? 'cover' : 'photo'}.${ext}`, bytes })
  }
  files.push({ name: 'caption.txt', bytes: Buffer.from(draft.caption, 'utf8') }, { name: 'publication.json', bytes: Buffer.from(JSON.stringify({ ...draft, status: 'local_draft', instagramPublished: false }, null, 2)) })
  return publicationZip(files)
}
