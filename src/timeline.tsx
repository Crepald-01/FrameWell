import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { AudioLines, CirclePlus, Copy, Eye, EyeOff, Film, LockKeyhole, Magnet, Minus, Plus, Scissors, Shapes, SquareCode, Trash2, Type, UnlockKeyhole, Volume2, VolumeX } from 'lucide-react'
import { animated, durationOf, fitOnTrack, getClip, newTrack, placeClip, timecode, type Clip, type Edit, type Project, type Track } from '../shared/model'

const icons = { video: Film, audio: AudioLines, image: Film, text: Type, shape: Shapes, react: SquareCode }
const labelWidth = 176
const timelineLimit = 2_160_000
type Drag = {
  clip: Clip; mode: 'move' | 'start' | 'end'; from: string; target: string;
  x: number; y: number; scroll: number; start: number; duration: number; offset: number; valid: boolean; moved: boolean;
}
type Props = {
  project: Project; frame: number; selected: string; selectedTrack: string; blocked: boolean;
  onSelect: (clip: string, track: string) => void; onSeek: (frame: number) => void;
  onEdit: (name: string, edits: Edit[]) => unknown; onAsset: (id: string, frame: number, track: string) => void;
  onAdd: (kind: 'text' | 'shape') => void;
}

export function clipActions(project: Project, id: string, at: number) {
  const item = getClip(project, id)
  if (!item || item.track.locked) return {}
  const { clip, track } = item
  const copy = { ...structuredClone(clip), id: crypto.randomUUID(), start: clip.start + clip.duration }
  return {
    split: clip.start < at && at < clip.start + clip.duration
      ? { type: 'splitClip', id, rightId: crypto.randomUUID(), at } as const : undefined,
    duplicate: copy.start + copy.duration <= timelineLimit ? placeClip(project, copy, track.id) : undefined,
    remove: { type: 'deleteClip', id } as const,
  }
}

