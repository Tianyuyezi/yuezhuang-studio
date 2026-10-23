import { useState } from 'react'
import { importImage } from '../lib/storage'
import { useWorkspace } from '../stores/workspace'
import type { Asset } from '../lib/types'
import { useNotify } from './ui'

export function useImportAssets() {
  const [importing, setImporting] = useState(false)
  const addAsset = useWorkspace((s) => s.addAsset)
  const notify = useNotify()
  async function importFiles(files: FileList | File[] | null): Promise<Asset[]> {
    if (!files?.length || importing) return []
    setImporting(true)
    const imported: Asset[] = []
    const groupId = crypto.randomUUID()
    const failures: string[] = []
    try {
      for (const file of Array.from(files).slice(0, 20)) {
        try { const asset = await importImage(file, groupId); addAsset(asset); imported.push(asset) }
        catch (error) { failures.push(error instanceof Error ? error.message : '导入失败') }
      }
      if (failures.length) notify(`${imported.length ? `已导入 ${imported.length} 张。` : ''}${failures[0]}`, 'error')
      else if (imported.length) notify(`已导入 ${imported.length} 张图片，原图已保存到本机`)
    } finally { setImporting(false) }
    return imported
  }
  return { importing, importFiles }
}
