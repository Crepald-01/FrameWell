import { useState } from 'react'
import { AudioLines, Film, Image, Import, LibraryBig, Plus, Search, SquareCode, UploadCloud } from 'lucide-react'
import { timecode, type Asset, type Project } from '../shared/model'
import { mediaUrl } from './api'

const tabs = [
  ['all', 'All'], ['video', 'Video'], ['audio', 'Audio'], ['image', 'Images'],
] as const
const icons = { video: Film, audio: AudioLines, image: Image }
type Filter = typeof tabs[number][0]

export function Library({ project, projectId, busy, onImport, onFiles, onAsset, onReact }: {
  project: Project; projectId: string; busy: boolean; onImport: () => void; onFiles: (files: FileList) => void;
  onAsset: (id: string) => void; onReact: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const assets = project.assets.filter(asset => (filter === 'all' || asset.kind === filter) && asset.name.toLowerCase().includes(query.trim().toLowerCase()))
  const reactFiles = project.code.filter(file => file.kind === 'react')
  return <aside className="panel library" onDragOver={event => {
    if (!busy && event.dataTransfer.types.includes('Files')) event.preventDefault()
  }} onDrop={event => {
    if (!busy && event.dataTransfer.files.length) { event.preventDefault(); onFiles(event.dataTransfer.files) }
  }}>
    <header className="panel-header"><LibraryBig size={15} /><h2>Media</h2><span className="toolbar-spacer" />
      <button className="icon-button" title="Import media" aria-label="Import media" disabled={busy} onClick={onImport}><Plus size={17} /></button>
    </header>
    <div className="library-tools">
      <label className="search"><Search size={15} /><input placeholder="Search media" aria-label="Search media" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="filters" aria-label="Media type">{tabs.map(([id, title]) => <button className={filter === id ? 'active' : ''}
        key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{title}</button>)}</div>
    </div>
    <div className="library-content">
      {assets.length > 0 && <div className="media-grid">{assets.map(asset => <AssetCard key={asset.id} asset={asset} projectId={projectId} fps={project.fps}
        disabled={busy} onAdd={() => onAsset(asset.id)} />)}</div>}
      {!project.assets.length && <button className="drop-zone" disabled={busy} onClick={onImport}>
        <UploadCloud size={24} strokeWidth={1.45} /><strong>Import media</strong><span>Drop video, audio, or images</span>
      </button>}
      {project.assets.length > 0 && !assets.length && <div className="empty search-empty">
        <p>No matching media</p><button className="button quiet" onClick={() => { setQuery(''); setFilter('all') }}>Clear filters</button>
      </div>}
      {reactFiles.length > 0 && <section className="library-code"><h3>React clips</h3>
        {reactFiles.map(file => <button className="file-item" key={file.id} disabled={busy} title="Add to timeline" onClick={() => onReact(file.id)}>
          <SquareCode size={15} /><span>{file.path}</span><Import size={13} />
        </button>)}
      </section>}
    </div>
    <footer className="library-footer">{project.assets.length} {project.assets.length === 1 ? 'asset' : 'assets'}</footer>
  </aside>
}

function AssetCard({ asset, projectId, fps, disabled, onAdd }: {
  asset: Asset; projectId: string; fps: number; disabled: boolean; onAdd: () => void;
}) {
  const Kind = icons[asset.kind]
  return <div className="asset-card" draggable={!disabled} onDragStart={event => {
    event.dataTransfer.setData('application/x-framewell-asset', asset.id)
    event.dataTransfer.effectAllowed = 'copy'
  }}>
    <div className={`asset-thumb asset-${asset.kind}`}>
      {asset.kind !== 'audio' ? <img alt="" src={mediaUrl(projectId, asset, 'thumb')} draggable={false} /> : <Kind size={24} strokeWidth={1.5} />}
      <span className="asset-badge" aria-hidden="true"><Kind size={12} /></span>
      <button type="button" className="asset-add" disabled={disabled} onClick={onAdd} title="Add at playhead" aria-label={`Add ${asset.name} at playhead`}><Plus size={16} /></button>
    </div>
    <div className="asset-details" title={asset.name}>
      <span>{asset.name}</span>
      <small>{asset.kind === 'image' ? `${asset.width} × ${asset.height}` : timecode(asset.duration, fps).slice(3)}</small>
    </div>
  </div>
}