export function Timeline({ project, frame, selected, selectedTrack, blocked, onSelect, onSeek, onEdit, onAsset, onAdd }: Props) {
  const [zoom, setZoom] = useState(58)
  const [snapping, setSnapping] = useState(true)
  const [scroll, setScroll] = useState({ left: 0, width: 940 })
  const [dragging, setDragging] = useState<Drag | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const axisRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const px = zoom / project.fps
  const end = durationOf(project)
  const width = Math.ceil(Math.max(scroll.width - labelWidth, (end + project.fps * 8) * px, frame * px + 64))
  const actions = clipActions(project, selected, frame)
  const interval = [0.25, 0.5, 1, 2, 5, 10, 30, 60].find(value => value * zoom >= 56) || 60
  const tickStep = Math.max(1, Math.round(interval * project.fps))
  const firstTick = Math.max(0, Math.floor((scroll.left / px) / tickStep) * tickStep)
  const lastTick = Math.min(width / px, (scroll.left + scroll.width) / px + tickStep)
  const ticks: number[] = []
  for (let tick = firstTick; tick <= lastTick; tick += tickStep) ticks.push(tick)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setScroll({ left: element.scrollLeft, width: element.clientWidth }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    dragRef.current = null
    setDragging(null)
  }, [project])

  function frameAt(clientX: number) {
    const x = clientX - (axisRef.current?.getBoundingClientRect().left || 0)
    return Math.max(0, Math.min(timelineLimit, Math.round(x / px)))
  }

  function snap(candidate: number, clip: Clip, compareEnd: boolean) {
    if (!snapping) return candidate
    const anchors = [0, frame, ...project.tracks.flatMap(track => track.clips.filter(other => other.id !== clip.id)
      .flatMap(other => [other.start, other.start + other.duration]))]
    let distance = 7 / px
    let winner = candidate
    for (const anchor of anchors) for (const delta of compareEnd ? [0, clip.duration] : [0]) {
      if (Math.abs(anchor - delta - candidate) >= distance) continue
      distance = Math.abs(anchor - delta - candidate)
      winner = anchor - delta
    }
    return winner
  }

  function startDrag(event: PointerEvent, clip: Clip, track: Track, mode: Drag['mode']) {
    if (event.button !== 0) return
    event.stopPropagation()
    onSelect(clip.id, track.id)
    if (track.locked || blocked || !scrollRef.current) return
    scrollRef.current.setPointerCapture(event.pointerId)
    dragRef.current = { clip, mode, from: track.id, target: track.id, x: event.clientX, y: event.clientY, scroll: scrollRef.current.scrollLeft,
      start: clip.start, duration: clip.duration, offset: clip.offset, valid: true, moved: false }
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = dragRef.current
    if (!current) return
    const distance = event.clientX - current.x + (event.currentTarget.scrollLeft - current.scroll)
    const movedAcrossTracks = current.mode === 'move' && Math.abs(event.clientY - current.y) >= 3
    if (!current.moved && Math.abs(distance) < 3 && !movedAcrossTracks) return
    const clip = current.clip
    const delta = Math.round(distance / px)
    const next = { ...current, moved: true }
    if (current.mode === 'move') {
      next.start = Math.max(0, Math.min(timelineLimit - clip.duration, snap(clip.start + delta, clip, true)))
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-track-id]')
      next.target = row?.dataset.trackId || current.from
    } else if (current.mode === 'start') {
      next.start = Math.max(0, clip.start - clip.offset, Math.min(clip.start + clip.duration - 1, snap(clip.start + delta, clip, false)))
      next.offset = clip.offset + next.start - clip.start
      next.duration = clip.duration - (next.start - clip.start)
    } else {
      const asset = project.assets.find(asset => asset.id === clip.assetId)
      const max = asset && asset.kind !== 'image' ? asset.duration - clip.offset : timelineLimit - Math.max(clip.start, clip.offset)
      next.duration = Math.max(1, Math.min(max, snap(clip.start + clip.duration + delta, clip, false) - clip.start))
    }
    const target = project.tracks.find(track => track.id === next.target)
    next.valid = Boolean(target && (clip.kind === 'audio') === (target.kind === 'audio') &&
      fitOnTrack(target, next.start, next.duration, clip.id))
    dragRef.current = next
    setDragging(next)
  }

  function stopDrag(cancel = false) {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(null)
    if (cancel || !drag?.moved || !drag.valid) return
    if (drag.mode === 'move') {
      if (drag.target !== drag.from || drag.start !== drag.clip.start) {
        onEdit('Move clip', [{ type: 'moveClip', id: drag.clip.id, trackId: drag.target, start: drag.start }])
      }
    } else if (drag.start !== drag.clip.start || drag.duration !== drag.clip.duration) {
      onEdit('Trim clip', [{ type: 'changeClip', id: drag.clip.id, changes: { start: drag.start, duration: drag.duration, offset: drag.offset } }])
    }
  }

  function drawClip(clip: Clip, track: Track, ghost = false) {
    const Icon = icons[clip.kind]
    const isDragged = dragging?.clip.id === clip.id
    const draft = isDragged && (ghost || dragging.target === track.id) ? dragging : undefined
    const start = draft?.start ?? clip.start
    const length = draft?.duration ?? clip.duration
    const asset = project.assets.find(item => item.id === clip.assetId)
    const points = [...new Set(Object.values(clip.keys).flatMap(keys => keys?.map(key => key.frame) || []))]
      .filter(value => value >= clip.offset && value < clip.offset + clip.duration)
    return <div key={clip.id + (ghost ? '-ghost' : '')}
      className={`timeline-clip clip-${clip.kind} ${selected === clip.id ? 'selected' : ''} ${isDragged && dragging.target !== dragging.from && !ghost ? 'original' : ''} ${draft && !draft.valid ? 'invalid' : ''}`}
      style={{ left: start * px, width: Math.max(4, length * px) }}>
      <button className="clip-body" tabIndex={ghost ? -1 : 0} aria-label={clip.name} aria-pressed={selected === clip.id}
        title={`${clip.name} · ${timecode(clip.start, project.fps)}`}
        onFocus={() => onSelect(clip.id, track.id)} onClick={() => onSelect(clip.id, track.id)}
        onPointerDown={event => startDrag(event, clip, track, 'move')}>
        <Icon size={13} /><span>{clip.name}</span>
      </button>
      {asset?.peaks.length ? <div className="waveform" aria-hidden="true">
        {asset.peaks.slice(Math.floor(clip.offset / asset.duration * asset.peaks.length),
          Math.ceil((clip.offset + clip.duration) / asset.duration * asset.peaks.length))
          .map((peak, index) => <i key={index} style={{ height: `${Math.max(8, peak * 100)}%` }} />)}
      </div> : null}
      {points.map(point => <i aria-hidden="true" key={point} className="key-dot" style={{ left: (point - clip.offset) * px }} />)}
      {!ghost && !track.locked && <><span className="trim-handle trim-left" title="Trim start" onPointerDown={event => startDrag(event, clip, track, 'start')} />
        <span className="trim-handle trim-right" title="Trim end" onPointerDown={event => startDrag(event, clip, track, 'end')} /></>}
    </div>
  }

  return <section className="timeline panel" aria-label="Timeline">
    <header className="timeline-tools">
      <h2>Timeline</h2>
      <div className="toolbar-group">
        <button className="icon-button" title="Split at playhead (S)" aria-label="Split at playhead" disabled={blocked || !actions.split}
          onClick={() => actions.split && onEdit('Split clip', [actions.split])}><Scissors size={16} /></button>
        <button className="icon-button" title="Duplicate clip" aria-label="Duplicate clip" disabled={blocked || !actions.duplicate}
          onClick={() => actions.duplicate && onEdit('Duplicate clip', actions.duplicate)}><Copy size={15} /></button>
        <button className="icon-button" title="Delete clip" aria-label="Delete clip" disabled={blocked || !actions.remove}
          onClick={() => actions.remove && onEdit('Delete clip', [actions.remove])}><Trash2 size={15} /></button>
      </div>
      <div className="toolbar-group">
        <button className="icon-button" title="Add a title" aria-label="Add a title" disabled={blocked} onClick={() => onAdd('text')}><Type size={17} /></button>
        <button className="icon-button" title="Add a shape" aria-label="Add a shape" disabled={blocked} onClick={() => onAdd('shape')}><Shapes size={16} /></button>
      </div>
      <span className="toolbar-spacer" />
      <button className={`icon-button ${snapping ? 'active' : ''}`} aria-label="Snap clips" aria-pressed={snapping} title="Snap clips"
        onClick={() => setSnapping(!snapping)}><Magnet size={15} /></button>
      <div className="zoom-control">
        <button className="icon-button" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(12, value / 1.25))}><Minus size={14} /></button>
        <input type="range" value={zoom} min={12} max={220} aria-label="Timeline zoom" onChange={event => setZoom(+event.target.value)} />
        <button className="icon-button" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(220, value * 1.25))}><Plus size={14} /></button>
      </div>
    </header>
    <div className="timeline-scroll" ref={scrollRef}
      onScroll={event => setScroll({ left: event.currentTarget.scrollLeft, width: event.currentTarget.clientWidth })}
      onPointerMove={moveDrag} onPointerUp={() => stopDrag()} onPointerCancel={() => stopDrag(true)} onLostPointerCapture={() => stopDrag(true)}>
      <div className="timeline-grid" style={{ width: width + labelWidth, gridTemplateColumns: `${labelWidth}px ${width}px` }}>
        <div className="track-add">
          <button className="icon-button" title="Add video track" aria-label="Add video track" disabled={blocked}
            onClick={() => onEdit('Add video track', [{ type: 'addTrack', track: newTrack(`Video ${project.tracks.filter(track => track.kind === 'visual').length + 1}`), before: project.tracks[0]?.id }])}><CirclePlus size={15} /></button>
          <span>Tracks</span>
          <button className="icon-button" title="Add audio track" aria-label="Add audio track" disabled={blocked}
            onClick={() => onEdit('Add audio track', [{ type: 'addTrack', track: newTrack(`Audio ${project.tracks.filter(track => track.kind === 'audio').length + 1}`, 'audio') }])}><AudioLines size={15} /></button>
        </div>
        <div className="timeline-ruler" ref={axisRef} role="slider" aria-label="Playhead" aria-valuemin={0}
          aria-valuemax={Math.min(timelineLimit, Math.floor(width / px))} aria-valuenow={frame} aria-valuetext={timecode(frame, project.fps)}
          tabIndex={0} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            event.stopPropagation()
            onSeek(event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, end - 1) : frame + (event.key === 'ArrowRight' ? 1 : -1))
          }}
          onPointerDown={event => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            onSeek(frameAt(event.clientX))
          }}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(frameAt(event.clientX)) }}>
          {ticks.map(tick => <span className="ruler-tick" key={tick} style={{ left: tick * px }}>{timecode(tick, project.fps).slice(3)}</span>)}
        </div>
        {project.tracks.map(track => <TrackRow key={track.id} track={track} selected={selectedTrack === track.id}
          onSelect={() => onSelect('', track.id)} disabled={blocked} onEdit={onEdit}
          lane={<div className="track-lane" data-track-id={track.id} data-active={track.id === selectedTrack}
            style={{ backgroundSize: `${tickStep * px}px 100%` }}
            onClick={event => { if (event.target === event.currentTarget) { onSelect('', track.id); onSeek(frameAt(event.clientX)) } }}
            onDragOver={event => {
              if (!blocked && !track.locked && event.dataTransfer.types.includes('application/x-framewell-asset')) event.preventDefault()
            }}
            onDrop={event => {
              const id = event.dataTransfer.getData('application/x-framewell-asset')
              if (id && !blocked && !track.locked) { event.preventDefault(); onAsset(id, frameAt(event.clientX), track.id) }
            }}>
            {track.clips.map(clip => drawClip(clip, track))}
            {dragging && dragging.from !== track.id && dragging.target === track.id && drawClip(dragging.clip, track, true)}
          </div>} />)}
        <div className="timeline-playhead" aria-hidden="true" style={{ left: labelWidth + frame * px }}><i /></div>
      </div>
    </div>
  </section>
}

