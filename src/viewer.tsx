import { useEffect, useRef, useState } from 'react'
import { Clapperboard, Film, Frame, Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from 'lucide-react'
import { durationOf, timecode, type Project } from '../shared/model'
import { Scene, type SceneSources } from './scene'

export function Viewer({ project, frame, playing, sources, onSeek, onPlay, onImport, onComposition }: {
  project: Project; frame: number; playing: boolean; sources: SceneSources;
  onSeek: (frame: number) => void; onPlay: () => void; onImport: () => void; onComposition: () => void;
}) {
  const [ratio, setRatio] = useState(0)
  const [guide, setGuide] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const length = durationOf(project)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setRatio(Math.max(0.01,
      Math.min((entry.contentRect.width - 48) / project.width, (entry.contentRect.height - 46) / project.height))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [project.width, project.height])

  return <section className="viewer panel" aria-label="Composition viewer">
    <header className="panel-header viewer-header">
      <Clapperboard size={15} /><h2>Composition</h2><span className="toolbar-spacer" />
      <button className="format-button" type="button" onClick={onComposition} title="Composition settings">{project.width} × {project.height}</button>
      <button className={`icon-button ${guide ? 'active' : ''}`} aria-label="Safe area guides" aria-pressed={guide} title="Safe area guides"
        onClick={() => setGuide(!guide)}><Frame size={15} /></button>
    </header>
    <div className="viewport" ref={host}>
      <div className="viewport-frame" style={{ width: project.width * ratio, height: project.height * ratio }}>
        <div className="viewport-stage" style={{ transform: `scale(${ratio})` }}>
          <Scene project={project} frame={frame} playing={playing} sources={sources} />
        </div>
        {guide && <div className="viewport-guide" aria-hidden="true" />}
        {!length && <div className="empty viewer-empty">
          <Film size={29} strokeWidth={1.25} />
          <h3>Start your composition</h3>
          <button className="button" onClick={onImport}>Import media</button>
        </div>}
      </div>
    </div>
    <div className="transport">
      <span className="transport-time"><strong>{timecode(frame, project.fps)}</strong><span>{timecode(length, project.fps)}</span></span>
      <div className="play-controls">
        <button className="icon-button" aria-label="Go to start" title="Go to start" onClick={() => onSeek(0)}><SkipBack size={15} /></button>
        <button className="icon-button" aria-label="Previous frame" title="Previous frame" onClick={() => onSeek(frame - 1)}><StepBack size={15} /></button>
        <button className="play-button" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'} disabled={!length} onClick={onPlay}>
          {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <button className="icon-button" aria-label="Next frame" title="Next frame" onClick={() => onSeek(frame + 1)}><StepForward size={15} /></button>
        <button className="icon-button" aria-label="Go to end" title="Go to end" onClick={() => onSeek(Math.max(0, length - 1))}><SkipForward size={15} /></button>
      </div>
      <span className="viewer-fps">{project.fps} fps</span>
    </div>
  </section>
}
