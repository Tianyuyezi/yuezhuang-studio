import type { Asset } from './types'
import { request } from './api'
import { useBackend } from '../stores/backend'

const DB_NAME = 'yuezhuang-studio-assets'
let database: Promise<IDBDatabase> | undefined

function openDatabase() {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('images')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => { database = undefined; reject(new Error('无法打开本地图片存储，请检查浏览器权限。')) }
    })
  }
  return database
}

export async function getLegacyImageBlob(id: string): Promise<Blob | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction('images', 'readonly').objectStore('images').get(id)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('无法读取本地图片。'))
  })
}

export async function deleteImageBlob(id: string) {
  if (useBackend.getState().status !== 'ready') throw new Error('本地服务尚未连接，暂时无法删除图片。')
  await request(`/assets/${id}`, { method: 'DELETE' })
}

export async function getImageBlob(id: string): Promise<Blob | undefined> {
  if (useBackend.getState().status === 'ready') {
    const response = await fetch(`/api/assets/${id}/file`)
    if (response.ok) return response.blob()
  }
  return getLegacyImageBlob(id)
}

export async function deleteLegacyImageBlob(id: string) {
  const db = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite')
    tx.objectStore('images').delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new Error('无法删除本地图片。'))
    tx.onabort = () => reject(new Error('删除已中止。'))
  })
}

export async function importImage(file: File, groupId?: string): Promise<Asset> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。')
  if (file.size > 20 * 1024 * 1024) throw new Error('单张图片不能超过 20 MB。')
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { throw new Error('图片无法解码，请选择完整的图片文件。') }
  const width = bitmap.width
  const height = bitmap.height
  bitmap.close()
  if (width * height > 60_000_000) throw new Error('图片尺寸过大，请使用不超过 6000 万像素的图片。')
  if (useBackend.getState().status !== 'ready') throw new Error('本地服务尚未连接，请等待连接完成后再导入。')
  return request<Asset>(`/assets${groupId ? `?groupId=${groupId}` : ''}`, { method: 'POST', headers: { 'Content-Type': file.type, 'X-YZ-Filename': encodeURIComponent(file.name) }, body: file })
}

export function downloadFile(name: string, content: Blob) {
  const url = URL.createObjectURL(content)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