function TrackRow({ track, selected, disabled, onSelect, onEdit, lane }: {
  track: Track; selected: boolean; disabled: boolean; onSelect: () => void; onEdit: Props['onEdit']; lane: React.ReactNode;
}) {
  const patch = (name: string, change: Partial<Pick<Track, 'hidden' | 'muted' | 'locked'>>) =>
    onEdit(name, [{ type: 'updateTrack', id: track.id, changes: change }])
  const TrackIcon = track.kind === 'audio' ? AudioLines : Film
  return <>
    <div className="track-label" data-active={selected} data-track-id={track.id}>
      <button className="track-name" title={track.name} onClick={onSelect}><TrackIcon size={14} /><span>{track.name}</span></button>
      {track.kind === 'visual' && <button className="track-action" title={track.hidden ? 'Show track' : 'Hide track'} aria-label={`${track.hidden ? 'Show' : 'Hide'} ${track.name}`}
        disabled={disabled} onClick={() => patch(track.hidden ? 'Show track' : 'Hide track', { hidden: !track.hidden })}>{track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>}
      <button className="track-action" title={track.muted ? 'Unmute track' : 'Mute track'} aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`}
        disabled={disabled} onClick={() => patch(track.muted ? 'Unmute track' : 'Mute track', { muted: !track.muted })}>{track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>
      <button className="track-action" title={track.locked ? 'Unlock track' : 'Lock track'} aria-label={`${track.locked ? 'Unlock' : 'Lock'} ${track.name}`}
        disabled={disabled} onClick={() => patch(track.locked ? 'Unlock track' : 'Lock track', { locked: !track.locked })}>{track.locked ? <LockKeyhole size={13} /> : <UnlockKeyhole size={13} />}</button>
    </div>
    {lane}
  </>
}
