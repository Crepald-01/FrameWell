import type { CodeFile } from '../shared/model'

export const templates: Record<CodeFile['kind'], { name: string; source: string }> = {
  react: {
    name: 'MotionTitle.tsx',
    source: `import { easeOut } from '@framewell/sdk'

export const defaults = { title: 'Make it move.', accent: '#bfa8ff' }

export default function MotionTitle({ frame, fps, width, props }) {
  const progress = easeOut(frame / (fps * 0.7))
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
      background: '#141121', color: '#fbf9ff', fontFamily: 'Arial',
    }}>
      <div style={{
        padding: '0.24em 0.52em 0.3em', fontSize: Math.min(width * 0.11, 186),
        lineHeight: 1, fontWeight: 800, letterSpacing: '-0.055em',
        borderBottom: \`6px solid \${props.accent ?? defaults.accent}\`,
        opacity: progress, transform: \`translateY(\${(1 - progress) * 72}px)\`,
      }}>
        {props.title ?? defaults.title}
      </div>
    </div>
  )
}
`,
  },
  script: {
    name: 'AnimatedTitle.ts',
    source: `// Start and duration are in frames, measured from the playhead.
export function build({ fps, width }) {
  return [
    {
      name: 'Title',
      clips: [{
        kind: 'text', name: 'Title', start: 0, duration: fps * 4,
        style: { text: 'Made with Framewell', fill: '#ffffff', fontSize: Math.round(width * 0.064) },
        keys: {
          opacity: [
            { frame: 0, value: 0, ease: 'ease-out' },
            { frame: Math.round(fps * 0.65), value: 1, ease: 'linear' },
          ],
          y: [
            { frame: 0, value: 42, ease: 'ease-out' },
            { frame: Math.round(fps * 0.65), value: 0, ease: 'linear' },
          ],
        },
      }],
    },
    {
      name: 'Title background',
      clips: [{
        kind: 'shape', name: 'Title background', start: 0, duration: fps * 4,
        style: { width: Math.round(width * 0.86), height: Math.round(width * 0.18), fill: '#30224f', radius: 32 },
      }],
    },
  ]
}
`,
  },
  module: {
    name: 'colors.ts',
    source: `export const ink = '#141121'
export const paper = '#fbf9ff'
export const accent = '#bfa8ff'
`,
  },
}

export function starter(kind: CodeFile['kind'], existing: CodeFile[]) {
  const template = templates[kind]
  let path = template.name
  let index = 2
  while (existing.some(file => path.toLowerCase() === file.path.toLowerCase())) {
    path = template.name.replace('.', `-${index++}.`)
  }
  return { id: crypto.randomUUID(), path, kind, source: template.source }
}
