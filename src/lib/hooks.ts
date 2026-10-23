import { useEffect, useState } from 'react'
import { SAMPLE_ASSETS, SAMPLE_MODELS } from './data'
import { getImageBlob } from './storage'
import { useWorkspace } from '../stores/workspace'
import type { Asset } from './types'

export function useAssets() {
  const imported = useWorkspace((s) => s.importedAssets)
  const hidden = useWorkspace((s) => s.hiddenExamples)
  return [...imported, ...SAMPLE_ASSETS.filter((a) => !hidden.includes(a.id))]
}

export function useModels() {
  const custom = useWorkspace((s) => s.customModels)
  return [...custom, ...SAMPLE_MODELS]
}

export function useImageUrl(asset: Asset | undefined) {
  const [url, setUrl] = useState(asset?.src ?? '')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    let objectUrl: string | undefined
    setFailed(false)
    setUrl(asset?.src ?? '')
    if (asset && !asset.src) {
      getImageBlob(asset.id).then((blob) => {
        if (!active) return
        if (blob) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) }
        else setFailed(true)
      }).catch(() => { if (active) setFailed(true) })
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [asset?.id, asset?.src])
  return { url, failed, setFailed }
}
