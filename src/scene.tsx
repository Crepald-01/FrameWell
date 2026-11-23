import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { animated, isActive, type Clip, type Project } from '../shared/model'
import { runtime, type Bundle, type ReactInput } from './runtime'
import { safeMarkup } from './safe-markup'
import './scene.css'

let audioContext: AudioContext | undefined
export function resumePreviewAudio() {
  audioContext ||= new AudioContext()
  return audioContext.resume()
}

function Markup({ value }: { value: string }) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!host.current) return
    const shadow = host.current.shadowRoot || host.current.attachShadow({ mode: 'open' })
    shadow.replaceChildren(safeMarkup(value))
  }, [value])
  return <div className="scene-code" ref={host} />
}

function ReactLayer({ bundle, input }: { bundle?: Bundle; input: ReactInput }) {
  const [display, setDisplay] = useState<{ value: string; error?: string }>({ value: '' })
  const pending = useRef<{ bundle: Bundle; input: ReactInput } | undefined>(undefined)
  const running = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; pending.current = undefined }
  }, [])
  useEffect(() => {
    if (!bundle) return
    pending.current = { bundle, input }
    if (running.current) return
    async function update() {
      running.current = true
      while (alive.current && pending.current) {
        const task = pending.current
        pending.current = undefined
        try {
          const value = await runtime.render(task.bundle, task.input)
          if (alive.current) setDisplay({ value })
        } catch (error) {
          if (alive.current) setDisplay({ value: '', error: error instanceof Error ? error.message : String(error) })
          break
        }
      }
      running.current = false
    }
    void update()
  }, [bundle, input])
  if (display.error) return <div className="scene-error">{display.error}</div>
  return <Markup value={display.value} />
}

function Media({ src, clip, at, fps, playing, muted }: {
  src: string; clip: Clip; at: number; fps: number; playing: boolean; muted: boolean
}) {
  const media = useRef<HTMLMediaElement | null>(null)
  const graph = useRef<{ source: MediaElementAudioSourceNode; gain: GainNode } | undefined>(undefined)
  const desired = (at + 0.12) / fps
  const relative = at - clip.offset
  const gain = muted || clip.style.muted ? 0 : clip.style.volume *
    Math.min(1, relative / (Math.min(clip.duration, clip.style.fadeIn) || 1) + (clip.style.fadeIn ? 0 : 1)) *
    Math.min(1, (clip.duration - relative) / (Math.min(clip.duration, clip.style.fadeOut) || 1))
  function sync() {
    const element = media.current
    if (!element || !element.readyState) return
    if (Math.abs(element.currentTime - desired) > (playing ? 0.11 : 0.002)) {
      element.currentTime = Math.min(desired, element.duration || desired)
    }
    if (playing && element.paused) void element.play().catch(() => {})
    else if (!playing && !element.paused) element.pause()
    if (audioContext && !graph.current) {
      const source = audioContext.createMediaElementSource(element)
      const gain = audioContext.createGain()
      source.connect(gain).connect(audioContext.destination)
      graph.current = { source, gain }
    }
    if (graph.current && audioContext) {
      graph.current.gain.gain.setTargetAtTime(gain, audioContext.currentTime, 0.005)
      element.volume = 1
    } else element.volume = Math.min(1, gain)
  }
  useLayoutEffect(sync, [src, desired, playing, gain])
  useEffect(() => () => {
    graph.current?.source.disconnect()
    graph.current?.gain.disconnect()
  }, [])
  if (clip.kind === 'audio') return <audio ref={node => { media.current = node }} src={src} preload="auto" onLoadedMetadata={sync} />
  return <video ref={node => { media.current = node }} src={src} preload="auto" playsInline onLoadedMetadata={sync} style={{ objectFit: clip.style.fit }} />
}

export type SceneSources = {
  media: Record<string, string>
  bundles: Record<string, Bundle>
}
export type BakedFrame = { videos: Record<string, string>; markup: Record<string, string> }

export function Scene({ project, frame, sources, playing = false, baked }: {
  project: Project; frame: number; sources: SceneSources; playing?: boolean; baked?: BakedFrame
}) {
  return <div className="scene" style={{ width: project.width, height: project.height, background: project.background }}>
    {[...project.tracks].reverse().flatMap(track => track.clips.filter(clip => isActive(clip, frame)).map(clip => (
      <Layer key={clip.id} clip={clip} frame={frame} project={project}
        hidden={track.hidden} muted={track.muted} playing={playing} sources={sources} baked={baked} />
    )))}
  </div>
}

function Layer({ clip, frame, project, hidden, muted, playing, sources, baked }: {
  clip: Clip; frame: number; project: Project; hidden: boolean; muted: boolean; playing: boolean;
  sources: SceneSources; baked?: BakedFrame;
}) {
  const at = clip.offset + frame - clip.start
  const input = useMemo(() => ({ frame: at, fps: project.fps, width: project.width, height: project.height, props: clip.props }),
    [at, project.fps, project.width, project.height, clip.props])
  const src = clip.assetId && sources.media[clip.assetId]
  if (clip.kind === 'audio') {
    return src && !baked ? <Media src={src} clip={clip} at={at} fps={project.fps} muted={muted} playing={playing} /> : null
  }
  if (hidden && (baked || clip.kind !== 'video')) return null
  const { style } = clip
  const x = animated(clip, 'x', at)
  const y = animated(clip, 'y', at)
  const scale = animated(clip, 'scale', at)
  const rotation = animated(clip, 'rotation', at)
  const opacity = animated(clip, 'opacity', at)
  return <div className="scene-layer" style={{
    opacity, display: hidden ? 'none' : undefined, transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`,
  }}>
    {clip.kind === 'video' && (baked
      ? <img src={baked.videos[clip.id]} style={{ objectFit: style.fit }} alt="" />
      : src && <Media src={src} clip={clip} at={at} fps={project.fps} muted={muted} playing={playing} />)}
    {clip.kind === 'image' && src && <img src={src} style={{ objectFit: style.fit }} alt="" />}
    {clip.kind === 'shape' && <div style={{ width: style.width, height: style.height, background: style.fill, borderRadius: style.radius }} />}
    {clip.kind === 'text' && <div className="scene-text" style={{
      color: style.fill, fontSize: style.fontSize, fontFamily: style.fontFamily, fontWeight: style.bold ? 700 : 400,
    }}>{style.text}</div>}
    {clip.kind === 'react' && (baked
      ? <Markup value={baked.markup[clip.id] || ''} />
      : <ReactLayer bundle={clip.codeId ? sources.bundles[clip.codeId] : undefined} input={input} />)}
  </div>
}
