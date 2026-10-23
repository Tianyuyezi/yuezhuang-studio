import { ArrowUpRight, Heart, ImagePlus } from 'lucide-react'
import { useWorkspace } from '../stores/workspace'
import type { Asset } from '../lib/types'
import { AssetImage, IconButton } from './ui'

export default function AssetCard({ asset, onOpen, onUse }: { asset: Asset; onOpen: (asset: Asset) => void; onUse?: (asset: Asset) => void }) {
  const favorite = useWorkspace((s) => s.favorites.includes(asset.id))
  const toggleFavorite = useWorkspace((s) => s.toggleFavorite)
  return <article className="asset-card">
    <div className="asset-picture">
      <button className="asset-open" onClick={() => onOpen(asset)} aria-label={`查看${asset.title}`}><AssetImage asset={asset} /><span className="asset-zoom"><ArrowUpRight size={19} /></span></button>
      <span className="image-badge">{asset.kind === 'example' ? asset.exampleOrigin === 'generated' ? 'AI 风格参考' : '摄影参考示例' : asset.kind === 'generated' ? 'AI 作品' : '本地素材'}</span>
      <IconButton label={favorite ? `取消收藏${asset.title}` : `收藏${asset.title}`} className={`favorite-button ${favorite ? 'is-favorite' : ''}`} onClick={() => toggleFavorite(asset.id)}><Heart size={16} fill={favorite ? 'currentColor' : 'none'} /></IconButton>
      {onUse && <button className="asset-use" onClick={() => onUse(asset)}><ImagePlus size={14} />用作参考图</button>}
    </div>
    <div className="asset-caption"><div><h3>{asset.title}</h3><span>{asset.style}</span></div></div>
  </article>
}
