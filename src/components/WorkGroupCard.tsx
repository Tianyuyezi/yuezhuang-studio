import { ArrowUpRight, Feather, Images } from 'lucide-react'
import { useWorkspace } from '../stores/workspace'
import type { Asset, WorkGroup } from '../lib/types'
import { AssetImage, Button } from './ui'

export default function WorkGroupCard({ group, assets, onOpen, onSelect }: { group: WorkGroup; assets: Asset[]; onOpen?: () => void; onSelect?: () => void }) {
  const openCaptions = useWorkspace((s) => s.openGroupCaptions)
  const startWorkflow = useWorkspace((s) => s.startWorkflow)
  const members = group.assetIds.map((id) => assets.find((a) => a.id === id)).filter((a): a is Asset => !!a)
  return <article className="work-group-card">
    <button className={`work-group-cover ${members.length === 1 ? 'single' : ''}`} aria-label={`查看作品组${group.title}`} onClick={onSelect ?? onOpen}>
      {members.slice(0, 3).map((asset) => <AssetImage key={asset.id} asset={{ ...asset, src: asset.thumbnailSrc ?? asset.src }} />)}
      <span><Images size={13} />{members.length} 张</span>
    </button>
    <div className="work-group-info"><h3>{group.title}</h3><p>{group.source === 'generated' ? '同批生成 · 同一妆造' : '同批导入'}<span>{group.assetIds.length} 张图片</span></p></div>
    <div className="work-group-actions">{onSelect ? <Button onClick={onSelect}>选择这组<ArrowUpRight size={14} /></Button> : <><Button onClick={onOpen}>查看组内图片</Button><Button variant="ghost" onClick={() => openCaptions(group.id)}><Feather size={14} />三语文案</Button></>}</div>
    {!onSelect && <button className="group-workflow-link" onClick={() => startWorkflow(group.id)}>继续快速工作流<ArrowUpRight size={13} /></button>}
  </article>
}
