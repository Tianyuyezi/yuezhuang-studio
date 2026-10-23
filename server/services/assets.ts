import sharp from 'sharp'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { eq, isNull } from 'drizzle-orm'
import { StudioDatabase } from '../database/client'
import { assetTable } from '../database/schema'
import { AppError } from '../errors'
import type { Asset } from '../../src/lib/types'

export class AssetService {
  constructor(private database: StudioDatabase, private publicDir: string) {}
  async save(bytes: Buffer, title: string, options: { id?: string; groupId?: string; kind?: 'imported' | 'generated'; style?: string; projectId?: string | null; jobId?: string } = {}): Promise<Asset> {
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new AppError('ASSET_SIZE', '图片大小必须在 1 字节到 20 MB 之间。')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (options.id) {
      const existing = this.database.db.select().from(assetTable).where(eq(assetTable.id, options.id)).get()
      if (existing) {
        if (!existing.deletedAt && existing.sha256 === sha256) return existing.metadata
        throw new AppError('ASSET_CONFLICT', '同一素材 ID 已有其他图片，请重新导入。', 409)
      }
    }
    let width: number, height: number, format: string
    let thumbnail: Buffer
    try {
      const image = sharp(bytes, { limitInputPixels: 60_000_000, failOn: 'error', animated: false })
      const metadata = await image.metadata()
      if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) throw new Error('format')
      // Decode all pixels; reading metadata alone would accept truncated files.
      await image.clone().stats()
      width = metadata.width; height = metadata.height; format = metadata.format!
      thumbnail = await image.clone().rotate().resize({ width: 600, height: 800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
    } catch { throw new AppError('ASSET_INVALID', '图片无法完整解码，请选择有效的 JPG、PNG 或 WebP 文件。') }
    const id = options.id ?? randomUUID()
    const originalPath = `assets/${id}/original.${format === 'jpeg' ? 'jpg' : format}`
    const thumbnailPath = `assets/${id}/thumbnail.jpg`
    const asset: Asset = { id, groupId: options.groupId ?? options.jobId ?? id, title: title.trim().slice(0, 120) || '未命名图片', src: `/api/assets/${id}/file`, thumbnailSrc: `/api/assets/${id}/thumbnail`, kind: options.kind ?? 'imported', style: options.style ?? '未分类', width, height, createdAt: Date.now(), projectId: options.projectId ?? null, ...(options.jobId ? { jobId: options.jobId } : {}) }
    await mkdir(join(this.database.dataDir, 'assets'), { recursive: true, mode: 0o700 })
    try { await mkdir(dirname(this.path(originalPath)), { mode: 0o700 }) }
    catch { throw new AppError('ASSET_BUSY', '这张图片正在保存或存在未完成的导入，请稍后重试。', 409) }
    try {
      await writeFile(this.path(originalPath), bytes, { mode: 0o600, flag: 'wx' })
      await writeFile(this.path(thumbnailPath), thumbnail, { mode: 0o600, flag: 'wx' })
      this.database.db.insert(assetTable).values({ id, metadata: asset, originalPath, thumbnailPath, mimeType: `image/${format}`, sha256, sizeBytes: bytes.length }).run()
      this.database.audit('asset.import', id)
      return asset
    } catch (error) { await rm(dirname(this.path(originalPath)), { recursive: true, force: true }); throw error }
  }
  path(relative: string) {
    const root = resolve(this.database.dataDir)
    const path = resolve(root, relative)
    if (!path.startsWith(root + sep)) throw new AppError('INVALID_PATH', '素材路径无效。')
    return path
  }
  file(id: string, thumbnail = false) {
    const row = this.database.db.select().from(assetTable).where(eq(assetTable.id, id)).get()
    if (!row || row.deletedAt) throw new AppError('ASSET_NOT_FOUND', '图片不存在或已经删除。', 404)
    return { path: this.path(thumbnail ? row.thumbnailPath : row.originalPath), mime: thumbnail ? 'image/jpeg' : row.mimeType }
  }
  async input(id: string, maxEdge = 1800) {
    if (/^sample-0[1-6]$/.test(id)) return { bytes: await readFile(join(this.publicDir, 'images', `portrait-${id.slice(-2)}.jpg`)), mime: 'image/jpeg' }
    const file = this.file(id)
    const bytes = await sharp(await readFile(file.path), { limitInputPixels: 60_000_000 }).rotate().resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: maxEdge <= 1024 ? 85 : 94 }).toBuffer()
    return { bytes, mime: 'image/jpeg' }
  }
  remove(id: string) {
    const existing = this.database.db.select().from(assetTable).where(eq(assetTable.id, id)).get()
    if (!existing || existing.deletedAt) throw new AppError('ASSET_NOT_FOUND', '图片不存在。', 404)
    return this.database.db.transaction(() => {
      this.database.db.update(assetTable).set({ deletedAt: Date.now() }).where(eq(assetTable.id, id)).run()
      const snapshot = this.database.mutateWorkspace((s) => {
        const deletedModels = new Set(s.customModels.filter((m) => m.assetId === id).map((m) => m.id))
        const cleanDraft = (draft: typeof s.draft) => ({ ...draft, referenceId: draft.referenceId === id ? null : draft.referenceId, modelId: draft.modelId && deletedModels.has(draft.modelId) ? null : draft.modelId })
        return { ...s, favorites: s.favorites.filter((v) => v !== id), customModels: s.customModels.filter((m) => m.assetId !== id), draft: cleanDraft(s.draft), projects: s.projects.map((p) => ({ ...p, coverId: p.coverId === id ? null : p.coverId, draft: cleanDraft(p.draft) })) }
      })
      this.database.audit('asset.delete', id)
      return snapshot
    })
  }
  async exportFiles() {
    const rows = this.database.db.select().from(assetTable).where(isNull(assetTable.deletedAt)).all()
    return Promise.all(rows.map(async (row) => ({ id: row.id, sha256: row.sha256, mimeType: row.mimeType, data: (await readFile(this.path(row.originalPath))).toString('base64') })))
  }
}
