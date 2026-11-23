import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { isActive, type Project } from '../shared/model'
import { Scene, type SceneSources } from './scene'
import { runtime, type Bundle } from './runtime'

declare global {
  interface Window {
    framewell: {
      prepare: (input: SceneSources & { project: Project }) => Promise<void>
      draw: (frame: number, videos: Record<string, string>) => Promise<void>
      build: (bundle: Bundle, input: unknown) => Promise<unknown>
    }
  }
}

const root = createRoot(document.getElementById('root')!)
let scene: SceneSources & { project: Project }

window.framewell = {
  async prepare(input) { scene = input },
  async draw(frame, videos) {
    const { project, bundles } = scene
    const layerMarkup = await Promise.all(project.tracks.filter(track => !track.hidden).flatMap(track =>
      track.clips.filter(clip => clip.kind === 'react' && isActive(clip, frame)).map(async clip => {
        try {
          const bundle = bundles[clip.codeId!]
          if (!bundle) throw new Error('Project code is unavailable.')
          const markup = await runtime.render(bundle, {
            frame: clip.offset + frame - clip.start, fps: project.fps, width: project.width, height: project.height, props: clip.props,
          })
          return [clip.id, markup] as const
        } catch (error) {
          throw new Error(`React clip “${clip.name}” failed at frame ${frame}: ${error instanceof Error ? error.message : error}`)
        }
      }),
    ))
    flushSync(() => root.render(<Scene project={project} frame={frame} sources={scene}
      baked={{ videos, markup: Object.fromEntries(layerMarkup) }} />))
    await Promise.all([...document.querySelectorAll<HTMLImageElement>('.scene img')].map(image => image.decode()))
    await document.fonts.ready
  },
  build: (compiled, input) => runtime.build(compiled, input),
}
